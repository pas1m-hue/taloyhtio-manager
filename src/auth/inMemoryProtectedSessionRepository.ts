import {
  DomainValidationError,
  type VisitorSessionWorkspace,
} from "../domain/types.js";
import { validateVisitorSessionWorkspace } from "../session/sessionWorkspace.js";
import type { VisitorSessionAccessRecord } from "./authTypes.js";
import type { ProtectedSessionWorkspaceRepository } from "./protectedSessionRepository.js";
import { tokenHashesEqual } from "./sessionCredential.js";

/** Test/MVP adapter that keeps raw access tokens out of session payloads. */
export class InMemoryProtectedSessionWorkspaceRepository
implements ProtectedSessionWorkspaceRepository {
  readonly #sessions = new Map<string, VisitorSessionWorkspace>();
  readonly #access = new Map<string, VisitorSessionAccessRecord>();

  public async create(
    workspace: VisitorSessionWorkspace,
  ): Promise<VisitorSessionWorkspace> {
    validateVisitorSessionWorkspace(workspace);
    if (this.#sessions.has(workspace.sessionId)) {
      throw new DomainValidationError(
        "SESSION_ALREADY_EXISTS",
        `Session ${workspace.sessionId} already exists.`,
      );
    }
    this.#sessions.set(workspace.sessionId, clone(workspace));
    return clone(workspace);
  }

  public async createProtected(
    workspace: VisitorSessionWorkspace,
    access: VisitorSessionAccessRecord,
  ): Promise<VisitorSessionWorkspace> {
    validateVisitorSessionWorkspace(workspace);
    validateAccessRecord(access, workspace);
    if (this.#sessions.has(workspace.sessionId) ||
        this.#access.has(workspace.sessionId)) {
      throw new DomainValidationError(
        "SESSION_ALREADY_EXISTS",
        `Session ${workspace.sessionId} already exists.`,
      );
    }
    this.#sessions.set(workspace.sessionId, clone(workspace));
    this.#access.set(workspace.sessionId, clone(access));
    return clone(workspace);
  }

  public async load(
    sessionId: string,
  ): Promise<VisitorSessionWorkspace | undefined> {
    const value = this.#sessions.get(sessionId);
    return value === undefined ? undefined : clone(value);
  }

  public async loadProtected(
    sessionId: string,
    tokenHash: string,
    asOf: string,
  ): Promise<VisitorSessionWorkspace | undefined> {
    const access = this.#access.get(sessionId);
    const workspace = this.#sessions.get(sessionId);
    if (access === undefined || workspace === undefined ||
        !accessActive(access, tokenHash, asOf)) {
      return undefined;
    }
    return clone(workspace);
  }

  public async save(
    sessionId: string,
    expectedRevision: number,
    next: VisitorSessionWorkspace,
  ): Promise<VisitorSessionWorkspace> {
    validateVisitorSessionWorkspace(next);
    const current = this.#sessions.get(sessionId);
    if (current === undefined) {
      throw new DomainValidationError(
        "SESSION_NOT_FOUND",
        `Session ${sessionId} does not exist.`,
      );
    }
    if (current.revision !== expectedRevision ||
        next.revision !== expectedRevision + 1 || next.sessionId !== sessionId) {
      throw new DomainValidationError(
        "SESSION_REVISION_CONFLICT",
        `Session ${sessionId} revision changed from ${expectedRevision} ` +
          `to ${current.revision}.`,
      );
    }
    this.#sessions.set(sessionId, clone(next));
    return clone(next);
  }

  public async saveProtected(
    sessionId: string,
    tokenHash: string,
    asOf: string,
    expectedRevision: number,
    next: VisitorSessionWorkspace,
  ): Promise<VisitorSessionWorkspace> {
    const authorized = await this.loadProtected(sessionId, tokenHash, asOf);
    if (authorized === undefined) {
      throw invalidCredential();
    }
    return this.save(sessionId, expectedRevision, next);
  }

  public async delete(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId);
    this.#access.delete(sessionId);
  }

  public async revokeAccess(
    sessionId: string,
    revokedAt: string,
  ): Promise<void> {
    const access = this.#access.get(sessionId);
    if (access === undefined) {
      throw invalidCredential();
    }
    if (!validDate(revokedAt) || Date.parse(revokedAt) < Date.parse(access.createdAt)) {
      throw new DomainValidationError(
        "INVALID_SESSION_CREDENTIAL",
        `Session ${sessionId} revocation date is invalid.`,
      );
    }
    this.#access.set(sessionId, { ...clone(access), revokedAt });
  }

  public async loadAccessRecord(
    sessionId: string,
  ): Promise<VisitorSessionAccessRecord | undefined> {
    const access = this.#access.get(sessionId);
    return access === undefined ? undefined : clone(access);
  }
}

function validateAccessRecord(
  access: VisitorSessionAccessRecord,
  workspace: VisitorSessionWorkspace,
): void {
  if (access.sessionId !== workspace.sessionId ||
      !/^[a-f0-9]{64}$/.test(access.tokenHash) ||
      !validDate(access.createdAt) || !validDate(access.expiresAt) ||
      Date.parse(access.createdAt) !== Date.parse(workspace.createdAt) ||
      Date.parse(access.expiresAt) !== Date.parse(workspace.expiresAt) ||
      Date.parse(access.expiresAt) <= Date.parse(access.createdAt) ||
      access.revokedAt !== undefined) {
    throw new DomainValidationError(
      "INVALID_SESSION_CREDENTIAL",
      `Session ${workspace.sessionId} access record is invalid.`,
    );
  }
}

function accessActive(
  access: VisitorSessionAccessRecord,
  tokenHash: string,
  asOf: string,
): boolean {
  return validDate(asOf) && access.revokedAt === undefined &&
    Date.parse(asOf) >= Date.parse(access.createdAt) &&
    Date.parse(asOf) < Date.parse(access.expiresAt) &&
    tokenHashesEqual(access.tokenHash, tokenHash);
}

function validDate(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Date.parse(value));
}

function invalidCredential(): DomainValidationError {
  return new DomainValidationError(
    "INVALID_SESSION_CREDENTIAL",
    "Visitor session credential is invalid, expired or revoked.",
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
