import {
  DomainValidationError,
  type EventDataGap,
  type Horizon,
  type RequiredCollectionResult,
  type ScenarioProjection,
} from "../domain/types.js";
import { fromCents, roundRate, toCents } from "./money.js";

export interface CalculateRequiredCollectionInput {
  readonly projection: ScenarioProjection;
  readonly horizon: Horizon;
  readonly initialCash: number;
  readonly operatingBufferTarget: number;
  readonly currentAnnualRepairCollection: number;
  readonly totalChargeableAreaM2?: number;
  readonly apartmentCount?: number;
}

/**
 * Solves the minimum flat annual repair collection that keeps known numeric
 * costs above the protected operating buffer at every year-end.
 *
 * Collection is assumed to arrive before each year's repair costs. Unknown
 * costs are retained as blocking DATA GAPs, so the result is a known-cost
 * lower bound rather than false precision.
 */
export function calculateRequiredCollection(
  input: CalculateRequiredCollectionInput,
): RequiredCollectionResult {
  validateHorizon(input.horizon);
  const initialCashCents = toCents(
    input.initialCash,
    "INVALID_CASH_INPUT",
    "initialCash",
  );
  const bufferCents = toCents(
    input.operatingBufferTarget,
    "INVALID_OPERATING_BUFFER",
    "operatingBufferTarget",
  );
  const currentCollectionCents = toCents(
    input.currentAnnualRepairCollection,
    "INVALID_COLLECTION_INPUT",
    "currentAnnualRepairCollection",
  );
  const costByYear = projectionCostMap(input.projection, input.horizon);
  const planningYearCount = input.horizon.endYear - input.horizon.startYear + 1;

  let cumulativeCostCents = 0;
  let requiredAnnualCents = 0;
  for (let year = input.horizon.startYear; year <= input.horizon.endYear; year += 1) {
    cumulativeCostCents += costByYear.get(year) ?? 0;
    const elapsedYears = year - input.horizon.startYear + 1;
    const requiredThroughYear = Math.max(
      0,
      Math.ceil((bufferCents - initialCashCents + cumulativeCostCents) /
        elapsedYears),
    );
    requiredAnnualCents = Math.max(requiredAnnualCents, requiredThroughYear);
  }

  const additionalAnnualCents = Math.max(
    0,
    requiredAnnualCents - currentCollectionCents,
  );
  const blockingDataGaps = blockingGaps(input.projection);
  const base = {
    scenario: input.projection.scenario,
    knownCostRequiredAnnualCollection: fromCents(requiredAnnualCents),
    currentAnnualRepairCollection: fromCents(currentCollectionCents),
    additionalAnnualCollection: fromCents(additionalAnnualCents),
    currentMonthlyCollection: fromCents(Math.ceil(currentCollectionCents / 12)),
    requiredMonthlyCollection: fromCents(Math.ceil(requiredAnnualCents / 12)),
    additionalMonthlyCollection: fromCents(Math.ceil(additionalAnnualCents / 12)),
    planningYearCount,
    forecastComplete: blockingDataGaps.length === 0,
    blockingDataGaps,
  } satisfies Omit<
    RequiredCollectionResult,
    | "currentMonthlyPerM2"
    | "requiredMonthlyPerM2"
    | "additionalMonthlyPerM2"
    | "currentMonthlyPerApartment"
    | "requiredMonthlyPerApartment"
    | "additionalMonthlyPerApartment"
  >;

  const areaMetrics = areaResult(
    input.totalChargeableAreaM2,
    currentCollectionCents,
    requiredAnnualCents,
    additionalAnnualCents,
  );
  const apartmentMetrics = apartmentResult(
    input.apartmentCount,
    currentCollectionCents,
    requiredAnnualCents,
    additionalAnnualCents,
  );

  return { ...base, ...areaMetrics, ...apartmentMetrics };
}

