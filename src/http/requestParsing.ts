import {
  DomainValidationError,
  type AdminDataOperation,
  type Horizon,
  type VisitorSessionOperation,
} from "../domain/types.js";
import { HttpRequestValidationError } from "./httpErrors.js";

export interface HorizonQuery {
  readonly startYear?: number | string;
  readonly endYear?: number | string;
}

export interface AdminChangesBody {
  readonly expectedRevision: number;
  readonly horizon: Horizon;
  readonly operations: readonly AdminDataOperation[];
}

export interface AdminPublishBody {
  readonly expectedAdminRevision: number;
  readonly expectedPublishedVersion: number;
  readonly sourceIds: readonly string[];
  readonly explanation: string;
}

export interface CreateSessionBody {
  readonly publicationVersion: number;
  readonly horizon: Horizon;
}

export interface VisitorChangesBody {
  readonly expectedRevision: number;
  readonly operations: readonly VisitorSessionOperation[];
}

export interface VisitorResetBody {
  readonly expectedRevision: number;
}

export function parseHorizon(query: HorizonQuery): Horizon {
  const startYear = integer(query.startYear, "startYear");
  const endYear = integer(query.endYear, "endYear");
  if (startYear > endYear) {
    throw new DomainValidationError(
      "INVALID_HORIZON",
      `Horizon ${startYear}-${endYear} is invalid.`,
    );
  }
  return { startYear, endYear };
}

export function parseAdminCredential(value: string | undefined): string {
  if (value === undefined) {
    throw new DomainValidationError(
      "UNAUTHENTICATED",
      "Admin bearer credential is required.",
    );
  }
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  if (match === null || match[1]!.trim() === "") {
    throw new DomainValidationError(
      "UNAUTHENTICATED",
      "Admin bearer credential is invalid.",
    );
  }
  return match[1]!.trim();
}

export function parseVisitorToken(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DomainValidationError(
      "INVALID_SESSION_CREDENTIAL",
      "Visitor session credential is required.",
    );
  }
  return value.trim();
}

export function assertNoTrustedMetadata(value: unknown): void {
  const forbidden = new Set([
    "actorId",
    "occurredAt",
    "publishedBy",
    "publishedAt",
    "updatedBy",
    "updatedAt",
    "createdAt",
    "expiresAt",
    "grantedBy",
    "grantedAt",
  ]);
  scan(value, forbidden, "$", 0);
}

export function ensureObject<T>(value: unknown, label: string): T {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpRequestValidationError(`${label} must be a JSON object.`);
  }
  return value as T;
}

function scan(
  value: unknown,
  forbidden: ReadonlySet<string>,
  path: string,
  depth: number,
): void {
  if (depth > 12) {
    throw new HttpRequestValidationError("Request nesting is too deep.");
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scan(item, forbidden, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbidden.has(key)) {
      throw new HttpRequestValidationError(
        `Trusted server field ${path}.${key} is not accepted from the browser.`,
      );
    }
    scan(nested, forbidden, `${path}.${key}`, depth + 1);
  }
}

function integer(value: number | string | undefined, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new HttpRequestValidationError(`${label} must be an integer.`);
  }
  return parsed;
}
