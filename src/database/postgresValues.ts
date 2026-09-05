import { DomainValidationError } from "../domain/types.js";

/**
 * Reading stored column values back as domain values. One implementation,
 * shared, because this file exists as the fix for a bug caused by not having
 * it: `integer` was duplicated in two repositories and the timestamp helper
 * existed in three different shapes, one of which silently truncated
 * milliseconds. Visitor sessions could not be created at all.
 */

function integrityError(message: string): DomainValidationError {
  return new DomainValidationError("DATABASE_INTEGRITY_ERROR", message);
}

export function integer(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw integrityError(`Stored ${label} is not a safe integer.`);
  }
  return parsed;
}

/**
 * Milliseconds since the epoch for a stored timestamptz, whatever shape the
 * driver hands back.
 *
 * NEVER `Date.parse(String(value))`. A driver returning a `Date` stringifies
 * through `Date.prototype.toString()`, which has second precision — so
 * "2026-09-05T11:43:38.744Z" comes back as 11:43:38.000 and any comparison
 * against the original fails by up to 999 ms. That is precisely how visitor
 * sessions broke: the round-trip integrity check in parseSessionRow compared a
 * payload written from `new Date().toISOString()` against its own stored
 * column and declared them different. `getTime()` keeps the milliseconds.
 *
 * The string branch normalises PostgreSQL's own text format, which is neither
 * ISO 8601 nor parseable by V8 as-is: a space instead of the "T", and a
 * two-digit zone offset ("+00") where ECMAScript requires "+00:00".
 */
export function instantMillis(value: Date | string, label: string): number {
  if (value instanceof Date) {
    const millis = value.getTime();
    if (!Number.isFinite(millis)) {
      throw integrityError(`Stored ${label} timestamp is invalid.`);
    }
    return millis;
  }

  const normalized = value.trim()
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00");
  const millis = Date.parse(normalized);
  if (!Number.isFinite(millis)) {
    throw integrityError(`Stored ${label} timestamp is invalid.`);
  }
  return millis;
}

/**
 * The same value as an ISO 8601 string, for the read models that carry
 * timestamps rather than compare them. Built on instantMillis so both
 * directions agree about what a stored instant is — the disagreement between
 * two such helpers is what this module was created to end.
 */
export function instantIso(value: Date | string, label: string): string {
  return new Date(instantMillis(value, label)).toISOString();
}
