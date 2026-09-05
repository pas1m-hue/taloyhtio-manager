import { validateAdminDataSnapshot } from "../admin/adminDataValidation.js";
import type { PublishingRepository } from "../publishing/publicationRepository.js";
import { validatePublishedDataSnapshot } from "../publishing/publishedSnapshot.js";
import {
  DomainValidationError,
  type AdminDataSnapshot,
  type PublishedDataSnapshot,
} from "../domain/types.js";
import type { SqlExecutor, SqlPool } from "./sql.js";
import { withPostgresTransaction } from "./transaction.js";
import { postgresErrorCode } from "./postgresErrors.js";

interface AdminRow extends Record<string, unknown> {
  company_id: string;
  revision: string | number;
  payload: unknown;
  updated_at: Date | string;
  updated_by: string;
}

interface PublicationRow extends Record<string, unknown> {
  company_id: string;
  publication_version: string | number;
  source_admin_revision: string | number;
  content_fingerprint: string;
  payload: unknown;
  published_at: Date | string;
  published_by: string;
}

/** PostgreSQL/Supabase-compatible repository for admin state and publications. */
export class PostgresPublishingRepository implements PublishingRepository {
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

  public async loadCurrent(
    companyId: string,
  ): Promise<PublishedDataSnapshot | undefined> {
    const result = await this.#pool.query<PublicationRow>(
      `SELECT company_id, publication_version, source_admin_revision,
              content_fingerprint, payload, published_at, published_by
       FROM tm_publications
       WHERE company_id = $1
       ORDER BY publication_version DESC
       LIMIT 1`,
      [companyId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : parsePublicationRow(row);
  }

  public async loadVersion(
    companyId: string,
    publicationVersion: number,
  ): Promise<PublishedDataSnapshot | undefined> {
    if (!Number.isInteger(publicationVersion) || publicationVersion <= 0) {
      return undefined;
    }
    const result = await this.#pool.query<PublicationRow>(
      `SELECT company_id, publication_version, source_admin_revision,
              content_fingerprint, payload, published_at, published_by
       FROM tm_publications
       WHERE company_id = $1 AND publication_version = $2`,
      [companyId, publicationVersion],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : parsePublicationRow(row);
  }

  public async listVersions(
    companyId: string,
  ): Promise<readonly PublishedDataSnapshot[]> {
    const result = await this.#pool.query<PublicationRow>(
      `SELECT company_id, publication_version, source_admin_revision,
              content_fingerprint, payload, published_at, published_by
       FROM tm_publications
       WHERE company_id = $1
       ORDER BY publication_version ASC`,
      [companyId],
    );
    return result.rows.map(parsePublicationRow);
  }

