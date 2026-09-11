import { describe, expect, it } from "vitest";
import {
  DomainValidationError,
  type AdminDataBatchCommand,
  type AdminDataOperation,
  type MaintenanceDocument,
} from "../domain/types.js";
import { adminBaselineSnapshot } from "../fixtures/adminBaseline.js";
import {
  completedWorksFixture,
  maintenanceNeedFixture,
  technicalLifespanFixture,
} from "../fixtures/maintenanceDocuments.js";
import { buildAdminDashboardReadModel } from "../readModels/adminDashboard.js";
import {
  createPublishedDataSnapshot,
  fingerprintAdminPublishableContent,
} from "../publishing/publishedSnapshot.js";
import { applyAdminBatch } from "./applyAdminBatch.js";

const NOW = "2026-09-11T12:00:00.123+03:00";

function command(
  operations: AdminDataBatchCommand["operations"],
  expectedRevision = 0,
): AdminDataBatchCommand {
  return {
    companyId: adminBaselineSnapshot.companyId,
    expectedRevision,
    actorId: "admin:test",
    occurredAt: NOW,
    operations,
  };
}

function save(value: MaintenanceDocument): AdminDataOperation {
  return {
    type: "save_maintenance_document",
    value,
    sourceIds: value.sourceIds,
    explanation: "",
  };
}

