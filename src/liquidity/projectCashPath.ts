import {
  DomainValidationError,
  type CashPathYear,
  type EventDataGap,
  type Horizon,
  type ScenarioCashPath,
  type ScenarioProjection,
} from "../domain/types.js";
import { fromCents, toCents } from "./money.js";

export interface ProjectCashPathInput {
  readonly projection: ScenarioProjection;
  readonly horizon: Horizon;
  readonly initialCash: number;
  readonly annualRepairCollection: number;
  readonly operatingBufferTarget: number;
}

/**
 * Builds a raw annual cash path for one scenario.
 *
 * The annual collection is assumed to be available before that year's
 * explicitly scheduled repair costs. No loan or other external financing is
 * injected; closing cash may therefore fall below the protected buffer.
 */
export function projectCashPath(
  input: ProjectCashPathInput,
): ScenarioCashPath {
  validateHorizon(input.horizon);
  const initialCashCents = toCents(
    input.initialCash,
    "INVALID_CASH_INPUT",
    "initialCash",
  );
  const annualCollectionCents = toCents(
    input.annualRepairCollection,
    "INVALID_COLLECTION_INPUT",
    "annualRepairCollection",
  );
  const bufferCents = toCents(
    input.operatingBufferTarget,
    "INVALID_OPERATING_BUFFER",
    "operatingBufferTarget",
  );
  const costByYear = validatedCostMap(input.projection, input.horizon);
  const gapsByYear = withinGapMap(input.projection, input.horizon);

  const years: CashPathYear[] = [];
  let openingCashCents = initialCashCents;
  let knownRepairCostsTotalCents = 0;

  for (let year = input.horizon.startYear; year <= input.horizon.endYear; year += 1) {
    const knownRepairCostCents = costByYear.get(year) ?? 0;
    const closingCashCents = openingCashCents + annualCollectionCents -
      knownRepairCostCents;
    const shortfallCents = Math.max(0, bufferCents - closingCashCents);

    years.push({
      year,
      openingCash: fromCents(openingCashCents),
      annualRepairCollection: fromCents(annualCollectionCents),
      knownRepairCosts: fromCents(knownRepairCostCents),
      closingCash: fromCents(closingCashCents),
      operatingBufferTarget: fromCents(bufferCents),
      cashAboveBuffer: fromCents(Math.max(0, closingCashCents - bufferCents)),
      bufferShortfall: fromCents(shortfallCents),
      dataGaps: gapsByYear.get(year) ?? [],
    });

    knownRepairCostsTotalCents += knownRepairCostCents;
    openingCashCents = closingCashCents;
  }

  const finalCashCents = openingCashCents;

  return {
    scenario: input.projection.scenario,
    years,
    initialCash: fromCents(initialCashCents),
    annualRepairCollection: fromCents(annualCollectionCents),
    operatingBufferTarget: fromCents(bufferCents),
    knownRepairCostsTotal: fromCents(knownRepairCostsTotalCents),
    collectionTotal: fromCents(annualCollectionCents * years.length),
    finalCash: fromCents(finalCashCents),
    blockingDataGaps: blockingGaps(input.projection),
  };
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

function validatedCostMap(
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

function withinGapMap(
  projection: ScenarioProjection,
  horizon: Horizon,
): ReadonlyMap<number, readonly EventDataGap[]> {
  const grouped = new Map<number, EventDataGap[]>();
  for (const gap of projection.dataGaps.withinHorizon) {
    if (gap.year < horizon.startYear || gap.year > horizon.endYear) {
      throw new DomainValidationError(
        "INVALID_SCENARIO_PROJECTION",
        `Within-horizon DATA GAP ${gap.eventId} has year ${gap.year} outside ` +
          `${horizon.startYear}–${horizon.endYear}.`,
      );
    }
    const list = grouped.get(gap.year) ?? [];
    list.push(gap);
    grouped.set(gap.year, list);
  }
  for (const [year, gaps] of grouped) {
    grouped.set(year, gaps.slice().sort(gapOrder));
  }
  return grouped;
}

function blockingGaps(
  projection: ScenarioProjection,
): readonly EventDataGap[] {
  return [
    ...projection.dataGaps.beforeHorizon,
    ...projection.dataGaps.withinHorizon,
  ].slice().sort(gapOrder);
}

function gapOrder(a: EventDataGap, b: EventDataGap): number {
  return a.year - b.year ||
    a.eventId.localeCompare(b.eventId) ||
    a.scheduleEntryId.localeCompare(b.scheduleEntryId);
}

