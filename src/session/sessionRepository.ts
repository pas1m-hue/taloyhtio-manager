import {
  DomainValidationError,
  type VisitorSessionWorkspace,
} from "../domain/types.js";
import { validateVisitorSessionWorkspace } from "./sessionWorkspace.js";

/** Ephemeral session storage; intentionally separate from the admin repository. */
export interface SessionWorkspaceRepository {
  create(workspace: VisitorSessionWorkspace): Promise<VisitorSessionWorkspace>;
  load(sessionId: string): Promise<VisitorSessionWorkspace | undefined>;
  save(
    sessionId: string,
    expectedRevision: number,
    next: VisitorSessionWorkspace,
  ): Promise<VisitorSessionWorkspace>;
  delete(sessionId: string): Promise<void>;
}

/** Test/MVP adapter. A production app may replace this with browser or TTL storage. */
export class InMemorySessionWorkspaceRepository
implements SessionWorkspaceRepository {
  readonly #sessions = new Map<string, VisitorSessionWorkspace>();

  public constructor(initial: readonly VisitorSessionWorkspace[] = []) {
    for (const workspace of initial) {
      validateVisitorSessionWorkspace(workspace);
      if (this.#sessions.has(workspace.sessionId)) {
        throw new DomainValidationError(
          "SESSION_ALREADY_EXISTS",
          `Session ${workspace.sessionId} already exists.`,
        );
      }
      this.#sessions.set(workspace.sessionId, clone(workspace));
    }
  }

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

  public async load(
    sessionId: string,
  ): Promise<VisitorSessionWorkspace | undefined> {
    const workspace = this.#sessions.get(sessionId);
    return workspace === undefined ? undefined : clone(workspace);
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
        next.revision !== expectedRevision + 1 ||
        next.sessionId !== sessionId) {
      throw new DomainValidationError(
        "SESSION_REVISION_CONFLICT",
        `Session ${sessionId} revision changed from ${expectedRevision} ` +
          `to ${current.revision}.`,
      );
    }
    this.#sessions.set(sessionId, clone(next));
    return clone(next);
  }

  public async delete(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
