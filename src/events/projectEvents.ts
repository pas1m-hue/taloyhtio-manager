import {
  PROJECTION_PRICE_LEVEL_YEAR,
  DomainValidationError,
  type ActualBuildingEvent,
  type Asset,
  type BuildingEvent,
  type CancelledBuildingEvent,
  type CostEvidence,
  type EventDataGap,
  type EventPortfolioResult,
  type EventScheduleEntry,
  type FutureBuildingEvent,
  type Horizon,
  type HorizonEventSummary,
  type HorizonPosition,
  type HorizonSummaryByScenario,
  type PriceLevelConfirmation,
  type ProjectedCostEvent,
  type Scenario,
} from "../domain/types.js";

export interface ProjectEventsInput {
  readonly assets: readonly Asset[];
  readonly events: readonly BuildingEvent[];
  readonly costEvidence: readonly CostEvidence[];
  readonly priceLevelConfirmations?: readonly PriceLevelConfirmation[];
  readonly horizon: Horizon;
}

/**
 * Projects only explicit approved schedule rows.
 *
 * No cycle, relation, supersession, lifecycle, or dependency logic exists in
 * this function. Two events remain independent even when they share an asset.
 */
export function projectEvents(input: ProjectEventsInput): EventPortfolioResult {
  validateHorizon(input.horizon);
  const assetsById = uniqueById(input.assets, "asset");
  const eventsById = uniqueById(input.events, "event");
  const evidenceById = uniqueEvidenceById(input.costEvidence);
  const confirmationByEvidenceId = confirmationMap(
    input.priceLevelConfirmations ?? [],
  );

  const projected: ProjectedCostEvent[] = [];
  const dataGaps: EventDataGap[] = [];
  const history: ActualBuildingEvent[] = [];
  const suggestions: FutureBuildingEvent[] = [];
  const cancelled: CancelledBuildingEvent[] = [];

  for (const event of [...eventsById.values()].sort(byId)) {
    validateEventBase(event, assetsById);

    if (event.status === "actual") {
      validateActualEvent(event, evidenceById);
      history.push(event);
      continue;
    }
    if (event.status === "cancelled") {
      cancelled.push(event);
      continue;
    }

    validateScheduleIds(event);
    validateScheduleShape(event);

    if (event.status === "suggested") {
      suggestions.push(event);
      continue;
    }

    for (const entry of event.schedule) {
      const evidence = requireEvidence(entry.costEvidenceId, evidenceById);
      validateEvidenceOwnership(evidence, event);

      validateEvidenceSource(evidence);

      if (entry.amount === undefined) {
        if (evidence.status !== "data_gap" || evidence.amount !== undefined) {
          throw new DomainValidationError(
            "INVALID_DATA_GAP",
            `Approved event ${event.id}/${entry.id} omits amount, but evidence ` +
              `${evidence.id} is ${evidence.status}, not data_gap.`,
          );
        }
        dataGaps.push(toDataGap(event, entry, input.horizon, evidence.id));
        continue;
      }

      validateNumericEntry(entry);
      validateNumericEvidence(
        evidence,
        event,
        confirmationByEvidenceId.get(evidence.id),
      );
      projected.push(toProjectedEvent(event, {
        ...entry,
        amount: entry.amount,
      }));
    }
  }

  projected.sort(projectedOrder);
  dataGaps.sort(dataGapOrder);
  history.sort(byId);
  suggestions.sort(byId);
  cancelled.sort(byId);

  const inside: ProjectedCostEvent[] = [];
  const before = emptyMutableSummary();
  const after = emptyMutableSummary();

  for (const event of projected) {
    if (event.year < input.horizon.startYear) {
      before[event.scenario].push(event);
    } else if (event.year > input.horizon.endYear) {
      after[event.scenario].push(event);
    } else {
      inside.push(event);
    }
  }

  return {
    events: inside,
    beforeHorizon: finalizeSummary(before),
    afterHorizon: finalizeSummary(after),
    dataGaps,
    history,
    suggestions,
    cancelled,
  };
}