describe("maintenance documents (feature/selvitykset)", () => {
  it("saves all three documents into one collection, one per kind", () => {
    const next = applyAdminBatch(adminBaselineSnapshot, command([
      save(technicalLifespanFixture),
      save(completedWorksFixture),
      save(maintenanceNeedFixture),
    ]));

    expect(next.maintenanceDocuments.map((doc) => doc.id))
      .toEqual(["completed_works", "maintenance_need", "technical_lifespan"]);
    expect(next.auditTrail.map((entry) => [entry.entityType, entry.entityKey, entry.operation]))
      .toEqual([
        ["maintenance_document", "technical_lifespan", "create"],
        ["maintenance_document", "completed_works", "create"],
        ["maintenance_document", "maintenance_need", "create"],
      ]);
  });

  it("replaces the whole table on re-paste: 4 rows, then 1, leaves 1", () => {
    const withFour = applyAdminBatch(adminBaselineSnapshot, command([save(technicalLifespanFixture)]));
    const replaced = applyAdminBatch(withFour, command([save({
      ...technicalLifespanFixture,
      rows: [{ item: "Hissi", interval: "25–30 v" }],
    })], withFour.revision));

    const doc = replaced.maintenanceDocuments.find((item) => item.kind === "technical_lifespan");
    expect(doc?.rows).toEqual([{ item: "Hissi", interval: "25–30 v" }]);
    expect(replaced.maintenanceDocuments).toHaveLength(1);
    expect(replaced.auditTrail.at(-1)?.operation).toBe("update");
  });

  it("keeps the pasted row order through save and normalisation", () => {
    // The technical lifespan list is grouped by subject in its source;
    // sorting it alphabetically would destroy that.
    const next = applyAdminBatch(adminBaselineSnapshot, command([
      save(technicalLifespanFixture),
      save(completedWorksFixture),
    ]));

    expect(next.maintenanceDocuments.find((d) => d.kind === "technical_lifespan")?.rows.map((r) => r.item))
      .toEqual(["Vesikatto, tiili", "Viemärit", "Ikkunat", "Lämminvesivaraaja"]);
    // Completed works are stored as pasted too; the view sorts them.
    expect(next.maintenanceDocuments.find((d) => d.kind === "completed_works")?.rows.map((r) => r.year))
      .toEqual([2025, 2012, 2025, 2019]);
  });

  it("deletes a document through delete_entity, with nothing cascading", () => {
    const withDocs = applyAdminBatch(adminBaselineSnapshot, command([
      save(completedWorksFixture),
      save(maintenanceNeedFixture),
    ]));
    const deleted = applyAdminBatch(withDocs, command([{
      type: "delete_entity",
      entityType: "maintenance_document",
      entityKey: "maintenance_need",
      sourceIds: ["maintenance_need"],
      explanation: "",
    }], withDocs.revision));

    expect(deleted.maintenanceDocuments.map((doc) => doc.id)).toEqual(["completed_works"]);
    expect(deleted.events).toEqual(withDocs.events);
    expect(deleted.auditTrail.at(-1)).toMatchObject({
      entityType: "maintenance_document",
      entityKey: "maintenance_need",
      operation: "delete",
      before: maintenanceNeedFixture,
    });
  });

  it("accepts an emptied document, since an emptied statement is still a statement", () => {
    const next = applyAdminBatch(adminBaselineSnapshot, command([
      save({ ...completedWorksFixture, rows: [] }),
    ]));

    expect(next.maintenanceDocuments[0]?.rows).toEqual([]);
  });

  it("rejects a document whose id is not its kind", () => {
    expect(() => applyAdminBatch(adminBaselineSnapshot, command([
      save({ ...completedWorksFixture, id: "completed_works_2" as "completed_works" }),
    ]))).toThrowError(DomainValidationError);
  });

  it("rejects a maintenance-need statement without a period, and one with an inverted period", () => {
    const { period: _p, ...withoutPeriod } = maintenanceNeedFixture;
    expect(() => applyAdminBatch(adminBaselineSnapshot, command([
      save(withoutPeriod as unknown as MaintenanceDocument),
    ]))).toThrowError(DomainValidationError);
    expect(() => applyAdminBatch(adminBaselineSnapshot, command([
      save({ ...maintenanceNeedFixture, period: { startYear: 2030, endYear: 2026 } }),
    ]))).toThrowError(DomainValidationError);
  });

  it("rejects a row missing its required text, but not one missing its optional timing", () => {
    expect(() => applyAdminBatch(adminBaselineSnapshot, command([
      save({ ...technicalLifespanFixture, rows: [{ item: "Viemärit", interval: " " }] }),
    ]))).toThrowError(DomainValidationError);
    expect(() => applyAdminBatch(adminBaselineSnapshot, command([
      save({ ...completedWorksFixture, rows: [{ year: 2025.5, description: "x" }] }),
    ]))).toThrowError(DomainValidationError);
    expect(() => applyAdminBatch(adminBaselineSnapshot, command([
      save({ ...maintenanceNeedFixture, rows: [{ measure: "Julkisivut" }] }),
    ]))).not.toThrow();
  });

  it("reaches the admin UI through the dashboard read model", () => {
    // The trap from PR #19: adminDashboard lists its collections one by one,
    // and a missing line leaves the new one undefined without a warning.
    const next = applyAdminBatch(adminBaselineSnapshot, command([save(technicalLifespanFixture)]));
    const model = buildAdminDashboardReadModel(next, undefined, { startYear: 2026, endYear: 2040 });

    expect(model.maintenanceDocuments).toEqual([technicalLifespanFixture]);
  });

  it("never reaches a publication: no fingerprint change, no published field", () => {
    const next = applyAdminBatch(adminBaselineSnapshot, command([
      save(completedWorksFixture),
      save(maintenanceNeedFixture),
      save(technicalLifespanFixture),
    ]));

    expect(fingerprintAdminPublishableContent(next))
      .toBe(fingerprintAdminPublishableContent(adminBaselineSnapshot));

    const published = createPublishedDataSnapshot(next, {
      companyId: next.companyId,
      expectedAdminRevision: next.revision,
      expectedPublishedVersion: 0,
      publishedAt: NOW,
      publishedBy: "admin:test",
      sourceIds: ["julkaisu"],
      explanation: "Julkaisu",
    });
    expect(published).not.toHaveProperty("maintenanceDocuments");
    expect(JSON.stringify(published)).not.toContain("Vesikatto, tiili");
  });
});
