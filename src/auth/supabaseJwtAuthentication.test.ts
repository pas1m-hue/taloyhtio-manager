import { describe, expect, it } from "vitest";
import {
  generateKeyPairSync,
  sign,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { InMemoryJwksProvider } from "./jwksClient.js";
import { SupabaseJwtAuthenticationPort } from "./supabaseJwtAuthentication.js";

const ISSUER = "https://project-ref.supabase.co/auth/v1";
const AUDIENCE = "authenticated";
const NOW = "2026-07-17T18:00:00.000Z";
const NOW_SECONDS = Math.floor(Date.parse(NOW) / 1000);
const SUBJECT = "123e4567-e89b-12d3-a456-426614174000";

interface TokenClaims {
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

const DEFAULT_CLAIMS: TokenClaims = {
  iss: ISSUER,
  aud: AUDIENCE,
  exp: NOW_SECONDS + 3600,
  iat: NOW_SECONDS - 60,
  sub: SUBJECT,
  role: "authenticated",
  session_id: "223e4567-e89b-12d3-a456-426614174000",
  aal: "aal1",
  email: "admin@example.com",
  is_anonymous: false,
};

describe("Supabase JWT authentication adapter", () => {
  it("verifies a valid RS256 Supabase user token", async () => {
    const key = createSigningKey("RS256", "rsa-key");
    const authentication = adapter(key.publicJwk);
    const identity = await authentication.verify(
      createToken(key.privateKey, "RS256", "rsa-key", DEFAULT_CLAIMS),
      NOW,
    );
    expect(identity).toEqual({
      subjectId: SUBJECT,
      provider: "supabase",
      authenticatedAt: new Date((NOW_SECONDS - 60) * 1000).toISOString(),
      expiresAt: new Date((NOW_SECONDS + 3600) * 1000).toISOString(),
      email: "admin@example.com",
    });
  });

  it("verifies a valid ES256 token and an audience array", async () => {
    const key = createSigningKey("ES256", "ec-key");
    const identity = await adapter(key.publicJwk).verify(
      createToken(key.privateKey, "ES256", "ec-key", {
        ...DEFAULT_CLAIMS,
        aud: ["other", AUDIENCE],
        aal: "aal2",
      }),
      NOW,
    );
    expect(identity?.subjectId).toBe(SUBJECT);
  });

  it("rejects expired, future and not-yet-valid tokens", async () => {
    const key = createSigningKey("RS256", "rsa-time");
    const authentication = adapter(key.publicJwk);
    expect(await authentication.verify(createToken(
      key.privateKey,
      "RS256",
      "rsa-time",
      { ...DEFAULT_CLAIMS, exp: NOW_SECONDS - 31 },
    ), NOW)).toBeUndefined();
    expect(await authentication.verify(createToken(
      key.privateKey,
      "RS256",
      "rsa-time",
      { ...DEFAULT_CLAIMS, iat: NOW_SECONDS + 31 },
    ), NOW)).toBeUndefined();
    expect(await authentication.verify(createToken(
      key.privateKey,
      "RS256",
      "rsa-time",
      { ...DEFAULT_CLAIMS, nbf: NOW_SECONDS + 31 },
    ), NOW)).toBeUndefined();
  });

  it("allows the configured clock tolerance at the exact boundary", async () => {
    const key = createSigningKey("RS256", "rsa-tolerance");
    expect(await adapter(key.publicJwk).verify(createToken(
      key.privateKey,
      "RS256",
      "rsa-tolerance",
      { ...DEFAULT_CLAIMS, iat: NOW_SECONDS + 30 },
    ), NOW)).toBeDefined();
  });

  it("rejects a wrong issuer or audience", async () => {
    const key = createSigningKey("RS256", "rsa-claims");
    const authentication = adapter(key.publicJwk);
    expect(await authentication.verify(createToken(
      key.privateKey,
      "RS256",
      "rsa-claims",
      { ...DEFAULT_CLAIMS, iss: "https://other.supabase.co/auth/v1" },
    ), NOW)).toBeUndefined();
    expect(await authentication.verify(createToken(
      key.privateKey,
      "RS256",
      "rsa-claims",
      { ...DEFAULT_CLAIMS, aud: "anon" },
    ), NOW)).toBeUndefined();
  });

  it("rejects anon, service-role and anonymous user tokens", async () => {
    const key = createSigningKey("RS256", "rsa-role");
    const authentication = adapter(key.publicJwk);
    for (const claims of [
      { ...DEFAULT_CLAIMS, role: "anon" },
      { ...DEFAULT_CLAIMS, role: "service_role" },
      { ...DEFAULT_CLAIMS, is_anonymous: true },
    ]) {
      expect(await authentication.verify(createToken(
        key.privateKey,
        "RS256",
        "rsa-role",
        claims,
      ), NOW)).toBeUndefined();
    }
  });

  it("rejects a wrong signature and an unknown kid", async () => {
    const trusted = createSigningKey("RS256", "trusted");
    const attacker = createSigningKey("RS256", "attacker");
    const authentication = adapter(trusted.publicJwk);
    expect(await authentication.verify(createToken(
      attacker.privateKey,
      "RS256",
      "trusted",
      DEFAULT_CLAIMS,
    ), NOW)).toBeUndefined();
    expect(await authentication.verify(createToken(
      trusted.privateKey,
      "RS256",
      "unknown",
      DEFAULT_CLAIMS,
    ), NOW)).toBeUndefined();
  });

  it("rejects malformed tokens and unsupported algorithms without throwing", async () => {
    const key = createSigningKey("RS256", "rsa-malformed");
    const authentication = adapter(key.publicJwk);
    expect(await authentication.verify("not-a-jwt", NOW)).toBeUndefined();
    expect(await authentication.verify("a.b.c", NOW)).toBeUndefined();
    const header = encode({ alg: "HS256", kid: "rsa-malformed", typ: "JWT" });
    const payload = encode(DEFAULT_CLAIMS);
    expect(await authentication.verify(`${header}.${payload}.AAAA`, NOW)).toBeUndefined();
    expect(await authentication.verify("A".repeat(8_193), NOW)).toBeUndefined();
  });

  it("rejects tokens missing Supabase user-session claims", async () => {
    const key = createSigningKey("RS256", "rsa-required");
    const claims = { ...DEFAULT_CLAIMS } as Record<string, unknown>;
    delete claims.session_id;
    expect(await adapter(key.publicJwk).verify(createToken(
      key.privateKey,
      "RS256",
      "rsa-required",
      claims,
    ), NOW)).toBeUndefined();
  });

  it("does not trust claims when the server asOf timestamp is invalid", async () => {
    const key = createSigningKey("RS256", "rsa-asof");
    expect(await adapter(key.publicJwk).verify(createToken(
      key.privateKey,
      "RS256",
      "rsa-asof",
      DEFAULT_CLAIMS,
    ), "not-a-date")).toBeUndefined();
  });
});

function adapter(publicJwk: JsonWebKey): SupabaseJwtAuthenticationPort {
  return new SupabaseJwtAuthenticationPort({
    issuer: ISSUER,
    audience: AUDIENCE,
    keyProvider: new InMemoryJwksProvider([publicJwk]),
  });
}

function createSigningKey(
  algorithm: "ES256" | "RS256",
  kid: string,
): { readonly privateKey: KeyObject; readonly publicJwk: JsonWebKey } {
  const pair = algorithm === "RS256"
    ? generateKeyPairSync("rsa", { modulusLength: 2048 })
    : generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privateKey: pair.privateKey,
    publicJwk: {
      ...pair.publicKey.export({ format: "jwk" }),
      kid,
      alg: algorithm,
      use: "sig",
      key_ops: ["verify"],
    },
  };
}

function createToken(
  privateKey: KeyObject,
  algorithm: "ES256" | "RS256",
  kid: string,
  claims: unknown,
): string {
  const header = encode({ alg: algorithm, kid, typ: "JWT" });
  const payload = encode(claims);
  const input = `${header}.${payload}`;
  const signature = algorithm === "ES256"
    ? sign("sha256", Buffer.from(input, "ascii"), {
        key: privateKey,
        dsaEncoding: "ieee-p1363",
      })
    : sign("RSA-SHA256", Buffer.from(input, "ascii"), privateKey);
  return `${input}.${signature.toString("base64url")}`;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