function validateHorizon(horizon: Horizon): void {
  if (!Number.isInteger(horizon.startYear) ||
      !Number.isInteger(horizon.endYear) ||
      horizon.startYear > horizon.endYear) {
    throw new DomainValidationError(
      "INVALID_HORIZON",
      `Invalid horizon ${horizon.startYear}–${horizon.endYear}.`,
    );
  }
}

function uniqueById<T extends { readonly id: string }>(
  values: readonly T[],
  kind: "asset" | "event",
): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const value of values) {
    if (map.has(value.id)) {
      throw new DomainValidationError(
        kind === "asset" ? "DUPLICATE_ASSET_ID" : "DUPLICATE_EVENT_ID",
        `${kind} id ${value.id} occurs more than once.`,
      );
    }
    map.set(value.id, value);
  }
  return map;
}

function uniqueEvidenceById(
  values: readonly CostEvidence[],
): ReadonlyMap<string, CostEvidence> {
  const map = new Map<string, CostEvidence>();
  for (const value of values) {
    if (map.has(value.id)) {
      throw new DomainValidationError(
        "DUPLICATE_COST_EVIDENCE_ID",
        `Cost evidence id ${value.id} occurs more than once.`,
      );
    }
    map.set(value.id, value);
  }
  return map;
}

function confirmationMap(
  values: readonly PriceLevelConfirmation[],
): ReadonlyMap<string, PriceLevelConfirmation> {
  const map = new Map<string, PriceLevelConfirmation>();
  for (const value of values) {
    map.set(value.costEvidenceId, value);
  }
  return map;
}

function validateEventBase(
  event: BuildingEvent,
  assetsById: ReadonlyMap<string, Asset>,
): void {
  const asset = assetsById.get(event.assetId);
  if (asset === undefined) {
    throw new DomainValidationError(
      "MISSING_ASSET",
      `Event ${event.id} references missing asset ${event.assetId}.`,
    );
  }
  if (!asset.active && event.status !== "actual" && event.status !== "cancelled") {
    throw new DomainValidationError(
      "INACTIVE_ASSET",
      `Future event ${event.id} references inactive asset ${asset.id}.`,
    );
  }
  if (event.sourceIds.length === 0) {
    throw new DomainValidationError(
      "MISSING_EVENT_SOURCE",
      `Event ${event.id} requires at least one sourceId.`,
    );
  }
}

function validateScheduleIds(event: FutureBuildingEvent): void {
  const seen = new Set<string>();
  for (const entry of event.schedule) {
    if (seen.has(entry.id)) {
      throw new DomainValidationError(
        "DUPLICATE_SCHEDULE_ENTRY_ID",
        `Event ${event.id} contains duplicate schedule entry ${entry.id}.`,
      );
    }
    seen.add(entry.id);
  }
}

function validateScheduleShape(event: FutureBuildingEvent): void {
  if (event.schedule.length === 0) {
    throw new DomainValidationError(
      "INVALID_EVENT_SCHEDULE",
      `Future event ${event.id} requires at least one explicit schedule row.`,
    );
  }
  for (const entry of event.schedule) {
    validateYear(entry.year, `${event.id}/${entry.id}`);
    validateQuantity(entry.quantity, `${event.id}/${entry.id}`);
    if (entry.amount !== undefined &&
        (!Number.isFinite(entry.amount) || entry.amount < 0)) {
      throw new DomainValidationError(
        "INVALID_EVENT_AMOUNT",
        `Event ${event.id}/${entry.id} amount must be finite and non-negative.`,
      );
    }
  }
}

function validateNumericEntry(entry: EventScheduleEntry): void {
  if (entry.amount === undefined ||
      !Number.isFinite(entry.amount) || entry.amount < 0) {
    throw new DomainValidationError(
      "INVALID_EVENT_AMOUNT",
      `Schedule entry ${entry.id} requires a finite non-negative amount.`,
    );
  }
}

