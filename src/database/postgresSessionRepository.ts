import {
  DomainValidationError,
  type VisitorSessionWorkspace,
} from "../domain/types.js";
import type { VisitorSessionAccessRecord } from "../auth/authTypes.js";
import type { ProtectedSessionWorkspaceRepository } from "../auth/protectedSessionRepository.js";
import { validateVisitorSessionWorkspace } from "../session/sessionWorkspace.js";
import type { SqlExecutor, SqlPool } from "./sql.js";
import { withPostgresTransaction } from "./transaction.js";

interface SessionRow extends Record<string, unknown> {
  session_id: string;
  company_id: string;
  publication_version: string | number;
  publication_fingerprint: string;
  revision: string | number;
  payload: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  expires_at: Date | string;
}

interface AccessRow extends Record<string, unknown> {
  session_id: string;
  token_hash: string;
  created_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
}

/** PostgreSQL-backed TTL session storage with optional capability protection. */
export class PostgresSessionWorkspaceRepository
implements ProtectedSessionWorkspaceRepository {
  readonly #pool: SqlPool;

  public constructor(pool: SqlPool) {
    this.#pool = pool;
  }

  public async create(
    workspace: VisitorSessionWorkspace,
  ): Promise<VisitorSessionWorkspace> {
    validateVisitorSessionWorkspace(workspace);
    try {
      return await insertSession(this.#pool, workspace);
    } catch (error) {
      throw mapCreateError(error, workspace);
    }
  }

  public async createProtected(
    workspace: VisitorSessionWorkspace,
    access: VisitorSessionAccessRecord,
  ): Promise<VisitorSessionWorkspace> {
    validateVisitorSessionWorkspace(workspace);
    validateAccessRecord(access, workspace);
    try {
      return await withPostgresTransaction(this.#pool, async (client) => {
        const inserted = await insertSession(client, workspace);
        await client.query(
          `INSERT INTO tm_visitor_session_access
            (session_id, token_hash, created_at, expires_at, revoked_at)
           VALUES ($1, $2, $3, $4, NULL)`,
          [access.sessionId, access.tokenHash, access.createdAt, access.expiresAt],
        );
        return inserted;
      });
    } catch (error) {
      throw mapCreateError(error, workspace);
    }
  }

  public async load(
    sessionId: string,
  ): Promise<VisitorSessionWorkspace | undefined> {
    const result = await this.#pool.query<SessionRow>(sessionSelect(
      "WHERE session_id = $1",
    ), [sessionId]);
    const row = result.rows[0];
    return row === undefined ? undefined : parseSessionRow(row);
  }

  public async loadProtected(
    sessionId: string,
    tokenHash: string,
    asOf: string,
  ): Promise<VisitorSessionWorkspace | undefined> {
    if (!validDate(asOf)) return undefined;
    const result = await this.#pool.query<SessionRow>(
      `SELECT s.session_id, s.company_id, s.publication_version,
              s.publication_fingerprint, s.revision, s.payload,
              s.created_at, s.updated_at, s.expires_at
       FROM tm_visitor_sessions s
       JOIN tm_visitor_session_access a ON a.session_id = s.session_id
       WHERE s.session_id = $1
         AND a.token_hash = $2
         AND a.revoked_at IS NULL
         AND a.created_at <= $3
         AND a.expires_at > $3
         AND s.created_at <= $3
         AND s.expires_at > $3`,
      [sessionId, tokenHash, asOf],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : parseSessionRow(row);
  }

  public async save(
    sessionId: string,
    expectedRevision: number,
    next: VisitorSessionWorkspace,
  ): Promise<VisitorSessionWorkspace> {
    validateVisitorSessionWorkspace(next);
    validateNextRevision(sessionId, expectedRevision, next);
    return saveSession(
      this.#pool,
      sessionId,
      expectedRevision,
      next,
    );
  }

  public async saveProtected(
    sessionId: string,
    tokenHash: string,
    asOf: string,
    expectedRevision: number,
    next: VisitorSessionWorkspace,
  ): Promise<VisitorSessionWorkspace> {
    validateVisitorSessionWorkspace(next);
    validateNextRevision(sessionId, expectedRevision, next);
    if (!validDate(asOf)) throw invalidCredential();
    return withPostgresTransaction(this.#pool, async (client) => {
      const authorized = await client.query<{ revision: string | number }>(
        `SELECT s.revision
         FROM tm_visitor_sessions s
         JOIN tm_visitor_session_access a ON a.session_id = s.session_id
         WHERE s.session_id = $1
           AND a.token_hash = $2
           AND a.revoked_at IS NULL
           AND a.created_at <= $3
           AND a.expires_at > $3
           AND s.created_at <= $3
           AND s.expires_at > $3
         FOR UPDATE`,
        [sessionId, tokenHash, asOf],
      );
      const row = authorized.rows[0];
      if (row === undefined) throw invalidCredential();
      const currentRevision = integer(row.revision, "session revision");
      if (currentRevision !== expectedRevision) {
        throw sessionRevisionConflict(
          sessionId,
          expectedRevision,
          currentRevision,
        );
      }
      return saveSession(client, sessionId, expectedRevision, next);
    });
  }

  public async delete(sessionId: string): Promise<void> {
    await this.#pool.query(
      "DELETE FROM tm_visitor_sessions WHERE session_id = $1",
      [sessionId],
    );
  }

  public async revokeAccess(
    sessionId: string,
    revokedAt: string,
  ): Promise<void> {
    if (!validDate(revokedAt)) throw invalidCredential();
    const result = await this.#pool.query<{ session_id: string }>(
      `UPDATE tm_visitor_session_access
       SET revoked_at = $2
       WHERE session_id = $1
         AND revoked_at IS NULL
         AND created_at <= $2
       RETURNING session_id`,
      [sessionId, revokedAt],
    );
    if (result.rows[0] === undefined) throw invalidCredential();
  }

  public async loadAccessRecord(
    sessionId: string,
  ): Promise<VisitorSessionAccessRecord | undefined> {
    const result = await this.#pool.query<AccessRow>(
      `SELECT session_id, token_hash, created_at, expires_at, revoked_at
       FROM tm_visitor_session_access
       WHERE session_id = $1`,
      [sessionId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : parseAccessRow(row);
  }

  /** Optional maintenance hook for a scheduled TTL cleanup job. */
  public async deleteExpired(asOf: string): Promise<number> {
    if (!validDate(asOf)) {
      throw new DomainValidationError(
        "INVALID_SESSION_DATA",
        `Session cleanup date ${asOf} is invalid.`,
      );
    }
    const result = await this.#pool.query<{ session_id: string }>(
      `DELETE FROM tm_visitor_sessions
       WHERE expires_at <= $1
       RETURNING session_id`,
      [asOf],
    );
    return result.rows.length;
  }
}

