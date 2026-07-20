import { describe, expect, it, vi } from "vitest";
import worker from "./worker.js";

describe("Cloudflare Worker adapter", () => {
  it("serves non-API requests through the ASSETS binding", async () => {
    const fetch = vi.fn(async () => new Response("asset", { status: 200 }));
    const response = await worker.fetch(new Request("https://example.test/"), {
      ASSETS: { fetch },
      HYPERDRIVE: { connectionString: "postgresql://unused" },
      SUPABASE_JWT_ISSUER: "https://example.supabase.co/auth/v1",
      SUPABASE_JWT_AUDIENCE: "authenticated",
      SUPABASE_JWKS_URL: "https://example.supabase.co/auth/v1/.well-known/jwks.json",
    });
    expect(await response.text()).toBe("asset");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects an invalid visitor session TTL before exposing details", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/v1/health"), {
      ASSETS: { fetch: async () => new Response("asset") },
      HYPERDRIVE: { connectionString: "postgresql://unused" },
      SUPABASE_JWT_ISSUER: "https://example.supabase.co/auth/v1",
      SUPABASE_JWT_AUDIENCE: "authenticated",
      SUPABASE_JWKS_URL: "https://example.supabase.co/auth/v1/.well-known/jwks.json",
      VISITOR_SESSION_TTL_SECONDS: "1",
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "WORKER_RUNTIME_ERROR", message: "Request failed." },
    });
  });
});
