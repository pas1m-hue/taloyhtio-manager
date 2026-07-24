import type { JsonWebKey as NodeJsonWebKey } from "node:crypto";
import type { AuthenticationPort } from "./authenticationPort.js";
import type { VerifiedIdentity } from "./authTypes.js";
import type {
  JwksKeyProvider,
  SupportedSupabaseJwtAlgorithm,
} from "./jwksClient.js";

export interface SupabaseJwtAuthenticationOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly keyProvider: JwksKeyProvider;
  readonly clockToleranceSeconds?: number;
}

interface JwtHeader {
  readonly alg: SupportedSupabaseJwtAlgorithm;
  readonly kid: string;
  readonly typ?: string;
}

interface SupabaseClaims {
  readonly iss: string;
  readonly aud: string | readonly string[];
  readonly exp: number;
  readonly iat: number;
  readonly nbf?: number;
  readonly sub: string;
  readonly role: string;
  readonly session_id: string;
  readonly aal: string;
  readonly email?: string;
  readonly is_anonymous?: boolean;
}

const MAX_JWT_LENGTH = 8_192;

/**
 * Verifies asymmetric Supabase user JWTs locally against the project's JWKS.
 * Legacy HS256 tokens are intentionally not accepted by this adapter.
 */
export class SupabaseJwtAuthenticationPort
implements AuthenticationPort<string> {
  readonly #issuer: string;
  readonly #audience: string;
  readonly #keyProvider: JwksKeyProvider;
  readonly #clockToleranceSeconds: number;

  public constructor(options: SupabaseJwtAuthenticationOptions) {
    this.#issuer = canonicalUrl(options.issuer, "issuer");
    if (options.audience.trim() === "") throw new Error("JWT audience is required.");
    this.#audience = options.audience;
    this.#keyProvider = options.keyProvider;
    this.#clockToleranceSeconds = boundedInteger(
      options.clockToleranceSeconds ?? 30,
      0,
      300,
      "JWT clock tolerance",
    );
  }

  public async verify(
    credential: string,
    asOf: string,
  ): Promise<VerifiedIdentity | undefined> {
    try {
      if (!validDate(asOf) || credential.length === 0 ||
          credential.length > MAX_JWT_LENGTH) return undefined;
      const parts = credential.split(".");
      if (parts.length !== 3) return undefined;
      const encodedHeader = parts[0];
      const encodedPayload = parts[1];
      const encodedSignature = parts[2];
      if (encodedHeader === undefined || encodedPayload === undefined ||
          encodedSignature === undefined) return undefined;

      const header = parseHeader(encodedHeader);
      const claims = parseClaims(encodedPayload);
      const key = await this.#keyProvider.getVerificationKey(
        header.kid,
        header.alg,
        asOf,
      );
      if (key === undefined || !(await verifyJwtSignature(
        header.alg,
        key,
        `${encodedHeader}.${encodedPayload}`,
        encodedSignature,
      ))) return undefined;

      const asOfSeconds = Math.floor(Date.parse(asOf) / 1000);
      if (!validateClaims(
        claims,
        this.#issuer,
        this.#audience,
        asOfSeconds,
        this.#clockToleranceSeconds,
      )) return undefined;

      return {
        subjectId: claims.sub,
        provider: "supabase",
        authenticatedAt: new Date(claims.iat * 1000).toISOString(),
        expiresAt: new Date(claims.exp * 1000).toISOString(),
        ...(claims.email === undefined ? {} : { email: claims.email }),
      };
    } catch {
      return undefined;
    }
  }
}

function parseHeader(encoded: string): JwtHeader {
  const value = parseJsonSegment(encoded);
  if (!isRecord(value)) throw new Error("JWT header is invalid.");
  if (value.alg !== "ES256" && value.alg !== "RS256") {
    throw new Error("JWT algorithm is unsupported.");
  }
  if (typeof value.kid !== "string" || value.kid.trim() === "" ||
      value.kid.length > 256) throw new Error("JWT kid is invalid.");
  if (value.typ !== undefined && value.typ !== "JWT") {
    throw new Error("JWT typ is invalid.");
  }
  return {
    alg: value.alg,
    kid: value.kid,
    ...(value.typ === undefined ? {} : { typ: value.typ }),
  };
}

