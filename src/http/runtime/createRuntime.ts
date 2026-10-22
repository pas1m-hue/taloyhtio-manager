import type { AdminDataRepository } from "../../admin/adminRepository.js";
import { SecuredAdminApplicationFacade } from "../../application/securedAdminFacade.js";
import type { AuthenticationPort } from "../../auth/authenticationPort.js";
import type { CompanyAccessRepository } from "../../auth/companyAccessRepository.js";
import { createHttpServer, type TaloyhtioHttpServer } from "../createHttpServer.js";
import type { ServerClock } from "../clock.js";

export interface RuntimeRepositories {
  readonly publications: AdminDataRepository;
  readonly access: CompanyAccessRepository;
}

export function createApplicationHttpRuntime(
  authentication: AuthenticationPort<string>,
  repositories: RuntimeRepositories,
  options: {
    readonly clock?: ServerClock;
    readonly publicDirectory?: string;
    readonly logger?: boolean;
  } = {},
): TaloyhtioHttpServer {
  const admin = new SecuredAdminApplicationFacade(
    authentication,
    repositories.access,
    repositories.publications,
  );
  return createHttpServer({
    admin,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.publicDirectory === undefined
      ? {}
      : { publicDirectory: options.publicDirectory }),
    logger: options.logger ?? false,
  });
}