function validateActualEvent(
  event: ActualBuildingEvent,
  evidenceById: ReadonlyMap<string, CostEvidence>,
): void {
  validateYear(event.actual.year, event.id);
  validateQuantity(event.actual.quantity, event.id);
  const evidence = requireEvidence(event.actual.costEvidenceId, evidenceById);
  validateEvidenceOwnership(evidence, event);
  validateEvidenceSource(evidence);

  if (event.actual.amount === undefined) {
    if (evidence.status !== "data_gap") {
      throw new DomainValidationError(
        "INVALID_DATA_GAP",
        `Actual event ${event.id} omits amount, but evidence ${evidence.id} ` +
          `is ${evidence.status}, not data_gap.`,
      );
    }
    return;
  }
  if (!Number.isFinite(event.actual.amount) || event.actual.amount < 0) {
    throw new DomainValidationError(
      "INVALID_EVENT_AMOUNT",
      `Actual event ${event.id} amount must be finite and non-negative.`,
    );
  }
  validateHistoricalEvidence(evidence, event);
}

function validateYear(year: number, context: string): void {
  if (!Number.isInteger(year)) {
    throw new DomainValidationError(
      "INVALID_EVENT_YEAR",
      `${context} year must be an integer; received ${year}.`,
    );
  }
}

function validateQuantity(quantity: number | undefined, context: string): void {
  if (quantity !== undefined &&
      (!Number.isInteger(quantity) || quantity <= 0)) {
    throw new DomainValidationError(
      "INVALID_EVENT_QUANTITY",
      `${context} quantity must be a positive integer.`,
    );
  }
}

function requireEvidence(
  id: string,
  evidenceById: ReadonlyMap<string, CostEvidence>,
): CostEvidence {
  const evidence = evidenceById.get(id);
  if (evidence === undefined) {
    throw new DomainValidationError(
      "MISSING_COST_EVIDENCE",
      `Missing cost evidence ${id}.`,
    );
  }
  return evidence;
}

function validateEvidenceOwnership(
  evidence: CostEvidence,
  event: BuildingEvent,
): void {
  if (evidence.assetId !== undefined && evidence.assetId !== event.assetId) {
    throw new DomainValidationError(
      "COST_EVIDENCE_MISMATCH",
      `Cost evidence ${evidence.id} belongs to asset ${evidence.assetId}, ` +
        `not ${event.assetId}.`,
    );
  }
  if (evidence.eventId !== undefined && evidence.eventId !== event.id) {
    throw new DomainValidationError(
      "COST_EVIDENCE_MISMATCH",
      `Cost evidence ${evidence.id} belongs to event ${evidence.eventId}, ` +
        `not ${event.id}.`,
    );
  }
}

function validateEvidenceSource(evidence: CostEvidence): void {
  if (evidence.sourceId === undefined && evidence.sourceUrl === undefined) {
    throw new DomainValidationError(
      "MISSING_COST_SOURCE",
      `Cost evidence ${evidence.id} requires sourceId or sourceUrl.`,
    );
  }
}

function validateHistoricalEvidence(
  evidence: CostEvidence,
  event: ActualBuildingEvent,
): void {
  if (evidence.status !== "actual") {
    throw new DomainValidationError(
      "COST_EVIDENCE_MISMATCH",
      `Actual event ${event.id} requires actual cost evidence; ` +
        `${evidence.id} is ${evidence.status}.`,
    );
  }
  // Historical actuals remain in their original nominal price-level year.
  if (!Number.isInteger(evidence.priceLevelYear)) {
    throw new DomainValidationError(
      "UNCONFIRMED_PRICE_LEVEL",
      `Cost evidence ${evidence.id} priceLevelYear must be an integer.`,
    );
  }
}

function validateNumericEvidence(
  evidence: CostEvidence,
  event: BuildingEvent,
  confirmation: PriceLevelConfirmation | undefined,
): void {
  if (evidence.status === "data_gap") {
    throw new DomainValidationError(
      "INVALID_DATA_GAP",
      `Numeric event ${event.id} cannot use DATA GAP evidence ${evidence.id}.`,
    );
  }
  if (evidence.sourceId === undefined && evidence.sourceUrl === undefined) {
    throw new DomainValidationError(
      "MISSING_COST_SOURCE",
      `Cost evidence ${evidence.id} requires sourceId or sourceUrl.`,
    );
  }
  if (!Number.isInteger(evidence.priceLevelYear)) {
    throw new DomainValidationError(
      "UNCONFIRMED_PRICE_LEVEL",
      `Cost evidence ${evidence.id} priceLevelYear must be an integer.`,
    );
  }
  if (evidence.priceLevelYear !== PROJECTION_PRICE_LEVEL_YEAR &&
      confirmation?.targetYear !== PROJECTION_PRICE_LEVEL_YEAR) {
    throw new DomainValidationError(
      "UNCONFIRMED_PRICE_LEVEL",
      `Cost evidence ${evidence.id} is at price level ` +
        `${evidence.priceLevelYear}; explicit ${PROJECTION_PRICE_LEVEL_YEAR} ` +
        `confirmation is required.`,
    );
  }
}

