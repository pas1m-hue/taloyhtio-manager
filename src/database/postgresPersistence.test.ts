import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminDataBatchCommand } from "../domain/types.js";
import { DomainValidationError } from "../domain/types.js";
import { applyAdminBatch } from "../admin/applyAdminBatch.js";
import { commitAdminBatch } from "../admin/adminEntryService.js";
import { adminBaselineSnapshot } from "../fixtures/adminBaseline.js";
import { financialActualsFixture } from "../fixtures/financialActuals.js";
import { buildSnapshotCalculations } from "../readModels/calculationReadModel.js";
import {
  loadPostgresMigrations,
  runPostgresMigrations,
  splitPostgresStatements,
  type SqlMigration,
} from "./migrationRunner.js";
import { PGliteSqlPool } from "./pgliteSqlPool.js";
import { PostgresAdminDataRepository } from "./postgresAdminRepository.js";

const COMPANY_ID = adminBaselineSnapshot.companyId;

function adminBatch(
  expectedRevision: number,
  name: string,
): AdminDataBatchCommand {
  return {
    companyId: COMPANY_ID,
    expectedRevision,
    actorId: "admin:pasi",
    occurredAt: `2026-07-17T19:${String(expectedRevision + 1).padStart(2, "0")}:00+03:00`,
    operations: [{
      type: "save_housing_company",
      value: { ...adminBaselineSnapshot.housingCompany, name },
      sourceIds: ["manual_admin_update"],
      explanation: "Update company display name.",
    }],
  };
}

let pool: PGliteSqlPool;
let migrations: readonly SqlMigration[];
let adminData: PostgresAdminDataRepository;

beforeAll(async () => {
  pool = new PGliteSqlPool();
  migrations = await loadPostgresMigrations();
  await runPostgresMigrations(pool, migrations);
});

beforeEach(async () => {
  await pool.query("DELETE FROM tm_company_access_grants");
  await pool.query("DELETE FROM tm_admin_snapshots");
  adminData = new PostgresAdminDataRepository(pool);
});

afterAll(async () => {
  await pool.close();
});

