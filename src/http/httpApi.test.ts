import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuthenticationPort } from "../auth/authenticationPort.js";
import { InMemoryCompanyAccessRepository } from "../auth/companyAccessRepository.js";
import { SecuredAdminApplicationFacade } from "../application/securedAdminFacade.js";
import { adminBaselineSnapshot } from "../fixtures/adminBaseline.js";
import { InMemoryAdminDataRepository } from "../admin/adminRepository.js";
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
let publications: InMemoryAdminDataRepository;

beforeEach(async () => {
  publications = new InMemoryAdminDataRepository([adminBaselineSnapshot]);
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
  server = createHttpServer({
    admin: new SecuredAdminApplicationFacade(authentication, access, publications),
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
    expect(response.body).toContain("<h2 id=\"overview-title\">Yleiskuva</h2>");
    expect(response.body).not.toContain("visitor-mode");
    expect(response.body).toContain('src="/app.js"');
    expect(response.body).not.toContain("<script>");
  });

  it("rejects browser-supplied trusted timestamps", async () => {
    const response = await server.inject({
      method: "POST",
      url: `/api/v1/admin/companies/${COMPANY_ID}/changes`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        expectedRevision: 0,
        occurredAt: "2000-01-01T00:00:00.000Z",
        horizon: { startYear: 2026, endYear: 2057 },
        operations: [{ type: "save_housing_company", value: adminBaselineSnapshot.housingCompany }],
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

  it("rejects actor metadata supplied by the browser", async () => {
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

  it("answers every removed publication and visitor route with a JSON 404", async () => {
    // The publication pipeline and the visitor side are gone. Their routes
    // must fall through to the stable 404, not to a 500 from a missing
    // dependency - with and without a valid admin token, so the admin
    // routes cannot be mistaken for an authentication failure either.
    const removed = [
      { method: "GET", url: `/api/v1/public/companies/${COMPANY_ID}/overview${HORIZON}` },
      { method: "POST", url: `/api/v1/public/companies/${COMPANY_ID}/sessions` },
      { method: "GET", url: "/api/v1/public/sessions/session_1" },
      { method: "PATCH", url: "/api/v1/public/sessions/session_1" },
      { method: "POST", url: "/api/v1/public/sessions/session_1/reset" },
      { method: "POST", url: `/api/v1/admin/companies/${COMPANY_ID}/publish` },
      { method: "GET", url: `/api/v1/admin/companies/${COMPANY_ID}/publications` },
    ];
    for (const route of removed) {
      for (const headers of [{}, { authorization: `Bearer ${ADMIN_TOKEN}` }]) {
        const response = await server.inject({
          method: route.method,
          url: route.url,
          headers,
          ...(route.method === "GET" ? {} : { payload: {} }),
        });
        expect(response.statusCode, `${route.method} ${route.url}`).toBe(404);
        expect(response.json<{ error: { code: string } }>().error.code)
          .toBe("HTTP_ROUTE_NOT_FOUND");
      }
    }
  });

  it("requires a bearer token on every remaining API route except health", async () => {
    const health = await server.inject({ url: "/api/v1/health" });
    expect(health.statusCode).toBe(200);

    const protectedRoutes = [
      { method: "GET", url: `/api/v1/admin/companies/${COMPANY_ID}/workspace${HORIZON}` },
      { method: "GET", url: `/api/v1/admin/companies/${COMPANY_ID}/preview${HORIZON}` },
      { method: "POST", url: `/api/v1/admin/companies/${COMPANY_ID}/changes` },
    ];
    for (const route of protectedRoutes) {
      const response = await server.inject({
        method: route.method,
        url: route.url,
        ...(route.method === "GET" ? {} : { payload: {} }),
      });
      expect(response.statusCode, `${route.method} ${route.url}`).toBe(401);
      expect(response.json<{ error: { code: string } }>().error.code)
        .toBe("UNAUTHENTICATED");
    }
  });
});