async function insertSession(
  executor: SqlExecutor,
  workspace: VisitorSessionWorkspace,
): Promise<VisitorSessionWorkspace> {
  const result = await executor.query<SessionRow>(
    `INSERT INTO tm_visitor_sessions
      (session_id, company_id, publication_version,
       publication_fingerprint, revision, payload,
       created_at, updated_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
     RETURNING session_id, company_id, publication_version,
               publication_fingerprint, revision, payload,
               created_at, updated_at, expires_at`,
    values(workspace),
  );
  const row = result.rows[0];
  if (row === undefined) throw integrityError("Session insert returned no row.");
  return parseSessionRow(row);
}

async function saveSession(
  executor: SqlExecutor,
  sessionId: string,
  expectedRevision: number,
  next: VisitorSessionWorkspace,
): Promise<VisitorSessionWorkspace> {
  const result = await executor.query<SessionRow>(
    `UPDATE tm_visitor_sessions
     SET revision = $3,
         payload = $4::jsonb,
         updated_at = $5,
         expires_at = $6
     WHERE session_id = $1 AND revision = $2
     RETURNING session_id, company_id, publication_version,
               publication_fingerprint, revision, payload,
               created_at, updated_at, expires_at`,
    [
      sessionId,
      expectedRevision,
      next.revision,
      JSON.stringify(next),
      next.updatedAt,
      next.expiresAt,
    ],
  );
  const row = result.rows[0];
  if (row !== undefined) return parseSessionRow(row);
  const current = await executor.query<{ revision: string | number }>(
    "SELECT revision FROM tm_visitor_sessions WHERE session_id = $1",
    [sessionId],
  );
  const currentRow = current.rows[0];
  if (currentRow === undefined) {
    throw new DomainValidationError(
      "SESSION_NOT_FOUND",
      `Session ${sessionId} does not exist.`,
    );
  }
  throw sessionRevisionConflict(
    sessionId,
    expectedRevision,
    integer(currentRow.revision, "session revision"),
  );
}

function sessionSelect(where: string): string {
  return `SELECT session_id, company_id, publication_version,
                 publication_fingerprint, revision, payload,
                 created_at, updated_at, expires_at
          FROM tm_visitor_sessions ${where}`;
}

