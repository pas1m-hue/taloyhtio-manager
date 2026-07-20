import {
  DomainValidationError,
  type PublishAdminDataCommand,
  type PublishedDataSnapshot,
} from "../domain/types.js";
import type { PublishingRepository } from "./publicationRepository.js";
import { createPublishedDataSnapshot } from "./publishedSnapshot.js";

/**
 * Publishes one exact admin workspace revision as the next immutable public
 * version. The repository rechecks admin and publication revisions atomically
 * at commit time.
 */
export async function publishAdminData(
  repository: PublishingRepository,
  command: PublishAdminDataCommand,
): Promise<PublishedDataSnapshot> {
  const admin = await repository.load(command.companyId);
  if (admin === undefined) {
    throw new DomainValidationError(
      "ADMIN_DATA_NOT_FOUND",
      `Admin data ${command.companyId} does not exist.`,
    );
  }

  const current = await repository.loadCurrent(command.companyId);
  const currentVersion = current?.publicationVersion ?? 0;
  if (currentVersion !== command.expectedPublishedVersion) {
    throw new DomainValidationError(
      "PUBLISHED_VERSION_CONFLICT",
      `Published data ${command.companyId} is at version ${currentVersion}, ` +
        `not ${command.expectedPublishedVersion}.`,
    );
  }

  const next = createPublishedDataSnapshot(admin, command);
  if (current?.contentFingerprint === next.contentFingerprint) {
    throw new DomainValidationError(
      "NO_PUBLICATION_CHANGES",
      `Admin revision ${admin.revision} has no publishable changes.`,
    );
  }
  return repository.publish(
    command.companyId,
    command.expectedAdminRevision,
    command.expectedPublishedVersion,
    next,
  );
}