  public async publish(
    companyId: string,
    expectedAdminRevision: number,
    expectedPublishedVersion: number,
    next: PublishedDataSnapshot,
  ): Promise<PublishedDataSnapshot> {
    validatePublishedDataSnapshot(next);
    return withPostgresTransaction(this.#pool, async (client) => {
      const adminResult = await client.query<AdminRow>(
        `SELECT company_id, revision, payload, updated_at, updated_by
         FROM tm_admin_snapshots
         WHERE company_id = $1
         FOR UPDATE`,
        [companyId],
      );
      const adminRow = adminResult.rows[0];
      if (adminRow === undefined) {
        throw new DomainValidationError(
          "ADMIN_DATA_NOT_FOUND",
          `Admin data ${companyId} does not exist.`,
        );
      }
      const admin = parseAdminRow(adminRow);
      if (admin.revision !== expectedAdminRevision ||
          next.sourceAdminRevision !== expectedAdminRevision ||
          next.companyId !== companyId) {
        throw adminRevisionConflict(
          companyId,
          expectedAdminRevision,
          admin.revision,
        );
      }

      const currentResult = await client.query<PublicationRow>(
        `SELECT company_id, publication_version, source_admin_revision,
                content_fingerprint, payload, published_at, published_by
         FROM tm_publications
         WHERE company_id = $1
         ORDER BY publication_version DESC
         LIMIT 1
         FOR UPDATE`,
        [companyId],
      );
      const currentRow = currentResult.rows[0];
      const current = currentRow === undefined
        ? undefined
        : parsePublicationRow(currentRow);
      const currentVersion = current?.publicationVersion ?? 0;
      if (currentVersion !== expectedPublishedVersion ||
          next.publicationVersion !== currentVersion + 1) {
        throw publishedVersionConflict(
          companyId,
          expectedPublishedVersion,
          currentVersion,
        );
      }
      if (current?.contentFingerprint === next.contentFingerprint) {
        throw new DomainValidationError(
          "NO_PUBLICATION_CHANGES",
          `Published content for ${companyId} has not changed.`,
        );
      }

      try {
        const inserted = await client.query<PublicationRow>(
          `INSERT INTO tm_publications
            (company_id, publication_version, source_admin_revision,
             content_fingerprint, payload, published_at, published_by)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
           RETURNING company_id, publication_version, source_admin_revision,
                     content_fingerprint, payload, published_at, published_by`,
          [
            next.companyId,
            next.publicationVersion,
            next.sourceAdminRevision,
            next.contentFingerprint,
            JSON.stringify(next),
            next.publishedAt,
            next.publishedBy,
          ],
        );
        const row = inserted.rows[0];
        if (row === undefined) {
          throw integrityError("Publication insert returned no row.");
        }
        return parsePublicationRow(row);
      } catch (error) {
        if (postgresErrorCode(error) === "23505") {
          throw publishedVersionConflict(
            companyId,
            expectedPublishedVersion,
            currentVersion + 1,
          );
        }
        throw error;
      }
    });
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
    liquidityBaselines: payload.liquidityBaselines ?? [],
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
    auditTrail: payload.auditTrail ?? [],
  };
}

function parsePublicationRow(row: PublicationRow): PublishedDataSnapshot {
  const payload = parsePayload<PublishedDataSnapshot>(
    row.payload,
    "published snapshot",
  );
  const publicationVersion = integer(
    row.publication_version,
    "publication version",
  );
  const sourceAdminRevision = integer(
    row.source_admin_revision,
    "source admin revision",
  );
  if (payload.companyId !== row.company_id ||
      payload.publicationVersion !== publicationVersion ||
      payload.sourceAdminRevision !== sourceAdminRevision ||
      payload.contentFingerprint !== row.content_fingerprint ||
      payload.publishedBy !== row.published_by ||
      instantMillis(payload.publishedAt, "publication payload publishedAt") !==
        instantMillis(row.published_at, "publication row published_at")) {
    throw integrityError(
      `Publication row ${row.company_id}/${publicationVersion} metadata does not match payload.`,
    );
  }
  validatePublishedDataSnapshot(payload);
  return clone(payload);
}

function parsePayload<T>(value: unknown, label: string): T {
  try {
    return clone((typeof value === "string" ? JSON.parse(value) : value) as T);
  } catch {
    throw integrityError(`Stored ${label} payload is not valid JSON.`);
  }
}


function instantMillis(value: Date | string, label: string): number {
  if (value instanceof Date) {
    const millis = value.getTime();
    if (!Number.isFinite(millis)) {
      throw integrityError(`Stored ${label} timestamp is invalid.`);
    }
    return millis;
  }

  const text = value.trim();
  const normalized = text
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00");
  const millis = Date.parse(normalized);
  if (!Number.isFinite(millis)) {
    throw integrityError(`Stored ${label} timestamp is invalid.`);
  }
  return millis;
}

function integer(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw integrityError(`Stored ${label} is not a safe integer.`);
  }
  return parsed;
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

function publishedVersionConflict(
  companyId: string,
  expected: number,
  current: number,
): DomainValidationError {
  return new DomainValidationError(
    "PUBLISHED_VERSION_CONFLICT",
    `Published data ${companyId} changed from version ${expected} to ${current}.`,
  );
}

function integrityError(message: string): DomainValidationError {
  return new DomainValidationError("DATABASE_INTEGRITY_ERROR", message);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
