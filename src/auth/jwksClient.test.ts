import { describe, expect, it } from "vitest";
import { generateKeyPairSync, type JsonWebKey } from "node:crypto";
import {
  RemoteJwksProvider,
  type JwksFetch,
} from "./jwksClient.js";

const NOW = "2026-07-17T18:00:00.000Z";

describe("remote JWKS provider", () => {
  it("caches a valid asymmetric key set", async () => {
    const key = publicJwk("cached");
    let calls = 0;
    const provider = new RemoteJwksProvider({
      jwksUrl: "https://project.supabase.co/auth/v1/.well-known/jwks.json",
      fetcher: response(() => {
        calls += 1;
        return { keys: [key] };
      }),
    });
    expect((await provider.getVerificationKey("cached", "RS256", NOW))?.kid)
      .toBe("cached");
    expect((await provider.getVerificationKey("cached", "RS256", NOW))?.kid)
      .toBe("cached");
    expect(calls).toBe(1);
  });

  it("refreshes once when key rotation introduces an unknown kid", async () => {
    const oldKey = publicJwk("old");
    const newKey = publicJwk("new");
    let calls = 0;
    const provider = new RemoteJwksProvider({
      jwksUrl: "https://project.supabase.co/auth/v1/.well-known/jwks.json",
      fetcher: response(() => {
        calls += 1;
        return { keys: calls === 1 ? [oldKey] : [oldKey, newKey] };
      }),
    });
    expect(await provider.getVerificationKey("old", "RS256", NOW)).toBeDefined();
    expect(await provider.getVerificationKey("new", "RS256", NOW)).toBeDefined();
    expect(calls).toBe(2);
  });

  it("returns undefined after one refresh for a genuinely unknown kid", async () => {
    let calls = 0;
    const provider = new RemoteJwksProvider({
      jwksUrl: "https://project.supabase.co/auth/v1/.well-known/jwks.json",
      fetcher: response(() => {
        calls += 1;
        return { keys: [publicJwk("known")] };
      }),
    });
    expect(await provider.getVerificationKey("missing", "RS256", NOW))
      .toBeUndefined();
    expect(await provider.getVerificationKey("another-missing", "RS256", NOW))
      .toBeUndefined();
    expect(calls).toBe(1);
  });

  it("rejects HTTP failures, oversized/invalid JSON and symmetric keys", async () => {
    const failed = new RemoteJwksProvider({
      jwksUrl: "https://project.supabase.co/auth/v1/.well-known/jwks.json",
      fetcher: async () => ({ ok: false, status: 503, text: async () => "" }),
    });
    await expect(failed.getVerificationKey("kid", "RS256", NOW))
      .rejects.toThrow(/503/);

    const invalid = new RemoteJwksProvider({
      jwksUrl: "https://project.supabase.co/auth/v1/.well-known/jwks.json",
      fetcher: async () => ({ ok: true, status: 200, text: async () => "{" }),
    });
    await expect(invalid.getVerificationKey("kid", "RS256", NOW))
      .rejects.toThrow(/invalid JSON/);

    const symmetric = new RemoteJwksProvider({
      jwksUrl: "https://project.supabase.co/auth/v1/.well-known/jwks.json",
      fetcher: response(() => ({
        keys: [{ kty: "oct", kid: "kid", alg: "HS256", k: "secret" }],
      })),
    });
    await expect(symmetric.getVerificationKey("kid", "RS256", NOW))
      .rejects.toThrow(/unsupported/);
  });

  it("requires HTTPS and bounded cache settings", () => {
    expect(() => new RemoteJwksProvider({
      jwksUrl: "http://project.supabase.co/jwks",
    })).toThrow(/HTTPS/);
    expect(() => new RemoteJwksProvider({
      jwksUrl: "https://project.supabase.co/jwks",
      cacheTtlMs: 1,
    })).toThrow(/cache TTL/);
  });
});

function publicJwk(kid: string): JsonWebKey {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    ...pair.publicKey.export({ format: "jwk" }),
    kid,
    alg: "RS256",
    use: "sig",
    key_ops: ["verify"],
  };
}

function response(factory: () => unknown): JwksFetch {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(factory()),
  });
}
