import type {
  FundingNeedSignal,
  ScenarioCashPath,
} from "../domain/types.js";

/**
 * Finds the first and maximum operating-buffer shortfall in a raw cash path.
 * This is a financing-need signal, not a decision to take a loan.
 *
 * Years beyond the maintenance plan's coverage carry no shortfall and no
 * closing cash, and are skipped here rather than compared. This is the one
 * place where an unguarded `undefined > 0` or `Math.min(..., undefined)`
 * would quietly produce a wrong signal instead of failing: the first is
 * always false, the second always NaN. Both are read as "no funding need".
 */
export function findFundingNeed(
  cashPath: ScenarioCashPath,
): FundingNeedSignal {
  const shortfallYears = cashPath.years.filter(
    (year) => year.bufferShortfall !== undefined && year.bufferShortfall > 0,
  );
  const first = shortfallYears[0];
  const closingCashes = cashPath.years
    .map((year) => year.closingCash)
    .filter((value): value is number => value !== undefined);
  const minimumClosingCash = closingCashes.length === 0
    ? cashPath.initialCash
    : Math.min(...closingCashes);

  const result = {
    scenario: cashPath.scenario,
    ownFundingSufficientForKnownCosts: first === undefined,
    forecastComplete: cashPath.blockingDataGaps.length === 0,
    amountAtFirstNeed: first?.bufferShortfall ?? 0,
    maximumBufferShortfall: shortfallYears.reduce(
      (maximum, year) => Math.max(maximum, year.bufferShortfall ?? 0),
      0,
    ),
    minimumClosingCash,
    blockingDataGaps: cashPath.blockingDataGaps,
  } satisfies Omit<FundingNeedSignal, "firstFundingNeedYear">;

  return first === undefined
    ? result
    : { ...result, firstFundingNeedYear: first.year };
}
