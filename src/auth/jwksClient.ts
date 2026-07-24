import type { JsonWebKey } from "node:crypto";

export type SupportedSupabaseJwtAlgorithm = "ES256" | "RS256";

export interface JwksKeyProvider {
  getVerificationKey(
    kid: string,
    algorithm: SupportedSupabaseJwtAlgorithm,
    asOf: string,
  ): Promise<JsonWebKey | undefined>;
}

export interface JwksFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type JwksFetch = (
  url: string,
  init: {
    readonly method: "GET";
    readonly redirect: "manual";
    readonly headers: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  },
) => Promise<JwksFetchResponse>;

export interface RemoteJwksProviderOptions {
  readonly jwksUrl: string;
  readonly cacheTtlMs?: number;
  readonly requestTimeoutMs?: number;
  readonly unknownKidRefreshIntervalMs?: number;
  readonly fetcher?: JwksFetch;
}

interface CacheEntry {
  readonly loadedAtMs: number;
  readonly keys: readonly JsonWebKey[];
}

const MAX_JWKS_BODY_BYTES = 128 * 1024;
const MAX_JWKS_KEYS = 32;

/**
 * Small provider-agnostic remote JWKS cache. It accepts only asymmetric
 * verification keys and refreshes once when a JWT references an unknown kid.
 */
export class RemoteJwksProvider implements JwksKeyProvider {
  readonly #jwksUrl: string;
  readonly #cacheTtlMs: number;
  readonly #requestTimeoutMs: number;
  readonly #unknownKidRefreshIntervalMs: number;
  readonly #fetcher: JwksFetch;
  #cache: CacheEntry | undefined;
  #lastUnknownKidRefreshMs: number | undefined;
  #inFlight: Promise<CacheEntry> | undefined;

  public constructor(options: RemoteJwksProviderOptions) {
    const url = new URL(options.jwksUrl);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
      throw new Error("JWKS URL must be an HTTPS URL without credentials.");
    }
    this.#jwksUrl = url.toString();
    this.#cacheTtlMs = boundedInteger(
      options.cacheTtlMs ?? 10 * 60 * 1000,
      60_000,
      60 * 60 * 1000,
      "JWKS cache TTL",
    );
    this.#requestTimeoutMs = boundedInteger(
      options.requestTimeoutMs ?? 5_000,
      500,
      30_000,
      "JWKS request timeout",
    );
    this.#unknownKidRefreshIntervalMs = boundedInteger(
      options.unknownKidRefreshIntervalMs ?? 60_000,
      1_000,
      this.#cacheTtlMs,
      "JWKS unknown-kid refresh interval",
    );
    this.#fetcher = options.fetcher ?? defaultFetch;
  }

  public async getVerificationKey(
    kid: string,
    algorithm: SupportedSupabaseJwtAlgorithm,
    asOf: string,
  ): Promise<JsonWebKey | undefined> {
    if (kid.trim() === "" || kid.length > 256 || !validDate(asOf)) return undefined;
    const nowMs = Date.parse(asOf);
    let cache = this.#cache;
    const startedWithFreshCache = cache !== undefined &&
      nowMs - cache.loadedAtMs < this.#cacheTtlMs;
    if (!startedWithFreshCache) {
      cache = await this.#refresh(nowMs);
    }
    if (cache === undefined) return undefined;
    let key = selectKey(cache.keys, kid, algorithm);
    if (key !== undefined) return structuredClone(key);

    // A cached key set may be stale during rotation. Limit forced refreshes so
    // random attacker-controlled kid values cannot turn each request into a
    // remote JWKS fetch.
    if (!startedWithFreshCache) {
      this.#lastUnknownKidRefreshMs = nowMs;
      return undefined;
    }
    if (this.#lastUnknownKidRefreshMs !== undefined &&
        nowMs - this.#lastUnknownKidRefreshMs < this.#unknownKidRefreshIntervalMs) {
      return undefined;
    }
    this.#lastUnknownKidRefreshMs = nowMs;
    cache = await this.#refresh(nowMs, true);
    key = selectKey(cache.keys, kid, algorithm);
    return key === undefined ? undefined : structuredClone(key);
  }

  async #refresh(nowMs: number, force = false): Promise<CacheEntry> {
    if (!force && this.#inFlight !== undefined) return this.#inFlight;
    const operation = this.#load(nowMs);
    this.#inFlight = operation;
    try {
      const loaded = await operation;
      this.#cache = loaded;
      return loaded;
    } finally {
      if (this.#inFlight === operation) this.#inFlight = undefined;
    }
  }

  async #load(nowMs: number): Promise<CacheEntry> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#requestTimeoutMs);
    let response: JwksFetchResponse;
    try {
      response = await this.#fetcher(this.#jwksUrl, {
        method: "GET",
        redirect: "manual",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new Error(`JWKS endpoint returned HTTP ${response.status}.`);
    }
    const body = await response.text();
    if (utf8ByteLength(body) > MAX_JWKS_BODY_BYTES) {
      throw new Error("JWKS response exceeds the maximum size.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error("JWKS endpoint returned invalid JSON.");
    }
    const keys = validateJwks(parsed);
    return { loadedAtMs: nowMs, keys };
  }
}

export class InMemoryJwksProvider implements JwksKeyProvider {
  readonly #keys: readonly JsonWebKey[];

  public constructor(keys: readonly JsonWebKey[]) {
    this.#keys = validateJwks({ keys });
  }

  public async getVerificationKey(
    kid: string,
    algorithm: SupportedSupabaseJwtAlgorithm,
    _asOf: string,
  ): Promise<JsonWebKey | undefined> {
    const key = selectKey(this.#keys, kid, algorithm);
    return key === undefined ? undefined : structuredClone(key);
  }
}

function validateJwks(value: unknown): readonly JsonWebKey[] {
  if (!isRecord(value) || !Array.isArray(value.keys) ||
      value.keys.length === 0 || value.keys.length > MAX_JWKS_KEYS) {
    throw new Error("JWKS must contain 1-32 keys.");
  }
  return value.keys.map((candidate) => validateJwk(candidate));
}

function validateJwk(value: unknown): JsonWebKey {
  if (!isRecord(value)) throw new Error("JWKS key must be an object.");
  const kid = stringField(value, "kid");
  const kty = stringField(value, "kty");
  if (kid.length > 256 || (kty !== "EC" && kty !== "RSA")) {
    throw new Error("JWKS contains an unsupported key.");
  }
  const alg = value.alg;
  if (alg !== undefined && alg !== "ES256" && alg !== "RS256") {
    throw new Error("JWKS contains an unsupported algorithm.");
  }
  if (Array.isArray(value.key_ops) && !value.key_ops.includes("verify")) {
    throw new Error("JWKS key is not permitted for verification.");
  }
  return structuredClone(value) as JsonWebKey;
}

function selectKey(
  keys: readonly JsonWebKey[],
  kid: string,
  algorithm: SupportedSupabaseJwtAlgorithm,
): JsonWebKey | undefined {
  return keys.find((key) => key.kid === kid &&
    (key.alg === undefined || key.alg === algorithm) &&
    ((algorithm === "ES256" && key.kty === "EC") ||
      (algorithm === "RS256" && key.kty === "RSA")));
}

async function defaultFetch(
  url: string,
  init: Parameters<JwksFetch>[1],
): Promise<JwksFetchResponse> {
  return fetch(url, init);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.trim() === "") {
    throw new Error(`JWKS key ${key} is missing.`);
  }
  return field;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function validDate(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Date.parse(value));
}
