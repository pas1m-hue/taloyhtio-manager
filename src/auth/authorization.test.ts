import { describe, expect, it } from "vitest";
import type {
  AdminDataOperation,
  Horizon,
} from "../domain/types.js";
import type {
  CompanyAccessGrant,
  VerifiedIdentity,
} from "./authTypes.js";
import { InMemoryCompanyAccessRepository } from "./companyAccessRepository.js";
import { InMemoryProtectedSessionWorkspaceRepository } from "./inMemoryProtectedSessionRepository.js";
import { InMemoryAuthenticationPort } from "./authenticationPort.js";
import { SecuredAdminApplicationFacade } from "../application/securedAdminFacade.js";
import { PublicVisitorApplicationFacade } from "../application/publicVisitorFacade.js";
import {
  SecureSessionCredentialGenerator,
  type SessionCredentialGenerator,
} from "./sessionCredential.js";
import { InMemoryPublishingRepository } from "../publishing/publicationRepository.js";
import { adminBaselineSnapshot } from "../fixtures/adminBaseline.js";
import {
  applyAuthorizedAdminChanges,
  loadAuthorizedAdminWorkspace,
  previewAuthorizedAdminCalculations,
} from "../application/authorizedAdminApplicationService.js";
import {
  loadAuthorizedPublicationHistory,
  publishAuthorizedAdminRevision,
} from "../application/authorizedPublishingApplicationService.js";
import {
  applyProtectedVisitorSessionChanges,
  createProtectedVisitorSession,
  loadProtectedVisitorScenario,
  resetProtectedVisitorSession,
  revokeProtectedVisitorSession,
} from "../application/protectedVisitorApplicationService.js";

const COMPANY_ID = adminBaselineSnapshot.companyId;
const NOW = "2026-07-17T20:00:00+03:00";
const HORIZON: Horizon = { startYear: 2026, endYear: 2057 };
const IDENTITY: VerifiedIdentity = {
  subjectId: "user:pasi",
  provider: "test-oidc",
  authenticatedAt: "2026-07-17T19:30:00+03:00",
  expiresAt: "2026-07-17T22:00:00+03:00",
  email: "pasi@example.test",
};
const GRANT: CompanyAccessGrant = {
  companyId: COMPANY_ID,
  subjectId: IDENTITY.subjectId,
  role: "admin",
  active: true,
  grantedAt: "2026-07-01T10:00:00+03:00",
  grantedBy: "deployment:bootstrap",
};

function operations(): readonly AdminDataOperation[] {
  return [{
    type: "save_housing_company",
    value: {
      ...adminBaselineSnapshot.housingCompany,
      name: "Authorized company name",
    },
    sourceIds: ["manual_admin_update"],
    explanation: "Authorized name update.",
  }];
}

async function publishedRepository(): Promise<InMemoryPublishingRepository> {
  const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
  const access = new InMemoryCompanyAccessRepository([GRANT]);
  await publishAuthorizedAdminRevision(repository, access, IDENTITY, {
    companyId: COMPANY_ID,
    expectedAdminRevision: 0,
    expectedPublishedVersion: 0,
    sourceIds: ["initial_publication"],
    explanation: "Initial publication.",
  }, NOW);
  return repository;
}

class FixedCredentialGenerator implements SessionCredentialGenerator {
  readonly #sessionId: string;
  readonly #accessToken: string;

  public constructor(sessionId: string, accessToken: string) {
    this.#sessionId = sessionId;
    this.#accessToken = accessToken;
  }

