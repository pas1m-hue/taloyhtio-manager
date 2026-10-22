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
import { InMemoryAdminDataRepository } from "../admin/adminRepository.js";
import { adminBaselineSnapshot } from "../fixtures/adminBaseline.js";
import {
  applyAuthorizedAdminChanges,
  loadAuthorizedAdminWorkspace,
  previewAuthorizedAdminCalculations,
} from "../application/authorizedAdminApplicationService.js";

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

describe("V2.6 admin authentication and authorization boundary", () => {
  it("rejects missing, expired and malformed identities", async () => {
    const repository = new InMemoryAdminDataRepository([adminBaselineSnapshot]);
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
    const repository = new InMemoryAdminDataRepository([adminBaselineSnapshot]);
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
    const repository = new InMemoryAdminDataRepository([adminBaselineSnapshot]);
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

  it("overrides spoofed browser audit metadata with server values", async () => {
    const repository = new InMemoryAdminDataRepository([adminBaselineSnapshot]);
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
  });

  it("authorizes all admin-facing application reads through the same grant", async () => {
    const repository = new InMemoryAdminDataRepository([adminBaselineSnapshot]);
    const access = new InMemoryCompanyAccessRepository([GRANT]);
    await expect(loadAuthorizedAdminWorkspace(
      repository, access, IDENTITY, COMPANY_ID, HORIZON, NOW,
    )).resolves.toMatchObject({ companyId: COMPANY_ID });
    await expect(previewAuthorizedAdminCalculations(
      repository, access, IDENTITY, COMPANY_ID, HORIZON, NOW,
    )).resolves.toHaveProperty("projection");
  });
});

describe("V2.6 UI-facing security facades", () => {
  it("verifies an opaque admin credential before authorization", async () => {
    const repository = new InMemoryAdminDataRepository([adminBaselineSnapshot]);
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

  it("keeps the admin facade to workspace, preview and changes", () => {
    // Publishing and publication history were admin features and are gone;
    // nothing else should have taken their place on the boundary.
    const facade = new SecuredAdminApplicationFacade(
      new InMemoryAuthenticationPort({}),
      new InMemoryCompanyAccessRepository([GRANT]),
      new InMemoryAdminDataRepository([adminBaselineSnapshot]),
    );
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(facade)).sort())
      .toEqual(["applyChanges", "constructor", "loadWorkspace", "previewCalculations"]);
  });
});
