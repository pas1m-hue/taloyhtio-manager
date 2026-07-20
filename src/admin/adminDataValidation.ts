import {
  ASSET_CATEGORIES,
  COST_EVIDENCE_STATUSES,
  EVENT_ORIGINS,
  EVENT_STATUSES,
  EVENT_TYPES,
  PROJECTION_PRICE_LEVEL_YEAR,
  SCENARIOS,
  DomainValidationError,
  type AdminDataSnapshot,
  type Asset,
  type BuildingEvent,
  type CostEvidence,
  type FinancialYear,
  type HousingCompany,
  type LiquidityBaselineRecord,
  type Observation,
  type PriceLevelConfirmation,
} from "../domain/types.js";
import { projectEvents } from "../events/projectEvents.js";

export function validateAdminDataSnapshot(state: AdminDataSnapshot): void {
  if (!Number.isInteger(state.revision) || state.revision < 0 ||
      state.companyId.trim() === "" || state.housingCompany.id !== state.companyId ||
      !isNonEmpty(state.updatedAt) || !isNonEmpty(state.updatedBy)) {
    throw invalid("Admin snapshot metadata is invalid");
  }

  validateHousingCompany(state.housingCompany);
  unique(state.assets, "asset id");
  unique(state.observations, "observation id");
  unique(state.costEvidence, "cost-evidence id");
  unique(state.events, "event id");
  unique(state.liquidityBaselines, "liquidity-baseline id");
  uniqueBy(state.financialYears, (item) => String(item.year), "financial year");
  uniqueBy(
    state.priceLevelConfirmations,
    (item) => item.costEvidenceId,
    "price-level confirmation",
  );

  const assets = new Map(state.assets.map((item) => [item.id, item]));
  const events = new Map(state.events.map((item) => [item.id, item]));
  const evidence = new Map(state.costEvidence.map((item) => [item.id, item]));

  state.assets.forEach(validateAsset);
  state.events.forEach(validateBuildingEventRuntime);
  validateEventObservationReferences(state.events, state.observations);
  validateAuditTrail(state);
  state.financialYears.forEach(validateFinancialYear);
  state.liquidityBaselines.forEach(validateLiquidityBaseline);
  state.observations.forEach((item) => validateObservation(item, assets));
  state.costEvidence.forEach((item) => validateCostEvidence(item, assets, events));
  state.priceLevelConfirmations.forEach((item) =>
    validatePriceLevelConfirmation(item, evidence)
  );

  // projectEvents is the calculation boundary validator. Suggested events are
  // validated as approved copies here so manual drafts cannot retain broken
  // evidence references that would fail only after approval.
  const validationEvents = state.events.map((event): BuildingEvent =>
    event.status === "suggested" ? { ...event, status: "approved" } : event
  );
  projectEvents({
    assets: state.assets,
    events: validationEvents,
    costEvidence: state.costEvidence,
    priceLevelConfirmations: state.priceLevelConfirmations,
    horizon: { startYear: 0, endYear: 9999 },
  });
}

export function validateHousingCompany(value: HousingCompany): void {
  if (!isNonEmpty(value.id) || !isNonEmpty(value.name) ||
      !Number.isInteger(value.apartmentCount) || value.apartmentCount <= 0 ||
      (value.chargeableAreaM2 !== undefined &&
        (!Number.isFinite(value.chargeableAreaM2) || value.chargeableAreaM2 <= 0)) ||
      (value.operatingBuffer?.bufferMonths !== undefined &&
        (!Number.isFinite(value.operatingBuffer.bufferMonths) ||
          value.operatingBuffer.bufferMonths <= 0)) ||
      (value.operatingBuffer?.userOverride !== undefined &&
        (!Number.isFinite(value.operatingBuffer.userOverride) ||
          value.operatingBuffer.userOverride < 0))) {
    throw invalid(`Housing company ${value.id || "<empty>"} is invalid`);
  }
}

function validateFinancialYear(value: FinancialYear): void {
  const figures = [
    value.budgetIncome,
    value.actualIncome,
    value.budgetCosts,
    value.actualCosts,
  ];
  if (!Number.isInteger(value.year) || !validSources(value.sourceIds) ||
      figures.every((item) => item === undefined) ||
      figures.some((item) => item !== undefined &&
        (!Number.isFinite(item) || item < 0))) {
    throw invalid(`Financial year ${value.year} is invalid`);
  }
}

function validateLiquidityBaseline(value: LiquidityBaselineRecord): void {
  if (!isNonEmpty(value.id) || !validDate(value.asOfDate) ||
      !nonNegative(value.currentCash) ||
      !nonNegative(value.trailing12mOperatingCosts) ||
      !nonNegative(value.currentAnnualRepairCollection) ||
      !validSources(value.sourceIds)) {
    throw invalid(`Liquidity baseline ${value.id || "<empty>"} is invalid`);
  }
}

function validateAsset(value: Asset): void {
  if (!isNonEmpty(value.id) || !isNonEmpty(value.name) ||
      !ASSET_CATEGORIES.includes(value.category) ||
      !validSources(value.sourceIds) || typeof value.active !== "boolean") {
    throw invalid(`Asset ${value.id || "<empty>"} is invalid`);
  }
}

function validateObservation(
  value: Observation,
  assets: ReadonlyMap<string, Asset>,
): void {
  if (!isNonEmpty(value.id) || !isNonEmpty(value.assetId) ||
      !assets.has(value.assetId) || !validDate(value.observedAt) ||
      !isNonEmpty(value.description) || !validSources(value.sourceIds)) {
    throw invalid(`Observation ${value.id || "<empty>"} is invalid`);
  }
}

