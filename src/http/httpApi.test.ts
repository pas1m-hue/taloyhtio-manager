import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuthenticationPort } from "../auth/authenticationPort.js";
import { InMemoryCompanyAccessRepository } from "../auth/companyAccessRepository.js";
import { InMemoryProtectedSessionWorkspaceRepository } from "../auth/inMemoryProtectedSessionRepository.js";
import { PublicVisitorApplicationFacade } from "../application/publicVisitorFacade.js";
import { SecuredAdminApplicationFacade } from "../application/securedAdminFacade.js";
import { adminBaselineSnapshot } from "../fixtures/adminBaseline.js";
import { publishAdminData } from "../publishing/publishAdminData.js";
import { InMemoryPublishingRepository } from "../publishing/publicationRepository.js";
import { FixedServerClock } from "./clock.js";
import { createHttpServer, type TaloyhtioHttpServer } from "./createHttpServer.js";

const COMPANY_ID = adminBaselineSnapshot.companyId;
const ADMIN_TOKEN = "valid-admin-token-with-safe-length";
const NO_ACCESS_TOKEN = "valid-no-access-token-safe-length";
const NOW = "2026-07-17T21:00:00.000Z";
const HORIZON = "?startYear=2026&endYear=2057";
const PUBLIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public",
);

let server: TaloyhtioHttpServer;
let publications: InMemoryPublishingRepository;

beforeEach(async () => {
  publications = new InMemoryPublishingRepository([adminBaselineSnapshot]);
  await publishAdminData(publications, {
    companyId: COMPANY_ID,
    expectedAdminRevision: 0,
    expectedPublishedVersion: 0,
    publishedAt: "2026-07-17T20:00:00.000Z",
    publishedBy: "admin:pasi",
    sourceIds: ["initial_publication"],
    explanation: "Initial publication for HTTP tests.",
  });
  const authentication = new InMemoryAuthenticationPort({
    [ADMIN_TOKEN]: {
      subjectId: "admin:pasi",
      provider: "test",
      authenticatedAt: "2026-07-17T19:00:00.000Z",
      expiresAt: "2026-07-18T19:00:00.000Z",
    },
    [NO_ACCESS_TOKEN]: {
      subjectId: "admin:outsider",
      provider: "test",
      authenticatedAt: "2026-07-17T19:00:00.000Z",
      expiresAt: "2026-07-18T19:00:00.000Z",
    },
  });
  const access = new InMemoryCompanyAccessRepository([{
    companyId: COMPANY_ID,
    subjectId: "admin:pasi",
    role: "admin",
    active: true,
    grantedAt: "2026-01-01T00:00:00.000Z",
    grantedBy: "system",
  }]);
  const sessions = new InMemoryProtectedSessionWorkspaceRepository();
  server = createHttpServer({
    admin: new SecuredAdminApplicationFacade(authentication, access, publications),
    visitor: new PublicVisitorApplicationFacade(publications, sessions),
    clock: new FixedServerClock(NOW),
    publicDirectory: PUBLIC_DIR,
  });
});

afterEach(async () => {
  await server.close();
});

