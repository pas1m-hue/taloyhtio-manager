import type { Horizon } from "../domain/types.js";
import type {
  AuthorizedAdminDataBatchCommand,
  AuthorizedPublishAdminDataCommand,
} from "../auth/authTypes.js";
import type { AuthenticationPort } from "../auth/authenticationPort.js";
import type { CompanyAccessRepository } from "../auth/companyAccessRepository.js";
import type { PublishingRepository } from "../publishing/publicationRepository.js";
import type { AdminDashboardReadModel } from "../readModels/adminDashboard.js";
import type { SnapshotCalculationReadModel } from "../readModels/calculationReadModel.js";
import type {
  PublicationHistoryItem,
  PublicationHistoryReadModel,
} from "../readModels/publishedOverview.js";
import {
  applyAuthorizedAdminChanges,
  loadAuthorizedAdminWorkspace,
  previewAuthorizedAdminCalculations,
} from "./authorizedAdminApplicationService.js";
import {
  loadAuthorizedPublicationHistory,
  publishAuthorizedAdminRevision,
} from "./authorizedPublishingApplicationService.js";

/**
 * The UI/API-facing admin boundary. It accepts an opaque provider credential,
 * not a subject id, role, actor id, or publishedBy value from the browser.
 */
export class SecuredAdminApplicationFacade<Credential> {
  readonly #authentication: AuthenticationPort<Credential>;
  readonly #access: CompanyAccessRepository;
  readonly #repository: PublishingRepository;

  public constructor(
    authentication: AuthenticationPort<Credential>,
    access: CompanyAccessRepository,
    repository: PublishingRepository,
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

  public async publish(
    credential: Credential,
    command: AuthorizedPublishAdminDataCommand,
    asOf: string,
  ): Promise<PublicationHistoryItem> {
    const identity = await this.#authentication.verify(credential, asOf);
    return publishAuthorizedAdminRevision(
      this.#repository,
      this.#access,
      identity,
      command,
      asOf,
    );
  }

  public async loadPublicationHistory(
    credential: Credential,
    companyId: string,
    asOf: string,
  ): Promise<PublicationHistoryReadModel> {
    const identity = await this.#authentication.verify(credential, asOf);
    return loadAuthorizedPublicationHistory(
      this.#repository,
      this.#access,
      identity,
      companyId,
      asOf,
    );
  }
}
