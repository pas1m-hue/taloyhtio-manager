import { DomainValidationError } from "../domain/types.js";
import type {
  CompanyAccessGrant,
  VerifiedIdentity,
} from "./authTypes.js";
import type { CompanyAccessRepository } from "./companyAccessRepository.js";

export function validateVerifiedIdentity(
  identity: VerifiedIdentity | undefined,
  asOf: string,
): asserts identity is VerifiedIdentity {
  if (identity === undefined) {
    throw new DomainValidationError(
      "UNAUTHENTICATED",
      "An authenticated admin identity is required.",
    );
  }
  if (identity.subjectId.trim() === "" || identity.provider.trim() === "" ||
      !validDate(identity.authenticatedAt) || !validDate(identity.expiresAt) ||
      !validDate(asOf) ||
      Date.parse(identity.authenticatedAt) > Date.parse(asOf) ||
      Date.parse(asOf) >= Date.parse(identity.expiresAt)) {
    throw new DomainValidationError(
      "INVALID_AUTH_CONTEXT",
      `Authentication context for ${identity.subjectId || "unknown"} is invalid or expired.`,
    );
  }
  if (identity.email !== undefined && identity.email.trim() === "") {
    throw new DomainValidationError(
      "INVALID_AUTH_CONTEXT",
      `Authentication email for ${identity.subjectId} is empty.`,
    );
  }
}

export function validateCompanyAccessGrant(
  grant: CompanyAccessGrant,
): void {
  if (grant.companyId.trim() === "" || grant.subjectId.trim() === "" ||
      grant.role !== "admin" || grant.grantedBy.trim() === "" ||
      !validDate(grant.grantedAt)) {
    throw new DomainValidationError(
      "INVALID_ACCESS_GRANT",
      "Company access grant has invalid required fields.",
    );
  }
  const hasRevokedAt = grant.revokedAt !== undefined;
  const hasRevokedBy = grant.revokedBy !== undefined;
  if (hasRevokedAt !== hasRevokedBy ||
      (grant.revokedAt !== undefined && !validDate(grant.revokedAt)) ||
      (grant.revokedBy !== undefined && grant.revokedBy.trim() === "") ||
      (grant.active && hasRevokedAt) ||
      (!grant.active && !hasRevokedAt)) {
    throw new DomainValidationError(
      "INVALID_ACCESS_GRANT",
      `Company access grant ${grant.companyId}/${grant.subjectId} has inconsistent revocation state.`,
    );
  }
}

export async function requireCompanyAdmin(
  repository: CompanyAccessRepository,
  identity: VerifiedIdentity | undefined,
  companyId: string,
  asOf: string,
): Promise<VerifiedIdentity> {
  validateVerifiedIdentity(identity, asOf);
  if (companyId.trim() === "") {
    throw new DomainValidationError(
      "ACCESS_DENIED",
      "Company id is required for admin authorization.",
    );
  }
  const grant = await repository.load(companyId, identity.subjectId);
  if (grant === undefined || !grant.active || grant.role !== "admin") {
    throw new DomainValidationError(
      "ACCESS_DENIED",
      `Identity ${identity.subjectId} has no active admin access to ${companyId}.`,
    );
  }
  validateCompanyAccessGrant(grant);
  if (Date.parse(grant.grantedAt) > Date.parse(asOf) ||
      (grant.revokedAt !== undefined && Date.parse(grant.revokedAt) <= Date.parse(asOf))) {
    throw new DomainValidationError(
      "ACCESS_DENIED",
      `Identity ${identity.subjectId} has no active admin access to ${companyId} at ${asOf}.`,
    );
  }
  return identity;
}

function validDate(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Date.parse(value));
}
