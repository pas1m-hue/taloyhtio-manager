import { DomainValidationError, type AdminDataSnapshot } from "../domain/types.js";

export interface AdminDataRepository {
  load(companyId: string): Promise<AdminDataSnapshot | undefined>;
  save(
    companyId: string,
    expectedRevision: number,
    next: AdminDataSnapshot,
  ): Promise<AdminDataSnapshot>;
}

/** Test/MVP adapter. A database adapter can implement the same contract later. */
export class InMemoryAdminDataRepository implements AdminDataRepository {
  readonly #states = new Map<string, AdminDataSnapshot>();

  public constructor(initialStates: readonly AdminDataSnapshot[] = []) {
    for (const state of initialStates) {
      this.#states.set(state.companyId, clone(state));
    }
  }

  public async load(companyId: string): Promise<AdminDataSnapshot | undefined> {
    const state = this.#states.get(companyId);
    return state === undefined ? undefined : clone(state);
  }

  public async save(
    companyId: string,
    expectedRevision: number,
    next: AdminDataSnapshot,
  ): Promise<AdminDataSnapshot> {
    const current = this.#states.get(companyId);
    if (current === undefined) {
      throw new DomainValidationError(
        "ADMIN_DATA_NOT_FOUND",
        `Admin data ${companyId} does not exist.`,
      );
    }
    if (current.revision !== expectedRevision ||
        next.revision !== expectedRevision + 1 || next.companyId !== companyId) {
      throw new DomainValidationError(
        "ADMIN_REVISION_CONFLICT",
        `Admin data ${companyId} revision changed from ${expectedRevision} ` +
          `to ${current.revision}.`,
      );
    }
    this.#states.set(companyId, clone(next));
    return clone(next);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
