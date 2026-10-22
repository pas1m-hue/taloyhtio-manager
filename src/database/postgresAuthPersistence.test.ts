import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  CompanyAccessGrant,
  VerifiedIdentity,
} from "../auth/authTypes.js";
import { adminBaselineSnapshot } from "../fixtures/adminBaseline.js";
import {
  loadPostgresMigrations,
  runPostgresMigrations,
} from "./migrationRunner.js";
import { PostgresCompanyAccessRepository } from "./postgresCompanyAccessRepository.js";
import { PGliteSqlPool } from "./pgliteSqlPool.js";
import { PostgresAdminDataRepository } from "./postgresAdminRepository.js";

const COMPANY_ID = adminBaselineSnapshot.companyId;
const IDENTITY: VerifiedIdentity = {
  subjectId: "user:pasi",
  provider: "test-oidc",
  authenticatedAt: "2026-07-17T19:00:00.451+03:00",
  expiresAt: "2026-07-18T19:00:00.773+03:00",
};
const GRANT: CompanyAccessGrant = {
  companyId: COMPANY_ID,
  subjectId: IDENTITY.subjectId,
  role: "admin",
  active: true,
  grantedAt: "2026-07-01T10:00:00.108+03:00",
  grantedBy: "deployment:bootstrap",
};
let pool: PGliteSqlPool;
let adminData: PostgresAdminDataRepository;
let access: PostgresCompanyAccessRepository;

beforeAll(async () => {
  pool = new PGliteSqlPool();
  await runPostgresMigrations(pool, await loadPostgresMigrations());
});

beforeEach(async () => {
  await pool.query("DELETE FROM tm_company_access_grants");
  await pool.query("DELETE FROM tm_admin_snapshots");
  adminData = new PostgresAdminDataRepository(pool);
  access = new PostgresCompanyAccessRepository(pool);
  await adminData.initializeAdminData(adminBaselineSnapshot);
  await access.save(GRANT);
});

afterAll(async () => {
  await pool.close();
});

describe("V2.6 PostgreSQL access control", () => {
  it("persists company grants and never derives roles from identity input", async () => {
    expect(await access.load(COMPANY_ID, IDENTITY.subjectId)).toEqual({
      ...GRANT,
      grantedAt: new Date(GRANT.grantedAt).toISOString(),
    });
    expect(await access.load(COMPANY_ID, "unknown-user")).toBeUndefined();
  });

  it("rejects a grant for an unknown company through the foreign key", async () => {
    await expect(access.save({ ...GRANT, companyId: "missing-company" }))
      .rejects.toMatchObject({ code: "ADMIN_DATA_NOT_FOUND" });
  });
});
