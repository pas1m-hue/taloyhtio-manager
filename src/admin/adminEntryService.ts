import {
  DomainValidationError,
  type AdminDataBatchCommand,
  type AdminDataSnapshot,
} from "../domain/types.js";
import { applyAdminBatch } from "./applyAdminBatch.js";
import type { AdminDataRepository } from "./adminRepository.js";

/** Loads, validates, applies, and atomically commits one admin batch. */
export async function commitAdminBatch(
  repository: AdminDataRepository,
  command: AdminDataBatchCommand,
): Promise<AdminDataSnapshot> {
  const current = await repository.load(command.companyId);
  if (current === undefined) {
    throw new DomainValidationError(
      "ADMIN_DATA_NOT_FOUND",
      `Admin data ${command.companyId} does not exist.`,
    );
  }
  const next = applyAdminBatch(current, command);
  return repository.save(command.companyId, command.expectedRevision, next);
}