function parseClaims(encoded: string): SupabaseClaims {
  const value = parseJsonSegment(encoded);
  if (!isRecord(value)) throw new Error("JWT claims are invalid.");
  const aud = value.aud;
  if (typeof aud !== "string" &&
      (!Array.isArray(aud) || !aud.every((item) => typeof item === "string"))) {
    throw new Error("JWT audience is invalid.");
  }
  const claims: SupabaseClaims = {
    iss: requiredString(value, "iss"),
    aud,
    exp: requiredInteger(value, "exp"),
    iat: requiredInteger(value, "iat"),
    sub: requiredString(value, "sub"),
    role: requiredString(value, "role"),
    session_id: requiredString(value, "session_id"),
    aal: requiredString(value, "aal"),
    ...(value.nbf === undefined ? {} : { nbf: requiredInteger(value, "nbf") }),
    ...(value.email === undefined ? {} : { email: requiredString(value, "email") }),
    ...(value.is_anonymous === undefined
      ? {}
      : { is_anonymous: requiredBoolean(value, "is_anonymous") }),
  };
  return claims;
}

function validateClaims(
  claims: SupabaseClaims,
  issuer: string,
  audience: string,
  asOfSeconds: number,
  toleranceSeconds: number,
): boolean {
  if (canonicalUrl(claims.iss, "iss") !== issuer ||
      !audienceIncludes(claims.aud, audience) ||
      claims.exp <= asOfSeconds - toleranceSeconds ||
      claims.iat > asOfSeconds + toleranceSeconds ||
      (claims.nbf !== undefined && claims.nbf > asOfSeconds + toleranceSeconds) ||
      claims.iat >= claims.exp ||
      claims.role !== "authenticated" ||
      claims.is_anonymous === true ||
      (claims.aal !== "aal1" && claims.aal !== "aal2")) {
    return false;
  }
  return true;
}

async function verifyJwtSignature(
  algorithm: SupportedSupabaseJwtAlgorithm,
  jwk: NodeJsonWebKey,
  signingInput: string,
  encodedSignature: string,
): Promise<boolean> {
  const signature = decodeBase64Url(encodedSignature);
  const input = new TextEncoder().encode(signingInput);
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) return false;

  if (algorithm === "ES256") {
    if (signature.length !== 64) return false;
    const publicKey = await subtle.importKey(
      "jwk",
      jwk as unknown as JsonWebKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      signature,
      input,
    );
  }

  const publicKey = await subtle.importKey(
    "jwk",
    jwk as unknown as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, input);
}

function parseJsonSegment(encoded: string): unknown {
  const bytes = decodeBase64Url(encoded);
  if (bytes.length === 0 || bytes.length > 32 * 1024) {
    throw new Error("JWT segment size is invalid.");
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function decodeBase64Url(value: string): Uint8Array {
  if (value === "" || value.includes("=") || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("JWT segment is not canonical base64url.");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.trim() === "") {
    throw new Error(`JWT claim ${key} is invalid.`);
  }
  return field;
}

function requiredInteger(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (!Number.isSafeInteger(field)) {
    throw new Error(`JWT claim ${key} is invalid.`);
  }
  return field as number;
}

function requiredBoolean(value: Record<string, unknown>, key: string): boolean {
  const field = value[key];
  if (typeof field !== "boolean") {
    throw new Error(`JWT claim ${key} is invalid.`);
  }
  return field;
}

function audienceIncludes(
  tokenAudience: string | readonly string[],
  expected: string,
): boolean {
  return typeof tokenAudience === "string"
    ? tokenAudience === expected
    : tokenAudience.includes(expected);
}

function canonicalUrl(value: string, label: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    throw new Error(`JWT ${label} must be an HTTPS URL.`);
  }
  const result = parsed.toString();
  return result.endsWith("/") ? result.slice(0, -1) : result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Date.parse(value));
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