  public create() {
    return { sessionId: this.#sessionId, accessToken: this.#accessToken };
  }
}

describe("V2.6 admin authentication and authorization boundary", () => {
  it("rejects missing, expired and malformed identities", async () => {
    const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    const access = new InMemoryCompanyAccessRepository([GRANT]);
    await expect(loadAuthorizedAdminWorkspace(
      repository, access, undefined, COMPANY_ID, HORIZON, NOW,
    )).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    await expect(loadAuthorizedAdminWorkspace(
      repository,
      access,
      { ...IDENTITY, expiresAt: "2026-07-17T19:59:59+03:00" },
      COMPANY_ID,
      HORIZON,
      NOW,
    )).rejects.toMatchObject({ code: "INVALID_AUTH_CONTEXT" });

    await expect(loadAuthorizedAdminWorkspace(
      repository,
      access,
      { ...IDENTITY, subjectId: "" },
      COMPANY_ID,
      HORIZON,
      NOW,
    )).rejects.toMatchObject({ code: "INVALID_AUTH_CONTEXT" });
  });

  it("requires an active company-specific admin grant", async () => {
    const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    const noAccess = new InMemoryCompanyAccessRepository();
    await expect(loadAuthorizedAdminWorkspace(
      repository, noAccess, IDENTITY, COMPANY_ID, HORIZON, NOW,
    )).rejects.toMatchObject({ code: "ACCESS_DENIED" });

    const otherCompany = new InMemoryCompanyAccessRepository([{
      ...GRANT,
      companyId: "other-company",
    }]);
    await expect(loadAuthorizedAdminWorkspace(
      repository, otherCompany, IDENTITY, COMPANY_ID, HORIZON, NOW,
    )).rejects.toMatchObject({ code: "ACCESS_DENIED" });

    const revoked = new InMemoryCompanyAccessRepository([{
      ...GRANT,
      active: false,
      revokedAt: "2026-07-10T10:00:00+03:00",
      revokedBy: "deployment:bootstrap",
    }]);
    await expect(loadAuthorizedAdminWorkspace(
      repository, revoked, IDENTITY, COMPANY_ID, HORIZON, NOW,
    )).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });

  it("injects the verified subject into admin audit instead of trusting UI input", async () => {
    const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    const access = new InMemoryCompanyAccessRepository([GRANT]);
    const dashboard = await applyAuthorizedAdminChanges(
      repository,
      access,
      IDENTITY,
      {
        companyId: COMPANY_ID,
        expectedRevision: 0,
        operations: operations(),
      },
      HORIZON,
      NOW,
    );
    expect(dashboard.auditTrail.at(-1)?.actorId)
      .toBe(IDENTITY.subjectId);
    expect((await repository.load(COMPANY_ID))!.updatedBy)
      .toBe(IDENTITY.subjectId);
  });

  it("overrides spoofed browser audit and publication metadata with server values", async () => {
    const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    const access = new InMemoryCompanyAccessRepository([GRANT]);
    const maliciousAdminCommand = {
      companyId: COMPANY_ID,
      expectedRevision: 0,
      actorId: "attacker",
      occurredAt: "2000-01-01T00:00:00Z",
      operations: operations(),
    };
    const dashboard = await applyAuthorizedAdminChanges(
      repository,
      access,
      IDENTITY,
      maliciousAdminCommand,
      HORIZON,
      NOW,
    );
    expect(dashboard.auditTrail.at(-1)).toMatchObject({
      actorId: IDENTITY.subjectId,
      occurredAt: NOW,
    });

    const maliciousPublishCommand = {
      companyId: COMPANY_ID,
      expectedAdminRevision: 1,
      expectedPublishedVersion: 0,
      publishedAt: "2000-01-01T00:00:00Z",
      publishedBy: "attacker",
      sourceIds: ["publication_source"],
      explanation: "Authorized publication.",
    };
    const publication = await publishAuthorizedAdminRevision(
      repository,
      access,
      IDENTITY,
      maliciousPublishCommand,
      NOW,
    );
    expect(publication).toMatchObject({
      publishedBy: IDENTITY.subjectId,
      publishedAt: NOW,
    });
  });

  it("injects the verified subject into publication metadata", async () => {
    const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    const access = new InMemoryCompanyAccessRepository([GRANT]);
    const result = await publishAuthorizedAdminRevision(
      repository,
      access,
      IDENTITY,
      {
        companyId: COMPANY_ID,
        expectedAdminRevision: 0,
        expectedPublishedVersion: 0,
        sourceIds: ["publication_source"],
        explanation: "Authorized publication.",
      },
      NOW,
    );
    expect(result.publishedBy).toBe(IDENTITY.subjectId);
    expect((await repository.loadCurrent(COMPANY_ID))!.publishedBy)
      .toBe(IDENTITY.subjectId);
  });

  it("authorizes all admin-facing application reads through the same grant", async () => {
    const repository = await publishedRepository();
    const access = new InMemoryCompanyAccessRepository([GRANT]);
    await expect(loadAuthorizedAdminWorkspace(
      repository, access, IDENTITY, COMPANY_ID, HORIZON, NOW,
    )).resolves.toMatchObject({ companyId: COMPANY_ID });
    await expect(previewAuthorizedAdminCalculations(
      repository, access, IDENTITY, COMPANY_ID, HORIZON, NOW,
    )).resolves.toHaveProperty("projection");
    await expect(loadAuthorizedPublicationHistory(
      repository, access, IDENTITY, COMPANY_ID, NOW,
    )).resolves.toMatchObject({ currentPublicationVersion: 1 });
  });
});

describe("V2.6 session credential generation", () => {
  it("generates a server capability with 32 random bytes", () => {
    const credential = new SecureSessionCredentialGenerator().create();
    expect(credential.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Buffer.from(credential.accessToken, "base64url")).toHaveLength(32);
  });
});

describe("V2.6 protected anonymous visitor sessions", () => {
  it("generates the session id and capability on the server and stores only a hash", async () => {
    const publications = await publishedRepository();
    const sessions = new InMemoryProtectedSessionWorkspaceRepository();
    const token = "A".repeat(43);
    const result = await createProtectedVisitorSession(
      publications,
      sessions,
      {
        companyId: COMPANY_ID,
        publicationVersion: 1,
        createdAt: NOW,
        expiresAt: "2026-07-18T20:00:00+03:00",
        horizon: HORIZON,
      },
      new FixedCredentialGenerator("server-session-id", token),
    );
    expect(result.credential).toEqual({
      sessionId: "server-session-id",
      accessToken: token,
    });
    expect(result.view.sessionId).toBe("server-session-id");
    expect(JSON.stringify(result.view)).not.toContain(token);
    expect(JSON.stringify(await sessions.load("server-session-id")))
      .not.toContain(token);
    const access = await sessions.loadAccessRecord("server-session-id");
    expect(access?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(access?.tokenHash).not.toBe(token);
  });

  it("accepts the correct capability and rejects a wrong or cross-session token", async () => {
    const publications = await publishedRepository();
    const sessions = new InMemoryProtectedSessionWorkspaceRepository();
    const first = await createProtectedVisitorSession(
      publications,
      sessions,
      {
        companyId: COMPANY_ID,
        publicationVersion: 1,
        createdAt: NOW,
        expiresAt: "2026-07-18T20:00:00+03:00",
        horizon: HORIZON,
      },
      new FixedCredentialGenerator("session-one", "B".repeat(43)),
    );
    const second = await createProtectedVisitorSession(
      publications,
      sessions,
      {
        companyId: COMPANY_ID,
        publicationVersion: 1,
        createdAt: NOW,
        expiresAt: "2026-07-18T20:00:00+03:00",
        horizon: HORIZON,
      },
      new FixedCredentialGenerator("session-two", "C".repeat(43)),
    );

    await expect(loadProtectedVisitorScenario(
      publications,
      sessions,
      first.credential,
      "2026-07-17T20:05:00+03:00",
    )).resolves.toMatchObject({ sessionId: "session-one" });

    await expect(loadProtectedVisitorScenario(
      publications,
      sessions,
      { sessionId: "session-one", accessToken: "D".repeat(43) },
      "2026-07-17T20:05:00+03:00",
    )).rejects.toMatchObject({ code: "INVALID_SESSION_CREDENTIAL" });

    await expect(loadProtectedVisitorScenario(
      publications,
      sessions,
      { sessionId: "session-one", accessToken: second.credential.accessToken },
      "2026-07-17T20:05:00+03:00",
    )).rejects.toMatchObject({ code: "INVALID_SESSION_CREDENTIAL" });
  });

  it("protects apply and reset with the same capability and revision checks", async () => {
    const publications = await publishedRepository();
    const sessions = new InMemoryProtectedSessionWorkspaceRepository();
    const handle = await createProtectedVisitorSession(
      publications,
      sessions,
      {
        companyId: COMPANY_ID,
        publicationVersion: 1,
        createdAt: NOW,
        expiresAt: "2026-07-18T20:00:00+03:00",
        horizon: HORIZON,
      },
      new FixedCredentialGenerator("session-edit", "E".repeat(43)),
    );
    const changed = await applyProtectedVisitorSessionChanges(
      publications,
      sessions,
      {
        ...handle.credential,
        expectedRevision: 0,
        operations: [{
          type: "set_horizon",
          value: { startYear: 2028, endYear: 2040 },
        }],
      },
      "2026-07-17T20:10:00+03:00",
    );
    expect(changed.sessionRevision).toBe(1);
    expect(changed.horizon).toEqual({ startYear: 2028, endYear: 2040 });

    const reset = await resetProtectedVisitorSession(
      publications,
      sessions,
      {
        ...handle.credential,
        expectedRevision: 1,
      },
      "2026-07-17T20:20:00+03:00",
    );
    expect(reset.sessionRevision).toBe(2);
    expect(reset.horizon).toEqual(HORIZON);
  });

  it("rejects expired and revoked capabilities without revealing session existence", async () => {
    const publications = await publishedRepository();
    const sessions = new InMemoryProtectedSessionWorkspaceRepository();
    const handle = await createProtectedVisitorSession(
      publications,
      sessions,
      {
        companyId: COMPANY_ID,
        publicationVersion: 1,
        createdAt: NOW,
        expiresAt: "2026-07-17T21:00:00+03:00",
        horizon: HORIZON,
      },
      new FixedCredentialGenerator("session-revoke", "F".repeat(43)),
    );
    await expect(loadProtectedVisitorScenario(
      publications,
      sessions,
      handle.credential,
      "2026-07-17T21:00:00+03:00",
    )).rejects.toMatchObject({ code: "INVALID_SESSION_CREDENTIAL" });

    await revokeProtectedVisitorSession(
      sessions,
      handle.credential,
      "2026-07-17T20:30:00+03:00",
    );
    await expect(loadProtectedVisitorScenario(
      publications,
      sessions,
      handle.credential,
      "2026-07-17T20:31:00+03:00",
    )).rejects.toMatchObject({ code: "INVALID_SESSION_CREDENTIAL" });
  });
});


describe("V2.6 UI-facing security facades", () => {
  it("verifies an opaque admin credential before authorization", async () => {
    const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    const access = new InMemoryCompanyAccessRepository([GRANT]);
    const authentication = new InMemoryAuthenticationPort({
      "valid-admin-token": IDENTITY,
    });
    const facade = new SecuredAdminApplicationFacade(
      authentication,
      access,
      repository,
    );
    await expect(facade.loadWorkspace(
      "unknown-token", COMPANY_ID, HORIZON, NOW,
    )).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(facade.loadWorkspace(
      "valid-admin-token", COMPANY_ID, HORIZON, NOW,
    )).resolves.toMatchObject({ companyId: COMPANY_ID });
  });

  it("uses server time and configured TTL instead of browser timestamps", async () => {
    const publications = await publishedRepository();
    const sessions = new InMemoryProtectedSessionWorkspaceRepository();
    const facade = new PublicVisitorApplicationFacade(
      publications,
      sessions,
      new FixedCredentialGenerator("server-time-session", "L".repeat(43)),
      60_000,
    );
    const handle = await facade.createSession({
      companyId: COMPANY_ID,
      publicationVersion: 1,
      horizon: HORIZON,
    }, NOW);
    expect(handle.view.createdAt).toBe(new Date(NOW).toISOString());
    expect(handle.view.expiresAt).toBe(
      new Date(Date.parse(NOW) + 60_000).toISOString(),
    );

    const forged = {
      ...handle.credential,
      expectedRevision: 0,
      occurredAt: NOW,
      operations: [{
        type: "set_horizon" as const,
        value: { startYear: 2027, endYear: 2040 },
      }],
    };
    await expect(facade.applyChanges(
      forged,
      "2026-07-17T20:01:00+03:00",
    )).rejects.toMatchObject({ code: "INVALID_SESSION_CREDENTIAL" });
  });

  it("keeps the public visitor surface free of admin persistence methods", async () => {
    const publications = await publishedRepository();
    const sessions = new InMemoryProtectedSessionWorkspaceRepository();
    const facade = new PublicVisitorApplicationFacade(
      publications,
      sessions,
      new FixedCredentialGenerator("public-facade-session", "K".repeat(43)),
    );
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(facade)).sort())
      .toEqual([
        "applyChanges",
        "constructor",
        "createSession",
        "loadPublishedOverview",
        "loadScenario",
        "reset",
      ]);
    await expect(facade.loadPublishedOverview(COMPANY_ID, HORIZON))
      .resolves.toMatchObject({ companyId: COMPANY_ID });
  });
});