function projectionCostMap(
  projection: ScenarioProjection,
  horizon: Horizon,
): ReadonlyMap<number, number> {
  const map = new Map<number, number>();
  let totalCents = 0;
  for (const row of projection.years) {
    if (!Number.isInteger(row.year) || row.year < horizon.startYear ||
        row.year > horizon.endYear || map.has(row.year)) {
      throw new DomainValidationError(
        "INVALID_SCENARIO_PROJECTION",
        `Scenario ${projection.scenario} contains an invalid or duplicate ` +
          `horizon year ${row.year}.`,
      );
    }
    const cents = toCents(
      row.amount,
      "INVALID_SCENARIO_PROJECTION",
      `projection amount for ${row.year}`,
    );
    map.set(row.year, cents);
    totalCents += cents;
  }
  const declaredTotalCents = toCents(
    projection.horizonAmount,
    "INVALID_SCENARIO_PROJECTION",
    "projection.horizonAmount",
  );
  if (totalCents !== declaredTotalCents) {
    throw new DomainValidationError(
      "INVALID_SCENARIO_PROJECTION",
      `Scenario ${projection.scenario} horizonAmount does not equal its year rows.`,
    );
  }
  return map;
}

function areaResult(
  area: number | undefined,
  currentAnnualCents: number,
  requiredAnnualCents: number,
  additionalAnnualCents: number,
): Pick<
  RequiredCollectionResult,
  "currentMonthlyPerM2" | "requiredMonthlyPerM2" | "additionalMonthlyPerM2"
> | Record<never, never> {
  if (area === undefined) {
    return {};
  }
  validatePositiveBasis(area, "totalChargeableAreaM2");
  return {
    currentMonthlyPerM2: roundRate(fromCents(currentAnnualCents) / 12 / area),
    requiredMonthlyPerM2: roundRate(fromCents(requiredAnnualCents) / 12 / area),
    additionalMonthlyPerM2: roundRate(fromCents(additionalAnnualCents) / 12 / area),
  };
}

function apartmentResult(
  apartmentCount: number | undefined,
  currentAnnualCents: number,
  requiredAnnualCents: number,
  additionalAnnualCents: number,
): Pick<
  RequiredCollectionResult,
  "currentMonthlyPerApartment" | "requiredMonthlyPerApartment" | "additionalMonthlyPerApartment"
> | Record<never, never> {
  if (apartmentCount === undefined) {
    return {};
  }
  if (!Number.isInteger(apartmentCount)) {
    throw new DomainValidationError(
      "INVALID_CHARGE_BASIS",
      `apartmentCount must be a positive integer; received ${apartmentCount}.`,
    );
  }
  validatePositiveBasis(apartmentCount, "apartmentCount");
  return {
    currentMonthlyPerApartment: roundRate(
      fromCents(currentAnnualCents) / 12 / apartmentCount,
    ),
    requiredMonthlyPerApartment: roundRate(
      fromCents(requiredAnnualCents) / 12 / apartmentCount,
    ),
    additionalMonthlyPerApartment: roundRate(
      fromCents(additionalAnnualCents) / 12 / apartmentCount,
    ),
  };
}

function validatePositiveBasis(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new DomainValidationError(
      "INVALID_CHARGE_BASIS",
      `${field} must be finite and greater than zero; received ${value}.`,
    );
  }
}

function blockingGaps(
  projection: ScenarioProjection,
): readonly EventDataGap[] {
  return [
    ...projection.dataGaps.beforeHorizon,
    ...projection.dataGaps.withinHorizon,
  ].slice().sort((a, b) => a.year - b.year ||
    a.eventId.localeCompare(b.eventId) ||
    a.scheduleEntryId.localeCompare(b.scheduleEntryId));
}

function validateHorizon(horizon: Horizon): void {
  if (!Number.isInteger(horizon.startYear) ||
      !Number.isInteger(horizon.endYear) ||
      horizon.startYear > horizon.endYear) {
    throw new DomainValidationError(
      "INVALID_HORIZON",
      `Invalid liquidity horizon ${horizon.startYear}–${horizon.endYear}.`,
    );
  }
}
