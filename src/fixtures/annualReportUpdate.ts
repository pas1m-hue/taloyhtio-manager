import type {
  Asset,
  BuildingEvent,
  CostEvidence,
  EventChangeCandidate,
  FutureBuildingEvent,
} from "../domain/types.js";
import {
  initialExcelAssets,
  initialExcelCostGaps,
  initialExcelEvents,
} from "./initialExcelDefaults.js";

/**
 * Illustrative annual-report review fixture. It demonstrates the workflow but
 * is not claimed to be extracted from a new real annual report.
 */
export const annualReport2026SourceId = "annual_report_2026_fixture";

export const annualReportUpdateAssets: readonly Asset[] = initialExcelAssets;
export const annualReportCurrentEvents: readonly BuildingEvent[] = initialExcelEvents;

const facadePainting = requireApproved("event_exterior_wall_painting");
const balconyTreatment = requireApproved("event_balcony_soffit_treatment");

export const annualReportAddedCostEvidence: CostEvidence = {
  id: "estimate_facade_condition_study_2028",
  assetId: facadePainting.assetId,
  eventId: "event_facade_condition_study_2028",
  status: "estimate",
  amount: 3_500,
  unit: "study_total",
  priceLevelYear: 2026,
  sourceId: annualReport2026SourceId,
  notes: "Illustrative numeric estimate used only by the V2.0 workflow fixture.",
};

export const annualReportUpdateCostEvidence: readonly CostEvidence[] = [
  ...initialExcelCostGaps,
  annualReportAddedCostEvidence,
];

export const facadePaintingUpdateCandidate: EventChangeCandidate = {
  id: "proposal_move_facade_painting_base_2030",
  changeType: "update",
  targetEventId: facadePainting.id,
  sourceIds: [annualReport2026SourceId],
  explanation:
    "Illustrative annual-report proposal moves only the named facade-painting base row from 2032 to 2030.",
  createdAt: "2026-07-17T12:00:00+03:00",
  proposedEvent: {
    ...facadePainting,
    status: "suggested",
    origin: "document_update",
    sourceIds: [...facadePainting.sourceIds, annualReport2026SourceId],
    schedule: facadePainting.schedule.map((entry) =>
      entry.scenario === "base"
        ? { ...entry, id: "base_2030", year: 2030 }
        : { ...entry }
    ),
  },
};

export const facadeStudyAddCandidate: EventChangeCandidate = {
  id: "proposal_add_facade_condition_study_2028",
  changeType: "add",
  sourceIds: [annualReport2026SourceId],
  explanation:
    "Illustrative annual-report proposal adds one independent facade condition study in 2028.",
  createdAt: "2026-07-17T12:01:00+03:00",
  proposedEvent: {
    id: "event_facade_condition_study_2028",
    assetId: facadePainting.assetId,
    title: "Julkisivun kuntotutkimus",
    type: "study",
    status: "suggested",
    origin: "document_update",
    sourceIds: [annualReport2026SourceId],
    schedule: (["optimistic", "base", "stress"] as const).map((scenario) => ({
      id: `${scenario}_2028`,
      scenario,
      year: 2028,
      amount: 3_500,
      costEvidenceId: annualReportAddedCostEvidence.id,
      explanation: "Explicit proposal row; no relation to facade painting or renewal is inferred.",
    })),
  },
};

export const balconyCancelCandidate: EventChangeCandidate = {
  id: "proposal_cancel_balcony_soffit_treatment",
  changeType: "cancel",
  targetEventId: balconyTreatment.id,
  sourceIds: [annualReport2026SourceId],
  explanation:
    "Illustrative annual-report proposal cancels only the named balcony-soffit event.",
  createdAt: "2026-07-17T12:02:00+03:00",
};

export const annualReportUpdateCandidates: readonly EventChangeCandidate[] = [
  facadePaintingUpdateCandidate,
  facadeStudyAddCandidate,
  balconyCancelCandidate,
];

function requireApproved(id: string): FutureBuildingEvent {
  const event = initialExcelEvents.find((item) => item.id === id);
  if (event === undefined || event.status !== "approved") {
    throw new Error(`Fixture requires approved event ${id}.`);
  }
  return event;
}
