import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  AdminDataBatchCommand,
  CreateVisitorSessionCommand,
  Horizon,
  PublishAdminDataCommand,
  VisitorSessionBatchCommand,
} from "../domain/types.js";
import { applyAdminBatch } from "../admin/applyAdminBatch.js";
import { commitAdminBatch } from "../admin/adminEntryService.js";
import { publishAdminRevision } from "../application/publishingApplicationService.js";
import {
  applyVisitorSessionChanges,
  createVisitorSession,
  loadVisitorScenario,
} from "../application/visitorApplicationService.js";
import { adminBaselineSnapshot } from "../fixtures/adminBaseline.js";
import { buildSnapshotCalculations } from "../readModels/calculationReadModel.js";
import {
  loadPostgresMigrations,
  runPostgresMigrations,
  splitPostgresStatements,
  type SqlMigration,
} from "./migrationRunner.js";
import { PostgresPublishingRepository } from "./postgresPublishingRepository.js";
import { PostgresSessionWorkspaceRepository } from "./postgresSessionRepository.js";
import type {
  SqlPool,
  SqlQueryResult,
  SqlTransactionClient,
} from "./sql.js";

const COMPANY_ID = adminBaselineSnapshot.companyId;
const HORIZON: Horizon = { startYear: 2026, endYear: 2057 };
const PUBLISHED_AT = "2026-07-17T19:00:00+03:00";
const SESSION_CREATED_AT = "2026-07-17T20:00:00+03:00";
const SESSION_EXPIRES_AT = "2026-07-18T20:00:00+03:00";

class PGliteSqlPool implements SqlPool {
  readonly #db = new PGlite();

  public async query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    const result = await this.#db.query<Row>(text, [...values]);
    return {
      rows: result.rows,
      rowCount: result.affectedRows ?? result.rows.length,
    };
  }

  public async connect(): Promise<SqlTransactionClient> {
    return {
      query: <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ) => this.query<Row>(text, values),
      release: () => undefined,
    };
  }

  public async close(): Promise<void> {
    await this.#db.close();
  }
}

function publishCommand(
  expectedAdminRevision: number,
  expectedPublishedVersion: number,
  publishedAt = PUBLISHED_AT,
): PublishAdminDataCommand {
  return {
    companyId: COMPANY_ID,
    expectedAdminRevision,
    expectedPublishedVersion,
    publishedAt,
    publishedBy: "admin:pasi",
    sourceIds: [`publication_${expectedPublishedVersion + 1}`],
    explanation: `Publish version ${expectedPublishedVersion + 1}.`,
  };
}

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

function sessionCommand(
  sessionId = "visitor-db-session",
  createdAt = SESSION_CREATED_AT,
  expiresAt = SESSION_EXPIRES_AT,
): CreateVisitorSessionCommand {
  return {
    sessionId,
    companyId: COMPANY_ID,
    publicationVersion: 1,
    createdAt,
    expiresAt,
    horizon: HORIZON,
  };
}

function sessionBatch(
  expectedRevision: number,
  sessionId = "visitor-db-session",
): VisitorSessionBatchCommand {
  return {
    sessionId,
    expectedRevision,
    occurredAt: "2026-07-17T20:15:00+03:00",
    operations: [{
      type: "set_horizon",
      value: { startYear: 2027, endYear: 2040 },
    }],
  };
}

let pool: PGliteSqlPool;
let migrations: readonly SqlMigration[];
let publications: PostgresPublishingRepository;
let sessions: PostgresSessionWorkspaceRepository;

beforeAll(async () => {
  pool = new PGliteSqlPool();
  migrations = await loadPostgresMigrations();
  await runPostgresMigrations(pool, migrations);
});

beforeEach(async () => {
  await pool.query("DELETE FROM tm_visitor_sessions");
  await pool.query("DELETE FROM tm_company_access_grants");
  await pool.query("DELETE FROM tm_publications");
  await pool.query("DELETE FROM tm_admin_snapshots");
  publications = new PostgresPublishingRepository(pool);
  sessions = new PostgresSessionWorkspaceRepository(pool);
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
    expect(rerun).toEqual({ appliedVersions: [], skippedVersions: [1, 2, 3] });
    const rows = await pool.query<{ version: number; checksum: string }>(
      "SELECT version, checksum FROM tm_schema_migrations ORDER BY version",
    );
    expect(rows.rows.map((row) => row.version)).toEqual([1, 2, 3]);
    expect(rows.rows.every((row) => row.checksum.length === 64)).toBe(true);
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
      { version: 4, name: "broken", sql: "CREATE TABLE broken (" },
    ];
    await expect(runPostgresMigrations(pool, broken)).rejects.toBeDefined();
    const rows = await pool.query<{ version: number }>(
      "SELECT version FROM tm_schema_migrations ORDER BY version",
    );
    expect(rows.rows.map((row) => row.version)).toEqual([1, 2, 3]);
  });
});

