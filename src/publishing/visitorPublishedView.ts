import {
  DomainValidationError,
  type ActualBuildingEvent,
  type FutureBuildingEvent,
  type PublishedDataSnapshot,
  type VisitorPublishedView,
} from "../domain/types.js";
import type { PublicationRepository } from "./publicationRepository.js";
import { validatePublishedDataSnapshot } from "./publishedSnapshot.js";

/** Loads only the latest immutable publication for visitor-facing use. */
export async function loadVisitorPublishedView(
  repository: PublicationRepository,
  companyId: string,
): Promise<VisitorPublishedView> {
  const current = await repository.loadCurrent(companyId);
  if (current === undefined) {
    throw new DomainValidationError(
      "PUBLISHED_DATA_NOT_FOUND",
      `Published data ${companyId} does not exist.`,
    );
  }
  return buildVisitorPublishedView(current);
}

export function buildVisitorPublishedView(
  snapshot: PublishedDataSnapshot,
): VisitorPublishedView {
  validatePublishedDataSnapshot(snapshot);
  const approvedEvents = snapshot.events.filter(
    (event): event is Omit<FutureBuildingEvent, "status"> & {
      readonly status: "approved";
    } => event.status === "approved",
  );
  const actualHistory = snapshot.events.filter(
    (event): event is ActualBuildingEvent => event.status === "actual",
  );
  const latestLiquidityBaseline = [...snapshot.liquidityBaselines]
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
    .at(-1);

  return clone({
    companyId: snapshot.companyId,
    publicationVersion: snapshot.publicationVersion,
    sourceAdminRevision: snapshot.sourceAdminRevision,
    publishedAt: snapshot.publishedAt,
    housingCompany: snapshot.housingCompany,
    financialYears: snapshot.financialYears,
    ...(latestLiquidityBaseline === undefined
      ? {}
      : { latestLiquidityBaseline }),
    assets: snapshot.assets,
    observations: snapshot.observations,
    costEvidence: snapshot.costEvidence,
    priceLevelConfirmations: snapshot.priceLevelConfirmations,
    approvedEvents,
    actualHistory,
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
