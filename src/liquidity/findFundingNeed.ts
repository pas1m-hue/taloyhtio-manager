import type {
  FundingNeedSignal,
  Horizon,
  ScenarioCashPath,
} from "../domain/types.js";
import { forecastIncompletenessReasons } from "./forecastCompleteness.js";

/**
 * Finds the first and maximum operating-buffer shortfall in a raw cash path.
 * This is a financing-need signal, not a decision to take a loan.
 *
 * Years beyond the maintenance plan's coverage carry no shortfall and no
 * closing cash, and are skipped here rather than compared. This is the one
 * place where an unguarded `undefined > 0` or `Math.min(..., undefined)`
 * would quietly produce a wrong signal instead of failing: the first is
 * always false, the second always NaN. Both are read as "no funding need".
 *
 * `horizon` is a required parameter rather than something derived from the
 * cash path's rows: the completeness rule compares the plan's coverage against
 * the horizon's last year, and reading that back out of the rows would make a
 * caller with a different horizon silently produce the wrong claim. Requiring
 * it forces every call site to say which horizon this signal is about.
 */
export function findFundingNeed(
  cashPath: ScenarioCashPath,
  horizon: Horizon,
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

  const forecastIncompleteReasons = forecastIncompletenessReasons({
    blockingDataGaps: cashPath.blockingDataGaps,
    horizon,
    ...(cashPath.maintenancePlanCoverageThroughYear === undefined
      ? {}
      : {
          maintenancePlanCoverageThroughYear:
            cashPath.maintenancePlanCoverageThroughYear,
        }),
  });

  const result = {
    scenario: cashPath.scenario,
    ownFundingSufficientForKnownCosts: first === undefined,
    forecastComplete: forecastIncompleteReasons.length === 0,
    forecastIncompleteReasons,
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
