import type {
  Horizon,
  PublishedDataSnapshot,
  VisitorPublishedView,
} from "../domain/types.js";
import { buildVisitorPublishedView } from "../publishing/visitorPublishedView.js";
import {
  buildSnapshotCalculations,
  type SnapshotCalculationReadModel,
} from "./calculationReadModel.js";

export interface PublishedOverviewReadModel {
  readonly companyId: string;
  readonly publicationVersion: number;
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly explanation: string;
  readonly contentFingerprint: string;
  readonly data: VisitorPublishedView;
  readonly calculations: SnapshotCalculationReadModel;
}

export interface PublicationHistoryItem {
  readonly companyId: string;
  readonly publicationVersion: number;
  readonly sourceAdminRevision: number;
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly explanation: string;
  readonly sourceIds: readonly string[];
  readonly contentFingerprint: string;
}

export interface PublicationHistoryReadModel {
  readonly companyId: string;
  readonly currentPublicationVersion: number;
  /** Newest publication first. */
  readonly versions: readonly PublicationHistoryItem[];
}

export function buildPublishedOverviewReadModel(
  snapshot: PublishedDataSnapshot,
  horizon: Horizon,
): PublishedOverviewReadModel {
  return structuredClone({
    companyId: snapshot.companyId,
    publicationVersion: snapshot.publicationVersion,
    publishedAt: snapshot.publishedAt,
    publishedBy: snapshot.publishedBy,
    explanation: snapshot.explanation,
    contentFingerprint: snapshot.contentFingerprint,
    data: buildVisitorPublishedView(snapshot),
    calculations: buildSnapshotCalculations(snapshot, horizon),
  });
}

export function buildPublicationHistoryReadModel(
  companyId: string,
  snapshots: readonly PublishedDataSnapshot[],
): PublicationHistoryReadModel {
  const versions = [...snapshots]
    .sort((a, b) => b.publicationVersion - a.publicationVersion)
    .map((snapshot) => ({
      companyId: snapshot.companyId,
      publicationVersion: snapshot.publicationVersion,
      sourceAdminRevision: snapshot.sourceAdminRevision,
      publishedAt: snapshot.publishedAt,
      publishedBy: snapshot.publishedBy,
      explanation: snapshot.explanation,
      sourceIds: [...snapshot.sourceIds],
      contentFingerprint: snapshot.contentFingerprint,
    }));
  return structuredClone({
    companyId,
    currentPublicationVersion: versions[0]?.publicationVersion ?? 0,
    versions,
  });
}