function values(workspace: VisitorSessionWorkspace): readonly unknown[] {
  return [
    workspace.sessionId,
    workspace.companyId,
    workspace.publicationVersion,
    workspace.publicationFingerprint,
    workspace.revision,
    JSON.stringify(workspace),
    workspace.createdAt,
    workspace.updatedAt,
    workspace.expiresAt,
  ];
}

function parseSessionRow(row: SessionRow): VisitorSessionWorkspace {
  const payload = parsePayload(row.payload);
  const publicationVersion = integer(
    row.publication_version,
    "session publication version",
  );
  const revision = integer(row.revision, "session revision");
  if (payload.sessionId !== row.session_id ||
      payload.companyId !== row.company_id ||
      payload.publicationVersion !== publicationVersion ||
      payload.publicationFingerprint !== row.publication_fingerprint ||
      payload.revision !== revision ||
      Date.parse(payload.createdAt) !== Date.parse(String(row.created_at)) ||
      Date.parse(payload.updatedAt) !== Date.parse(String(row.updated_at)) ||
      Date.parse(payload.expiresAt) !== Date.parse(String(row.expires_at))) {
    throw integrityError(`Session row ${row.session_id} metadata does not match payload.`);
  }
  validateVisitorSessionWorkspace(payload);
  return clone(payload);
}

function parseAccessRow(row: AccessRow): VisitorSessionAccessRecord {
  const record: VisitorSessionAccessRecord = {
    sessionId: row.session_id,
    tokenHash: row.token_hash,
    createdAt: timestamp(row.created_at),
    expiresAt: timestamp(row.expires_at),
    ...(row.revoked_at === null ? {} : { revokedAt: timestamp(row.revoked_at) }),
  };
  if (!/^[a-f0-9]{64}$/.test(record.tokenHash) ||
      Date.parse(record.expiresAt) <= Date.parse(record.createdAt)) {
    throw integrityError(`Session access row ${row.session_id} is invalid.`);
  }
  return clone(record);
}

function parsePayload(value: unknown): VisitorSessionWorkspace {
  try {
    return clone((typeof value === "string"
      ? JSON.parse(value)
      : value) as VisitorSessionWorkspace);
  } catch {
    throw integrityError("Stored visitor-session payload is not valid JSON.");
  }
}

function validateAccessRecord(
  access: VisitorSessionAccessRecord,
  workspace: VisitorSessionWorkspace,
): void {
  if (access.sessionId !== workspace.sessionId ||
      !/^[a-f0-9]{64}$/.test(access.tokenHash) ||
      Date.parse(access.createdAt) !== Date.parse(workspace.createdAt) ||
      Date.parse(access.expiresAt) !== Date.parse(workspace.expiresAt) ||
      Date.parse(access.expiresAt) <= Date.parse(access.createdAt) ||
      access.revokedAt !== undefined) {
    throw new DomainValidationError(
      "INVALID_SESSION_CREDENTIAL",
      `Session ${workspace.sessionId} access record is invalid.`,
    );
  }
}

function validateNextRevision(
  sessionId: string,
  expectedRevision: number,
  next: VisitorSessionWorkspace,
): void {
  if (next.sessionId !== sessionId || next.revision !== expectedRevision + 1) {
    throw sessionRevisionConflict(sessionId, expectedRevision, next.revision);
  }
}

function mapCreateError(
  error: unknown,
  workspace: VisitorSessionWorkspace,
): unknown {
  const code = postgresErrorCode(error);
  if (code === "23505") {
    return new DomainValidationError(
      "SESSION_ALREADY_EXISTS",
      `Session ${workspace.sessionId} already exists.`,
    );
  }
  if (code === "23503") {
    return new DomainValidationError(
      "PUBLISHED_DATA_NOT_FOUND",
      `Published data ${workspace.companyId} version ` +
        `${workspace.publicationVersion} does not exist.`,
    );
  }
  return error;
}

function integer(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw integrityError(`Stored ${label} is not a safe integer.`);
  }
  return parsed;
}

function timestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw integrityError("Stored session-access timestamp is invalid.");
  }
  return date.toISOString();
}

function sessionRevisionConflict(
  sessionId: string,
  expected: number,
  current: number,
): DomainValidationError {
  return new DomainValidationError(
    "SESSION_REVISION_CONFLICT",
    `Session ${sessionId} revision changed from ${expected} to ${current}.`,
  );
}

function invalidCredential(): DomainValidationError {
  return new DomainValidationError(
    "INVALID_SESSION_CREDENTIAL",
    "Visitor session credential is invalid, expired or revoked.",
  );
}

function integrityError(message: string): DomainValidationError {
  return new DomainValidationError("DATABASE_INTEGRITY_ERROR", message);
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function validDate(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Date.parse(value));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