function toProjectedEvent(
  event: FutureBuildingEvent,
  entry: EventScheduleEntry & { readonly amount: number },
): ProjectedCostEvent {
  const base = {
    id: `${event.id}:${entry.id}`,
    eventId: event.id,
    scheduleEntryId: entry.id,
    assetId: event.assetId,
    title: event.title,
    type: event.type,
    origin: event.origin,
    scenario: entry.scenario,
    year: entry.year,
    amount: entry.amount,
    costEvidenceId: entry.costEvidenceId,
    explanation: entry.explanation ??
      `${event.title}: explicit ${entry.scenario} event row entered from ` +
      `${event.origin}; no lifecycle or dependency inference applied.`,
  } satisfies ProjectedCostEvent;

  const withQuantity = entry.quantity === undefined
    ? base
    : { ...base, quantity: entry.quantity };
  return event.observationIds === undefined
    ? withQuantity
    : { ...withQuantity, observationIds: [...event.observationIds].sort() };
}

function toDataGap(
  event: FutureBuildingEvent,
  entry: EventScheduleEntry,
  horizon: Horizon,
  evidenceId: string,
): EventDataGap {
  const base = {
    eventId: event.id,
    scheduleEntryId: entry.id,
    assetId: event.assetId,
    title: event.title,
    scenario: entry.scenario,
    year: entry.year,
    costEvidenceId: evidenceId,
    horizonPosition: horizonPosition(entry.year, horizon),
    reason: `Approved event has a named DATA GAP; no zero-euro row was created.`,
  } satisfies EventDataGap;
  return entry.quantity === undefined
    ? base
    : { ...base, quantity: entry.quantity };
}

function horizonPosition(year: number, horizon: Horizon): HorizonPosition {
  if (year < horizon.startYear) return "before";
  if (year > horizon.endYear) return "after";
  return "within";
}

function byId<T extends { readonly id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}

const scenarioOrder: Readonly<Record<Scenario, number>> = {
  optimistic: 0,
  base: 1,
  stress: 2,
};

function projectedOrder(a: ProjectedCostEvent, b: ProjectedCostEvent): number {
  return a.year - b.year ||
    scenarioOrder[a.scenario] - scenarioOrder[b.scenario] ||
    a.eventId.localeCompare(b.eventId) ||
    a.scheduleEntryId.localeCompare(b.scheduleEntryId);
}

function dataGapOrder(a: EventDataGap, b: EventDataGap): number {
  return a.year - b.year ||
    scenarioOrder[a.scenario] - scenarioOrder[b.scenario] ||
    a.eventId.localeCompare(b.eventId) ||
    a.scheduleEntryId.localeCompare(b.scheduleEntryId);
}

type MutableSummary = Record<Scenario, ProjectedCostEvent[]>;

function emptyMutableSummary(): MutableSummary {
  return { optimistic: [], base: [], stress: [] };
}

function finalizeSummary(mutable: MutableSummary): HorizonSummaryByScenario {
  return {
    optimistic: summarize(mutable.optimistic),
    base: summarize(mutable.base),
    stress: summarize(mutable.stress),
  };
}

function summarize(events: readonly ProjectedCostEvent[]): HorizonEventSummary {
  return {
    events,
    eventCount: events.length,
    quantity: events.reduce((sum, event) => sum + (event.quantity ?? 0), 0),
    amount: events.reduce((sum, event) => sum + event.amount, 0),
  };
}