describe("V2.7 HTTP API boundary", () => {
  it("serves health and strict security headers", async () => {
    const response = await server.inject({ url: "/api/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "taloyhtio-manager",
      apiVersion: "v1",
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["content-security-policy"]).toContain("script-src 'self'");
  });

  it("serves the browser UI without inline script permissions", async () => {
    const response = await server.inject({ url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Visitor-skenaario");
    expect(response.body).toContain('src="/app.js"');
    expect(response.body).not.toContain("<script>");
  });

  it("loads the published visitor overview without authentication", async () => {
    const response = await server.inject({
      url: `/api/v1/public/companies/${COMPANY_ID}/overview${HORIZON}`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ publicationVersion: number; data: { approvedEvents: unknown[] } }>();
    expect(body.publicationVersion).toBe(1);
    expect(body.data.approvedEvents.length).toBeGreaterThan(0);
  });

  it("creates a protected session and never returns the token from later reads", async () => {
    const created = await createSession();
    expect(created.statusCode).toBe(201);
    const handle = created.json<{
      credential: { sessionId: string; accessToken: string };
      view: { sessionRevision: number };
    }>();
    expect(handle.credential.accessToken.length).toBeGreaterThanOrEqual(32);

    const loaded = await server.inject({
      url: `/api/v1/public/sessions/${handle.credential.sessionId}`,
      headers: { "x-tm-session-token": handle.credential.accessToken },
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.body).not.toContain(handle.credential.accessToken);
    expect(loaded.json<{ sessionRevision: number }>().sessionRevision).toBe(0);
  });

  it("rejects a missing or wrong visitor capability", async () => {
    const handle = (await createSession()).json<{
      credential: { sessionId: string; accessToken: string };
    }>();
    const missing = await server.inject({
      url: `/api/v1/public/sessions/${handle.credential.sessionId}`,
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.json<{ error: { code: string } }>().error.code)
      .toBe("INVALID_SESSION_CREDENTIAL");

    const wrong = await server.inject({
      url: `/api/v1/public/sessions/${handle.credential.sessionId}`,
      headers: { "x-tm-session-token": "wrong_token_value_that_is_long_enough_123456" },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it("applies and resets visitor deltas with optimistic locking", async () => {
    const handle = (await createSession()).json<{
      credential: { sessionId: string; accessToken: string };
    }>();
    const changed = await server.inject({
      method: "PATCH",
      url: `/api/v1/public/sessions/${handle.credential.sessionId}`,
      headers: { "x-tm-session-token": handle.credential.accessToken },
      payload: {
        expectedRevision: 0,
        operations: [{ type: "set_horizon", value: { startYear: 2028, endYear: 2040 } }],
      },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json<{ sessionRevision: number; horizon: { startYear: number } }>()
      .sessionRevision).toBe(1);

    const stale = await server.inject({
      method: "PATCH",
      url: `/api/v1/public/sessions/${handle.credential.sessionId}`,
      headers: { "x-tm-session-token": handle.credential.accessToken },
      payload: {
        expectedRevision: 0,
        operations: [{ type: "set_horizon", value: { startYear: 2029, endYear: 2040 } }],
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { code: string } }>().error.code)
      .toBe("SESSION_REVISION_CONFLICT");

    const reset = await server.inject({
      method: "POST",
      url: `/api/v1/public/sessions/${handle.credential.sessionId}/reset`,
      headers: { "x-tm-session-token": handle.credential.accessToken },
      payload: { expectedRevision: 1 },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json<{ changes: { modificationCount: number } }>()
      .changes.modificationCount).toBe(0);
  });

  it("rejects browser-supplied trusted timestamps", async () => {
    const handle = (await createSession()).json<{
      credential: { sessionId: string; accessToken: string };
    }>();
    const response = await server.inject({
      method: "PATCH",
      url: `/api/v1/public/sessions/${handle.credential.sessionId}`,
      headers: { "x-tm-session-token": handle.credential.accessToken },
      payload: {
        expectedRevision: 0,
        occurredAt: "2000-01-01T00:00:00.000Z",
        operations: [{ type: "reset_workspace" }],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code)
      .toBe("INVALID_HTTP_REQUEST");
  });

  it("requires an admin bearer token and a company grant", async () => {
    const missing = await server.inject({
      url: `/api/v1/admin/companies/${COMPANY_ID}/workspace${HORIZON}`,
    });
    expect(missing.statusCode).toBe(401);

    const denied = await server.inject({
      url: `/api/v1/admin/companies/${COMPANY_ID}/workspace${HORIZON}`,
      headers: { authorization: `Bearer ${NO_ACCESS_TOKEN}` },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json<{ error: { code: string } }>().error.code)
      .toBe("ACCESS_DENIED");
  });

  it("loads the admin workspace with the verified identity", async () => {
    const response = await server.inject({
      url: `/api/v1/admin/companies/${COMPANY_ID}/workspace${HORIZON}`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ adminRevision: number; updatedBy: string }>();
    expect(body.adminRevision).toBe(0);
    expect(body.updatedBy).toBe("admin:pasi");
  });

  it("adds actor and timestamp server-side to an admin batch", async () => {
    const response = await server.inject({
      method: "POST",
      url: `/api/v1/admin/companies/${COMPANY_ID}/changes`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        expectedRevision: 0,
        horizon: { startYear: 2026, endYear: 2057 },
        operations: [{
          type: "save_housing_company",
          value: { ...adminBaselineSnapshot.housingCompany, name: "HTTP updated" },
          sourceIds: ["manual_http"],
          explanation: "Manual browser update.",
        }],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      adminRevision: number;
      auditTrail: { actorId: string; occurredAt: string }[];
    }>();
    expect(body.adminRevision).toBe(1);
    expect(body.auditTrail.at(-1)).toMatchObject({
      actorId: "admin:pasi",
      occurredAt: NOW,
    });
  });

  it("rejects actor and publication metadata supplied by the browser", async () => {
    const actor = await server.inject({
      method: "POST",
      url: `/api/v1/admin/companies/${COMPANY_ID}/changes`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        expectedRevision: 0,
        actorId: "attacker",
        horizon: { startYear: 2026, endYear: 2057 },
        operations: [{ type: "save_housing_company", value: adminBaselineSnapshot.housingCompany }],
      },
    });
    expect(actor.statusCode).toBe(400);

    const publisher = await server.inject({
      method: "POST",
      url: `/api/v1/admin/companies/${COMPANY_ID}/publish`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        expectedAdminRevision: 0,
        expectedPublishedVersion: 1,
        publishedBy: "attacker",
        sourceIds: ["manual"],
        explanation: "Invalid metadata.",
      },
    });
    expect(publisher.statusCode).toBe(400);
  });

  it("maps stale admin writes to HTTP 409", async () => {
    const payload = {
      expectedRevision: 0,
      horizon: { startYear: 2026, endYear: 2057 },
      operations: [{
        type: "save_housing_company",
        value: { ...adminBaselineSnapshot.housingCompany, name: "First" },
        sourceIds: ["manual_http"],
        explanation: "First update.",
      }],
    };
    const first = await server.inject({
      method: "POST",
      url: `/api/v1/admin/companies/${COMPANY_ID}/changes`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload,
    });
    expect(first.statusCode).toBe(200);
    const stale = await server.inject({
      method: "POST",
      url: `/api/v1/admin/companies/${COMPANY_ID}/changes`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { code: string } }>().error.code)
      .toBe("ADMIN_REVISION_CONFLICT");
  });

  it("can serve the same API through a real ephemeral TCP listener", async () => {
    const address = await server.listen({ port: 0 });
    const response = await fetch(`${address}/api/v1/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("returns a stable JSON 404 and exposes no public admin write route", async () => {
    const response = await server.inject({
      method: "POST",
      url: `/api/v1/public/companies/${COMPANY_ID}/publish`,
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code)
      .toBe("HTTP_ROUTE_NOT_FOUND");
  });
});

async function createSession() {
  return server.inject({
    method: "POST",
    url: `/api/v1/public/companies/${COMPANY_ID}/sessions`,
    payload: {
      publicationVersion: 1,
      horizon: { startYear: 2026, endYear: 2057 },
    },
  });
}
