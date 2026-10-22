import { validateAdminDataSnapshot } from "../admin/adminDataValidation.js";
import type { AdminDataRepository } from "../admin/adminRepository.js";
import {
  DomainValidationError,
  type AdminDataSnapshot,
} from "../domain/types.js";
import type { SqlExecutor, SqlPool } from "./sql.js";
import { instantMillis, integer } from "./postgresValues.js";
import { withoutLegacyBaselineFields } from "../domain/legacyFieldNames.js";

interface AdminRow extends Record<string, unknown> {
  company_id: string;
  revision: string | number;
  payload: unknown;
  updated_at: Date | string;
  updated_by: string;
}

/** PostgreSQL/Supabase-compatible repository for admin state. */
export class PostgresPublishingRepository implements AdminDataRepository {
  readonly #pool: SqlPool;

  public constructor(pool: SqlPool) {
    this.#pool = pool;
  }

  /** One-time company bootstrap. Normal admin writes continue through save(). */
  public async initializeAdminData(
    snapshot: AdminDataSnapshot,
  ): Promise<AdminDataSnapshot> {
    validateAdminDataSnapshot(snapshot);
    const result = await this.#pool.query<AdminRow>(
      `INSERT INTO tm_admin_snapshots
        (company_id, revision, payload, updated_at, updated_by)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (company_id) DO NOTHING
       RETURNING company_id, revision, payload, updated_at, updated_by`,
      [
        snapshot.companyId,
        snapshot.revision,
        JSON.stringify(snapshot),
        snapshot.updatedAt,
        snapshot.updatedBy,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new DomainValidationError(
        "ADMIN_DATA_ALREADY_EXISTS",
        `Admin data ${snapshot.companyId} already exists.`,
      );
    }
    return parseAdminRow(row);
  }

  public async load(companyId: string): Promise<AdminDataSnapshot | undefined> {
    const result = await this.#pool.query<AdminRow>(
      `SELECT company_id, revision, payload, updated_at, updated_by
       FROM tm_admin_snapshots
       WHERE company_id = $1`,
      [companyId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : parseAdminRow(row);
  }

  public async save(
    companyId: string,
    expectedRevision: number,
    next: AdminDataSnapshot,
  ): Promise<AdminDataSnapshot> {
    validateAdminDataSnapshot(next);
    if (next.companyId !== companyId ||
        next.revision !== expectedRevision + 1) {
      throw adminRevisionConflict(companyId, expectedRevision, next.revision);
    }
    const result = await this.#pool.query<AdminRow>(
      `UPDATE tm_admin_snapshots
       SET revision = $3,
           payload = $4::jsonb,
           updated_at = $5,
           updated_by = $6
       WHERE company_id = $1 AND revision = $2
       RETURNING company_id, revision, payload, updated_at, updated_by`,
      [
        companyId,
        expectedRevision,
        next.revision,
        JSON.stringify(next),
        next.updatedAt,
        next.updatedBy,
      ],
    );
    const row = result.rows[0];
    if (row !== undefined) {
      return parseAdminRow(row);
    }
    const current = await currentAdminRevision(this.#pool, companyId);
    if (current === undefined) {
      throw new DomainValidationError(
        "ADMIN_DATA_NOT_FOUND",
        `Admin data ${companyId} does not exist.`,
      );
    }
    throw adminRevisionConflict(companyId, expectedRevision, current);
  }
}

async function currentAdminRevision(
  executor: SqlExecutor,
  companyId: string,
): Promise<number | undefined> {
  const result = await executor.query<{ revision: string | number }>(
    "SELECT revision FROM tm_admin_snapshots WHERE company_id = $1",
    [companyId],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : integer(row.revision, "admin revision");
}

function parseAdminRow(row: AdminRow): AdminDataSnapshot {
  const payload = withDefaultedAdminCollections(
    parsePayload<AdminDataSnapshot>(row.payload, "admin snapshot"),
  );
  const revision = integer(row.revision, "admin revision");
  if (payload.companyId !== row.company_id || payload.revision !== revision ||
      payload.updatedBy !== row.updated_by ||
      instantMillis(payload.updatedAt, "admin payload updatedAt") !==
        instantMillis(row.updated_at, "admin row updated_at")) {
    throw integrityError(`Admin row ${row.company_id} metadata does not match payload.`);
  }
  validateAdminDataSnapshot(payload);
  return clone(payload);
}

/**
 * Defaults every additive AdminDataSnapshot collection field to an empty
 * array when a stored row predates it. The JSONB snapshot has no SQL
 * migration path (single-blob architecture, see the vaihe-3A handoff): a row
 * written before a new collection field existed simply omits that JSON key,
 * so `payload.someCollection` is `undefined` at runtime despite the static
 * type saying otherwise. Without this, validateAdminDataSnapshot's
 * `uniqueBy()`/`.forEach()` calls throw "is not iterable" the first time an
 * old row is loaded after a field is added — this happened for
 * financialAccounts/financialEntries against real Supabase data.
 */
function withDefaultedAdminCollections(
  payload: AdminDataSnapshot,
): AdminDataSnapshot {
  return {
    ...payload,
    financialYears: payload.financialYears ?? [],
    liquidityBaselines: (payload.liquidityBaselines ?? []).map(withoutLegacyBaselineFields),
    assets: payload.assets ?? [],
    observations: payload.observations ?? [],
    costEvidence: payload.costEvidence ?? [],
    priceLevelConfirmations: payload.priceLevelConfirmations ?? [],
    events: payload.events ?? [],
    financialAccounts: payload.financialAccounts ?? [],
    financialEntries: payload.financialEntries ?? [],
    balanceSheetSnapshots: payload.balanceSheetSnapshots ?? [],
    groupBudgets: payload.groupBudgets ?? [],
    groupActuals: payload.groupActuals ?? [],
    maintenanceDocuments: payload.maintenanceDocuments ?? [],
    auditTrail: payload.auditTrail ?? [],
  };
}

function parsePayload<T>(value: unknown, label: string): T {
  try {
    return clone((typeof value === "string" ? JSON.parse(value) : value) as T);
  } catch {
    throw integrityError(`Stored ${label} payload is not valid JSON.`);
  }
}

function adminRevisionConflict(
  companyId: string,
  expected: number,
  current: number,
): DomainValidationError {
  return new DomainValidationError(
    "ADMIN_REVISION_CONFLICT",
    `Admin data ${companyId} revision changed from ${expected} to ${current}.`,
  );
}

function integrityError(message: string): DomainValidationError {
  return new DomainValidationError("DATABASE_INTEGRITY_ERROR", message);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
