import {
  DomainValidationError,
  type Horizon,
} from "../domain/types.js";
import type {
  ProtectedCreateVisitorSessionRequest,
  ProtectedResetVisitorSessionCommand,
  ProtectedVisitorSessionBatchCommand,
  ProtectedVisitorSessionHandle,
  VisitorSessionCredential,
} from "../auth/authTypes.js";
import type { ProtectedSessionWorkspaceRepository } from "../auth/protectedSessionRepository.js";
import type { SessionCredentialGenerator } from "../auth/sessionCredential.js";
import type { PublicationRepository } from "../publishing/publicationRepository.js";
import type { PublishedOverviewReadModel } from "../readModels/publishedOverview.js";
import type { VisitorScenarioViewReadModel } from "../readModels/visitorScenarioView.js";
import { loadPublishedOverview } from "./visitorApplicationService.js";
import {
  applyProtectedVisitorSessionChanges,
  createProtectedVisitorSession,
  loadProtectedVisitorScenario,
  resetProtectedVisitorSession,
} from "./protectedVisitorApplicationService.js";

export const DEFAULT_VISITOR_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_VISITOR_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Public/anonymous capability surface. It intentionally exposes no admin write. */
export class PublicVisitorApplicationFacade {
  readonly #publications: PublicationRepository;
  readonly #sessions: ProtectedSessionWorkspaceRepository;
  readonly #credentialGenerator: SessionCredentialGenerator | undefined;
  readonly #sessionTtlMs: number;

  public constructor(
    publications: PublicationRepository,
    sessions: ProtectedSessionWorkspaceRepository,
    credentialGenerator?: SessionCredentialGenerator,
    sessionTtlMs = DEFAULT_VISITOR_SESSION_TTL_MS,
  ) {
    if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs <= 0 ||
        sessionTtlMs > MAX_VISITOR_SESSION_TTL_MS) {
      throw new DomainValidationError(
        "INVALID_SESSION_DATA",
        `Visitor session TTL ${sessionTtlMs} ms is invalid.`,
      );
    }
    this.#publications = publications;
    this.#sessions = sessions;
    this.#credentialGenerator = credentialGenerator;
    this.#sessionTtlMs = sessionTtlMs;
  }

  public loadPublishedOverview(
    companyId: string,
    horizon: Horizon,
  ): Promise<PublishedOverviewReadModel> {
    return loadPublishedOverview(this.#publications, companyId, horizon);
  }

  public createSession(
    request: ProtectedCreateVisitorSessionRequest,
    asOf: string,
  ): Promise<ProtectedVisitorSessionHandle<VisitorScenarioViewReadModel>> {
    const createdAt = serverTimestamp(asOf);
    const expiresAt = new Date(
      Date.parse(createdAt) + this.#sessionTtlMs,
    ).toISOString();
    return createProtectedVisitorSession(
      this.#publications,
      this.#sessions,
      { ...request, createdAt, expiresAt },
      this.#credentialGenerator,
    );
  }

  public loadScenario(
    credential: VisitorSessionCredential,
    asOf: string,
  ): Promise<VisitorScenarioViewReadModel> {
    return loadProtectedVisitorScenario(
      this.#publications,
      this.#sessions,
      credential,
      serverTimestamp(asOf),
    );
  }

  public applyChanges(
    command: ProtectedVisitorSessionBatchCommand,
    asOf: string,
  ): Promise<VisitorScenarioViewReadModel> {
    return applyProtectedVisitorSessionChanges(
      this.#publications,
      this.#sessions,
      command,
      serverTimestamp(asOf),
    );
  }

  public reset(
    command: ProtectedResetVisitorSessionCommand,
    asOf: string,
  ): Promise<VisitorScenarioViewReadModel> {
    return resetProtectedVisitorSession(
      this.#publications,
      this.#sessions,
      command,
      serverTimestamp(asOf),
    );
  }
}

function serverTimestamp(value: string): string {
  const date = new Date(value);
  if (value.trim() === "" || !Number.isFinite(date.getTime())) {
    throw new DomainValidationError(
      "INVALID_SESSION_DATA",
      `Server timestamp ${value} is invalid.`,
    );
  }
  return date.toISOString();
}
