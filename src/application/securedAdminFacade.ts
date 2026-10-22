import type { Horizon } from "../domain/types.js";
import type { AuthorizedAdminDataBatchCommand } from "../auth/authTypes.js";
import type { AdminDataRepository } from "../admin/adminRepository.js";
import type { AuthenticationPort } from "../auth/authenticationPort.js";
import type { CompanyAccessRepository } from "../auth/companyAccessRepository.js";
import type { AdminDashboardReadModel } from "../readModels/adminDashboard.js";
import type { SnapshotCalculationReadModel } from "../readModels/calculationReadModel.js";
import {
  applyAuthorizedAdminChanges,
  loadAuthorizedAdminWorkspace,
  previewAuthorizedAdminCalculations,
} from "./authorizedAdminApplicationService.js";

/**
 * The UI/API-facing admin boundary. It accepts an opaque provider credential,
 * not a subject id, role or actor id from the browser.
 */
export class SecuredAdminApplicationFacade<Credential> {
  readonly #authentication: AuthenticationPort<Credential>;
  readonly #access: CompanyAccessRepository;
  readonly #repository: AdminDataRepository;

  public constructor(
    authentication: AuthenticationPort<Credential>,
    access: CompanyAccessRepository,
    repository: AdminDataRepository,
  ) {
    this.#authentication = authentication;
    this.#access = access;
    this.#repository = repository;
  }

  public async loadWorkspace(
    credential: Credential,
    companyId: string,
    horizon: Horizon,
    asOf: string,
  ): Promise<AdminDashboardReadModel> {
    const identity = await this.#authentication.verify(credential, asOf);
    return loadAuthorizedAdminWorkspace(
      this.#repository,
      this.#access,
      identity,
      companyId,
      horizon,
      asOf,
    );
  }

  public async applyChanges(
    credential: Credential,
    command: AuthorizedAdminDataBatchCommand,
    horizon: Horizon,
    asOf: string,
  ): Promise<AdminDashboardReadModel> {
    const identity = await this.#authentication.verify(credential, asOf);
    return applyAuthorizedAdminChanges(
      this.#repository,
      this.#access,
      identity,
      command,
      horizon,
      asOf,
    );
  }

  public async previewCalculations(
    credential: Credential,
    companyId: string,
    horizon: Horizon,
    asOf: string,
  ): Promise<SnapshotCalculationReadModel> {
    const identity = await this.#authentication.verify(credential, asOf);
    return previewAuthorizedAdminCalculations(
      this.#repository,
      this.#access,
      identity,
      companyId,
      horizon,
      asOf,
    );
  }
}