describe("V2.6 PostgreSQL migrations", () => {
  it("does not split semicolons inside PostgreSQL quoted blocks", () => {
    const sql = `
      CREATE FUNCTION demo() RETURNS void AS $$
      BEGIN
        PERFORM 'a;b';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TABLE "semi;colon" (id integer);
    `;
    expect(splitPostgresStatements(sql)).toHaveLength(2);
  });

  it("creates the persistence tables on an actual PostgreSQL engine", async () => {
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'tm_%'
       ORDER BY table_name`,
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([
      "tm_admin_snapshots",
      "tm_company_access_grants",
      "tm_publications",
      "tm_schema_migrations",
      "tm_visitor_session_access",
      "tm_visitor_sessions",
    ]);
  });

  it("is idempotent and records migration checksums", async () => {
    const rerun = await runPostgresMigrations(pool, migrations);
    expect(rerun).toEqual({ appliedVersions: [], skippedVersions: [1, 2, 3, 4] });
    const rows = await pool.query<{ version: number; checksum: string }>(
      "SELECT version, checksum FROM tm_schema_migrations ORDER BY version",
    );
    expect(rows.rows.map((row) => row.version)).toEqual([1, 2, 3, 4]);
    expect(rows.rows.every((row) => row.checksum.length === 64)).toBe(true);
  });

  it("leaves no tm_ table behind row-level security without a policy", async () => {
    // RLS enabled with zero policies denies every write, and it is never a
    // valid state here: the Worker is the only thing that reaches the database
    // and authorization lives in the application layer, so a policy could only
    // ever say "allow all". Three tables were in exactly this state in
    // production, which is why the first publication ever attempted failed
    // with a bare INTERNAL_SERVER_ERROR.
    const offending = await pool.query<{ relname: string }>(
      `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname LIKE 'tm\\_%'
         AND c.relrowsecurity
         AND NOT EXISTS (
           SELECT 1 FROM pg_policies p
           WHERE p.schemaname = n.nspname AND p.tablename = c.relname
         )
       ORDER BY c.relname`,
    );

    expect(offending.rows.map((row) => row.relname)).toEqual([]);
  });

  it("disables row-level security again when it has been switched on out of band", async () => {
    // Migration 004 has to survive both a re-run and the case where the same
    // correction was already made by hand in the Supabase console. DISABLE is
    // a no-op on a table that already has RLS off, so the statements are
    // replayed here directly rather than through the version ledger, which
    // would skip them.
    const migration = migrations.find((item) => item.version === 4);
    expect(migration?.name).toBe("disable_unused_row_level_security");

    await pool.query("ALTER TABLE tm_publications ENABLE ROW LEVEL SECURITY");
    for (const statement of splitPostgresStatements(migration!.sql)) {
      await pool.query(statement);
    }
    // Replaying onto the now-disabled tables must not raise either.
    for (const statement of splitPostgresStatements(migration!.sql)) {
      await pool.query(statement);
    }

    const enabled = await pool.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'tm_publications'`,
    );
    expect(enabled.rows[0]?.relrowsecurity).toBe(false);
  });

  it("splits migration 004 into one statement per table, comments and all", async () => {
    const migration = migrations.find((item) => item.version === 4);
    const statements = splitPostgresStatements(migration!.sql);

    expect(statements).toHaveLength(3);
    expect(statements.every((statement) =>
      /ALTER TABLE tm_\w+ DISABLE ROW LEVEL SECURITY$/.test(statement))).toBe(true);
  });

  it("names a row-level-security rejection instead of leaking a bare 500", async () => {
    // The production failure, reproduced against a real PostgreSQL engine:
    // RLS on with no policy denies the insert, and every repository catch
    // matched only the constraint code it owns, so the driver error fell
    // through all of them. The client saw INTERNAL_SERVER_ERROR with no
    // actionable message and the cause was visible only in the server log.
    // The role switch is what makes this real. PGlite connects as postgres, a
    // superuser, and superusers bypass RLS entirely — even FORCE — so simply
    // enabling it here would let the insert through and the test would prove
    // nothing. Production denied the write because the Worker reaches the
    // table as a non-owner role against relrowsecurity = true with no policy;
    // switching to an unprivileged role reproduces exactly that, down to the
    // message PostgreSQL emitted in the live log.
    await pool.query("ALTER TABLE tm_admin_snapshots ENABLE ROW LEVEL SECURITY");
    await pool.query("CREATE ROLE tm_rls_probe NOLOGIN");
    await pool.query(
      "GRANT SELECT, INSERT, UPDATE ON tm_admin_snapshots TO tm_rls_probe",
    );
    await pool.query("SET ROLE tm_rls_probe");
    try {
      const error = await adminData.initializeAdminData(adminBaselineSnapshot)
        .then(() => undefined, (thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(DomainValidationError);
      expect((error as DomainValidationError).code).toBe("DATABASE_ACCESS_POLICY_ERROR");
      // The message names the table and points at the fix; it reaches the
      // server log, not the client, since httpErrors withholds every 500's
      // message on purpose.
      expect((error as DomainValidationError).message).toContain("tm_admin_snapshots");
      expect((error as DomainValidationError).message)
        .toContain("new row violates row-level security policy");
      expect((error as DomainValidationError).message).toContain("migration 004");
    } finally {
      await pool.query("RESET ROLE");
      await pool.query("ALTER TABLE tm_admin_snapshots DISABLE ROW LEVEL SECURITY");
      await pool.query("REVOKE ALL ON tm_admin_snapshots FROM tm_rls_probe");
      await pool.query("DROP ROLE tm_rls_probe");
    }
  });

  it("still maps the constraint violations each repository owns", async () => {
    // The translation must not swallow the codes the repositories match
    // themselves: a duplicate company is a conflict, not a policy problem,
    // and only the repository knows which table means what.
    await adminData.initializeAdminData(adminBaselineSnapshot);
    await expect(adminData.initializeAdminData(adminBaselineSnapshot))
      .rejects.toMatchObject({ code: "ADMIN_DATA_ALREADY_EXISTS" });
  });

  it("rejects edited SQL for an already applied migration", async () => {
    const changed = migrations.map((migration) =>
      migration.version === 1
        ? { ...migration, sql: `${migration.sql}\n-- unauthorized drift` }
        : migration
    );
    await expect(runPostgresMigrations(pool, changed))
      .rejects.toMatchObject({ code: "DATABASE_MIGRATION_CONFLICT" });
  });

  it("rolls back a failing later migration", async () => {
    const broken: readonly SqlMigration[] = [
      ...migrations,
      { version: 5, name: "broken", sql: "CREATE TABLE broken (" },
    ];
    await expect(runPostgresMigrations(pool, broken)).rejects.toBeDefined();
    const rows = await pool.query<{ version: number }>(
      "SELECT version FROM tm_schema_migrations ORDER BY version",
    );
    expect(rows.rows.map((row) => row.version)).toEqual([1, 2, 3, 4]);
  });
});

describe("V2.6 PostgreSQL admin repository", () => {
  it("initializes, reloads and defensively copies an admin snapshot", async () => {
    await adminData.initializeAdminData(adminBaselineSnapshot);
    const loaded = await adminData.load(COMPANY_ID);
    expect(loaded).toEqual(adminBaselineSnapshot);
    (loaded!.assets as unknown as { name: string }[])[0]!.name = "mutated";
    expect((await adminData.load(COMPANY_ID))!.assets[0]!.name)
      .not.toBe("mutated");
  });

  it("prevents duplicate company initialization", async () => {
    await adminData.initializeAdminData(adminBaselineSnapshot);
    await expect(adminData.initializeAdminData(adminBaselineSnapshot))
      .rejects.toMatchObject({ code: "ADMIN_DATA_ALREADY_EXISTS" });
  });

  it("persists an admin batch and rejects a stale competing revision", async () => {
    await adminData.initializeAdminData(adminBaselineSnapshot);
    const original = await adminData.load(COMPANY_ID);
    const first = await commitAdminBatch(adminData, adminBatch(0, "First name"));
    expect(first.revision).toBe(1);
    const staleNext = applyAdminBatch(original!, adminBatch(0, "Stale name"));
    await expect(adminData.save(COMPANY_ID, 0, staleNext))
      .rejects.toMatchObject({ code: "ADMIN_REVISION_CONFLICT" });
    expect((await adminData.load(COMPANY_ID))!.housingCompany.name)
      .toBe("First name");
  });

  it("detects column/payload corruption instead of returning plausible data", async () => {
    await adminData.initializeAdminData(adminBaselineSnapshot);
    await pool.query(
      "UPDATE tm_admin_snapshots SET revision = 9 WHERE company_id = $1",
      [COMPANY_ID],
    );
    await expect(adminData.load(COMPANY_ID))
      .rejects.toMatchObject({ code: "DATABASE_INTEGRITY_ERROR" });
  });

  it("defaults additive collection fields missing from a pre-existing stored row instead of throwing", async () => {
    await adminData.initializeAdminData(adminBaselineSnapshot);
    // Simulates a row written before financialAccounts/financialEntries
    // existed: the JSONB payload simply has no such keys, the way a real
    // pre-vaihe-3A Supabase row does. Without withDefaultedAdminCollections()
    // this reproduces "TypeError: values is not iterable" from
    // validateAdminDataSnapshot's uniqueBy() on the missing arrays.
    await pool.query(
      `UPDATE tm_admin_snapshots
       SET payload = payload - 'financialAccounts' - 'financialEntries'
       WHERE company_id = $1`,
      [COMPANY_ID],
    );

    const loaded = await adminData.load(COMPANY_ID);

    expect(loaded).toBeDefined();
    expect(loaded!.financialAccounts).toEqual([]);
    expect(loaded!.financialEntries).toEqual([]);
  });

  it("defaults balanceSheetSnapshots missing from a pre-existing stored row instead of throwing", async () => {
    await adminData.initializeAdminData(adminBaselineSnapshot);
    // Same regression as above (handoff vaihe-4A §1), for the collection
    // field added in this vaihe: a row written before balanceSheetSnapshots
    // existed has no such JSONB key. Without withDefaultedAdminCollections()
    // defaulting it to [], loading that row throws "values is not iterable"
    // from validateAdminDataSnapshot's uniqueBy() call.
    await pool.query(
      `UPDATE tm_admin_snapshots
       SET payload = payload - 'balanceSheetSnapshots'
       WHERE company_id = $1`,
      [COMPANY_ID],
    );

    const loaded = await adminData.load(COMPANY_ID);

    expect(loaded).toBeDefined();
    expect(loaded!.balanceSheetSnapshots).toEqual([]);
  });

  it("defaults groupBudgets missing from a pre-existing stored row instead of throwing", async () => {
    await adminData.initializeAdminData(adminBaselineSnapshot);
    // Same regression as above (feature/group-budget handoff §1), for the
    // collection field added in this feature: a row written before
    // groupBudgets existed has no such JSONB key. Without
    // withDefaultedAdminCollections() defaulting it to [], loading that row
    // throws "values is not iterable" from validateAdminDataSnapshot's
    // uniqueBy() call.
    await pool.query(
      `UPDATE tm_admin_snapshots
       SET payload = payload - 'groupBudgets'
       WHERE company_id = $1`,
      [COMPANY_ID],
    );

    const loaded = await adminData.load(COMPANY_ID);

    expect(loaded).toBeDefined();
    expect(loaded!.groupBudgets).toEqual([]);
  });

  it("defaults groupActuals missing from a pre-existing stored row instead of throwing", async () => {
    await adminData.initializeAdminData(adminBaselineSnapshot);
    // Same regression as above (feature/group-level-actuals handoff §4.1), for
    // the collection field added in this feature: a row written before
    // groupActuals existed has no such JSONB key. Without
    // withDefaultedAdminCollections() defaulting it to [], loading that row
    // throws "values is not iterable" from validateAdminDataSnapshot's
    // uniqueBy() call — the bug that took the workspace down once in 3A.
    await pool.query(
      `UPDATE tm_admin_snapshots
       SET payload = payload - 'groupActuals'
       WHERE company_id = $1`,
      [COMPANY_ID],
    );

    const loaded = await adminData.load(COMPANY_ID);

    expect(loaded).toBeDefined();
    expect(loaded!.groupActuals).toEqual([]);
  });

  it("defaults maintenanceDocuments missing from a pre-existing stored row instead of throwing", async () => {
    await adminData.initializeAdminData(adminBaselineSnapshot);
    // Same regression as above (feature/selvitykset handoff §3): every row
    // written before this collection existed has no such JSONB key, and
    // validateAdminDataSnapshot's uniqueBy() would throw "is not iterable".
    await pool.query(
      `UPDATE tm_admin_snapshots
       SET payload = payload - 'maintenanceDocuments'
       WHERE company_id = $1`,
      [COMPANY_ID],
    );

    const loaded = await adminData.load(COMPANY_ID);

    expect(loaded).toBeDefined();
    expect(loaded!.maintenanceDocuments).toEqual([]);
  });

  // Two generations of liquidity baseline rows exist in storage
  // (legacyFieldNames.ts). The row is rewritten as raw JSON text, the way the
  // old code left it: the current types no longer have these fields, so a
  // fixture built from them and cast could not represent such a row at all.
  const LEGACY_BASELINE_ROWS = [
    {
      name: "pre refactor/hoitokate-naming",
      keys: ["trailing12mOperatingCosts", "currentAnnualRepairCollection"],
      text: '"trailing12mOperatingCosts": 34029.46, "currentAnnualRepairCollection": 9680, ',
    },
    {
      name: "refactor/hoitokate-naming up to refactor/remove-manual-liquidity-inputs",
      keys: ["trailing12mOperatingCosts", "currentAnnualOperatingMargin"],
      text: '"trailing12mOperatingCosts": 34029.46, "currentAnnualOperatingMargin": 9680, ',
    },
  ] as const;

  for (const generation of LEGACY_BASELINE_ROWS) {
    it(`loads an admin snapshot written ${generation.name} without the stored figures`, async () => {
      await adminData.initializeAdminData(adminBaselineSnapshot);
      await pool.query(
        `UPDATE tm_admin_snapshots
         SET payload = replace(payload::text, '"currentCash": ', $2 || '"currentCash": ')::jsonb
         WHERE company_id = $1`,
        [COMPANY_ID, generation.text],
      );
      // The rewrite must have landed, or everything below passes vacuously.
      const stored = await storedBaselineKeys();
      for (const key of generation.keys) expect(stored).toContain(key);

      const loaded = await adminData.load(COMPANY_ID);

      expect(loaded!.liquidityBaselines).toEqual(adminBaselineSnapshot.liquidityBaselines);
      for (const key of generation.keys) {
        expect(loaded!.liquidityBaselines[0]).not.toHaveProperty(key);
      }

      // And they are not written back: the next save stores the current shape.
      await commitAdminBatch(adminData, adminBatch(0, "Legacy row re-saved"));
      const resaved = await storedBaselineKeys();
      for (const key of generation.keys) expect(resaved).not.toContain(key);
    });
  }

  it("defaults every additive collection at once, so removing the defaulting cannot pass unnoticed", async () => {
    await adminData.initializeAdminData(adminBaselineSnapshot);
    // The tests above each pin one field, which means a future field
    // added without a matching test is unprotected. This one strips every
    // collection key withDefaultedAdminCollections() knows about, so deleting
    // any single `?? []` from it fails here even if nobody adds a test.
    await pool.query(
      `UPDATE tm_admin_snapshots
       SET payload = payload
         - 'financialYears' - 'liquidityBaselines' - 'assets' - 'observations'
         - 'costEvidence' - 'priceLevelConfirmations' - 'events'
         - 'financialAccounts' - 'financialEntries' - 'balanceSheetSnapshots'
         - 'groupBudgets' - 'groupActuals' - 'maintenanceDocuments' - 'auditTrail'
       WHERE company_id = $1`,
      [COMPANY_ID],
    );

    const loaded = await adminData.load(COMPANY_ID);

    expect(loaded).toBeDefined();
    for (const collection of [
      loaded!.financialYears, loaded!.liquidityBaselines, loaded!.assets,
      loaded!.observations, loaded!.costEvidence, loaded!.priceLevelConfirmations,
      loaded!.events, loaded!.financialAccounts, loaded!.financialEntries,
      loaded!.balanceSheetSnapshots, loaded!.groupBudgets, loaded!.groupActuals,
      loaded!.maintenanceDocuments, loaded!.auditTrail,
    ]) {
      expect(collection).toEqual([]);
    }
  });

  it("loads a snapshot written before the maintenance-plan coverage existed", async () => {
    // With account data: this test asserts on a cash path, and the liquidity
    // inputs are derived from accounts rather than from the baseline record.
    await adminData.initializeAdminData({
      ...adminBaselineSnapshot,
      ...financialActualsFixture,
    });
    const horizon = { startYear: 2026, endYear: 2050 } as const;
    // Write the key first, so stripping it below is a real removal rather
    // than a no-op against a fixture that never carried it.
    await pool.query(
      `UPDATE tm_admin_snapshots
       SET payload = jsonb_set(
         payload,
         '{housingCompany,maintenancePlanCoverageThroughYear}',
         '2030'::jsonb
       )
       WHERE company_id = $1`,
      [COMPANY_ID],
    );
    const withCoverage = await adminData.load(COMPANY_ID);
    expect(withCoverage!.housingCompany.maintenancePlanCoverageThroughYear)
      .toBe(2030);
    const covered = buildSnapshotCalculations(withCoverage!, horizon);
    if (covered.liquidity.status !== "available") {
      throw new Error("fixture requires liquidity");
    }
    expect(
      covered.liquidity.forecast.scenarios.base.cashPath.years
        .some((year) => !year.costsKnown),
    ).toBe(true);

    // Unlike the collections above, this one is an optional scalar on an
    // object that always exists, so withDefaultedAdminCollections() has
    // nothing to default. The old row must still load, and the missing key
    // must stay unknown coverage - never a claim that the plan reaches the
    // horizon end.
    await pool.query(
      `UPDATE tm_admin_snapshots
       SET payload = jsonb_set(
         payload,
         '{housingCompany}',
         (payload -> 'housingCompany') - 'maintenancePlanCoverageThroughYear'
       )
       WHERE company_id = $1`,
      [COMPANY_ID],
    );

    const loaded = await adminData.load(COMPANY_ID);

    expect(loaded).toBeDefined();
    expect(loaded!.housingCompany.maintenancePlanCoverageThroughYear)
      .toBeUndefined();
    const calculations = buildSnapshotCalculations(loaded!, horizon);
    expect(calculations.liquidity.status).toBe("available");
    if (calculations.liquidity.status !== "available") return;
    const cashPath = calculations.liquidity.forecast.scenarios.base.cashPath;
    expect(cashPath.years.every((year) => year.costsKnown)).toBe(true);
    expect(cashPath.maintenancePlanCoverageThroughYear).toBeUndefined();
  });

  it("round-trips a delete audit entry, which has no `after` value to store", async () => {
    await adminData.initializeAdminData(adminBaselineSnapshot);
    const stored = await adminData.load(COMPANY_ID);
    const added = applyAdminBatch(stored!, {
      companyId: COMPANY_ID,
      expectedRevision: stored!.revision,
      actorId: "admin:pasi",
      occurredAt: "2026-09-01T11:00:00+03:00",
      operations: [{
        type: "save_asset",
        value: {
          id: "asset_typo_row",
          name: "fgda",
          category: "other",
          sourceIds: ["manual_admin_entry_2026"],
          active: true,
        },
        sourceIds: ["manual_admin_entry_2026"],
        explanation: "Testirivi.",
      }],
    });
    await adminData.save(COMPANY_ID, stored!.revision, added);

    const next = applyAdminBatch(added, {
      companyId: COMPANY_ID,
      expectedRevision: added.revision,
      actorId: "admin:pasi",
      occurredAt: "2026-09-01T12:00:00+03:00",
      operations: [{
        type: "delete_entity",
        entityType: "asset",
        entityKey: "asset_typo_row",
        sourceIds: ["asset:asset_typo_row"],
        explanation: "Testidataa, poistetaan.",
      }],
    });
    await adminData.save(COMPANY_ID, added.revision, next);

    const reloaded = await adminData.load(COMPANY_ID);
    const audit = reloaded!.auditTrail.at(-1);
    expect(audit?.operation).toBe("delete");
    expect(audit?.after).toBeUndefined();
    expect(audit?.before).toMatchObject({ id: "asset_typo_row" });
    expect(reloaded!.assets.some((item) => item.id === "asset_typo_row")).toBe(false);
    // The create entry is still there: deleting the row does not delete its history.
    expect(reloaded!.auditTrail.some((item) =>
      item.entityKey === "asset_typo_row" && item.operation === "create")).toBe(true);
  });
});

async function storedBaselineKeys(): Promise<readonly string[]> {
  const result = await pool.query<{ key: string }>(
    `SELECT jsonb_object_keys(payload->'liquidityBaselines'->0) AS key
     FROM tm_admin_snapshots
     WHERE company_id = $1`,
    [COMPANY_ID],
  );
  return result.rows.map((row) => row.key);
}
