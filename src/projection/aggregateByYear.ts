import {
  SCENARIOS,
  type EventDataGap,
  type ProjectedCostEvent,
  type Scenario,
  type YearProjection,
} from "../domain/types.js";

export interface AggregateByYearInput {
  readonly events: readonly ProjectedCostEvent[];
  /** Only within-horizon gaps become year rows; other positions stay summaries. */
  readonly dataGaps?: readonly EventDataGap[];
}

/**
 * Groups already projected explicit rows by scenario and year.
 *
 * This function does not infer, move, delete, or create building events. A
 * DATA GAP creates a visible year row but contributes no numeric amount.
 */
export function aggregateByYear(
  input: AggregateByYearInput,
): Readonly<Record<Scenario, readonly YearProjection[]>> {
  const result = emptyScenarioYears();

  for (const scenario of SCENARIOS) {
    const events = input.events
      .filter((event) => event.scenario === scenario)
      .slice()
      .sort(projectedOrder);
    const dataGaps = (input.dataGaps ?? [])
      .filter((gap) => gap.scenario === scenario && gap.horizonPosition === "within")
      .slice()
      .sort(dataGapOrder);

    const years = new Map<number, MutableYearProjection>();

    for (const event of events) {
      const year = getOrCreate(years, event.year);
      year.events.push(event);
    }
    for (const gap of dataGaps) {
      const year = getOrCreate(years, gap.year);
      year.dataGaps.push(gap);
    }

    result[scenario] = [...years.values()]
      .sort((a, b) => a.year - b.year)
      .map(finalizeYear);
  }

  return {
    optimistic: result.optimistic,
    base: result.base,
    stress: result.stress,
  };
}

interface MutableYearProjection {
  readonly year: number;
  readonly events: ProjectedCostEvent[];
  readonly dataGaps: EventDataGap[];
}

type MutableScenarioYears = Record<Scenario, readonly YearProjection[]>;

function emptyScenarioYears(): MutableScenarioYears {
  return { optimistic: [], base: [], stress: [] };
}

function getOrCreate(
  years: Map<number, MutableYearProjection>,
  year: number,
): MutableYearProjection {
  const existing = years.get(year);
  if (existing !== undefined) {
    return existing;
  }
  const created: MutableYearProjection = { year, events: [], dataGaps: [] };
  years.set(year, created);
  return created;
}

function finalizeYear(year: MutableYearProjection): YearProjection {
  const events = year.events.slice().sort(projectedOrder);
  const dataGaps = year.dataGaps.slice().sort(dataGapOrder);
  return {
    year: year.year,
    eventCount: events.length,
    quantity: events.reduce((sum, event) => sum + (event.quantity ?? 0), 0),
    amount: events.reduce((sum, event) => sum + event.amount, 0),
    events,
    dataGaps,
  };
}

function projectedOrder(a: ProjectedCostEvent, b: ProjectedCostEvent): number {
  return a.eventId.localeCompare(b.eventId) ||
    a.scheduleEntryId.localeCompare(b.scheduleEntryId) ||
    a.id.localeCompare(b.id);
}

function dataGapOrder(a: EventDataGap, b: EventDataGap): number {
  return a.eventId.localeCompare(b.eventId) ||
    a.scheduleEntryId.localeCompare(b.scheduleEntryId);
}
