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

export function fromCents(cents: number): number {
  return cents / 100;
}

export function roundRate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
