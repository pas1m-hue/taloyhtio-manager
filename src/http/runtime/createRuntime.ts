import { PublicVisitorApplicationFacade } from "../../application/publicVisitorFacade.js";
import { SecuredAdminApplicationFacade } from "../../application/securedAdminFacade.js";
import type { AuthenticationPort } from "../../auth/authenticationPort.js";
import type { CompanyAccessRepository } from "../../auth/companyAccessRepository.js";
import type { ProtectedSessionWorkspaceRepository } from "../../auth/protectedSessionRepository.js";
import type { PublishingRepository } from "../../publishing/publicationRepository.js";
import { createHttpServer, type TaloyhtioHttpServer } from "../createHttpServer.js";
import type { ServerClock } from "../clock.js";

export interface RuntimeRepositories {
  readonly publications: PublishingRepository;
  readonly sessions: ProtectedSessionWorkspaceRepository;
  readonly access: CompanyAccessRepository;
}

export function createApplicationHttpRuntime(
  authentication: AuthenticationPort<string>,
  repositories: RuntimeRepositories,
  options: {
    readonly clock?: ServerClock;
    readonly publicDirectory?: string;
    readonly logger?: boolean;
    readonly sessionTtlMs?: number;
  } = {},
): TaloyhtioHttpServer {
  const admin = new SecuredAdminApplicationFacade(
    authentication,
    repositories.access,
    repositories.publications,
  );
  const visitor = new PublicVisitorApplicationFacade(
    repositories.publications,
    repositories.sessions,
    undefined,
    options.sessionTtlMs,
  );
  return createHttpServer({
    admin,
    visitor,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.publicDirectory === undefined
      ? {}
      : { publicDirectory: options.publicDirectory }),
    logger: options.logger ?? false,
  });
}
