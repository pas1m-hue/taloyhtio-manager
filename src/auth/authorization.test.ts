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
import { InMemoryAuthenticationPort } from "./authenticationPort.js";
import { SecuredAdminApplicationFacade } from "../application/securedAdminFacade.js";
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
});
