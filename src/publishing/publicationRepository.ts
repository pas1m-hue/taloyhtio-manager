import {
  DomainValidationError,
  type AdminDataSnapshot,
  type PublishedDataSnapshot,
} from "../domain/types.js";
import type { AdminDataRepository } from "../admin/adminRepository.js";
import { validatePublishedDataSnapshot } from "./publishedSnapshot.js";

export interface PublicationRepository {
  loadCurrent(companyId: string): Promise<PublishedDataSnapshot | undefined>;
  loadVersion(
    companyId: string,
    publicationVersion: number,
  ): Promise<PublishedDataSnapshot | undefined>;
  listVersions(companyId: string): Promise<readonly PublishedDataSnapshot[]>;
  /**
   * A database adapter must verify both revisions and insert the publication
   * in one transaction. This prevents an older workspace revision from being
   * published after a concurrent admin edit.
   */
  publish(
    companyId: string,
    expectedAdminRevision: number,
    expectedPublishedVersion: number,
    next: PublishedDataSnapshot,
  ): Promise<PublishedDataSnapshot>;
}

export interface PublishingRepository
  extends AdminDataRepository, PublicationRepository {}

/** In-memory test/MVP adapter retaining admin state and publication history. */
export class InMemoryPublishingRepository implements PublishingRepository {
  readonly #adminStates = new Map<string, AdminDataSnapshot>();
  readonly #versions = new Map<string, PublishedDataSnapshot[]>();

  public constructor(
    adminStates: readonly AdminDataSnapshot[] = [],
    publications: readonly PublishedDataSnapshot[] = [],
  ) {
    for (const state of adminStates) {
      this.#adminStates.set(state.companyId, clone(state));
    }
    for (const snapshot of [...publications].sort((a, b) =>
      a.publicationVersion - b.publicationVersion
    )) {
      validatePublishedDataSnapshot(snapshot);
      const versions = this.#versions.get(snapshot.companyId) ?? [];
      if (snapshot.publicationVersion !== versions.length + 1) {
        throw new DomainValidationError(
          "PUBLISHED_VERSION_CONFLICT",
          `Publication history for ${snapshot.companyId} is not contiguous.`,
        );
      }
      versions.push(clone(snapshot));
      this.#versions.set(snapshot.companyId, versions);
    }
  }

  public async load(companyId: string): Promise<AdminDataSnapshot | undefined> {
    const state = this.#adminStates.get(companyId);
    return state === undefined ? undefined : clone(state);
  }

  public async save(
    companyId: string,
    expectedRevision: number,
    next: AdminDataSnapshot,
  ): Promise<AdminDataSnapshot> {
    const current = this.#adminStates.get(companyId);
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
    this.#adminStates.set(companyId, clone(next));
    return clone(next);
  }

  public async loadCurrent(
    companyId: string,
  ): Promise<PublishedDataSnapshot | undefined> {
    const current = (this.#versions.get(companyId) ?? []).at(-1);
    return current === undefined ? undefined : clone(current);
  }

  public async loadVersion(
    companyId: string,
    publicationVersion: number,
  ): Promise<PublishedDataSnapshot | undefined> {
    if (!Number.isInteger(publicationVersion) || publicationVersion <= 0) {
      return undefined;
    }
    const snapshot = (this.#versions.get(companyId) ?? [])
      .find((item) => item.publicationVersion === publicationVersion);
    return snapshot === undefined ? undefined : clone(snapshot);
  }

  public async listVersions(
    companyId: string,
  ): Promise<readonly PublishedDataSnapshot[]> {
    return (this.#versions.get(companyId) ?? [])
      .map(clone)
      .sort((a, b) => a.publicationVersion - b.publicationVersion);
  }

  public async publish(
    companyId: string,
    expectedAdminRevision: number,
    expectedPublishedVersion: number,
    next: PublishedDataSnapshot,
  ): Promise<PublishedDataSnapshot> {
    validatePublishedDataSnapshot(next);
    const admin = this.#adminStates.get(companyId);
    if (admin === undefined) {
      throw new DomainValidationError(
        "ADMIN_DATA_NOT_FOUND",
        `Admin data ${companyId} does not exist.`,
      );
    }
    const versions = this.#versions.get(companyId) ?? [];
    const currentPublishedVersion = versions.at(-1)?.publicationVersion ?? 0;
    if (admin.revision !== expectedAdminRevision ||
        next.sourceAdminRevision !== expectedAdminRevision) {
      throw new DomainValidationError(
        "ADMIN_REVISION_CONFLICT",
        `Admin data ${companyId} revision changed from ` +
          `${expectedAdminRevision} to ${admin.revision}.`,
      );
    }
    if (expectedPublishedVersion !== currentPublishedVersion ||
        next.publicationVersion !== currentPublishedVersion + 1 ||
        next.companyId !== companyId) {
      throw new DomainValidationError(
        "PUBLISHED_VERSION_CONFLICT",
        `Published data ${companyId} changed from version ` +
          `${expectedPublishedVersion} to ${currentPublishedVersion}.`,
      );
    }
    this.#versions.set(companyId, [...versions.map(clone), clone(next)]);
    return clone(next);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
