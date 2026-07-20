import {
  SCENARIOS,
  type EventDataGap,
  type ProjectionResult,
  type Scenario,
  type ScenarioDataGapSummary,
  type ScenarioProjection,
  type YearProjection,
} from "../domain/types.js";
import {
  projectEvents,
  type ProjectEventsInput,
} from "../events/projectEvents.js";
import { aggregateByYear } from "./aggregateByYear.js";

/**
 * Builds the reporting projection from explicit event rows.
 *
 * projectEvents performs domain validation and horizon classification;
 * aggregateByYear only groups those validated rows. No event intelligence is
 * introduced at this layer.
 */
export function buildProjection(input: ProjectEventsInput): ProjectionResult {
  const portfolio = projectEvents(input);
  const yearsByScenario = aggregateByYear({
    events: portfolio.events,
    dataGaps: portfolio.dataGaps,
  });

  const scenarios = {} as Record<Scenario, ScenarioProjection>;
  for (const scenario of SCENARIOS) {
    const years = yearsByScenario[scenario];
    const before = portfolio.beforeHorizon[scenario];
    const after = portfolio.afterHorizon[scenario];
    scenarios[scenario] = {
      scenario,
      years,
      horizonEventCount: sum(years, (year) => year.eventCount),
      horizonQuantity: sum(years, (year) => year.quantity),
      horizonAmount: sum(years, (year) => year.amount),
      beforeHorizonEventCount: before.eventCount,
      beforeHorizonQuantity: before.quantity,
      beforeHorizonAmount: before.amount,
      afterHorizonEventCount: after.eventCount,
      afterHorizonQuantity: after.quantity,
      afterHorizonAmount: after.amount,
      dataGaps: summarizeDataGaps(portfolio.dataGaps, scenario),
    };
  }

  return {
    scenarios: {
      optimistic: scenarios.optimistic,
      base: scenarios.base,
      stress: scenarios.stress,
    },
    dataGaps: portfolio.dataGaps,
    history: portfolio.history,
    suggestions: portfolio.suggestions,
    cancelled: portfolio.cancelled,
  };
}

function summarizeDataGaps(
  gaps: readonly EventDataGap[],
  scenario: Scenario,
): ScenarioDataGapSummary {
  const forScenario = gaps.filter((gap) => gap.scenario === scenario);
  return {
    beforeHorizon: forScenario.filter((gap) => gap.horizonPosition === "before"),
    withinHorizon: forScenario.filter((gap) => gap.horizonPosition === "within"),
    afterHorizon: forScenario.filter((gap) => gap.horizonPosition === "after"),
  };
}

function sum(
  years: readonly YearProjection[],
  select: (year: YearProjection) => number,
): number {
  return years.reduce((total, year) => total + select(year), 0);
}