function validateCostEvidence(
  value: CostEvidence,
  assets: ReadonlyMap<string, Asset>,
  events: ReadonlyMap<string, BuildingEvent>,
): void {
  if (!isNonEmpty(value.id) || !COST_EVIDENCE_STATUSES.includes(value.status) ||
      !isNonEmpty(value.unit) || !Number.isInteger(value.priceLevelYear) ||
      (value.assetId !== undefined && !assets.has(value.assetId)) ||
      (value.eventId !== undefined && !events.has(value.eventId)) ||
      (value.amount !== undefined && !nonNegative(value.amount)) ||
      (value.quantity !== undefined &&
        (!Number.isInteger(value.quantity) || value.quantity <= 0)) ||
      (value.sourceId === undefined && value.sourceUrl === undefined) ||
      (value.sourceId !== undefined && !isNonEmpty(value.sourceId)) ||
      (value.sourceUrl !== undefined && !isNonEmpty(value.sourceUrl)) ||
      (value.observedAt !== undefined && value.observedAt !== null &&
        !validDate(value.observedAt)) ||
      (value.validUntil !== undefined && value.validUntil !== null &&
        !validDate(value.validUntil)) ||
      (value.status === "data_gap" && value.amount !== undefined)) {
    throw invalid(`Cost evidence ${value.id || "<empty>"} is invalid`);
  }
}

function validatePriceLevelConfirmation(
  value: PriceLevelConfirmation,
  evidence: ReadonlyMap<string, CostEvidence>,
): void {
  if (!isNonEmpty(value.costEvidenceId) || !evidence.has(value.costEvidenceId) ||
      value.targetYear !== PROJECTION_PRICE_LEVEL_YEAR ||
      !validDate(value.confirmedAt) || !isNonEmpty(value.confirmedBy)) {
    throw invalid(
      `Price-level confirmation ${value.costEvidenceId || "<empty>"} is invalid`,
    );
  }
}

export function validateBuildingEventRuntime(value: BuildingEvent): void {
  if (!isNonEmpty(value.id) || !isNonEmpty(value.assetId) ||
      !isNonEmpty(value.title) || !EVENT_TYPES.includes(value.type) ||
      !EVENT_STATUSES.includes(value.status) || !EVENT_ORIGINS.includes(value.origin) ||
      !validSources(value.sourceIds)) {
    throw invalid(`Building event ${value.id || "<empty>"} is invalid`);
  }

  if (value.observationIds !== undefined &&
      (value.observationIds.some((item) => !isNonEmpty(item)) ||
        new Set(value.observationIds).size !== value.observationIds.length)) {
    throw invalid(`Building event ${value.id} has invalid observationIds`);
  }

  if (value.status === "actual") {
    if (!Number.isInteger(value.actual.year) ||
        !isNonEmpty(value.actual.costEvidenceId) ||
        (value.actual.amount !== undefined && !nonNegative(value.actual.amount)) ||
        (value.actual.quantity !== undefined &&
          (!Number.isInteger(value.actual.quantity) || value.actual.quantity <= 0))) {
      throw invalid(`Actual event ${value.id} is invalid`);
    }
    return;
  }

  const schedule = value.schedule ?? [];
  if (value.status !== "cancelled" && schedule.length === 0) {
    throw invalid(`Future event ${value.id} requires schedule rows`);
  }
  const entryIds = new Set<string>();
  for (const entry of schedule) {
    if (!isNonEmpty(entry.id) || entryIds.has(entry.id) ||
        !SCENARIOS.includes(entry.scenario) || !Number.isInteger(entry.year) ||
        !isNonEmpty(entry.costEvidenceId) ||
        (entry.amount !== undefined && !nonNegative(entry.amount)) ||
        (entry.quantity !== undefined &&
          (!Number.isInteger(entry.quantity) || entry.quantity <= 0))) {
      throw invalid(`Building event ${value.id} has an invalid schedule row`);
    }
    entryIds.add(entry.id);
  }
}

function validateEventObservationReferences(
  events: readonly BuildingEvent[],
  observations: readonly Observation[],
): void {
  const byId = new Map(observations.map((item) => [item.id, item]));
  for (const event of events) {
    for (const observationId of event.observationIds ?? []) {
      const observation = byId.get(observationId);
      if (observation === undefined || observation.assetId !== event.assetId) {
        throw invalid(
          `Building event ${event.id} references invalid observation ${observationId}`,
        );
      }
    }
  }
}

function validateAuditTrail(state: AdminDataSnapshot): void {
  unique(state.auditTrail, "admin-audit id");
  for (const item of state.auditTrail) {
    if (!Number.isInteger(item.revision) || item.revision <= 0 ||
        item.revision > state.revision || !isNonEmpty(item.entityKey) ||
        !isNonEmpty(item.actorId) || !validDate(item.occurredAt) ||
        !validSources(item.sourceIds) || !isNonEmpty(item.explanation)) {
      throw invalid(`Admin audit ${item.id || "<empty>"} is invalid`);
    }
  }
}

function unique<T extends { readonly id: string }>(
  values: readonly T[],
  label: string,
): void {
  uniqueBy(values, (item) => item.id, label);
}

function uniqueBy<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
  label: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const key = keyOf(value);
    if (!isNonEmpty(key) || seen.has(key)) {
      throw invalid(`Duplicate or empty ${label}: ${key || "<empty>"}`);
    }
    seen.add(key);
  }
}

function validSources(values: readonly string[]): boolean {
  return values.length > 0 && values.every(isNonEmpty);
}

function validDate(value: string): boolean {
  return isNonEmpty(value) && Number.isFinite(Date.parse(value));
}

function isNonEmpty(value: string): boolean {
  return value.trim() !== "";
}

function nonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function invalid(message: string): DomainValidationError {
  return new DomainValidationError("INVALID_ADMIN_DATA", `${message}.`);
}
