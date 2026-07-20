import type {
  FundingNeedSignal,
  ScenarioCashPath,
} from "../domain/types.js";

/**
 * Finds the first and maximum operating-buffer shortfall in a raw cash path.
 * This is a financing-need signal, not a decision to take a loan.
 */
export function findFundingNeed(
  cashPath: ScenarioCashPath,
): FundingNeedSignal {
  const shortfallYears = cashPath.years.filter((year) => year.bufferShortfall > 0);
  const first = shortfallYears[0];
  const minimumClosingCash = cashPath.years.length === 0
    ? cashPath.initialCash
    : Math.min(...cashPath.years.map((year) => year.closingCash));

  const result = {
    scenario: cashPath.scenario,
    ownFundingSufficientForKnownCosts: first === undefined,
    forecastComplete: cashPath.blockingDataGaps.length === 0,
    amountAtFirstNeed: first?.bufferShortfall ?? 0,
    maximumBufferShortfall: shortfallYears.reduce(
      (maximum, year) => Math.max(maximum, year.bufferShortfall),
      0,
    ),
    minimumClosingCash,
    blockingDataGaps: cashPath.blockingDataGaps,
  } satisfies Omit<FundingNeedSignal, "firstFundingNeedYear">;

  return first === undefined
    ? result
    : { ...result, firstFundingNeedYear: first.year };
}
