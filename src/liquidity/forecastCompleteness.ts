import type {
  EventDataGap,
  ForecastIncompletenessReason,
  Horizon,
} from "../domain/types.js";

export interface ForecastCompletenessInput {
  readonly blockingDataGaps: readonly EventDataGap[];
  readonly horizon: Horizon;
  /** Last year the maintenance plan covers; omitted means nobody has said. */
  readonly maintenancePlanCoverageThroughYear?: number;
}

/**
 * Every reason this forecast falls short of covering its horizon, in the order
 * the reasons are declared. An empty list is what `forecastComplete` means.
 *
 * ONE SUBTLETY, and it is the whole reason this lives in a shared function.
 * An unset coverage year is not detectable from the cash path's shape:
 * projectCashPath treats `coverage === undefined` as "every year is covered",
 * so `beyondCoverage` is absent and every row reports `costsKnown: true` —
 * indistinguishable from a plan that genuinely reaches the horizon's end. A
 * check written against `beyondCoverage` alone would therefore call an unset
 * plan complete, which is the opposite of the decision taken here: claiming
 * "täydellinen" is a stronger claim than drawing a table's rows, so it needs
 * more, and "I never said how far the plan reaches" must not read to the user
 * as "all is well". The coverage year is therefore tested directly.
 */
export function forecastIncompletenessReasons(
  input: ForecastCompletenessInput,
): readonly ForecastIncompletenessReason[] {
  const reasons: ForecastIncompletenessReason[] = [];
  if (input.blockingDataGaps.length > 0) reasons.push("data_gap");
  const coverage = input.maintenancePlanCoverageThroughYear;
  if (coverage === undefined) {
    reasons.push("coverage_unset");
  } else if (coverage < input.horizon.endYear) {
    reasons.push("coverage_ends_before_horizon");
  }
  return reasons;
}
