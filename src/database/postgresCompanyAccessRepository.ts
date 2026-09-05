import { DomainValidationError } from "../domain/types.js";
import type {
  CompanyAccessGrant,
} from "../auth/authTypes.js";
import type { CompanyAccessRepository } from "../auth/companyAccessRepository.js";
import { validateCompanyAccessGrant } from "../auth/authorization.js";
import type { SqlPool } from "./sql.js";
import { instantIso } from "./postgresValues.js";

interface GrantRow extends Record<string, unknown> {
  company_id: string;
  subject_id: string;
  role: string;
  active: boolean;
  granted_at: Date | string;
  granted_by: string;
  revoked_at: Date | string | null;
  revoked_by: string | null;
}

export class PostgresCompanyAccessRepository
implements CompanyAccessRepository {
  readonly #pool: SqlPool;

  public constructor(pool: SqlPool) {
    this.#pool = pool;
  }

  public async load(
    companyId: string,
    subjectId: string,
  ): Promise<CompanyAccessGrant | undefined> {
    const result = await this.#pool.query<GrantRow>(
      `SELECT company_id, subject_id, role, active,
              granted_at, granted_by, revoked_at, revoked_by
       FROM tm_company_access_grants
       WHERE company_id = $1 AND subject_id = $2`,
      [companyId, subjectId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : parseGrant(row);
  }

  public async save(grant: CompanyAccessGrant): Promise<CompanyAccessGrant> {
    validateCompanyAccessGrant(grant);
    try {
      const result = await this.#pool.query<GrantRow>(
        `INSERT INTO tm_company_access_grants
          (company_id, subject_id, role, active,
           granted_at, granted_by, revoked_at, revoked_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (company_id, subject_id)
         DO UPDATE SET
           role = EXCLUDED.role,
           active = EXCLUDED.active,
           granted_at = EXCLUDED.granted_at,
           granted_by = EXCLUDED.granted_by,
           revoked_at = EXCLUDED.revoked_at,
           revoked_by = EXCLUDED.revoked_by
         RETURNING company_id, subject_id, role, active,
                   granted_at, granted_by, revoked_at, revoked_by`,
        [
          grant.companyId,
          grant.subjectId,
          grant.role,
          grant.active,
          grant.grantedAt,
          grant.grantedBy,
          grant.revokedAt ?? null,
          grant.revokedBy ?? null,
        ],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw integrityError("Company access upsert returned no row.");
      }
      return parseGrant(row);
    } catch (error) {
      if (postgresErrorCode(error) === "23503") {
        throw new DomainValidationError(
          "ADMIN_DATA_NOT_FOUND",
          `Admin data ${grant.companyId} does not exist.`,
        );
      }
      throw error;
    }
  }
}

function parseGrant(row: GrantRow): CompanyAccessGrant {
  if (row.role !== "admin") {
    throw integrityError(`Stored role ${row.role} is not supported.`);
  }
  const grant: CompanyAccessGrant = {
    companyId: row.company_id,
    subjectId: row.subject_id,
    role: "admin",
    active: row.active,
    grantedAt: instantIso(row.granted_at, "access-grant granted_at"),
    grantedBy: row.granted_by,
    ...(row.revoked_at === null ? {} : { revokedAt: instantIso(row.revoked_at, "access-grant revoked_at") }),
    ...(row.revoked_by === null ? {} : { revokedBy: row.revoked_by }),
  };
  validateCompanyAccessGrant(grant);
  return structuredClone(grant);
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
