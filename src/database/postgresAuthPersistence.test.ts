import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  CompanyAccessGrant,
  ProtectedCreateVisitorSessionCommand,
  VerifiedIdentity,
} from "../auth/authTypes.js";
import type { SessionCredentialGenerator } from "../auth/sessionCredential.js";
import { adminBaselineSnapshot } from "../fixtures/adminBaseline.js";
import { publishAuthorizedAdminRevision } from "../application/authorizedPublishingApplicationService.js";
import {
  applyProtectedVisitorSessionChanges,
  createProtectedVisitorSession,
  loadProtectedVisitorScenario,
  revokeProtectedVisitorSession,
} from "../application/protectedVisitorApplicationService.js";
import {
  loadPostgresMigrations,
  runPostgresMigrations,
} from "./migrationRunner.js";
import { PostgresCompanyAccessRepository } from "./postgresCompanyAccessRepository.js";
import { PostgresPublishingRepository } from "./postgresPublishingRepository.js";
import { PostgresSessionWorkspaceRepository } from "./postgresSessionRepository.js";
import type {
  SqlPool,
  SqlQueryResult,
  SqlTransactionClient,
} from "./sql.js";

const COMPANY_ID = adminBaselineSnapshot.companyId;
const NOW = "2026-07-17T20:00:00+03:00";
const IDENTITY: VerifiedIdentity = {
  subjectId: "user:pasi",
  provider: "test-oidc",
  authenticatedAt: "2026-07-17T19:00:00+03:00",
  expiresAt: "2026-07-18T19:00:00+03:00",
};
const GRANT: CompanyAccessGrant = {
  companyId: COMPANY_ID,
  subjectId: IDENTITY.subjectId,
  role: "admin",
  active: true,
  grantedAt: "2026-07-01T10:00:00+03:00",
  grantedBy: "deployment:bootstrap",
};
const SESSION_COMMAND: ProtectedCreateVisitorSessionCommand = {
  companyId: COMPANY_ID,
  publicationVersion: 1,
  createdAt: NOW,
  expiresAt: "2026-07-18T20:00:00+03:00",
  horizon: { startYear: 2026, endYear: 2057 },
};

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

class FixedCredentialGenerator implements SessionCredentialGenerator {
  readonly #sessionId: string;
  readonly #token: string;
  public constructor(sessionId: string, token: string) {
    this.#sessionId = sessionId;
    this.#token = token;
  }
  public create() {
    return { sessionId: this.#sessionId, accessToken: this.#token };
  }
}

let pool: PGliteSqlPool;
let publications: PostgresPublishingRepository;
let sessions: PostgresSessionWorkspaceRepository;
let access: PostgresCompanyAccessRepository;

beforeAll(async () => {
  pool = new PGliteSqlPool();
  await runPostgresMigrations(pool, await loadPostgresMigrations());
});

beforeEach(async () => {
  await pool.query("DELETE FROM tm_visitor_sessions");
  await pool.query("DELETE FROM tm_company_access_grants");
  await pool.query("DELETE FROM tm_publications");
  await pool.query("DELETE FROM tm_admin_snapshots");
  publications = new PostgresPublishingRepository(pool);
  sessions = new PostgresSessionWorkspaceRepository(pool);
  access = new PostgresCompanyAccessRepository(pool);
  await publications.initializeAdminData(adminBaselineSnapshot);
  await access.save(GRANT);
  await publishAuthorizedAdminRevision(publications, access, IDENTITY, {
    companyId: COMPANY_ID,
    expectedAdminRevision: 0,
    expectedPublishedVersion: 0,
    sourceIds: ["initial_publication"],
    explanation: "Initial publication.",
  }, NOW);
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

  it("stores only the visitor token hash and protects load/update/revoke", async () => {
    const rawToken = "G".repeat(43);
    const handle = await createProtectedVisitorSession(
      publications,
      sessions,
      SESSION_COMMAND,
      new FixedCredentialGenerator("pg-protected-session", rawToken),
    );
    const stored = await sessions.loadAccessRecord(handle.credential.sessionId);
    expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.tokenHash).not.toContain(rawToken);

    const db = await pool.query<{ payload: unknown; token_hash: string }>(
      `SELECT s.payload, a.token_hash
       FROM tm_visitor_sessions s
       JOIN tm_visitor_session_access a ON a.session_id = s.session_id
       WHERE s.session_id = $1`,
      [handle.credential.sessionId],
    );
    expect(JSON.stringify(db.rows[0]?.payload)).not.toContain(rawToken);
    expect(db.rows[0]?.token_hash).not.toBe(rawToken);

    await expect(loadProtectedVisitorScenario(
      publications,
      sessions,
      { ...handle.credential, accessToken: "H".repeat(43) },
      "2026-07-17T20:05:00+03:00",
    )).rejects.toMatchObject({ code: "INVALID_SESSION_CREDENTIAL" });

    const changed = await applyProtectedVisitorSessionChanges(
      publications,
      sessions,
      {
        ...handle.credential,
        expectedRevision: 0,
        operations: [{
          type: "set_horizon",
          value: { startYear: 2027, endYear: 2040 },
        }],
      },
      "2026-07-17T20:10:00+03:00",
    );
    expect(changed.sessionRevision).toBe(1);

    await revokeProtectedVisitorSession(
      sessions,
      handle.credential,
      "2026-07-17T20:20:00+03:00",
    );
    await expect(loadProtectedVisitorScenario(
      publications,
      sessions,
      handle.credential,
      "2026-07-17T20:21:00+03:00",
    )).rejects.toMatchObject({ code: "INVALID_SESSION_CREDENTIAL" });
  });

  it("cascades the capability record when its visitor session is deleted", async () => {
    const handle = await createProtectedVisitorSession(
      publications,
      sessions,
      SESSION_COMMAND,
      new FixedCredentialGenerator("pg-cascade-session", "I".repeat(43)),
    );
    await sessions.delete(handle.credential.sessionId);
    expect(await sessions.loadAccessRecord(handle.credential.sessionId))
      .toBeUndefined();
  });

  it("enforces protected optimistic locking in one PostgreSQL transaction", async () => {
    const handle = await createProtectedVisitorSession(
      publications,
      sessions,
      SESSION_COMMAND,
      new FixedCredentialGenerator("pg-lock-session", "J".repeat(43)),
    );
    await applyProtectedVisitorSessionChanges(publications, sessions, {
      ...handle.credential,
      expectedRevision: 0,
      operations: [{
        type: "set_horizon",
        value: { startYear: 2027, endYear: 2040 },
      }],
    }, "2026-07-17T20:10:00+03:00");
    await expect(applyProtectedVisitorSessionChanges(publications, sessions, {
      ...handle.credential,
      expectedRevision: 0,
      operations: [{
        type: "set_horizon",
        value: { startYear: 2028, endYear: 2041 },
      }],
    }, "2026-07-17T20:11:00+03:00"))
      .rejects.toMatchObject({ code: "SESSION_REVISION_CONFLICT" });
  });
});