describe("V2.6 PostgreSQL admin and publication repository", () => {
  it("initializes, reloads and defensively copies an admin snapshot", async () => {
    await publications.initializeAdminData(adminBaselineSnapshot);
    const loaded = await publications.load(COMPANY_ID);
    expect(loaded).toEqual(adminBaselineSnapshot);
    (loaded!.assets as unknown as { name: string }[])[0]!.name = "mutated";
    expect((await publications.load(COMPANY_ID))!.assets[0]!.name)
      .not.toBe("mutated");
  });

  it("prevents duplicate company initialization", async () => {
    await publications.initializeAdminData(adminBaselineSnapshot);
    await expect(publications.initializeAdminData(adminBaselineSnapshot))
      .rejects.toMatchObject({ code: "ADMIN_DATA_ALREADY_EXISTS" });
  });

  it("persists an admin batch and rejects a stale competing revision", async () => {
    await publications.initializeAdminData(adminBaselineSnapshot);
    const original = await publications.load(COMPANY_ID);
    const first = await commitAdminBatch(publications, adminBatch(0, "First name"));
    expect(first.revision).toBe(1);
    const staleNext = applyAdminBatch(original!, adminBatch(0, "Stale name"));
    await expect(publications.save(COMPANY_ID, 0, staleNext))
      .rejects.toMatchObject({ code: "ADMIN_REVISION_CONFLICT" });
    expect((await publications.load(COMPANY_ID))!.housingCompany.name)
      .toBe("First name");
  });

  it("persists publication history and survives repository recreation", async () => {
    await publications.initializeAdminData(adminBaselineSnapshot);
    await publishAdminRevision(publications, publishCommand(0, 0));
    await commitAdminBatch(publications, adminBatch(0, "Published V2 name"));
    await publishAdminRevision(
      publications,
      publishCommand(1, 1, "2026-07-17T21:00:00+03:00"),
    );

    const restarted = new PostgresPublishingRepository(pool);
    expect((await restarted.loadCurrent(COMPANY_ID))!.publicationVersion).toBe(2);
    expect((await restarted.listVersions(COMPANY_ID))
      .map((item) => item.publicationVersion)).toEqual([1, 2]);
    expect((await restarted.loadVersion(COMPANY_ID, 1))!.housingCompany.name)
      .toBe(adminBaselineSnapshot.housingCompany.name);
  });

  it("checks admin and publication revisions inside the publication transaction", async () => {
    await publications.initializeAdminData(adminBaselineSnapshot);
    await commitAdminBatch(publications, adminBatch(0, "Newer workspace"));
    await expect(publishAdminRevision(publications, publishCommand(0, 0)))
      .rejects.toMatchObject({ code: "ADMIN_REVISION_CONFLICT" });
    expect(await publications.loadCurrent(COMPANY_ID)).toBeUndefined();

    await publishAdminRevision(publications, publishCommand(1, 0));
    await expect(publishAdminRevision(publications, publishCommand(1, 0)))
      .rejects.toMatchObject({ code: "PUBLISHED_VERSION_CONFLICT" });
    expect((await publications.listVersions(COMPANY_ID))).toHaveLength(1);
  });

  it("detects column/payload corruption instead of returning plausible data", async () => {
    await publications.initializeAdminData(adminBaselineSnapshot);
    await pool.query(
      "UPDATE tm_admin_snapshots SET revision = 9 WHERE company_id = $1",
      [COMPANY_ID],
    );
    await expect(publications.load(COMPANY_ID))
      .rejects.toMatchObject({ code: "DATABASE_INTEGRITY_ERROR" });
  });

  it("defaults additive collection fields missing from a pre-existing stored row instead of throwing", async () => {
    await publications.initializeAdminData(adminBaselineSnapshot);
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

    const loaded = await publications.load(COMPANY_ID);

    expect(loaded).toBeDefined();
    expect(loaded!.financialAccounts).toEqual([]);
    expect(loaded!.financialEntries).toEqual([]);
  });

  it("defaults balanceSheetSnapshots missing from a pre-existing stored row instead of throwing", async () => {
    await publications.initializeAdminData(adminBaselineSnapshot);
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

    const loaded = await publications.load(COMPANY_ID);

    expect(loaded).toBeDefined();
    expect(loaded!.balanceSheetSnapshots).toEqual([]);
  });

  it("defaults groupBudgets missing from a pre-existing stored row instead of throwing", async () => {
    await publications.initializeAdminData(adminBaselineSnapshot);
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

    const loaded = await publications.load(COMPANY_ID);

    expect(loaded).toBeDefined();
    expect(loaded!.groupBudgets).toEqual([]);
  });

  it("defaults groupActuals missing from a pre-existing stored row instead of throwing", async () => {
    await publications.initializeAdminData(adminBaselineSnapshot);
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

    const loaded = await publications.load(COMPANY_ID);

    expect(loaded).toBeDefined();
    expect(loaded!.groupActuals).toEqual([]);
  });

  it("defaults every additive collection at once, so removing the defaulting cannot pass unnoticed", async () => {
    await publications.initializeAdminData(adminBaselineSnapshot);
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
         - 'groupBudgets' - 'groupActuals' - 'auditTrail'
       WHERE company_id = $1`,
      [COMPANY_ID],
    );

    const loaded = await publications.load(COMPANY_ID);

    expect(loaded).toBeDefined();
    for (const collection of [
      loaded!.financialYears, loaded!.liquidityBaselines, loaded!.assets,
      loaded!.observations, loaded!.costEvidence, loaded!.priceLevelConfirmations,
      loaded!.events, loaded!.financialAccounts, loaded!.financialEntries,
      loaded!.balanceSheetSnapshots, loaded!.groupBudgets, loaded!.groupActuals,
      loaded!.auditTrail,
    ]) {
      expect(collection).toEqual([]);
    }
  });

  it("loads a snapshot written before the maintenance-plan coverage existed", async () => {
    await publications.initializeAdminData(adminBaselineSnapshot);
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
    const withCoverage = await publications.load(COMPANY_ID);
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

    const loaded = await publications.load(COMPANY_ID);

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
    await publications.initializeAdminData(adminBaselineSnapshot);
    const stored = await publications.load(COMPANY_ID);
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
    await publications.save(COMPANY_ID, stored!.revision, added);

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
    await publications.save(COMPANY_ID, added.revision, next);

    const reloaded = await publications.load(COMPANY_ID);
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

describe("V2.5 PostgreSQL visitor-session repository", () => {
  beforeEach(async () => {
    await publications.initializeAdminData(adminBaselineSnapshot);
    await publishAdminRevision(publications, publishCommand(0, 0));
  });

  it("persists a visitor session and its optimistic revision", async () => {
    const created = await createVisitorSession(
      publications,
      sessions,
      sessionCommand(),
    );
    expect(created.sessionRevision).toBe(0);
    const changed = await applyVisitorSessionChanges(
      publications,
      sessions,
      sessionBatch(0),
    );
    expect(changed.sessionRevision).toBe(1);
    expect(changed.horizon).toEqual({ startYear: 2027, endYear: 2040 });

    const restarted = new PostgresSessionWorkspaceRepository(pool);
    const reloaded = await loadVisitorScenario(
      publications,
      restarted,
      "visitor-db-session",
      "2026-07-17T20:30:00+03:00",
    );
    expect(reloaded.sessionRevision).toBe(1);
  });

  it("rejects duplicate sessions and stale browser revisions", async () => {
    await createVisitorSession(publications, sessions, sessionCommand());
    await expect(createVisitorSession(publications, sessions, sessionCommand()))
      .rejects.toMatchObject({ code: "SESSION_ALREADY_EXISTS" });
    await applyVisitorSessionChanges(publications, sessions, sessionBatch(0));
    await expect(applyVisitorSessionChanges(publications, sessions, sessionBatch(0)))
      .rejects.toMatchObject({ code: "SESSION_REVISION_CONFLICT" });
  });

  it("enforces publication foreign keys even when called below the service layer", async () => {
    const workspace = await sessions.load("missing");
    expect(workspace).toBeUndefined();
    const invalid = {
      ...(await (async () => {
        const created = await createVisitorSession(
          publications,
          sessions,
          sessionCommand("temporary-valid"),
        );
        return created;
      })()),
    };
    await sessions.delete("temporary-valid");

    const raw = {
      sessionId: "orphan",
      companyId: COMPANY_ID,
      publicationVersion: 999,
      publicationFingerprint: invalid.publicationFingerprint,
      revision: 0,
      createdAt: SESSION_CREATED_AT,
      updatedAt: SESSION_CREATED_AT,
      expiresAt: SESSION_EXPIRES_AT,
      baseHorizon: HORIZON,
      horizon: HORIZON,
      eventOverrides: [],
      customEvents: [],
      liquidityOverrides: {},
    } as const;
    await expect(sessions.create(raw))
      .rejects.toMatchObject({ code: "PUBLISHED_DATA_NOT_FOUND" });
  });

  it("deletes only expired sessions through the TTL maintenance hook", async () => {
    await createVisitorSession(
      publications,
      sessions,
      sessionCommand(
        "expired",
        "2026-07-17T19:10:00+03:00",
        "2026-07-17T19:30:00+03:00",
      ),
    );
    await createVisitorSession(
      publications,
      sessions,
      sessionCommand("active"),
    );
    expect(await sessions.deleteExpired("2026-07-17T20:00:00+03:00")).toBe(1);
    expect(await sessions.load("expired")).toBeUndefined();
    expect(await sessions.load("active")).toBeDefined();
  });
});
