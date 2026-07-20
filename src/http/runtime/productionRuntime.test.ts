import { describe, expect, it } from "vitest";
import {
  generateKeyPairSync,
  sign,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { InMemoryProtectedSessionWorkspaceRepository } from "../../auth/inMemoryProtectedSessionRepository.js";
import type { JwksKeyProvider, SupportedSupabaseJwtAlgorithm } from "../../auth/jwksClient.js";
import { InMemoryCompanyAccessRepository } from "../../auth/companyAccessRepository.js";
import { loadProductionEnvironment } from "../../config/environment.js";
import { adminBaselineSnapshot } from "../../fixtures/adminBaseline.js";
import { InMemoryPublishingRepository } from "../../publishing/publicationRepository.js";
import { FixedServerClock } from "../clock.js";
import { createApplicationHttpRuntime } from "./createRuntime.js";
import { createProductionAuthentication } from "./createProductionRuntime.js";

const CONFIG = loadProductionEnvironment({
  TM_ENV: "production",
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://tm_admin:secret@db.example.com:5432/tm",
  SUPABASE_URL: "https://project-ref.supabase.co",
  PUBLIC_APP_URL: "https://taloyhtio.example.com",
});
const NOW = "2026-07-17T18:00:00.000Z";
const NOW_SECONDS = Math.floor(Date.parse(NOW) / 1000);
const SUBJECT_ID = "123e4567-e89b-12d3-a456-426614174000";

class RecordingKeyProvider implements JwksKeyProvider {
  public calls: Array<{
    readonly kid: string;
    readonly algorithm: SupportedSupabaseJwtAlgorithm;
    readonly asOf: string;
  }> = [];

  public async getVerificationKey(
    kid: string,
    algorithm: SupportedSupabaseJwtAlgorithm,
    asOf: string,
  ): Promise<JsonWebKey | undefined> {
    this.calls.push({ kid, algorithm, asOf });
    return undefined;
  }
}

describe("production runtime composition", () => {
  it("uses the Supabase JWT verifier and never accepts an opaque demo token", async () => {
    const provider = new RecordingKeyProvider();
    const authentication = createProductionAuthentication(CONFIG, provider);
    expect(await authentication.verify(
      "local-development-admin-token",
      NOW,
    )).toBeUndefined();
    expect(provider.calls).toHaveLength(0);
  });

  it("authorizes a signed Supabase user JWT through the real HTTP admin boundary", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk: JsonWebKey = {
      ...pair.publicKey.export({ format: "jwk" }),
      kid: "production-key",
      alg: "RS256",
      key_ops: ["verify"],
    };
    const authentication = createProductionAuthentication(CONFIG, {
      getVerificationKey: async () => publicJwk,
    });
    const publications = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    const access = new InMemoryCompanyAccessRepository([{
      companyId: adminBaselineSnapshot.companyId,
      subjectId: SUBJECT_ID,
      role: "admin",
      active: true,
      grantedAt: "2026-01-01T00:00:00.000Z",
      grantedBy: "bootstrap",
    }]);
    const server = createApplicationHttpRuntime(authentication, {
      publications,
      sessions: new InMemoryProtectedSessionWorkspaceRepository(),
      access,
    }, { clock: new FixedServerClock(NOW) });
    const token = createToken(pair.privateKey, {
      iss: CONFIG.supabaseJwtIssuer,
      aud: CONFIG.supabaseJwtAudience,
      exp: NOW_SECONDS + 3600,
      iat: NOW_SECONDS - 60,
      sub: SUBJECT_ID,
      role: "authenticated",
      session_id: "223e4567-e89b-12d3-a456-426614174000",
      aal: "aal1",
      email: "admin@example.com",
      is_anonymous: false,
    });
    const response = await server.inject({
      url: `/api/v1/admin/companies/${adminBaselineSnapshot.companyId}/workspace?startYear=2026&endYear=2036`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ companyId: string }>().companyId)
      .toBe(adminBaselineSnapshot.companyId);
  });

  it("derives one exact Supabase issuer and JWKS endpoint from configuration", () => {
    expect(CONFIG.supabaseJwtIssuer)
      .toBe("https://project-ref.supabase.co/auth/v1");
    expect(CONFIG.supabaseJwksUrl)
      .toBe("https://project-ref.supabase.co/auth/v1/.well-known/jwks.json");
    expect(CONFIG.supabaseJwtAudience).toBe("authenticated");
  });

  it("keeps visitor authentication capability-based rather than Supabase-account based", () => {
    expect(CONFIG.visitorSessionTtlSeconds).toBe(86_400);
    expect(CONFIG).not.toHaveProperty("visitorSupabaseAudience");
    expect(CONFIG).not.toHaveProperty("supabaseServiceRoleKey");
  });
});

function createToken(privateKey: KeyObject, claims: unknown): string {
  const header = Buffer.from(JSON.stringify({
    alg: "RS256",
    kid: "production-key",
    typ: "JWT",
  })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const input = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(input, "ascii"), privateKey);
  return `${input}.${signature.toString("base64url")}`;
}
