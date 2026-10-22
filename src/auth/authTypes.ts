import type {
  AdminDataBatchCommand,
  PublishAdminDataCommand,
} from "../domain/types.js";

/** Identity already verified by a trusted server-side authentication adapter. */
export interface VerifiedIdentity {
  readonly subjectId: string;
  readonly provider: string;
  readonly authenticatedAt: string;
  readonly expiresAt: string;
  readonly email?: string;
}

export type CompanyRole = "admin";

/** Server-side company authorization record. Roles are never accepted from UI input. */
export interface CompanyAccessGrant {
  readonly companyId: string;
  readonly subjectId: string;
  readonly role: CompanyRole;
  readonly active: boolean;
  readonly grantedAt: string;
  readonly grantedBy: string;
  readonly revokedAt?: string;
  readonly revokedBy?: string;
}

export type AuthorizedAdminDataBatchCommand = Omit<
  AdminDataBatchCommand,
  "actorId" | "occurredAt"
>;

export type AuthorizedPublishAdminDataCommand = Omit<
  PublishAdminDataCommand,
  "publishedBy" | "publishedAt"
>;
