import type {
  PublishAdminDataCommand,
  PublishedDataSnapshot,
} from "../domain/types.js";
import { publishAdminData } from "../publishing/publishAdminData.js";
import type { PublishingRepository } from "../publishing/publicationRepository.js";
import {
  buildPublicationHistoryReadModel,
  type PublicationHistoryItem,
  type PublicationHistoryReadModel,
} from "../readModels/publishedOverview.js";

/** Publishes one exact admin revision and returns compact UI metadata. */
export async function publishAdminRevision(
  repository: PublishingRepository,
  command: PublishAdminDataCommand,
): Promise<PublicationHistoryItem> {
  const snapshot = await publishAdminData(repository, command);
  return publicationItem(snapshot);
}

/** Loads immutable publication metadata newest first, without full payloads. */
export async function loadPublicationHistory(
  repository: PublishingRepository,
  companyId: string,
): Promise<PublicationHistoryReadModel> {
  const versions = await repository.listVersions(companyId);
  return buildPublicationHistoryReadModel(companyId, versions);
}

function publicationItem(snapshot: PublishedDataSnapshot): PublicationHistoryItem {
  return structuredClone({
    companyId: snapshot.companyId,
    publicationVersion: snapshot.publicationVersion,
    sourceAdminRevision: snapshot.sourceAdminRevision,
    publishedAt: snapshot.publishedAt,
    publishedBy: snapshot.publishedBy,
    explanation: snapshot.explanation,
    sourceIds: snapshot.sourceIds,
    contentFingerprint: snapshot.contentFingerprint,
  });
}
