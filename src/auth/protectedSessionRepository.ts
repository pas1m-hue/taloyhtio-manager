import type { VisitorSessionWorkspace } from "../domain/types.js";
import type { SessionWorkspaceRepository } from "../session/sessionRepository.js";
import type { VisitorSessionAccessRecord } from "./authTypes.js";

/**
 * Server-only session repository. Credential verification and session writes
 * must be performed atomically by a production adapter.
 */
export interface ProtectedSessionWorkspaceRepository
extends SessionWorkspaceRepository {
  createProtected(
    workspace: VisitorSessionWorkspace,
    access: VisitorSessionAccessRecord,
  ): Promise<VisitorSessionWorkspace>;
  loadProtected(
    sessionId: string,
    tokenHash: string,
    asOf: string,
  ): Promise<VisitorSessionWorkspace | undefined>;
  saveProtected(
    sessionId: string,
    tokenHash: string,
    asOf: string,
    expectedRevision: number,
    next: VisitorSessionWorkspace,
  ): Promise<VisitorSessionWorkspace>;
  revokeAccess(sessionId: string, revokedAt: string): Promise<void>;
  loadAccessRecord(
    sessionId: string,
  ): Promise<VisitorSessionAccessRecord | undefined>;
}
