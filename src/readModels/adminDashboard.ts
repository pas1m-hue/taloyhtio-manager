import type {
  AdminAuditEntry,
  AdminDataSnapshot,
  BuildingEvent,
  Horizon,
  PublishedDataSnapshot,
} from "../domain/types.js";
import { fingerprintAdminPublishableContent } from "../publishing/publishedSnapshot.js";
import {
  buildSnapshotCalculations,
  latestLiquidityBaseline,
  type SnapshotCalculationReadModel,
} from "./calculationReadModel.js";

export interface AdminDashboardCounts {
  readonly assets: number;
  readonly approvedEvents: number;
  readonly suggestedEvents: number;
  readonly actualEvents: number;
  readonly cancelledEvents: number;
  readonly dataGapsWithinHorizon: number;
}

export interface AdminPublicationStatus {
  readonly latestPublicationVersion: number;
  readonly latestPublishedAdminRevision?: number;
  readonly latestPublishedAt?: string;
  readonly workspaceChangedSincePublication: boolean;
  readonly publishableChanges: boolean;
  readonly unpublishedAuditEntryCount: number;
}

export interface AdminDashboardReadModel {
  readonly companyId: string;
  readonly adminRevision: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly housingCompany: AdminDataSnapshot["housingCompany"];
  readonly financialYears: AdminDataSnapshot["financialYears"];
  readonly latestLiquidityBaseline?: AdminDataSnapshot["liquidityBaselines"][number];
  readonly assets: AdminDataSnapshot["assets"];
  readonly observations: AdminDataSnapshot["observations"];
  readonly costEvidence: AdminDataSnapshot["costEvidence"];
  readonly events: AdminDataSnapshot["events"];
  readonly auditTrail: readonly AdminAuditEntry[];
  readonly publication: AdminPublicationStatus;
  readonly counts: AdminDashboardCounts;
  readonly calculations: SnapshotCalculationReadModel;
}

export function buildAdminDashboardReadModel(
  admin: AdminDataSnapshot,
  currentPublication: PublishedDataSnapshot | undefined,
  horizon: Horizon,
): AdminDashboardReadModel {
  const calculations = buildSnapshotCalculations(admin, horizon);
  const latestBaseline = latestLiquidityBaseline(admin.liquidityBaselines);
  const latestPublishedRevision = currentPublication?.sourceAdminRevision;
  const unpublishedAudits = currentPublication === undefined
    ? admin.auditTrail
    : admin.auditTrail.filter((entry) => entry.revision > currentPublication.sourceAdminRevision);
  const counts = eventCounts(admin.assets.length, admin.events, calculations);
  const publication: AdminPublicationStatus = {
    latestPublicationVersion: currentPublication?.publicationVersion ?? 0,
    ...(latestPublishedRevision === undefined
      ? {}
      : { latestPublishedAdminRevision: latestPublishedRevision }),
    ...(currentPublication === undefined
      ? {}
      : { latestPublishedAt: currentPublication.publishedAt }),
    workspaceChangedSincePublication: currentPublication === undefined ||
      admin.revision !== currentPublication.sourceAdminRevision,
    publishableChanges: currentPublication === undefined ||
      fingerprintAdminPublishableContent(admin) !== currentPublication.contentFingerprint,
    unpublishedAuditEntryCount: unpublishedAudits.length,
  };
  return structuredClone({
    companyId: admin.companyId,
    adminRevision: admin.revision,
    updatedAt: admin.updatedAt,
    updatedBy: admin.updatedBy,
    housingCompany: admin.housingCompany,
    financialYears: admin.financialYears,
    ...(latestBaseline === undefined ? {} : { latestLiquidityBaseline: latestBaseline }),
    assets: admin.assets,
    observations: admin.observations,
    costEvidence: admin.costEvidence,
    events: admin.events,
    auditTrail: admin.auditTrail,
    publication,
    counts,
    calculations,
  });
}

function eventCounts(
  assetCount: number,
  events: readonly BuildingEvent[],
  calculations: SnapshotCalculationReadModel,
): AdminDashboardCounts {
  return {
    assets: assetCount,
    approvedEvents: events.filter((event) => event.status === "approved").length,
    suggestedEvents: events.filter((event) => event.status === "suggested").length,
    actualEvents: events.filter((event) => event.status === "actual").length,
    cancelledEvents: events.filter((event) => event.status === "cancelled").length,
    dataGapsWithinHorizon: calculations.projection.dataGaps.filter(
      (gap) => gap.horizonPosition === "within",
    ).length,
  };
}
