import { DomainValidationError, type ValidationCode } from "../domain/types.js";

export function toCents(
  value: number,
  code: ValidationCode,
  field: string,
): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new DomainValidationError(
      code,
      `${field} must be a finite non-negative euro amount; received ${value}.`,
    );
  }
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new DomainValidationError(
      code,
      `${field} is outside the supported monetary range.`,
    );
  }
  return cents;
}

/**
 * Cents for an amount that may legitimately be negative.
 *
 * toCents rejects a negative value, which was right while the only collection
 * the cash path knew was an earmarked repair charge: you cannot collect a
 * negative charge. The figure is now hoitokate - a year's operating income
 * less its operating costs - and that is negative whenever costs exceed
 * income. A housing company in exactly that position is the one the
 * application exists to warn, so the cash path has to be able to model it
 * draining rather than refuse the input.
 *
 * Cash balances and buffer targets keep using toCents: those are quantities
 * held, and a negative one would be a data error rather than a bad year.
 */
export function toSignedCents(
  value: number,
  code: ValidationCode,
  field: string,
): number {
  if (!Number.isFinite(value)) {
    throw new DomainValidationError(
      code,
      `${field} must be a finite euro amount; received ${value}.`,
    );
  }
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new DomainValidationError(
      code,
      `${field} is outside the supported monetary range.`,
    );
  }
  return cents;
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function roundRate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
