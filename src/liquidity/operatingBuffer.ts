import {
  DEFAULT_OPERATING_BUFFER_MONTHS,
  DomainValidationError,
  type OperatingBufferResult,
  type OperatingBufferSettings,
} from "../domain/types.js";
import { fromCents, toCents } from "./money.js";

export interface CalculateOperatingBufferInput {
  readonly trailing12mOperatingCosts: number;
  readonly settings?: OperatingBufferSettings;
}

/**
 * Calculates a protected operating-cash target.
 *
 * The suggested target is trailing twelve-month operating costs divided by
 * twelve and multiplied by buffer months. A user override wins explicitly.
 */
export function calculateOperatingBuffer(
  input: CalculateOperatingBufferInput,
): OperatingBufferResult {
  const operatingCostCents = toCents(
    input.trailing12mOperatingCosts,
    "INVALID_OPERATING_BUFFER",
    "trailing12mOperatingCosts",
  );
  const bufferMonths = input.settings?.bufferMonths ??
    DEFAULT_OPERATING_BUFFER_MONTHS;
  if (!Number.isFinite(bufferMonths) || bufferMonths < 0) {
    throw new DomainValidationError(
      "INVALID_OPERATING_BUFFER",
      `bufferMonths must be finite and non-negative; received ${bufferMonths}.`,
    );
  }

  const suggestedCents = Math.round(operatingCostCents / 12 * bufferMonths);
  const override = input.settings?.userOverride;
  const targetCents = override === undefined
    ? suggestedCents
    : toCents(override, "INVALID_OPERATING_BUFFER", "userOverride");

  return {
    bufferMonths,
    suggestedOperatingBuffer: fromCents(suggestedCents),
    operatingBufferTarget: fromCents(targetCents),
    basis: override === undefined ? "suggested" : "user_override",
  };
}
