import { DomainValidationError } from "../domain/types.js";

/**
 * PostgreSQL SQLSTATE 42501, insufficient_privilege. Raised when row-level
 * security rejects a write: `new row violates row-level security policy for
 * table "…"`.
 */
const INSUFFICIENT_PRIVILEGE = "42501";

export function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

/**
 * Translates driver errors the repositories cannot act on into named domain
 * errors, and passes everything else through untouched.
 *
 * Only 42501 is translated here. The constraint violations (23505, 23503) stay
 * where they are: those mean different things per table — a duplicate
 * publication version is a conflict, a duplicate session id is another — and
 * only the calling repository knows which.
 *
 * WHY THIS EXISTS. A row-level-security rejection fell through every catch in
 * the repositories, because each one matched only the constraint code it cared
 * about. It reached the client as a bare INTERNAL_SERVER_ERROR with the
 * message replaced by "Internal server error." (httpErrors maps every 500 that
 * way, deliberately, so internals do not leak), leaving the real cause visible
 * only in the server log. That is what happened to the first publication ever
 * attempted against production.
 *
 * The named code is what carries the information out: `code` IS returned to
 * the client on a 500 even though `message` is not, so the admin UI can turn
 * DATABASE_ACCESS_POLICY_ERROR into an instruction. The message, which names
 * the table, goes to the server log.
 *
 * It stays a 500: this is a server misconfiguration, not a bad request. The
 * caller did nothing wrong and cannot fix it by retrying or by changing input.
 */
export function asDatabaseError(error: unknown): unknown {
  if (postgresErrorCode(error) !== INSUFFICIENT_PRIVILEGE) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new DomainValidationError(
    "DATABASE_ACCESS_POLICY_ERROR",
    `The database rejected the write on an access policy: ${detail}. ` +
      "Row-level security is enabled on a table that has no policy, which " +
      "denies every write. See migration 004.",
  );
}
