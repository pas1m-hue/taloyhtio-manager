import {
  DomainValidationError,
} from "../domain/types.js";
import type { CompanyAccessGrant } from "./authTypes.js";
import { validateCompanyAccessGrant } from "./authorization.js";

export interface CompanyAccessRepository {
  load(
    companyId: string,
    subjectId: string,
  ): Promise<CompanyAccessGrant | undefined>;
  save(grant: CompanyAccessGrant): Promise<CompanyAccessGrant>;
}

/** Test/MVP adapter. Production authorization uses the PostgreSQL adapter. */
export class InMemoryCompanyAccessRepository
implements CompanyAccessRepository {
  readonly #grants = new Map<string, CompanyAccessGrant>();

  public constructor(initial: readonly CompanyAccessGrant[] = []) {
    for (const grant of initial) {
      validateCompanyAccessGrant(grant);
      const key = grantKey(grant.companyId, grant.subjectId);
      if (this.#grants.has(key)) {
        throw new DomainValidationError(
          "INVALID_ACCESS_GRANT",
          `Duplicate company access grant ${key}.`,
        );
      }
      this.#grants.set(key, clone(grant));
    }
  }

  public async load(
    companyId: string,
    subjectId: string,
  ): Promise<CompanyAccessGrant | undefined> {
    const grant = this.#grants.get(grantKey(companyId, subjectId));
    return grant === undefined ? undefined : clone(grant);
  }

  public async save(grant: CompanyAccessGrant): Promise<CompanyAccessGrant> {
    validateCompanyAccessGrant(grant);
    this.#grants.set(grantKey(grant.companyId, grant.subjectId), clone(grant));
    return clone(grant);
  }
}

function grantKey(companyId: string, subjectId: string): string {
  return `${companyId}\u0000${subjectId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
