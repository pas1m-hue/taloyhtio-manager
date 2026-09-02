import { describe, expect, it } from "vitest";
import { applyAdminBatch, createAdminDataSnapshot } from "../src/admin/applyAdminBatch.js";
import {
  buildAccountCostsViewModel,
  buildAssetListViewModel,
  buildBalanceSheetImportOperation,
  buildBalanceSheetViewModel,
  computeBalanceReconciliation,
  computeBalanceRatios,
  buildBalanceComparisonViewModel,
  buildBudgetVsActualViewModel,
  buildCostEvidenceListViewModel,
  buildDeletionOperations,
  buildEventListViewModel,
  buildExpenseGroupViewModel,
  buildFinancialImportOperations,
  buildGroupBudgetId,
  buildGroupBudgetImportOperations,
  buildGroupBudgetVsActualViewModel,
  buildIncomeViewModel,
  buildObservationListViewModel,
  buildSaveAssetOperation,
  buildSaveBalanceSheetSnapshotOperation,
  buildSaveBuildingEventOperation,
  buildSaveCostEvidenceOperation,
  buildSaveFinancialAccountOperation,
  buildSaveFinancialEntryOperation,
  buildSaveHousingCompanyOperation,
  buildSaveObservationOperation,
  buildSavePriceLevelConfirmationOperation,
  canSubmitAdminOperation,
  copyScheduleRowToAllScenarios,
  countActiveAssets,
  countObservationsWithoutEvent,
  deriveComparableYears,
  deriveDataGapAssets,
  deriveEventYearOptions,
  groupScheduleByScenario,
  deriveComparableGroupBudgetYears,
  interpretRevisionConflict,
  isCostEvidenceExpired,
  parseBalanceSheetPasteInput,
  parseFinancialPasteInput,
  parseGroupBudgetPasteInput,
  parseSourceIds,
  detectBalanceImportValueDrops,
  detectFinancialImportValueDrops,
  listDataImports,
  planEntityDeletion,
  planImportDeletion,
  PROJECTION_PRICE_LEVEL_YEAR,
  selectFinancialYearViewModel,
  summarizeDeletionPlan,
  formatDeletionSources,
  formatDeletionTarget,
  validateAssetInput,
  validateBalanceSheetSnapshotInput,
  validateBuildingEventInput,
  validateCompanyInput,
  validateCostEvidenceInput,
  validateDeletionMeta,
  validateFinancialAccountInput,
  validateFinancialEntryInput,
  validateObservationInput,
  validatePriceLevelConfirmationInput,
} from "./adminOperationPayloads.js";

const ASSETS = [
  { id: "asset_roof", name: "Vesikatto" },
  { id: "asset_yard", name: "Piha-alue" },
];

const EVENTS = [{ id: "event_roof_repair" }];

const COST_EVIDENCE_ROWS = [
  { id: "quote_roof_2026", status: "quote" },
  { id: "gap_roof", status: "data_gap" },
];

const OBSERVATIONS = [
  { id: "observation_roof_leak", assetId: "asset_roof" },
  { id: "observation_yard_crack", assetId: "asset_yard" },
];

describe("buildSaveHousingCompanyOperation", () => {
  const validRaw = {
    id: "housing_company_demo",
    name: "Testiyhtiö",
    apartmentCount: "12",
    chargeableAreaM2: "1245",
    bufferMonths: "3.5",
    userOverride: "",
    sourceIds: "board_2026",
    explanation: "Hallitus tarkisti perustiedot.",
  };

  it("builds a save_housing_company operation with metadata", () => {
    const result = buildSaveHousingCompanyOperation(validRaw);
    expect(result).toEqual({
      ok: true,
      operation: {
        type: "save_housing_company",
        value: {
          id: "housing_company_demo",
          name: "Testiyhtiö",
          apartmentCount: 12,
          chargeableAreaM2: 1245,
          operatingBuffer: { bufferMonths: 3.5 },
        },
        sourceIds: ["board_2026"],
        explanation: "Hallitus tarkisti perustiedot.",
      },
    });
  });

  it("omits optional fields when left blank", () => {
    const result = buildSaveHousingCompanyOperation({
      ...validRaw,
      chargeableAreaM2: "",
      bufferMonths: "",
      userOverride: "",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operation.value).toEqual({
      id: "housing_company_demo",
      name: "Testiyhtiö",
      apartmentCount: 12,
    });
  });

  it("includes the euro override when provided (and allows zero)", () => {
    const result = buildSaveHousingCompanyOperation({
      ...validRaw,
      userOverride: "0",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operation.value.operatingBuffer).toEqual({
      bufferMonths: 3.5,
      userOverride: 0,
    });
  });

  it("requires operation sourceIds and explanation (not hardcoded)", () => {
    const result = buildSaveHousingCompanyOperation({
      ...validRaw,
      sourceIds: "",
      explanation: "   ",
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        sourceIds: expect.any(String),
        explanation: expect.any(String),
      },
    });
  });
});

describe("validateCompanyInput apartment count", () => {
  const base = { id: "c", name: "Nimi" };

  it.each(["0", "-1", "2.5", "", "abc"])(
    "rejects invalid apartmentCount %j",
    (apartmentCount) => {
      const result = validateCompanyInput({ ...base, apartmentCount });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.apartmentCount).toBeTruthy();
    },
  );

  it("accepts a positive integer", () => {
    const result = validateCompanyInput({ ...base, apartmentCount: "13" });
    expect(result.ok).toBe(true);
  });
});

describe("buildSaveAssetOperation", () => {
  const validRaw = {
    id: "asset_roof",
    name: "Vesikatto",
    category: "envelope",
    active: true,
    sourceIds: "initial_excel, inspection_2026",
    operationSourceIds: "inspection_2026",
    explanation: "Lisätään vesikatto rekisteriin.",
  };

  it("builds a save_asset operation (add) with distinct entity/operation sources", () => {
    const result = buildSaveAssetOperation(validRaw);
    expect(result).toEqual({
      ok: true,
      operation: {
        type: "save_asset",
        value: {
          id: "asset_roof",
          name: "Vesikatto",
          category: "envelope",
          sourceIds: ["initial_excel", "inspection_2026"],
          active: true,
        },
        sourceIds: ["inspection_2026"],
        explanation: "Lisätään vesikatto rekisteriin.",
      },
    });
  });

  it("builds an edit operation toggling active to false", () => {
    const result = buildSaveAssetOperation({ ...validRaw, active: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operation.value.active).toBe(false);
  });

  it("rejects an unknown category", () => {
    const result = buildSaveAssetOperation({ ...validRaw, category: "roofing" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.category).toBeTruthy();
  });

  it("reports entity and operation source errors under separate keys", () => {
    const result = buildSaveAssetOperation({
      ...validRaw,
      sourceIds: "",
      operationSourceIds: "",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.sourceIds).toBeTruthy();
    expect(result.errors.operationSourceIds).toBeTruthy();
  });

  it("requires a boolean active flag", () => {
    const { active, ...withoutActive } = validRaw;
    const result = validateAssetInput(withoutActive);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.active).toBeTruthy();
  });
});

describe("parseSourceIds", () => {
  it("splits comma and newline separated strings", () => {
    expect(parseSourceIds("a, b\nc,,")).toEqual(["a", "b", "c"]);
  });
  it("trims and filters arrays", () => {
    expect(parseSourceIds([" a ", "", "b"])).toEqual(["a", "b"]);
  });
  it("returns an empty array for nullish input", () => {
    expect(parseSourceIds(undefined)).toEqual([]);
  });
});

describe("deriveDataGapAssets", () => {
  it("counts unique assetIds among data_gap evidence", () => {
    const result = deriveDataGapAssets([
      { status: "data_gap", assetId: "a" },
      { status: "data_gap", assetId: "a" },
      { status: "data_gap", assetId: "b" },
      { status: "estimate", assetId: "c" },
      { status: "data_gap" },
    ]);
    expect(result).toEqual({ assetIds: ["a", "b"], count: 2 });
  });

  it("handles missing input", () => {
    expect(deriveDataGapAssets()).toEqual({ assetIds: [], count: 0 });
  });
});

describe("buildAssetListViewModel", () => {
  it("marks an empty list with an empty-state message and no rows", () => {
    const model = buildAssetListViewModel([]);
    expect(model.isEmpty).toBe(true);
    expect(model.rows).toEqual([]);
    expect(model.emptyMessage).toBeTruthy();
  });

  it("maps rows for a non-empty list", () => {
    const model = buildAssetListViewModel([
      { id: "a", name: "Katto", category: "envelope", active: true, sourceIds: ["x"] },
    ]);
    expect(model.isEmpty).toBe(false);
    expect(model.rows).toEqual([
      { id: "a", name: "Katto", category: "envelope", active: true, sourceIds: ["x"] },
    ]);
  });
});

describe("selectFinancialYearViewModel", () => {
  const years = [
    { year: 2024, budgetIncome: 100, actualIncome: 90 },
    { year: 2025, budgetCosts: 50, actualCosts: 55 },
  ];

  it("returns no data when there are no financial years", () => {
    expect(selectFinancialYearViewModel([])).toEqual({
      hasData: false,
      availableYears: [],
      selectedYear: null,
      figures: null,
    });
  });

  it("defaults to the newest year and lists options descending", () => {
    const model = selectFinancialYearViewModel(years);
    expect(model.availableYears).toEqual([2025, 2024]);
    expect(model.selectedYear).toBe(2025);
    expect(model.figures).toEqual({ budgetCosts: 50, actualCosts: 55 });
  });

  it("selects the requested year's figures", () => {
    const model = selectFinancialYearViewModel(years, 2024);
    expect(model.selectedYear).toBe(2024);
    expect(model.figures).toEqual({ budgetIncome: 100, actualIncome: 90 });
  });
});

describe("interpretRevisionConflict", () => {
  it("recognises a 409 admin revision conflict", () => {
    const result = interpretRevisionConflict({ code: "ADMIN_REVISION_CONFLICT" });
    expect(result.isConflict).toBe(true);
    expect(result.message).toMatch(/lataa työtila uudelleen/i);
  });

  it("passes through other errors", () => {
    const result = interpretRevisionConflict({ code: "OTHER", message: "Boom" });
    expect(result).toEqual({ isConflict: false, message: "Boom" });
  });
});

describe("canSubmitAdminOperation", () => {
  it("is false without a token", () => {
    expect(canSubmitAdminOperation(null)).toBe(false);
    expect(canSubmitAdminOperation({})).toBe(false);
    expect(canSubmitAdminOperation({ access_token: "   " })).toBe(false);
  });

  it("is true with a token", () => {
    expect(canSubmitAdminOperation({ access_token: "abc" })).toBe(true);
  });
});

describe("countActiveAssets", () => {
  it("counts only active assets", () => {
    expect(
      countActiveAssets([{ active: true }, { active: false }, { active: true }]),
    ).toBe(2);
  });
});

describe("buildSaveObservationOperation", () => {
  const validRaw = {
    id: "obs_roof_1",
    assetId: "asset_roof",
    observedAt: "2026-03-01",
    description: "Katteessa havaittu kulumaa räystäällä.",
    sourceIds: "inspection_2026",
    operationSourceIds: "inspection_2026",
    explanation: "Kirjattiin tarkastuksen havainto.",
  };

  it("builds a save_observation operation with entity/operation sources", () => {
    const result = buildSaveObservationOperation(validRaw, ASSETS);
    expect(result).toEqual({
      ok: true,
      operation: {
        type: "save_observation",
        value: {
          id: "obs_roof_1",
          assetId: "asset_roof",
          observedAt: "2026-03-01",
          description: "Katteessa havaittu kulumaa räystäällä.",
          sourceIds: ["inspection_2026"],
        },
        sourceIds: ["inspection_2026"],
        explanation: "Kirjattiin tarkastuksen havainto.",
      },
    });
  });

  it("rejects a missing assetId", () => {
    const result = buildSaveObservationOperation({ ...validRaw, assetId: "" }, ASSETS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.assetId).toBeTruthy();
  });

  it("rejects an assetId that does not refer to a known asset", () => {
    const result = buildSaveObservationOperation({ ...validRaw, assetId: "asset_unknown" }, ASSETS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.assetId).toBeTruthy();
  });

  it("rejects an empty description", () => {
    const result = buildSaveObservationOperation({ ...validRaw, description: "   " }, ASSETS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.description).toBeTruthy();
  });

  it("rejects an invalid observedAt date", () => {
    const result = buildSaveObservationOperation({ ...validRaw, observedAt: "not-a-date" }, ASSETS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.observedAt).toBeTruthy();
  });

  it("reports entity and operation source errors under separate keys", () => {
    const result = buildSaveObservationOperation(
      { ...validRaw, sourceIds: "", operationSourceIds: "" },
      ASSETS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.sourceIds).toBeTruthy();
    expect(result.errors.operationSourceIds).toBeTruthy();
  });
});

describe("buildSaveCostEvidenceOperation", () => {
  const quoteRaw = {
    id: "quote_roof_2026",
    assetId: "asset_roof",
    status: "quote",
    amount: "12500",
    unit: "erä",
    quantity: "1",
    priceLevelYear: "2026",
    vatIncluded: "true",
    observedAt: "2026-02-01",
    validUntil: "2026-12-31",
    sourceUrl: "https://example.test/quote.pdf",
    notes: "Kattourakoitsijan tarjous.",
    operationSourceIds: "quote_2026",
    explanation: "Lisättiin kattourakoitsijan tarjous.",
  };

  it("builds a save_cost_evidence operation for a quote", () => {
    const result = buildSaveCostEvidenceOperation(quoteRaw, ASSETS, EVENTS);
    expect(result).toEqual({
      ok: true,
      operation: {
        type: "save_cost_evidence",
        value: {
          id: "quote_roof_2026",
          assetId: "asset_roof",
          status: "quote",
          unit: "erä",
          priceLevelYear: 2026,
          amount: 12500,
          quantity: 1,
          vatIncluded: true,
          observedAt: "2026-02-01",
          validUntil: "2026-12-31",
          sourceUrl: "https://example.test/quote.pdf",
          notes: "Kattourakoitsijan tarjous.",
        },
        sourceIds: ["quote_2026"],
        explanation: "Lisättiin kattourakoitsijan tarjous.",
      },
    });
  });

  it("carries an existing eventId through unmodified", () => {
    const result = buildSaveCostEvidenceOperation(
      { ...quoteRaw, eventId: "event_roof_repair" },
      ASSETS,
      EVENTS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operation.value.eventId).toBe("event_roof_repair");
  });

  it("rejects an eventId that does not refer to a known event", () => {
    const result = buildSaveCostEvidenceOperation(
      { ...quoteRaw, eventId: "event_unknown" },
      ASSETS,
      EVENTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.eventId).toBeTruthy();
  });

  it("rejects an unknown status", () => {
    const result = buildSaveCostEvidenceOperation({ ...quoteRaw, status: "guess" }, ASSETS, EVENTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.status).toBeTruthy();
  });

  it("rejects a negative amount", () => {
    const result = buildSaveCostEvidenceOperation({ ...quoteRaw, amount: "-1" }, ASSETS, EVENTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.amount).toBeTruthy();
  });

  it("rejects a non-integer quantity", () => {
    const result = buildSaveCostEvidenceOperation({ ...quoteRaw, quantity: "1.5" }, ASSETS, EVENTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.quantity).toBeTruthy();
  });

  it("rejects a non-integer priceLevelYear", () => {
    const result = buildSaveCostEvidenceOperation({ ...quoteRaw, priceLevelYear: "2026.5" }, ASSETS, EVENTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.priceLevelYear).toBeTruthy();
  });

  it("requires either sourceId or sourceUrl", () => {
    const { sourceUrl, ...withoutSource } = quoteRaw;
    const result = buildSaveCostEvidenceOperation(withoutSource, ASSETS, EVENTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.sourceId).toBeTruthy();
    expect(result.errors.sourceUrl).toBeTruthy();
  });

  it("accepts a sourceId in place of a sourceUrl", () => {
    const { sourceUrl, ...withoutUrl } = quoteRaw;
    const result = buildSaveCostEvidenceOperation(
      { ...withoutUrl, sourceId: "quote_doc_1" },
      ASSETS,
      EVENTS,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an invalid validUntil date", () => {
    const result = buildSaveCostEvidenceOperation({ ...quoteRaw, validUntil: "not-a-date" }, ASSETS, EVENTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.validUntil).toBeTruthy();
  });

  describe("DATA GAP rule (L-004)", () => {
    const dataGapRaw = {
      id: "gap_roof",
      assetId: "asset_roof",
      status: "data_gap",
      unit: "erä",
      priceLevelYear: "2026",
      sourceId: "inspection_2026",
      operationSourceIds: "inspection_2026",
      explanation: "Merkittiin tuntematon kustannus DATA GAPiksi.",
    };

    it("rejects a data_gap row that carries an amount", () => {
      const result = buildSaveCostEvidenceOperation({ ...dataGapRaw, amount: "0" }, ASSETS, EVENTS);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.amount).toBeTruthy();
    });

    it("accepts a data_gap row without an amount", () => {
      const result = buildSaveCostEvidenceOperation(dataGapRaw, ASSETS, EVENTS);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.operation.value.amount).toBeUndefined();
      expect(result.operation.value.status).toBe("data_gap");
    });
  });
});

describe("buildSaveBuildingEventOperation", () => {
  const suggestedRaw = {
    id: "event_roof_repair",
    assetId: "asset_roof",
    title: "Vesikaton uusiminen",
    type: "replacement",
    status: "suggested",
    origin: "manual",
    sourceIds: "board_2026",
    notes: "Karkea arvio, tarkennettava.",
    schedule: [
      {
        id: "row_base_2030",
        scenario: "base",
        year: "2030",
        amount: "18000",
        quantity: "1",
        costEvidenceId: "quote_roof_2026",
      },
    ],
    operationSourceIds: "board_2026",
    explanation: "Hallitus hyväksyi suunnitelman.",
  };

  it("builds a save_building_event operation for a suggested future event", () => {
    const result = buildSaveBuildingEventOperation(suggestedRaw, ASSETS, COST_EVIDENCE_ROWS, OBSERVATIONS);
    expect(result).toEqual({
      ok: true,
      operation: {
        type: "save_building_event",
        value: {
          id: "event_roof_repair",
          assetId: "asset_roof",
          title: "Vesikaton uusiminen",
          type: "replacement",
          origin: "manual",
          sourceIds: ["board_2026"],
          notes: "Karkea arvio, tarkennettava.",
          status: "suggested",
          schedule: [
            {
              id: "row_base_2030",
              scenario: "base",
              year: 2030,
              amount: 18000,
              quantity: 1,
              costEvidenceId: "quote_roof_2026",
            },
          ],
        },
        sourceIds: ["board_2026"],
        explanation: "Hallitus hyväksyi suunnitelman.",
      },
    });
  });

  it("rejects a future event (suggested/approved) with no schedule rows", () => {
    const result = buildSaveBuildingEventOperation(
      { ...suggestedRaw, schedule: [] },
      ASSETS,
      COST_EVIDENCE_ROWS,
      OBSERVATIONS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.schedule).toBeTruthy();
  });

  it("accepts an approved event the same way as suggested", () => {
    const result = buildSaveBuildingEventOperation(
      { ...suggestedRaw, status: "approved" },
      ASSETS,
      COST_EVIDENCE_ROWS,
      OBSERVATIONS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operation.value.status).toBe("approved");
  });

  it("accepts a cancelled event without any schedule rows", () => {
    const result = buildSaveBuildingEventOperation(
      { ...suggestedRaw, status: "cancelled", schedule: [] },
      ASSETS,
      COST_EVIDENCE_ROWS,
      OBSERVATIONS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operation.value.status).toBe("cancelled");
    expect(result.operation.value.schedule).toBeUndefined();
  });

  it("accepts a cancelled event that still carries schedule rows", () => {
    const result = buildSaveBuildingEventOperation(
      { ...suggestedRaw, status: "cancelled" },
      ASSETS,
      COST_EVIDENCE_ROWS,
      OBSERVATIONS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operation.value.schedule).toHaveLength(1);
  });

  describe("schedule row rules", () => {
    it("rejects an invalid scenario", () => {
      const result = buildSaveBuildingEventOperation(
        { ...suggestedRaw, schedule: [{ ...suggestedRaw.schedule[0], scenario: "guess" }] },
        ASSETS, COST_EVIDENCE_ROWS, OBSERVATIONS,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors["schedule.0.scenario"]).toBeTruthy();
    });

    it("rejects a non-integer year", () => {
      const result = buildSaveBuildingEventOperation(
        { ...suggestedRaw, schedule: [{ ...suggestedRaw.schedule[0], year: "2030.5" }] },
        ASSETS, COST_EVIDENCE_ROWS, OBSERVATIONS,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors["schedule.0.year"]).toBeTruthy();
    });

    it("rejects a missing costEvidenceId", () => {
      const result = buildSaveBuildingEventOperation(
        { ...suggestedRaw, schedule: [{ ...suggestedRaw.schedule[0], costEvidenceId: "" }] },
        ASSETS, COST_EVIDENCE_ROWS, OBSERVATIONS,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors["schedule.0.costEvidenceId"]).toBeTruthy();
    });

    it("rejects a duplicate row id", () => {
      const row = suggestedRaw.schedule[0];
      const result = buildSaveBuildingEventOperation(
        { ...suggestedRaw, schedule: [row, { ...row, scenario: "stress" }] },
        ASSETS, COST_EVIDENCE_ROWS, OBSERVATIONS,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors["schedule.1.id"]).toBeTruthy();
    });

    it("rejects a negative amount", () => {
      const result = buildSaveBuildingEventOperation(
        { ...suggestedRaw, schedule: [{ ...suggestedRaw.schedule[0], amount: "-1" }] },
        ASSETS, COST_EVIDENCE_ROWS, OBSERVATIONS,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors["schedule.0.amount"]).toBeTruthy();
    });

    it("rejects a non-integer quantity", () => {
      const result = buildSaveBuildingEventOperation(
        { ...suggestedRaw, schedule: [{ ...suggestedRaw.schedule[0], quantity: "1.5" }] },
        ASSETS, COST_EVIDENCE_ROWS, OBSERVATIONS,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors["schedule.0.quantity"]).toBeTruthy();
    });
  });

  describe("actual event", () => {
    const actualRaw = {
      id: "event_roof_repair_done",
      assetId: "asset_roof",
      title: "Vesikaton uusiminen",
      type: "replacement",
      status: "actual",
      origin: "manual",
      sourceIds: "board_2026",
      actualYear: "2027",
      actualCostEvidenceId: "quote_roof_2026",
      actualOccurredAt: "2027-06-15",
      actualAmount: "17500",
      actualQuantity: "1",
      operationSourceIds: "board_2026",
      explanation: "Kirjattiin toteutunut korjaus.",
    };

    it("builds a save_building_event operation for an actual event", () => {
      const result = buildSaveBuildingEventOperation(actualRaw, ASSETS, COST_EVIDENCE_ROWS, OBSERVATIONS);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.operation.value.actual).toEqual({
        year: 2027,
        occurredAt: "2027-06-15",
        amount: 17500,
        quantity: 1,
        costEvidenceId: "quote_roof_2026",
      });
      expect(result.operation.value.schedule).toBeUndefined();
    });

    it("rejects an actual event with no costEvidenceId", () => {
      const result = buildSaveBuildingEventOperation(
        { ...actualRaw, actualCostEvidenceId: "" },
        ASSETS, COST_EVIDENCE_ROWS, OBSERVATIONS,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.actualCostEvidenceId).toBeTruthy();
    });

    it("rejects an actual event with a non-integer year", () => {
      const result = buildSaveBuildingEventOperation(
        { ...actualRaw, actualYear: "2027.5" },
        ASSETS, COST_EVIDENCE_ROWS, OBSERVATIONS,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.actualYear).toBeTruthy();
    });
  });

  it("keeps entity sourceIds and operation sourceIds distinct", () => {
    const result = buildSaveBuildingEventOperation(
      { ...suggestedRaw, sourceIds: "entity_src", operationSourceIds: "" },
      ASSETS, COST_EVIDENCE_ROWS, OBSERVATIONS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.operationSourceIds).toBeTruthy();
    expect(result.errors.sourceIds).toBeUndefined();
  });

  it("rejects observationIds that reference an observation on a different asset", () => {
    const result = buildSaveBuildingEventOperation(
      { ...suggestedRaw, observationIds: "observation_yard_crack" },
      ASSETS, COST_EVIDENCE_ROWS, OBSERVATIONS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.observationIds).toBeTruthy();
  });

  it("accepts observationIds that reference an observation on the same asset", () => {
    const result = buildSaveBuildingEventOperation(
      { ...suggestedRaw, observationIds: "observation_roof_leak" },
      ASSETS, COST_EVIDENCE_ROWS, OBSERVATIONS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operation.value.observationIds).toEqual(["observation_roof_leak"]);
  });

  it("rejects duplicate observationIds", () => {
    const result = buildSaveBuildingEventOperation(
      { ...suggestedRaw, observationIds: ["observation_roof_leak", "observation_roof_leak"] },
      ASSETS, COST_EVIDENCE_ROWS, OBSERVATIONS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.observationIds).toBeTruthy();
  });
});

describe("copyScheduleRowToAllScenarios", () => {
  const row = {
    id: "row_base_2030",
    year: 2030,
    amount: 18000,
    quantity: 1,
    costEvidenceId: "quote_roof_2026",
    explanation: "Karkea arvio.",
  };

  it("produces three rows, one per scenario, with unique ids and otherwise identical fields", () => {
    const rows = copyScheduleRowToAllScenarios(row, []);
    expect(rows).toHaveLength(3);
    expect(rows.map((item) => item.scenario)).toEqual(["optimistic", "base", "stress"]);
    const ids = rows.map((item) => item.id);
    expect(new Set(ids).size).toBe(3);
    for (const copy of rows) {
      expect(copy.year).toBe(row.year);
      expect(copy.amount).toBe(row.amount);
      expect(copy.quantity).toBe(row.quantity);
      expect(copy.costEvidenceId).toBe(row.costEvidenceId);
      expect(copy.explanation).toBe(row.explanation);
    }
  });

  it("avoids id collisions with rows already in the event", () => {
    const rows = copyScheduleRowToAllScenarios(row, [{ id: "row_base_2030_base" }]);
    const ids = rows.map((item) => item.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain("row_base_2030_base");
  });

  it("never infers or changes numeric fields, only clones the input row", () => {
    const zeroRow = { ...row, amount: 0, quantity: undefined };
    const rows = copyScheduleRowToAllScenarios(zeroRow, []);
    for (const copy of rows) {
      expect(copy.amount).toBe(0);
      expect(copy.quantity).toBeUndefined();
    }
  });
});

describe("buildEventListViewModel", () => {
  const events = [
    {
      id: "event_roof_repair",
      assetId: "asset_roof",
      title: "Vesikaton uusiminen",
      type: "replacement",
      status: "suggested",
      schedule: [
        { scenario: "base", year: 2030, costEvidenceId: "quote_roof_2026" },
        { scenario: "stress", year: 2028, costEvidenceId: "gap_roof" },
      ],
    },
    {
      id: "event_yard_inspection",
      assetId: "asset_yard",
      title: "Pihan tarkastus",
      type: "inspection",
      status: "actual",
      actual: { year: 2026, costEvidenceId: "quote_roof_2026" },
    },
  ];

  it("builds rows with asset names, year ranges and DATA GAP flags", () => {
    const vm = buildEventListViewModel(events, ASSETS, COST_EVIDENCE_ROWS);
    expect(vm.isEmpty).toBe(false);
    const roofRow = vm.rows.find((row) => row.id === "event_roof_repair");
    expect(roofRow.assetName).toBe("Vesikatto");
    expect(roofRow.yearRange).toBe("2028–2030");
    expect(roofRow.hasDataGap).toBe(true);
    const yardRow = vm.rows.find((row) => row.id === "event_yard_inspection");
    expect(yardRow.yearRange).toBe("2026");
    expect(yardRow.hasDataGap).toBe(false);
  });

  it("filters by status, type, asset, year and gap-only", () => {
    expect(buildEventListViewModel(events, ASSETS, COST_EVIDENCE_ROWS, { status: "actual" }).rows).toHaveLength(1);
    expect(buildEventListViewModel(events, ASSETS, COST_EVIDENCE_ROWS, { type: "inspection" }).rows).toHaveLength(1);
    expect(buildEventListViewModel(events, ASSETS, COST_EVIDENCE_ROWS, { assetId: "asset_yard" }).rows).toHaveLength(1);
    expect(buildEventListViewModel(events, ASSETS, COST_EVIDENCE_ROWS, { year: 2028 }).rows).toHaveLength(1);
    expect(buildEventListViewModel(events, ASSETS, COST_EVIDENCE_ROWS, { gapOnly: true }).rows).toHaveLength(1);
  });

  it("reports an empty state with a message when there are no events", () => {
    const vm = buildEventListViewModel([], ASSETS, COST_EVIDENCE_ROWS);
    expect(vm.isEmpty).toBe(true);
    expect(vm.emptyMessage).toBeTruthy();
  });
});

describe("deriveEventYearOptions", () => {
  it("collects unique sorted years from schedule rows and actual entries", () => {
    const events = [
      { status: "suggested", schedule: [{ year: 2030 }, { year: 2028 }] },
      { status: "actual", actual: { year: 2026 } },
      { status: "suggested", schedule: [{ year: 2028 }] },
    ];
    expect(deriveEventYearOptions(events)).toEqual([2026, 2028, 2030]);
  });
});

describe("groupScheduleByScenario", () => {
  it("groups rows into their scenario buckets", () => {
    const schedule = [
      { id: "a", scenario: "base" },
      { id: "b", scenario: "stress" },
      { id: "c", scenario: "base" },
    ];
    const groups = groupScheduleByScenario(schedule);
    expect(groups.base.map((row) => row.id)).toEqual(["a", "c"]);
    expect(groups.stress.map((row) => row.id)).toEqual(["b"]);
    expect(groups.optimistic).toEqual([]);
  });
});

describe("validateBuildingEventInput", () => {
  it("is used directly by buildSaveBuildingEventOperation's error mapping (exported for form-level checks)", () => {
    const result = validateBuildingEventInput(
      { id: "", assetId: "", title: "", type: "", status: "", origin: "" },
      ASSETS, COST_EVIDENCE_ROWS, OBSERVATIONS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors)).toEqual(
      expect.arrayContaining(["id", "assetId", "title", "type", "status", "origin", "sourceIds"]),
    );
  });
});

describe("buildSavePriceLevelConfirmationOperation", () => {
  const costEvidence = [{ id: "quote_roof_2026" }];
  const validRaw = {
    costEvidenceId: "quote_roof_2026",
    confirmedAt: "2026-03-05",
    confirmedBy: "admin:board",
    operationSourceIds: "board_minutes_2026",
    explanation: "Hallitus vahvisti hintatason 2026.",
  };

  it("builds a save_price_level_confirmation operation with a fixed targetYear", () => {
    const result = buildSavePriceLevelConfirmationOperation(validRaw, costEvidence);
    expect(result).toEqual({
      ok: true,
      operation: {
        type: "save_price_level_confirmation",
        value: {
          costEvidenceId: "quote_roof_2026",
          targetYear: PROJECTION_PRICE_LEVEL_YEAR,
          confirmedAt: "2026-03-05",
          confirmedBy: "admin:board",
        },
        sourceIds: ["board_minutes_2026"],
        explanation: "Hallitus vahvisti hintatason 2026.",
      },
    });
  });

  it("rejects a costEvidenceId that does not exist", () => {
    const result = buildSavePriceLevelConfirmationOperation(
      { ...validRaw, costEvidenceId: "unknown" },
      costEvidence,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.costEvidenceId).toBeTruthy();
  });

  it("rejects a missing confirmedBy", () => {
    const result = buildSavePriceLevelConfirmationOperation({ ...validRaw, confirmedBy: "" }, costEvidence);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.confirmedBy).toBeTruthy();
  });
});

describe("buildObservationListViewModel", () => {
  it("marks an empty list with its own empty-state message", () => {
    const model = buildObservationListViewModel([], ASSETS);
    expect(model.isEmpty).toBe(true);
    expect(model.rows).toEqual([]);
    expect(model.emptyMessage).toMatch(/havaint/i);
  });

  it("resolves the asset name for each row", () => {
    const model = buildObservationListViewModel(
      [{ id: "o1", assetId: "asset_roof", observedAt: "2026-03-01", description: "Kulumaa.", sourceIds: ["x"] }],
      ASSETS,
    );
    expect(model.isEmpty).toBe(false);
    expect(model.rows[0].assetName).toBe("Vesikatto");
  });
});

describe("countObservationsWithoutEvent", () => {
  it("counts observations no event references", () => {
    const observations = [{ id: "o1" }, { id: "o2" }, { id: "o3" }];
    const events = [{ observationIds: ["o1"] }];
    expect(countObservationsWithoutEvent(observations, events)).toBe(2);
  });
});

describe("buildCostEvidenceListViewModel", () => {
  it("marks an empty list with its own empty-state message", () => {
    const model = buildCostEvidenceListViewModel([], ASSETS, []);
    expect(model.isEmpty).toBe(true);
    expect(model.emptyMessage).toMatch(/DATA GAP/);
  });

  it("never carries an amount for a DATA GAP row", () => {
    const model = buildCostEvidenceListViewModel(
      [{ id: "gap_1", assetId: "asset_roof", status: "data_gap", unit: "erä", priceLevelYear: 2026 }],
      ASSETS,
      [],
    );
    expect(model.rows[0].isDataGap).toBe(true);
    expect(model.rows[0].amount).toBeUndefined();
  });

  it("flags a row confirmed to the projection price level", () => {
    const model = buildCostEvidenceListViewModel(
      [{ id: "quote_1", assetId: "asset_roof", status: "quote", unit: "erä", priceLevelYear: 2024, amount: 1000 }],
      ASSETS,
      [{ costEvidenceId: "quote_1", targetYear: PROJECTION_PRICE_LEVEL_YEAR }],
    );
    expect(model.rows[0].needsPriceLevelConfirmation).toBe(true);
    expect(model.rows[0].hasPriceLevelConfirmation).toBe(true);
  });

  it("does not require confirmation when already at the projection price level", () => {
    const model = buildCostEvidenceListViewModel(
      [{ id: "quote_1", assetId: "asset_roof", status: "quote", unit: "erä", priceLevelYear: PROJECTION_PRICE_LEVEL_YEAR, amount: 1000 }],
      ASSETS,
      [],
    );
    expect(model.rows[0].needsPriceLevelConfirmation).toBe(false);
  });
});

describe("isCostEvidenceExpired", () => {
  it("is false without a validUntil", () => {
    expect(isCostEvidenceExpired({}, "2026-06-01")).toBe(false);
  });

  it("is true once validUntil has passed", () => {
    expect(isCostEvidenceExpired({ validUntil: "2026-01-01" }, "2026-06-01")).toBe(true);
  });

  it("is false while validUntil is still ahead", () => {
    expect(isCostEvidenceExpired({ validUntil: "2027-01-01" }, "2026-06-01")).toBe(false);
  });
});

describe("validateObservationInput / validateCostEvidenceInput / validatePriceLevelConfirmationInput", () => {
  it("expose the same field errors as their build* counterparts", () => {
    expect(validateObservationInput({}, ASSETS).ok).toBe(false);
    expect(validateCostEvidenceInput({}, ASSETS, EVENTS).ok).toBe(false);
    expect(validatePriceLevelConfirmationInput({}, []).ok).toBe(false);
  });
});

const FINANCIAL_ACCOUNTS = [
  { accountCode: "5300", name: "Isännöintipalkkiot", kind: "expense", group: "HALLINTOPALVELUT" },
  { accountCode: "3000", name: "Hoitovastikkeet", kind: "income", group: "VASTIKETULOT" },
];

describe("validateFinancialAccountInput / buildSaveFinancialAccountOperation", () => {
  const validRaw = {
    accountCode: "5300",
    name: "Isännöintipalkkiot",
    kind: "expense",
    group: "HALLINTOPALVELUT",
    active: true,
    sourceIds: "initial_excel",
    explanation: "Tuonti Excelistä.",
  };

  it("accepts a valid minimal account", () => {
    const result = validateFinancialAccountInput(validRaw);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      accountCode: "5300",
      name: "Isännöintipalkkiot",
      kind: "expense",
      group: "HALLINTOPALVELUT",
      active: true,
    });
  });

  it("includes nature and controllability only when provided", () => {
    const result = validateFinancialAccountInput({
      ...validRaw,
      nature: "maintenance",
      controllability: "fixed",
    });
    expect(result.ok).toBe(true);
    expect(result.value.nature).toBe("maintenance");
    expect(result.value.controllability).toBe("fixed");
  });

  it("rejects a missing accountCode, name, or group", () => {
    expect(validateFinancialAccountInput({ ...validRaw, accountCode: "" }).ok).toBe(false);
    expect(validateFinancialAccountInput({ ...validRaw, name: "" }).ok).toBe(false);
    expect(validateFinancialAccountInput({ ...validRaw, group: "" }).ok).toBe(false);
  });

  it("rejects an unknown kind, nature, or controllability", () => {
    expect(validateFinancialAccountInput({ ...validRaw, kind: "expense_and_income" }).ok).toBe(false);
    expect(validateFinancialAccountInput({ ...validRaw, nature: "renovation" }).ok).toBe(false);
    expect(validateFinancialAccountInput({ ...validRaw, controllability: "unknown" }).ok).toBe(false);
  });

  it("rejects a non-boolean active value", () => {
    expect(validateFinancialAccountInput({ ...validRaw, active: undefined }).ok).toBe(false);
  });

  it("builds an operation with account value and operation metadata", () => {
    const result = buildSaveFinancialAccountOperation(validRaw);
    expect(result.ok).toBe(true);
    expect(result.operation).toEqual({
      type: "save_financial_account",
      value: {
        accountCode: "5300",
        name: "Isännöintipalkkiot",
        kind: "expense",
        group: "HALLINTOPALVELUT",
        active: true,
      },
      sourceIds: ["initial_excel"],
      explanation: "Tuonti Excelistä.",
    });
  });

  it("rejects a missing sourceIds or explanation, mirroring housing-company metadata", () => {
    const missingSource = buildSaveFinancialAccountOperation({ ...validRaw, sourceIds: "" });
    expect(missingSource.ok).toBe(false);
    expect(missingSource.errors.sourceIds).toBeDefined();

    const missingExplanation = buildSaveFinancialAccountOperation({ ...validRaw, explanation: "" });
    expect(missingExplanation.ok).toBe(false);
    expect(missingExplanation.errors.explanation).toBeDefined();
  });
});

describe("validateFinancialEntryInput / buildSaveFinancialEntryOperation", () => {
  const validRaw = {
    accountCode: "5300",
    year: "2025",
    budgetAmount: "13000",
    actualAmount: "12800.25",
    sourceIds: "initial_excel",
    explanation: "Tuonti Excelistä.",
  };

  it("accepts a valid entry with both amounts", () => {
    const result = validateFinancialEntryInput(validRaw, FINANCIAL_ACCOUNTS);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      accountCode: "5300",
      year: 2025,
      sourceIds: ["initial_excel"],
      budgetAmount: 13000,
      actualAmount: 12800.25,
    });
  });

  it("accepts an entry with only budgetAmount or only actualAmount", () => {
    expect(validateFinancialEntryInput({ ...validRaw, actualAmount: "" }, FINANCIAL_ACCOUNTS).ok).toBe(true);
    expect(validateFinancialEntryInput({ ...validRaw, budgetAmount: "" }, FINANCIAL_ACCOUNTS).ok).toBe(true);
  });

  it("rejects an entry with neither budgetAmount nor actualAmount", () => {
    const result = validateFinancialEntryInput(
      { ...validRaw, budgetAmount: "", actualAmount: "" },
      FINANCIAL_ACCOUNTS,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.budgetAmount).toBeDefined();
    expect(result.errors.actualAmount).toBeDefined();
  });

  it("rejects an accountCode that does not exist among known accounts", () => {
    const result = validateFinancialEntryInput({ ...validRaw, accountCode: "9999" }, FINANCIAL_ACCOUNTS);
    expect(result.ok).toBe(false);
    expect(result.errors.accountCode).toBeDefined();
  });

  it("rejects a non-integer year", () => {
    expect(validateFinancialEntryInput({ ...validRaw, year: "2025.5" }, FINANCIAL_ACCOUNTS).ok).toBe(false);
  });

  it("rejects an empty sourceIds list", () => {
    const result = validateFinancialEntryInput({ ...validRaw, sourceIds: "" }, FINANCIAL_ACCOUNTS);
    expect(result.ok).toBe(false);
    expect(result.errors.sourceIds).toBeDefined();
  });

  it("builds an operation with the entity/operation sourceIds split", () => {
    const result = buildSaveFinancialEntryOperation(
      { accountCode: "5300", year: "2025", actualAmount: "12000", sourceIds: "row_source", operationSourceIds: "batch_source", explanation: "Tuonti." },
      FINANCIAL_ACCOUNTS,
    );
    expect(result.ok).toBe(true);
    expect(result.operation).toEqual({
      type: "save_financial_entry",
      value: { accountCode: "5300", year: 2025, sourceIds: ["row_source"], actualAmount: 12000 },
      sourceIds: ["batch_source"],
      explanation: "Tuonti.",
    });
  });

  it("reports operation-metadata errors under operationSourceIds, not sourceIds", () => {
    const result = buildSaveFinancialEntryOperation(
      { accountCode: "5300", year: "2025", actualAmount: "12000", sourceIds: "row_source", operationSourceIds: "", explanation: "" },
      FINANCIAL_ACCOUNTS,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.operationSourceIds).toBeDefined();
    expect(result.errors.sourceIds).toBeUndefined();
  });
});

describe("parseFinancialPasteInput", () => {
  function row(kind, group, tili, nimi, vuosi, budjetti, toteuma) {
    return [kind, group, tili, nimi, vuosi, budjetti, toteuma].join("\t");
  }

  it("parses a valid multi-row paste with a header row", () => {
    const text = [
      row("kind", "ryhmä", "tili", "nimi", "vuosi", "budjetti", "toteuma"),
      row("kulu", "HALLINTOPALVELUT", "5300", "Isännöintipalkkiot", "2024", "", "12500,50"),
      row("kulu", "HALLINTOPALVELUT", "5300", "Isännöintipalkkiot", "2025", "13000", "12800.25"),
      row("tulo", "VASTIKETULOT", "3000", "Hoitovastikkeet", "2025", "500000", "495000"),
    ].join("\n");

    const result = parseFinancialPasteInput(text);

    expect(result.errors).toEqual([]);
    expect(result.accounts).toEqual([
      { accountCode: "5300", name: "Isännöintipalkkiot", kind: "expense", group: "HALLINTOPALVELUT", active: true },
      { accountCode: "3000", name: "Hoitovastikkeet", kind: "income", group: "VASTIKETULOT", active: true },
    ]);
    expect(result.entries).toEqual([
      { accountCode: "5300", year: 2024, actualAmount: 12500.5 },
      { accountCode: "5300", year: 2025, budgetAmount: 13000, actualAmount: 12800.25 },
      { accountCode: "3000", year: 2025, budgetAmount: 500000, actualAmount: 495000 },
    ]);
  });

  it("parses correctly without a header row", () => {
    const text = row("kulu", "HALLINTOPALVELUT", "5300", "Isännöintipalkkiot", "2025", "1000", "");
    const result = parseFinancialPasteInput(text);
    expect(result.errors).toEqual([]);
    expect(result.entries).toEqual([{ accountCode: "5300", year: 2025, budgetAmount: 1000 }]);
  });

  it("does not treat a data row that merely starts with 'kind' as a header", () => {
    const text = row("kulu", "ryhmä", "tili", "nimi", "vuosi", "budjetti", "toteuma");
    const result = parseFinancialPasteInput(text);
    expect(result.errors).toEqual([
      { row: 1, message: 'Rivi 1: vuosi "vuosi" ei ole kokonaisluku.' },
    ]);
  });

  it("returns no rows for empty or whitespace-only input", () => {
    expect(parseFinancialPasteInput("")).toEqual({ accounts: [], entries: [], errors: [] });
    expect(parseFinancialPasteInput("   \n\t\n  ")).toEqual({ accounts: [], entries: [], errors: [] });
  });

  it("skips blank lines without shifting row numbers", () => {
    const text = [
      row("kulu", "HALLINTOPALVELUT", "5300", "Isännöintipalkkiot", "2025", "1000", ""),
      "",
      row("kulu", "HALLINTOPALVELUT", "5300", "Isännöintipalkkiot", "huono-vuosi", "1000", ""),
    ].join("\n");
    const result = parseFinancialPasteInput(text);
    expect(result.entries).toEqual([{ accountCode: "5300", year: 2025, budgetAmount: 1000 }]);
    expect(result.errors).toEqual([
      { row: 3, message: 'Rivi 3: vuosi "huono-vuosi" ei ole kokonaisluku.' },
    ]);
  });

  it("reports the wrong column count with a row number", () => {
    const result = parseFinancialPasteInput("kulu\tHALLINTOPALVELUT\t5300\tNimi\t2025");
    expect(result.errors).toEqual([
      { row: 1, message: "Rivi 1: odotettiin 7 saraketta, löytyi 5." },
    ]);
  });

  it("reports an unknown kind", () => {
    const result = parseFinancialPasteInput(row("meno", "X", "5300", "Nimi", "2025", "100", ""));
    expect(result.errors).toEqual([
      { row: 1, message: 'Rivi 1: tuntematon kind "meno" (odotettiin "kulu" tai "tulo").' },
    ]);
  });

  it("reports a non-numeric amount", () => {
    const budgetResult = parseFinancialPasteInput(row("kulu", "X", "5300", "Nimi", "2025", "abc", ""));
    expect(budgetResult.errors).toEqual([
      { row: 1, message: 'Rivi 1: budjetti "abc" ei ole luku.' },
    ]);
    const actualResult = parseFinancialPasteInput(row("kulu", "X", "5300", "Nimi", "2025", "", "abc"));
    expect(actualResult.errors).toEqual([
      { row: 1, message: 'Rivi 1: toteuma "abc" ei ole luku.' },
    ]);
  });

  it("reports a row where both budget and actual are empty", () => {
    const result = parseFinancialPasteInput(row("kulu", "X", "5300", "Nimi", "2025", "", ""));
    expect(result.errors).toEqual([
      { row: 1, message: "Rivi 1: sekä budjetti että toteuma puuttuvat." },
    ]);
  });

  it("preserves a negative sign on amounts", () => {
    const result = parseFinancialPasteInput(row("kulu", "X", "5300", "Nimi", "2025", "-100", "-50,25"));
    expect(result.entries).toEqual([{ accountCode: "5300", year: 2025, budgetAmount: -100, actualAmount: -50.25 }]);
  });

  it("groups multiple years under one account", () => {
    const text = [
      row("kulu", "X", "5300", "Nimi", "2024", "", "1000"),
      row("kulu", "X", "5300", "Nimi", "2025", "", "1100"),
      row("kulu", "X", "5300", "Nimi", "2026", "1200", ""),
    ].join("\n");
    const result = parseFinancialPasteInput(text);
    expect(result.accounts).toHaveLength(1);
    expect(result.entries).toHaveLength(3);
  });

  it("rejects a conflicting name/group/kind on a later row for the same account", () => {
    const text = [
      row("kulu", "HALLINTOPALVELUT", "5300", "Isännöintipalkkiot", "2024", "", "1000"),
      row("kulu", "MUU_RYHMA", "5300", "Isännöintipalkkiot", "2025", "", "1100"),
    ].join("\n");
    const result = parseFinancialPasteInput(text);
    expect(result.accounts).toEqual([
      { accountCode: "5300", name: "Isännöintipalkkiot", kind: "expense", group: "HALLINTOPALVELUT", active: true },
    ]);
    expect(result.entries).toHaveLength(1);
    expect(result.errors).toEqual([
      {
        row: 2,
        message: "Rivi 2: tili 5300 on ristiriidassa aiemman rivin kanssa (nimi, ryhmä tai kind ei täsmää).",
      },
    ]);
  });

  it("rejects a duplicate (accountCode, year) pair", () => {
    const text = [
      row("kulu", "X", "5300", "Nimi", "2025", "", "1000"),
      row("kulu", "X", "5300", "Nimi", "2025", "", "1100"),
    ].join("\n");
    const result = parseFinancialPasteInput(text);
    expect(result.entries).toHaveLength(1);
    expect(result.errors).toEqual([
      { row: 2, message: "Rivi 2: tili 5300 vuodelle 2025 esiintyy jo aiemmalla rivillä." },
    ]);
  });
});

describe("buildFinancialImportOperations", () => {
  it("orders every save_financial_account operation before any save_financial_entry operation", () => {
    const parsed = parseFinancialPasteInput([
      "kulu\tHALLINTOPALVELUT\t5300\tIsännöintipalkkiot\t2024\t\t1000",
      "kulu\tHALLINTOPALVELUT\t5300\tIsännöintipalkkiot\t2025\t1100\t",
      "tulo\tVASTIKETULOT\t3000\tHoitovastikkeet\t2025\t500000\t495000",
    ].join("\n"));
    const operations = buildFinancialImportOperations(parsed, {
      sourceIds: ["initial_excel"],
      explanation: "Tuonti Excelistä.",
    });

    const accountOps = operations.filter((op) => op.type === "save_financial_account");
    const entryOps = operations.filter((op) => op.type === "save_financial_entry");
    expect(accountOps).toHaveLength(2);
    expect(entryOps).toHaveLength(3);
    expect(operations.indexOf(accountOps[0])).toBeLessThan(operations.indexOf(entryOps[0]));
    expect(operations.indexOf(accountOps[1])).toBeLessThan(operations.indexOf(entryOps[0]));

    for (const op of operations) {
      expect(op.sourceIds).toEqual(["initial_excel"]);
      expect(op.explanation).toBe("Tuonti Excelistä.");
    }
    for (const op of entryOps) {
      expect(op.value.sourceIds).toEqual(["initial_excel"]);
    }
  });

  it("produces operations that applyAdminBatch accepts in one batch, in cross-reference order", () => {
    const snapshot = createAdminDataSnapshot({
      housingCompany: { id: "housing_company_demo", name: "Testiyhtiö", apartmentCount: 12 },
      updatedAt: "2026-07-17T15:00:00+03:00",
      updatedBy: "admin:test",
    });
    const parsed = parseFinancialPasteInput([
      "kulu\tHALLINTOPALVELUT\t5300\tIsännöintipalkkiot\t2024\t\t1000",
      "kulu\tHALLINTOPALVELUT\t5300\tIsännöintipalkkiot\t2025\t1100\t",
      "tulo\tVASTIKETULOT\t3000\tHoitovastikkeet\t2025\t500000\t495000",
    ].join("\n"));
    const operations = buildFinancialImportOperations(parsed, {
      sourceIds: ["initial_excel"],
      explanation: "Tuonti Excelistä.",
    });

    const next = applyAdminBatch(snapshot, {
      companyId: "housing_company_demo",
      expectedRevision: 0,
      actorId: "admin:test",
      occurredAt: "2026-07-18T09:00:00+03:00",
      operations,
    });

    expect(next.revision).toBe(1);
    expect(next.financialAccounts).toHaveLength(2);
    expect(next.financialEntries).toHaveLength(3);
    expect(next.financialAccounts.map((a) => a.accountCode).sort()).toEqual(["3000", "5300"]);
  });
});

describe("validateBalanceSheetSnapshotInput / buildSaveBalanceSheetSnapshotOperation", () => {
  const validRaw = {
    id: "balance_2025",
    asOfDate: "2025-12-31",
    sourceIds: "tase_2025",
    entries: [
      { section: "current_assets", key: "rahat", name: "Rahat ja pankkisaamiset", amount: 12345.67 },
      { section: "liabilities", key: "lainat", name: "Pitkäaikaiset lainat", amount: -50000 },
    ],
    operationSourceIds: "tase_2025",
    explanation: "Tilinpäätöksen liite.",
  };

  it("accepts a valid snapshot", () => {
    const result = validateBalanceSheetSnapshotInput(validRaw);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      id: "balance_2025",
      asOfDate: "2025-12-31",
      sourceIds: ["tase_2025"],
      entries: [
        { section: "current_assets", key: "rahat", name: "Rahat ja pankkisaamiset", amount: 12345.67 },
        { section: "liabilities", key: "lainat", name: "Pitkäaikaiset lainat", amount: -50000 },
      ],
    });
  });

  it("rejects an unknown section", () => {
    const result = validateBalanceSheetSnapshotInput({
      ...validRaw,
      entries: [{ section: "not_a_section", key: "x", name: "X", amount: 1 }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.entries).toBeDefined();
  });

  it("rejects empty entries", () => {
    const result = validateBalanceSheetSnapshotInput({ ...validRaw, entries: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.entries).toBeDefined();
  });

  it("rejects a non-numeric amount", () => {
    const result = validateBalanceSheetSnapshotInput({
      ...validRaw,
      entries: [{ section: "liabilities", key: "x", name: "X", amount: "abc" }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.entries).toBeDefined();
  });

  it("rejects an empty sourceIds list", () => {
    const result = validateBalanceSheetSnapshotInput({ ...validRaw, sourceIds: "" });
    expect(result.ok).toBe(false);
    expect(result.errors.sourceIds).toBeDefined();
  });

  it("rejects a missing/invalid asOfDate", () => {
    expect(validateBalanceSheetSnapshotInput({ ...validRaw, asOfDate: "" }).ok).toBe(false);
    expect(validateBalanceSheetSnapshotInput({ ...validRaw, asOfDate: "not-a-date" }).ok).toBe(false);
  });

  it("builds an operation with the entity/operation sourceIds split", () => {
    const result = buildSaveBalanceSheetSnapshotOperation(validRaw);
    expect(result.ok).toBe(true);
    expect(result.operation).toEqual({
      type: "save_balance_sheet_snapshot",
      value: validateBalanceSheetSnapshotInput(validRaw).value,
      sourceIds: ["tase_2025"],
      explanation: "Tilinpäätöksen liite.",
    });
  });

  it("applyAdminBatch accepts a snapshot built this way, uniqueness by id enforced", () => {
    const snapshot = createAdminDataSnapshot({
      housingCompany: { id: "housing_company_demo", name: "Testiyhtiö", apartmentCount: 12 },
      updatedAt: "2026-07-17T15:00:00+03:00",
      updatedBy: "admin:test",
    });
    const built = buildSaveBalanceSheetSnapshotOperation(validRaw);
    const next = applyAdminBatch(snapshot, {
      companyId: "housing_company_demo",
      expectedRevision: 0,
      actorId: "admin:test",
      occurredAt: "2026-07-18T09:00:00+03:00",
      operations: [built.operation],
    });
    expect(next.revision).toBe(1);
    expect(next.balanceSheetSnapshots).toHaveLength(1);
    expect(next.balanceSheetSnapshots[0].id).toBe("balance_2025");

    // A second snapshot with the same id upserts (replaces) rather than duplicating.
    const again = applyAdminBatch(next, {
      companyId: "housing_company_demo",
      expectedRevision: 1,
      actorId: "admin:test",
      occurredAt: "2026-07-19T09:00:00+03:00",
      operations: [built.operation],
    });
    expect(again.balanceSheetSnapshots).toHaveLength(1);
  });
});

describe("parseBalanceSheetPasteInput", () => {
  function row(section, key, name, amount) {
    return [section, key, name, amount].join("\t");
  }

  const meta = { id: "balance_2025", asOfDate: "2025-12-31" };

  it("parses a valid multi-row paste with a header row", () => {
    const text = [
      row("section", "key", "name", "amount"),
      row("Vaihtuvat vastaavat", "rahat", "Rahat ja pankkisaamiset", "12345,67"),
      row("Velat", "lainat", "Pitkäaikaiset lainat", "-50000"),
    ].join("\n");

    const result = parseBalanceSheetPasteInput(text, meta);

    expect(result.errors).toEqual([]);
    expect(result.snapshot).toEqual({
      id: "balance_2025",
      asOfDate: "2025-12-31",
      entries: [
        { section: "current_assets", key: "rahat", name: "Rahat ja pankkisaamiset", amount: 12345.67 },
        { section: "liabilities", key: "lainat", name: "Pitkäaikaiset lainat", amount: -50000 },
      ],
    });
  });

  it("parses correctly without a header row", () => {
    const text = row("Velat", "lainat", "Pitkäaikaiset lainat", "50000.5");
    const result = parseBalanceSheetPasteInput(text, meta);
    expect(result.errors).toEqual([]);
    expect(result.snapshot.entries).toEqual([
      { section: "liabilities", key: "lainat", name: "Pitkäaikaiset lainat", amount: 50000.5 },
    ]);
  });

  it("matches the Finnish section label case-insensitively", () => {
    const text = row("velat", "lainat", "Pitkäaikaiset lainat", "1000");
    const result = parseBalanceSheetPasteInput(text, meta);
    expect(result.errors).toEqual([]);
    expect(result.snapshot.entries[0].section).toBe("liabilities");
  });

  it("reports an unknown section", () => {
    const result = parseBalanceSheetPasteInput(row("Muu osio", "x", "X", "100"), meta);
    expect(result.errors).toEqual([
      expect.objectContaining({ row: 1, message: expect.stringContaining('tuntematon osio "Muu osio"') }),
    ]);
  });

  it("reports the wrong column count with a row number", () => {
    const result = parseBalanceSheetPasteInput("Velat\tlainat\tNimi", meta);
    expect(result.errors).toEqual([
      { row: 1, message: "Rivi 1: odotettiin 4 saraketta, löytyi 3." },
    ]);
  });

  it("reports a non-numeric amount", () => {
    const result = parseBalanceSheetPasteInput(row("Velat", "lainat", "Nimi", "abc"), meta);
    expect(result.errors).toEqual([
      { row: 1, message: 'Rivi 1: euromäärä "abc" ei ole luku.' },
    ]);
  });

  it("rejects a duplicate key across rows", () => {
    const text = [
      row("Velat", "lainat", "Nimi 1", "100"),
      row("Vaihtuvat vastaavat", "lainat", "Nimi 2", "200"),
    ].join("\n");
    const result = parseBalanceSheetPasteInput(text, meta);
    expect(result.snapshot.entries).toHaveLength(1);
    expect(result.errors).toEqual([
      { row: 2, message: 'Rivi 2: erän tunniste "lainat" esiintyy jo aiemmalla rivillä.' },
    ]);
  });

  it("reports missing id/asOfDate as row-0 errors, independent of the pasted rows", () => {
    const result = parseBalanceSheetPasteInput(
      row("Velat", "lainat", "Nimi", "100"),
      { id: "", asOfDate: "not-a-date" },
    );
    expect(result.errors).toEqual([
      { row: 0, message: "Snapshotin tunniste (id) puuttuu." },
      { row: 0, message: "Anna kelvollinen tilinpäätöspäivä." },
    ]);
    expect(result.snapshot.entries).toHaveLength(1);
  });

  it("reports no rows found when only a header (or nothing) is pasted", () => {
    const result = parseBalanceSheetPasteInput(row("section", "key", "name", "amount"), meta);
    expect(result.snapshot.entries).toEqual([]);
    expect(result.errors).toEqual([
      { row: 0, message: "Liitetystä datasta ei löytynyt yhtään tase-erää." },
    ]);
  });

  it("preserves a negative sign on amounts", () => {
    const result = parseBalanceSheetPasteInput(row("Velat", "lainat", "Nimi", "-1234,5"), meta);
    expect(result.snapshot.entries[0].amount).toBe(-1234.5);
  });
});

describe("buildBalanceSheetImportOperation", () => {
  it("builds a save_balance_sheet_snapshot operation from a successful parse", () => {
    const parsed = parseBalanceSheetPasteInput(
      "Velat\tlainat\tPitkäaikaiset lainat\t-50000",
      { id: "balance_2025", asOfDate: "2025-12-31" },
    );
    const operation = buildBalanceSheetImportOperation(parsed, {
      sourceIds: ["initial_excel"],
      explanation: "Tuonti Excelistä.",
    });
    expect(operation).toEqual({
      type: "save_balance_sheet_snapshot",
      value: {
        id: "balance_2025",
        asOfDate: "2025-12-31",
        entries: [
          { section: "liabilities", key: "lainat", name: "Pitkäaikaiset lainat", amount: -50000 },
        ],
        sourceIds: ["initial_excel"],
      },
      sourceIds: ["initial_excel"],
      explanation: "Tuonti Excelistä.",
    });
  });

  it("produces an operation applyAdminBatch accepts", () => {
    const snapshot = createAdminDataSnapshot({
      housingCompany: { id: "housing_company_demo", name: "Testiyhtiö", apartmentCount: 12 },
      updatedAt: "2026-07-17T15:00:00+03:00",
      updatedBy: "admin:test",
    });
    const parsed = parseBalanceSheetPasteInput(
      "Velat\tlainat\tPitkäaikaiset lainat\t-50000",
      { id: "balance_2025", asOfDate: "2025-12-31" },
    );
    const operation = buildBalanceSheetImportOperation(parsed, {
      sourceIds: ["initial_excel"],
      explanation: "Tuonti Excelistä.",
    });
    const next = applyAdminBatch(snapshot, {
      companyId: "housing_company_demo",
      expectedRevision: 0,
      actorId: "admin:test",
      occurredAt: "2026-07-18T09:00:00+03:00",
      operations: [operation],
    });
    expect(next.revision).toBe(1);
    expect(next.balanceSheetSnapshots).toHaveLength(1);
  });
});

describe("buildBalanceSheetViewModel", () => {
  it("is empty with no snapshot or no entries", () => {
    expect(buildBalanceSheetViewModel(undefined).isEmpty).toBe(true);
    expect(buildBalanceSheetViewModel(null).isEmpty).toBe(true);
    expect(buildBalanceSheetViewModel({ id: "x", asOfDate: "2025-12-31", entries: [] }).isEmpty).toBe(true);
  });

  it("groups entries under all five sections, nested under VARAT / OMA PÄÄOMA / VELAT", () => {
    const vm = buildBalanceSheetViewModel({
      id: "balance_2025",
      asOfDate: "2025-12-31",
      entries: [
        { section: "fixed_assets", key: "kiinteisto", name: "Kiinteistöt", amount: 1000000 },
        { section: "current_assets", key: "rahat", name: "Rahat ja pankkisaamiset", amount: 50000 },
        { section: "restricted_equity", key: "osakepaaoma", name: "Osakepääoma", amount: 100000 },
        { section: "unrestricted_equity", key: "edellisten", name: "Edellisten tilikausien voitto", amount: 200000 },
        { section: "liabilities", key: "lainat", name: "Pitkäaikaiset lainat", amount: 750000 },
      ],
    });

    expect(vm.isEmpty).toBe(false);
    expect(vm.topGroups.map((g) => g.key)).toEqual(["assets", "equity", "liabilities"]);
    expect(vm.topGroups.map((g) => g.label)).toEqual(["VARAT", "OMA PÄÄOMA", "VELAT"]);

    const assetsGroup = vm.topGroups.find((g) => g.key === "assets");
    expect(assetsGroup.sections.map((s) => s.section)).toEqual(["fixed_assets", "current_assets"]);
    expect(assetsGroup.groupTotal).toBe(1050000);

    const equityGroup = vm.topGroups.find((g) => g.key === "equity");
    expect(equityGroup.groupTotal).toBe(300000);

    const liabilitiesGroup = vm.topGroups.find((g) => g.key === "liabilities");
    expect(liabilitiesGroup.groupTotal).toBe(750000);

    expect(vm.assetsTotal).toBe(1050000);
    expect(vm.equityAndLiabilitiesTotal).toBe(1050000);
  });

  it("always renders all five sections, even with zero entries", () => {
    const vm = buildBalanceSheetViewModel({
      id: "x",
      asOfDate: "2025-12-31",
      entries: [{ section: "liabilities", key: "lainat", name: "Lainat", amount: 100 }],
    });
    const allSections = vm.topGroups.flatMap((g) => g.sections.map((s) => s.section));
    expect(allSections).toEqual([
      "fixed_assets", "current_assets", "restricted_equity", "unrestricted_equity", "liabilities",
    ]);
    const emptySection = vm.topGroups[0].sections.find((s) => s.section === "fixed_assets");
    expect(emptySection.entries).toEqual([]);
    expect(emptySection.sectionTotal).toBe(0);
  });

  it("preserves a genuinely negative entry's sign in its amount, section total, and group total", () => {
    const vm = buildBalanceSheetViewModel({
      id: "x",
      asOfDate: "2025-12-31",
      entries: [{ section: "unrestricted_equity", key: "voittovarat", name: "Kertyneet voittovarat", amount: -4736.16 }],
    });
    const equityGroup = vm.topGroups.find((g) => g.key === "equity");
    expect(equityGroup.sections.find((s) => s.section === "unrestricted_equity").entries[0].amount).toBe(-4736.16);
    expect(equityGroup.groupTotal).toBe(-4736.16);
    expect(vm.equityAndLiabilitiesTotal).toBe(-4736.16);
  });

  it("balances real 2024 tilinpäätös data (assets, equity with a negative accrued-loss entry, and liabilities)", () => {
    const vm = buildBalanceSheetViewModel({
      id: "balance_2024",
      asOfDate: "2024-12-31",
      entries: [
        { section: "fixed_assets", key: "kiinteisto", name: "Kiinteistöt", amount: 1749678.88 - 5000 },
        { section: "current_assets", key: "rahat", name: "Rahat ja pankkisaamiset", amount: 5000 },
        { section: "restricted_equity", key: "osakepaaoma", name: "Osakepääoma", amount: 1751919.65 },
        { section: "unrestricted_equity", key: "voittovarat", name: "Kertyneet voittovarat", amount: -4736.16 },
        { section: "liabilities", key: "ostovelat", name: "Ostovelat", amount: 2495.39 },
      ],
    });
    expect(vm.assetsTotal).toBe(1749678.88);
    expect(vm.equityAndLiabilitiesTotal).toBeCloseTo(1749678.88, 6);
  });
});

describe("computeBalanceReconciliation", () => {
  it("is empty with no snapshot", () => {
    expect(computeBalanceReconciliation(undefined).isEmpty).toBe(true);
  });

  it("balances when assets equal equity + liabilities", () => {
    const result = computeBalanceReconciliation({
      id: "x",
      asOfDate: "2025-12-31",
      entries: [
        { section: "fixed_assets", key: "kiinteisto", name: "Kiinteistöt", amount: 1000000 },
        { section: "restricted_equity", key: "osakepaaoma", name: "Osakepääoma", amount: 250000 },
        { section: "liabilities", key: "lainat", name: "Lainat", amount: 750000 },
      ],
    });
    expect(result.assets).toBe(1000000);
    expect(result.equityPlusLiabilities).toBe(1000000);
    expect(result.difference).toBe(0);
    expect(result.balances).toBe(true);
  });

  it("does not balance and reports the difference when off by more than the tolerance", () => {
    const result = computeBalanceReconciliation({
      id: "x",
      asOfDate: "2025-12-31",
      entries: [
        { section: "fixed_assets", key: "kiinteisto", name: "Kiinteistöt", amount: 1000000 },
        { section: "liabilities", key: "lainat", name: "Lainat", amount: 750000 },
      ],
    });
    expect(result.difference).toBe(250000);
    expect(result.balances).toBe(false);
  });

  it("treats a rounding-cent difference (0.005) as balanced", () => {
    const result = computeBalanceReconciliation({
      id: "x",
      asOfDate: "2025-12-31",
      entries: [
        { section: "fixed_assets", key: "kiinteisto", name: "Kiinteistöt", amount: 1000.005 },
        { section: "liabilities", key: "lainat", name: "Lainat", amount: 1000 },
      ],
    });
    expect(result.difference).toBeCloseTo(0.005, 5);
    expect(result.balances).toBe(true);
  });

  it("regression: real 2024 tilinpäätös balances even though Kertyneet voittovarat is negative (-4 736,16 €)", () => {
    // Real 31.12.2024 data. Before the fix, Math.abs on the -4736.16 entry
    // flipped it to +4736.16, inflating equity by 2x4736.16 = 9472.32 and
    // making this reconciliation falsely report a mismatch of -9472.32 €.
    const result = computeBalanceReconciliation({
      id: "balance_2024",
      asOfDate: "2024-12-31",
      entries: [
        { section: "fixed_assets", key: "kiinteisto", name: "Kiinteistöt", amount: 1744678.88 },
        { section: "current_assets", key: "rahat", name: "Rahat ja pankkisaamiset", amount: 5000 },
        { section: "restricted_equity", key: "osakepaaoma", name: "Osakepääoma", amount: 1751919.65 },
        { section: "unrestricted_equity", key: "voittovarat", name: "Kertyneet voittovarat", amount: -4736.16 },
        { section: "liabilities", key: "ostovelat", name: "Ostovelat", amount: 2495.39 },
      ],
    });
    expect(result.assets).toBeCloseTo(1749678.88, 6);
    expect(result.equityPlusLiabilities).toBeCloseTo(1749678.88, 6);
    expect(result.difference).toBeCloseTo(0, 6);
    expect(result.balances).toBe(true);
  });

  it("still balances the real 2025 tilinpäätös (all-positive entries — no regression from the fix)", () => {
    const result = computeBalanceReconciliation({
      id: "balance_2025",
      asOfDate: "2025-12-31",
      entries: [
        { section: "fixed_assets", key: "kiinteisto", name: "Kiinteistöt", amount: 1749852.62 },
        { section: "current_assets", key: "rahat", name: "Rahat ja pankkisaamiset", amount: 5000 },
        { section: "restricted_equity", key: "osakepaaoma", name: "Osakepääoma", amount: 1751919.65 },
        { section: "unrestricted_equity", key: "voittovarat", name: "Kertyneet voittovarat", amount: 437.58 },
        { section: "liabilities", key: "ostovelat", name: "Ostovelat", amount: 2495.39 },
      ],
    });
    expect(result.balances).toBe(true);
  });
});

describe("computeBalanceRatios", () => {
  const snapshot = {
    id: "x",
    asOfDate: "2025-12-31",
    entries: [
      { section: "current_assets", key: "rahat", name: "Rahat ja pankkisaamiset", amount: 60000 },
      { section: "current_assets", key: "muut", name: "Muut saamiset", amount: 15000 },
      { section: "liabilities", key: "lainat", name: "Lainat", amount: 500000 },
    ],
  };

  it("is empty with no snapshot", () => {
    const result = computeBalanceRatios(undefined, undefined);
    expect(result.liquidity).toBeNull();
    expect(result.monthsOfCash).toBeNull();
    expect(result.interestBearingDebt).toBeNull();
    expect(result.cashSource).toBeNull();
  });

  it("computes liquidity as current assets / liabilities", () => {
    const result = computeBalanceRatios(snapshot, undefined);
    expect(result.liquidity).toBeCloseTo(75000 / 500000, 6);
  });

  it("returns null liquidity and interestBearingDebt when liabilities are zero (no division by zero)", () => {
    const noLiabilities = {
      id: "x",
      asOfDate: "2025-12-31",
      entries: [{ section: "current_assets", key: "rahat", name: "Rahat ja pankkisaamiset", amount: 60000 }],
    };
    const result = computeBalanceRatios(noLiabilities, undefined);
    expect(result.liquidity).toBeNull();
    expect(result.interestBearingDebt).toBeNull();
  });

  it("computes monthsOfCash as rahat / (trailing12mOperatingCosts / 12), using the named cash entry", () => {
    const result = computeBalanceRatios(snapshot, { trailing12mOperatingCosts: 120000 });
    expect(result.monthsOfCash).toBeCloseTo(60000 / 10000, 6);
    expect(result.cashSource).toBe("entry");
  });

  it("returns null monthsOfCash when latestLiquidityBaseline is missing", () => {
    const result = computeBalanceRatios(snapshot, undefined);
    expect(result.monthsOfCash).toBeNull();
  });

  it("returns null monthsOfCash when trailing12mOperatingCosts is zero", () => {
    const result = computeBalanceRatios(snapshot, { trailing12mOperatingCosts: 0 });
    expect(result.monthsOfCash).toBeNull();
  });

  it("falls back to the current_assets section total when no named cash entry exists", () => {
    const noNamedCash = {
      id: "x",
      asOfDate: "2025-12-31",
      entries: [
        { section: "current_assets", key: "muut", name: "Muut saamiset", amount: 15000 },
        { section: "liabilities", key: "lainat", name: "Lainat", amount: 500000 },
      ],
    };
    const result = computeBalanceRatios(noNamedCash, { trailing12mOperatingCosts: 120000 });
    expect(result.cashSource).toBe("section_total");
    expect(result.monthsOfCash).toBeCloseTo(15000 / 10000, 6);
  });

  it("computes interestBearingDebt as the whole liabilities total", () => {
    const result = computeBalanceRatios(snapshot, undefined);
    expect(result.interestBearingDebt).toBe(500000);
  });

  it("keeps liquidity, monthsOfCash, and interestBearingDebt correct when an equity entry is negative", () => {
    const snapshotWithNegativeEquity = {
      id: "x",
      asOfDate: "2024-12-31",
      entries: [
        { section: "current_assets", key: "rahat", name: "Rahat ja pankkisaamiset", amount: 60000 },
        { section: "current_assets", key: "muut", name: "Muut saamiset", amount: 15000 },
        { section: "unrestricted_equity", key: "voittovarat", name: "Kertyneet voittovarat", amount: -4736.16 },
        { section: "liabilities", key: "lainat", name: "Lainat", amount: 500000 },
      ],
    };
    const result = computeBalanceRatios(snapshotWithNegativeEquity, { trailing12mOperatingCosts: 120000 });
    expect(result.liquidity).toBeCloseTo(75000 / 500000, 6);
    expect(result.monthsOfCash).toBeCloseTo(60000 / 10000, 6);
    expect(result.interestBearingDebt).toBe(500000);
  });
});

describe("buildBalanceComparisonViewModel", () => {
  const newerSnapshot = {
    id: "balance_2025",
    asOfDate: "2025-12-31",
    entries: [
      { section: "fixed_assets", key: "kiinteisto", name: "Kiinteistöt", amount: 1100000 },
      { section: "current_assets", key: "rahat", name: "Rahat ja pankkisaamiset", amount: 60000 },
      { section: "current_assets", key: "uusi_saatava", name: "Uusi saatava", amount: 5000 },
      { section: "liabilities", key: "lainat", name: "Lainat", amount: 700000 },
    ],
  };
  const olderSnapshot = {
    id: "balance_2024",
    asOfDate: "2024-12-31",
    entries: [
      { section: "fixed_assets", key: "kiinteisto", name: "Kiinteistöt", amount: 1000000 },
      { section: "current_assets", key: "rahat", name: "Rahat ja pankkisaamiset", amount: 50000 },
      { section: "current_assets", key: "vanha_saatava", name: "Vanha saatava", amount: 8000 },
      { section: "liabilities", key: "lainat", name: "Lainat", amount: 750000 },
    ],
  };

  it("has no comparison when olderSnapshot is missing (single-snapshot edge case)", () => {
    const vm = buildBalanceComparisonViewModel(newerSnapshot, undefined);
    expect(vm.hasComparison).toBe(false);
    expect(vm.isEmpty).toBe(false);
    expect(vm.newer.isEmpty).toBe(false);
    expect(vm.topGroups).toEqual([]);
  });

  it("is empty when the newer snapshot is empty, regardless of older", () => {
    const vm = buildBalanceComparisonViewModel(undefined, olderSnapshot);
    expect(vm.isEmpty).toBe(true);
    expect(vm.hasComparison).toBe(false);
  });

  it("pairs entries present in both snapshots and computes change = newer - older", () => {
    const vm = buildBalanceComparisonViewModel(newerSnapshot, olderSnapshot);
    expect(vm.hasComparison).toBe(true);

    const assetsGroup = vm.topGroups.find((g) => g.key === "assets");
    const currentAssets = assetsGroup.sections.find((s) => s.section === "current_assets");
    const rahat = currentAssets.entries.find((e) => e.key === "rahat");
    expect(rahat.newerAmount).toBe(60000);
    expect(rahat.olderAmount).toBe(50000);
    expect(rahat.change).toBe(10000);
  });

  it("shows null on the missing side for an entry present in only one snapshot, with change = whole value", () => {
    const vm = buildBalanceComparisonViewModel(newerSnapshot, olderSnapshot);
    const currentAssets = vm.topGroups
      .find((g) => g.key === "assets")
      .sections.find((s) => s.section === "current_assets");

    const onlyInNewer = currentAssets.entries.find((e) => e.key === "uusi_saatava");
    expect(onlyInNewer.newerAmount).toBe(5000);
    expect(onlyInNewer.olderAmount).toBeNull();
    expect(onlyInNewer.change).toBe(5000);

    const onlyInOlder = currentAssets.entries.find((e) => e.key === "vanha_saatava");
    expect(onlyInOlder.newerAmount).toBeNull();
    expect(onlyInOlder.olderAmount).toBe(8000);
    expect(onlyInOlder.change).toBe(-8000);
  });

  it("computes section and group total changes", () => {
    const vm = buildBalanceComparisonViewModel(newerSnapshot, olderSnapshot);
    const assetsGroup = vm.topGroups.find((g) => g.key === "assets");
    const currentAssets = assetsGroup.sections.find((s) => s.section === "current_assets");
    expect(currentAssets.newerTotal).toBe(65000);
    expect(currentAssets.olderTotal).toBe(58000);
    expect(currentAssets.totalChange).toBe(7000);

    const liabilitiesGroup = vm.topGroups.find((g) => g.key === "liabilities");
    expect(liabilitiesGroup.newerGroupTotal).toBe(700000);
    expect(liabilitiesGroup.olderGroupTotal).toBe(750000);
    expect(liabilitiesGroup.groupChange).toBe(-50000);

    expect(vm.assetsChange).toBe(vm.newer.assetsTotal - vm.older.assetsTotal);
  });

  it("preserves genuinely negative amounts (does not flip sign) when pairing entries", () => {
    const negNewer = {
      id: "x", asOfDate: "2025-12-31",
      entries: [{ section: "liabilities", key: "lainat", name: "Lainat", amount: -700000 }],
    };
    const negOlder = {
      id: "y", asOfDate: "2024-12-31",
      entries: [{ section: "liabilities", key: "lainat", name: "Lainat", amount: -750000 }],
    };
    const vm = buildBalanceComparisonViewModel(negNewer, negOlder);
    const liabilities = vm.topGroups.find((g) => g.key === "liabilities").sections[0];
    expect(liabilities.entries[0].newerAmount).toBe(-700000);
    expect(liabilities.entries[0].olderAmount).toBe(-750000);
    expect(liabilities.entries[0].change).toBe(50000);
  });

  it("regression: computes the change correctly across a sign flip (voittovarat -4736.16 -> +437.58)", () => {
    const newer2025 = {
      id: "balance_2025", asOfDate: "2025-12-31",
      entries: [{ section: "unrestricted_equity", key: "voittovarat", name: "Kertyneet voittovarat", amount: 437.58 }],
    };
    const older2024 = {
      id: "balance_2024", asOfDate: "2024-12-31",
      entries: [{ section: "unrestricted_equity", key: "voittovarat", name: "Kertyneet voittovarat", amount: -4736.16 }],
    };
    const vm = buildBalanceComparisonViewModel(newer2025, older2024);
    const voittovarat = vm.topGroups
      .find((g) => g.key === "equity")
      .sections.find((s) => s.section === "unrestricted_equity").entries[0];
    expect(voittovarat.newerAmount).toBe(437.58);
    expect(voittovarat.olderAmount).toBe(-4736.16);
    expect(voittovarat.change).toBeCloseTo(5173.74, 6);
  });
});

describe("buildAccountCostsViewModel", () => {
  it("is empty with no accounts or no matching entries", () => {
    expect(buildAccountCostsViewModel([], []).isEmpty).toBe(true);
    expect(buildAccountCostsViewModel(FINANCIAL_ACCOUNTS, []).isEmpty).toBe(true);
  });

  it("includes only expense accounts, derives year columns from data, and orders budget before actual", () => {
    const accounts = [
      { accountCode: "5300", name: "Isännöintipalkkiot", kind: "expense", group: "HALLINTOPALVELUT" },
      { accountCode: "3000", name: "Hoitovastikkeet", kind: "income", group: "VASTIKETULOT" },
    ];
    const entries = [
      { accountCode: "5300", year: 2024, actualAmount: 1000 },
      { accountCode: "5300", year: 2025, budgetAmount: 1300, actualAmount: 1200 },
      { accountCode: "3000", year: 2025, budgetAmount: 500000, actualAmount: 495000 },
    ];

    const vm = buildAccountCostsViewModel(accounts, entries);

    expect(vm.isEmpty).toBe(false);
    expect(vm.columns.map((c) => c.key)).toEqual(["actual-2024", "budget-2025", "actual-2025"]);
    expect(vm.groups).toHaveLength(1);
    expect(vm.groups[0].group).toBe("HALLINTOPALVELUT");
    expect(vm.groups[0].rows).toEqual([
      {
        accountCode: "5300",
        name: "Isännöintipalkkiot",
        values: { "actual-2024": 1000, "budget-2025": 1300, "actual-2025": 1200 },
      },
    ]);
  });

  it("groups multiple accounts and sums group and grand totals", () => {
    const accounts = [
      { accountCode: "5300", name: "Isännöinti", kind: "expense", group: "HALLINTO" },
      { accountCode: "5310", name: "Kirjanpito", kind: "expense", group: "HALLINTO" },
      { accountCode: "6000", name: "Lämmitys", kind: "expense", group: "LÄMMITYS" },
    ];
    const entries = [
      { accountCode: "5300", year: 2025, actualAmount: 1000 },
      { accountCode: "5310", year: 2025, actualAmount: 500 },
      { accountCode: "6000", year: 2025, actualAmount: 2000 },
    ];

    const vm = buildAccountCostsViewModel(accounts, entries);

    expect(vm.groups.map((g) => g.group)).toEqual(["HALLINTO", "LÄMMITYS"]);
    const hallinto = vm.groups.find((g) => g.group === "HALLINTO");
    expect(hallinto.totals["actual-2025"]).toBe(1500);
    expect(vm.totals["actual-2025"]).toBe(3500);
  });

  it("shows an empty-state message pointing at the import view", () => {
    const vm = buildAccountCostsViewModel([], []);
    expect(vm.emptyMessage).toBe("Ei vielä tilidataa. Tuo se Liitä-näkymästä.");
  });
});

describe("deriveComparableYears", () => {
  it("returns only years with both a budget and an actual figure somewhere in the data", () => {
    const entries = [
      { accountCode: "3000", year: 2024, actualAmount: 100 },
      { accountCode: "3000", year: 2025, budgetAmount: 200, actualAmount: 210 },
      { accountCode: "3001", year: 2026, budgetAmount: 300 },
      { accountCode: "3001", year: 2027, budgetAmount: 50, actualAmount: 10 },
    ];
    expect(deriveComparableYears(entries)).toEqual([2025, 2027]);
  });

  it("matches budget on one account against actual on another for the same year", () => {
    const entries = [
      { accountCode: "3000", year: 2025, budgetAmount: 200 },
      { accountCode: "3001", year: 2025, actualAmount: 210 },
    ];
    expect(deriveComparableYears(entries)).toEqual([2025]);
  });

  it("is empty with no entries", () => {
    expect(deriveComparableYears([])).toEqual([]);
    expect(deriveComparableYears(undefined)).toEqual([]);
  });
});

const INCOME_ACCOUNTS = [
  { accountCode: "3000", name: "Hoitovastikkeet, asunnot", kind: "income", group: "Hoitovastikkeet" },
  { accountCode: "3001", name: "Hoitovastikkeet, liiketilat", kind: "income", group: "Hoitovastikkeet" },
  { accountCode: "3100", name: "Vuokratulot", kind: "income", group: "Muut tulot" },
];

describe("buildIncomeViewModel", () => {
  it("groups accounts, computes the 2024→2025 change and each group's share of total income", () => {
    const entries = [
      { accountCode: "3000", year: 2023, actualAmount: 900 },
      { accountCode: "3000", year: 2024, actualAmount: 1000 },
      { accountCode: "3000", year: 2025, actualAmount: 1100 },
      { accountCode: "3000", year: 2026, budgetAmount: 1200 },
      { accountCode: "3001", year: 2024, actualAmount: 200 },
      { accountCode: "3001", year: 2025, actualAmount: 300 },
      { accountCode: "3100", year: 2024, actualAmount: 500 },
      { accountCode: "3100", year: 2025, actualAmount: 600 },
    ];

    const vm = buildIncomeViewModel(INCOME_ACCOUNTS, entries);

    expect(vm.isEmpty).toBe(false);
    expect(vm.actualYears).toEqual([2023, 2024, 2025]);
    expect(vm.budgetYear).toBe(2026);
    expect(vm.changeYears).toEqual({ previous: 2024, latest: 2025 });
    expect(vm.latestActualYear).toBe(2025);

    const hoitovastikkeet = vm.groups.find((g) => g.group === "Hoitovastikkeet");
    expect(hoitovastikkeet.actuals[2024]).toBe(1200);
    expect(hoitovastikkeet.actuals[2025]).toBe(1400);
    expect(hoitovastikkeet.changeAmount).toBe(200);
    expect(hoitovastikkeet.changePercent).toBeCloseTo((200 / 1200) * 100);
    expect(hoitovastikkeet.budget).toBe(1200);

    const muutTulot = vm.groups.find((g) => g.group === "Muut tulot");
    expect(muutTulot.actuals[2025]).toBe(600);

    // Osuus tuloista sums to ~100% across groups for the latest actual year.
    const totalShare = vm.groups.reduce((sum, g) => sum + (g.sharePercent ?? 0), 0);
    expect(totalShare).toBeCloseTo(100, 5);
    expect(hoitovastikkeet.sharePercent).toBeCloseTo((1400 / 2000) * 100);
  });

  it("excludes historical budget years, keeping only the latest", () => {
    const entries = [
      { accountCode: "3000", year: 2024, budgetAmount: 950, actualAmount: 1000 },
      { accountCode: "3000", year: 2025, budgetAmount: 1050, actualAmount: 1100 },
      { accountCode: "3000", year: 2026, budgetAmount: 1200 },
    ];
    const vm = buildIncomeViewModel(INCOME_ACCOUNTS, entries);
    expect(vm.budgetYear).toBe(2026);
    const group = vm.groups.find((g) => g.group === "Hoitovastikkeet");
    expect(group.budget).toBe(1200);
  });

  it("leaves change figures undefined when fewer than two actual years exist", () => {
    const entries = [{ accountCode: "3000", year: 2025, actualAmount: 1000 }];
    const vm = buildIncomeViewModel(INCOME_ACCOUNTS, entries);
    expect(vm.changeYears).toBeNull();
    expect(vm.groups[0].changeAmount).toBeUndefined();
    expect(vm.groups[0].changePercent).toBeUndefined();
  });

  it("is a first-class empty state pointing at the import view when there is no data", () => {
    const vm = buildIncomeViewModel([], []);
    expect(vm.isEmpty).toBe(true);
    expect(vm.groups).toEqual([]);
    expect(vm.emptyMessage).toBe("Ei vielä talousdataa. Tuo se Liitä tilidataa -näkymästä.");
  });

  it("sets showAccountRowsInline when there is exactly one group", () => {
    const oneGroupAccounts = INCOME_ACCOUNTS.filter((a) => a.group === "Hoitovastikkeet");
    const entries = [
      { accountCode: "3000", year: 2025, actualAmount: 1000 },
      { accountCode: "3001", year: 2025, actualAmount: 300 },
    ];
    const vm = buildIncomeViewModel(oneGroupAccounts, entries);
    expect(vm.groups.length).toBe(1);
    expect(vm.showAccountRowsInline).toBe(true);
  });

  it("leaves showAccountRowsInline false when there is more than one group", () => {
    const entries = [
      { accountCode: "3000", year: 2025, actualAmount: 1000 },
      { accountCode: "3100", year: 2025, actualAmount: 500 },
    ];
    const vm = buildIncomeViewModel(INCOME_ACCOUNTS, entries);
    expect(vm.groups.length).toBeGreaterThan(1);
    expect(vm.showAccountRowsInline).toBe(false);
  });

  it("leaves showAccountRowsInline false on the empty state", () => {
    expect(buildIncomeViewModel([], []).showAccountRowsInline).toBe(false);
  });
});

const EXPENSE_ACCOUNTS = [
  {
    accountCode: "5300", name: "Isännöintipalkkiot", kind: "expense",
    group: "HALLINTOPALVELUT", nature: "maintenance", controllability: "fixed",
  },
  {
    accountCode: "5301", name: "Isänn.kokouspalkkiot", kind: "expense",
    group: "HALLINTOPALVELUT", nature: "maintenance", controllability: "variable",
  },
  {
    accountCode: "6100", name: "Julkisivukorjaus", kind: "expense",
    group: "KORJAUKSET", nature: "repair", controllability: "variable",
  },
];

describe("buildExpenseGroupViewModel", () => {
  it("groups accounts, computes the 2024→2025 change, and never shows historical budgets", () => {
    const entries = [
      { accountCode: "5300", year: 2024, budgetAmount: -5000, actualAmount: -5200 },
      { accountCode: "5300", year: 2025, budgetAmount: -5100, actualAmount: -5500 },
      { accountCode: "5300", year: 2026, budgetAmount: -5700 },
      { accountCode: "5301", year: 2024, actualAmount: -900 },
      { accountCode: "5301", year: 2025, actualAmount: -1000 },
    ];
    const vm = buildExpenseGroupViewModel(EXPENSE_ACCOUNTS, entries);

    expect(vm.isEmpty).toBe(false);
    expect(vm.budgetYear).toBe(2026);
    const group = vm.groups.find((g) => g.group === "HALLINTOPALVELUT");
    expect(group.actuals[2024]).toBe(-6100);
    expect(group.actuals[2025]).toBe(-6500);
    expect(group.changeAmount).toBe(-400);
    expect(group.budget).toBe(-5700);
  });

  it("shows \"—\" (undefined) for nature when accounts in a group disagree, and \"mixed\" for controllability", () => {
    const accounts = [
      { accountCode: "5300", name: "A", kind: "expense", group: "SEKARYHMÄ", nature: "maintenance", controllability: "fixed" },
      { accountCode: "5301", name: "B", kind: "expense", group: "SEKARYHMÄ", nature: "repair", controllability: "variable" },
    ];
    const entries = [
      { accountCode: "5300", year: 2025, actualAmount: -100 },
      { accountCode: "5301", year: 2025, actualAmount: -200 },
    ];
    const vm = buildExpenseGroupViewModel(accounts, entries);
    const group = vm.groups.find((g) => g.group === "SEKARYHMÄ");
    expect(group.nature).toBeUndefined();
    expect(group.controllability).toBe("mixed");
  });

  it("shows \"—\" (undefined) for nature/controllability when every account in the group leaves it blank", () => {
    const accounts = [
      { accountCode: "5400", name: "C", kind: "expense", group: "MUUT" },
    ];
    const entries = [{ accountCode: "5400", year: 2025, actualAmount: -50 }];
    const vm = buildExpenseGroupViewModel(accounts, entries);
    const group = vm.groups.find((g) => g.group === "MUUT");
    expect(group.nature).toBeUndefined();
    expect(group.controllability).toBeUndefined();
  });

  it("agrees on a single nature/controllability shared by every account in the group", () => {
    const vm = buildExpenseGroupViewModel(EXPENSE_ACCOUNTS, [
      { accountCode: "5300", year: 2025, actualAmount: -100 },
      { accountCode: "5301", year: 2025, actualAmount: -200 },
    ]);
    const group = vm.groups.find((g) => g.group === "HALLINTOPALVELUT");
    expect(group.nature).toBe("maintenance");
    expect(group.controllability).toBe("mixed"); // fixed vs. variable disagree -> "sekä"
  });

  it("is a first-class empty state pointing at the import view when there is no data", () => {
    const vm = buildExpenseGroupViewModel([], []);
    expect(vm.isEmpty).toBe(true);
    expect(vm.emptyMessage).toBe("Ei vielä talousdataa. Tuo se Liitä tilidataa -näkymästä.");
  });
});

describe("buildBudgetVsActualViewModel", () => {
  const accounts = [
    ...EXPENSE_ACCOUNTS,
    ...INCOME_ACCOUNTS,
  ];

  it("orders columns Budjetti before Toteuma and computes Erotus = Toteuma − Budjetti", () => {
    const entries = [
      { accountCode: "5300", year: 2025, budgetAmount: -5000, actualAmount: -5500 },
      { accountCode: "3000", year: 2025, budgetAmount: 30000, actualAmount: 31000 },
    ];
    const vm = buildBudgetVsActualViewModel(accounts, entries, 2025);

    expect(vm.isEmpty).toBe(false);
    expect(vm.year).toBe(2025);
    const expenseSection = vm.sections.find((s) => s.kind === "expense");
    const hallinto = expenseSection.groups.find((g) => g.group === "HALLINTOPALVELUT");
    expect(hallinto.budget).toBe(-5000);
    expect(hallinto.actual).toBe(-5500);
    expect(hallinto.diffAmount).toBe(-500);
    expect(hallinto.favorable).toBe(false); // expense: negative diff (more spent) = unfavorable

    const incomeSection = vm.sections.find((s) => s.kind === "income");
    const hoitovastikkeet = incomeSection.groups.find((g) => g.group === "Hoitovastikkeet");
    expect(hoitovastikkeet.diffAmount).toBe(1000);
    expect(hoitovastikkeet.favorable).toBe(true); // income: positive diff (more received) = favorable
  });

  it("leaves Erotus % empty (undefined) when the budget is 0, without NaN or Infinity", () => {
    const entries = [{ accountCode: "5300", year: 2025, budgetAmount: 0, actualAmount: -200 }];
    const vm = buildBudgetVsActualViewModel(accounts, entries, 2025);
    const group = vm.sections[0].groups[0];
    expect(group.budget).toBe(0);
    expect(group.diffAmount).toBe(-200);
    expect(group.diffPercent).toBeUndefined();
  });

  it("leaves Erotus and Erotus % empty when the budget is missing entirely", () => {
    const entries = [{ accountCode: "5300", year: 2025, actualAmount: -200 }];
    const vm = buildBudgetVsActualViewModel(accounts, entries, 2025);
    const group = vm.sections[0].groups[0];
    expect(group.budget).toBeUndefined();
    expect(group.diffAmount).toBeUndefined();
    expect(group.diffPercent).toBeUndefined();
    expect(group.favorable).toBeUndefined();
  });

  it("computes KPI totals across both kinds for the selected year", () => {
    const entries = [
      { accountCode: "5300", year: 2025, budgetAmount: -5000, actualAmount: -5500 },
      { accountCode: "3000", year: 2025, budgetAmount: 30000, actualAmount: 31000 },
    ];
    const vm = buildBudgetVsActualViewModel(accounts, entries, 2025);
    expect(vm.kpis.totalBudget).toBe(25000);
    expect(vm.kpis.totalActual).toBe(25500);
    expect(vm.kpis.netDiff).toBe(500);
    expect(vm.kpis.avgAbsDeviation).toBe((500 + 1000) / 2);
  });

  it("is a first-class empty state when the selected year has no data", () => {
    const entries = [{ accountCode: "5300", year: 2024, budgetAmount: -100, actualAmount: -100 }];
    const vm = buildBudgetVsActualViewModel(accounts, entries, 2025);
    expect(vm.isEmpty).toBe(true);
    expect(vm.sections).toEqual([]);
    expect(vm.kpis).toBeNull();
    expect(vm.emptyMessage).toBe("Ei vielä talousdataa. Tuo se Liitä tilidataa -näkymästä.");
  });

  it("is empty when no year is selected", () => {
    const vm = buildBudgetVsActualViewModel(accounts, [{ accountCode: "5300", year: 2025, actualAmount: -1 }], undefined);
    expect(vm.isEmpty).toBe(true);
    expect(vm.year).toBeNull();
  });
});

describe("buildGroupBudgetId", () => {
  it("is a deterministic kind::group::year composite", () => {
    expect(buildGroupBudgetId("expense", "Sähkö", 2024)).toBe("expense::Sähkö::2024");
    expect(buildGroupBudgetId("expense", "Sähkö", 2024)).toBe(buildGroupBudgetId("expense", "Sähkö", 2024));
    expect(buildGroupBudgetId("income", "Sähkö", 2024)).not.toBe(buildGroupBudgetId("expense", "Sähkö", 2024));
  });
});

describe("parseGroupBudgetPasteInput", () => {
  const accounts = [
    { accountCode: "5400", kind: "expense", group: "Sähkö" },
    { accountCode: "3000", kind: "income", group: "Hoitovastikkeet" },
  ];

  it("parses valid rows and skips a recognized header row", () => {
    const text = [
      "kind\tryhmä\tvuosi\tbudjetti",
      "kulu\tSähkö\t2024\t-10000",
      "tulo\tHoitovastikkeet\t2024\t30000",
    ].join("\n");
    const parsed = parseGroupBudgetPasteInput(text, accounts);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.groupBudgets).toEqual([
      { id: "expense::Sähkö::2024", kind: "expense", group: "Sähkö", year: 2024, budgetAmount: -10000 },
      { id: "income::Hoitovastikkeet::2024", kind: "income", group: "Hoitovastikkeet", year: 2024, budgetAmount: 30000 },
    ]);
  });

  it("rejects an unknown kind", () => {
    const parsed = parseGroupBudgetPasteInput("meno\tSähkö\t2024\t-10000", accounts);
    expect(parsed.groupBudgets).toEqual([]);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].message).toMatch(/tuntematon kind/);
  });

  it("rejects a missing group", () => {
    const parsed = parseGroupBudgetPasteInput("kulu\t\t2024\t-10000", accounts);
    expect(parsed.errors[0].message).toMatch(/ryhmä puuttuu/);
  });

  it("rejects a non-integer year", () => {
    const parsed = parseGroupBudgetPasteInput("kulu\tSähkö\t2024.5\t-10000", accounts);
    expect(parsed.errors[0].message).toMatch(/vuosi/);
  });

  it("rejects a missing budget", () => {
    const parsed = parseGroupBudgetPasteInput("kulu\tSähkö\t2024\t", accounts);
    expect(parsed.errors[0].message).toMatch(/budjetti puuttuu/);
  });

  it("rejects a non-numeric budget", () => {
    const parsed = parseGroupBudgetPasteInput("kulu\tSähkö\t2024\tabc", accounts);
    expect(parsed.errors[0].message).toMatch(/ei ole luku/);
  });

  it("rejects a duplicate kind+group+year", () => {
    const text = "kulu\tSähkö\t2024\t-10000\nkulu\tSähkö\t2024\t-11000";
    const parsed = parseGroupBudgetPasteInput(text, accounts);
    expect(parsed.groupBudgets).toHaveLength(1);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].message).toMatch(/esiintyy jo aiemmalla rivillä/);
  });

  it("warns but does not block on a group name that matches no account (typo case)", () => {
    const parsed = parseGroupBudgetPasteInput("kulu\tSähkö- ja vesi\t2024\t-10000", accounts);
    expect(parsed.errors).toEqual([]);
    expect(parsed.groupBudgets).toHaveLength(1);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0].message).toMatch(/ei täsmää mihinkään tiliryhmään/);
  });

  it("rejects a row with the wrong column count", () => {
    const parsed = parseGroupBudgetPasteInput("kulu\tSähkö\t2024", accounts);
    expect(parsed.errors[0].message).toMatch(/saraketta/);
  });
});

describe("buildGroupBudgetImportOperations", () => {
  it("builds save_group_budget operations defaulting active: true", () => {
    const parsed = { groupBudgets: [{ id: "expense::Sähkö::2024", kind: "expense", group: "Sähkö", year: 2024, budgetAmount: -10000 }] };
    const ops = buildGroupBudgetImportOperations(parsed, { sourceIds: ["src1"], explanation: "Tuonti" });
    expect(ops).toEqual([{
      type: "save_group_budget",
      value: { id: "expense::Sähkö::2024", kind: "expense", group: "Sähkö", year: 2024, budgetAmount: -10000, active: true, sourceIds: ["src1"] },
      sourceIds: ["src1"],
      explanation: "Tuonti",
    }]);
  });
});

const GROUP_BUDGET_ACCOUNTS = [
  { accountCode: "5400", name: "Sähkölasku", kind: "expense", group: "Sähkö" },
  { accountCode: "5401", name: "Sähkösopimus", kind: "expense", group: "Sähkö" },
  { accountCode: "5500", name: "Korjaus", kind: "expense", group: "Korjaukset" },
  { accountCode: "3200", name: "Autopaikkavuokrat", kind: "income", group: "Vuokrat" },
];

describe("deriveComparableGroupBudgetYears", () => {
  it("includes a year when a group has both actual and an active GroupBudget", () => {
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -9000 }];
    const groupBudgets = [{ id: "expense::Sähkö::2024", kind: "expense", group: "Sähkö", year: 2024, budgetAmount: -10000, active: true }];
    expect(deriveComparableGroupBudgetYears(GROUP_BUDGET_ACCOUNTS, entries, groupBudgets)).toEqual([2024]);
  });

  it("includes a year when a group has both actual and a tili-summed budget (no GroupBudget)", () => {
    const entries = [{ accountCode: "5400", year: 2025, actualAmount: -9000, budgetAmount: -10000 }];
    expect(deriveComparableGroupBudgetYears(GROUP_BUDGET_ACCOUNTS, entries, [])).toEqual([2025]);
  });

  it("excludes a year when only actual exists (no budget from either source)", () => {
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -9000 }];
    expect(deriveComparableGroupBudgetYears(GROUP_BUDGET_ACCOUNTS, entries, [])).toEqual([]);
  });

  it("excludes a year when only a GroupBudget exists with no actual anywhere in the group", () => {
    const groupBudgets = [{ id: "expense::Sähkö::2024", kind: "expense", group: "Sähkö", year: 2024, budgetAmount: -10000, active: true }];
    expect(deriveComparableGroupBudgetYears(GROUP_BUDGET_ACCOUNTS, [], groupBudgets)).toEqual([]);
  });

  it("ignores an inactive GroupBudget", () => {
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -9000 }];
    const groupBudgets = [{ id: "expense::Sähkö::2024", kind: "expense", group: "Sähkö", year: 2024, budgetAmount: -10000, active: false }];
    expect(deriveComparableGroupBudgetYears(GROUP_BUDGET_ACCOUNTS, entries, groupBudgets)).toEqual([]);
  });
});

describe("buildGroupBudgetVsActualViewModel", () => {
  it("is empty with no accounts or no year selected", () => {
    expect(buildGroupBudgetVsActualViewModel([], [], [], 2024).isEmpty).toBe(true);
    expect(buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, [], [], undefined).isEmpty).toBe(true);
  });

  it("is empty when the selected year has no data from either source", () => {
    const entries = [{ accountCode: "5400", year: 2023, actualAmount: -9000 }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], 2024);
    expect(vm.isEmpty).toBe(true);
    expect(vm.year).toBe(2024);
  });

  it("prefers an active GroupBudget over the tili-summed budget and surfaces the overridden figure (budgetSource etusijasääntö)", () => {
    const entries = [
      { accountCode: "5400", year: 2024, actualAmount: -6000, budgetAmount: -5000 },
      { accountCode: "5401", year: 2024, actualAmount: -3000, budgetAmount: -4000 },
    ];
    const groupBudgets = [{ id: "expense::Sähkö::2024", kind: "expense", group: "Sähkö", year: 2024, budgetAmount: -10000, active: true }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, groupBudgets, 2024);
    const sahko = vm.sections.find((s) => s.kind === "expense").groups.find((g) => g.group === "Sähkö");
    expect(sahko.budget).toBe(-10000);
    expect(sahko.budgetSource).toBe("group");
    expect(sahko.overriddenAccountsBudget).toBe(-9000); // -5000 + -4000, the tili-summed budget that lost
    expect(sahko.actual).toBe(-9000); // -6000 + -3000
  });

  it("falls back to the tili-summed budget when no active GroupBudget exists for the row", () => {
    const entries = [{ accountCode: "5500", year: 2024, actualAmount: -1500, budgetAmount: -2000 }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], 2024);
    const korjaukset = vm.sections.find((s) => s.kind === "expense").groups.find((g) => g.group === "Korjaukset");
    expect(korjaukset.budget).toBe(-2000);
    expect(korjaukset.budgetSource).toBe("accounts");
    expect(korjaukset.overriddenAccountsBudget).toBeUndefined();
  });

  it("ignores an inactive GroupBudget and falls back to the tili-summed budget", () => {
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -6000, budgetAmount: -5000 }];
    const groupBudgets = [{ id: "expense::Sähkö::2024", kind: "expense", group: "Sähkö", year: 2024, budgetAmount: -10000, active: false }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, groupBudgets, 2024);
    const sahko = vm.sections.find((s) => s.kind === "expense").groups.find((g) => g.group === "Sähkö");
    expect(sahko.budget).toBe(-5000);
    expect(sahko.budgetSource).toBe("accounts");
  });

  it("includes a row budgeted with no actual (one-sided, handoff §3(b)) without treating the missing side as zero", () => {
    const groupBudgets = [{ id: "expense::Korjaukset::2024", kind: "expense", group: "Korjaukset", year: 2024, budgetAmount: -5000, active: true }];
    // Another group needs *some* actual data this year so the view isn't
    // considered empty overall.
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -1000, budgetAmount: -1000 }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, groupBudgets, 2024);
    const korjaukset = vm.sections.find((s) => s.kind === "expense").groups.find((g) => g.group === "Korjaukset");
    expect(korjaukset.budget).toBe(-5000);
    expect(korjaukset.actual).toBeUndefined();
    expect(korjaukset.diffAmount).toBeUndefined();
    expect(korjaukset.diffPercent).toBeUndefined();
    expect(korjaukset.favorable).toBeUndefined();
  });

  it("includes a row with actual but no budget from either source (one-sided, handoff §3(b))", () => {
    const entries = [{ accountCode: "5500", year: 2024, actualAmount: -3200 }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], 2024);
    const korjaukset = vm.sections.find((s) => s.kind === "expense").groups.find((g) => g.group === "Korjaukset");
    expect(korjaukset.actual).toBe(-3200);
    expect(korjaukset.budget).toBeUndefined();
    expect(korjaukset.budgetSource).toBeUndefined();
    expect(korjaukset.diffAmount).toBeUndefined();
    expect(korjaukset.favorable).toBeUndefined();
  });

  it("sign convention: an expense group that came in under budget shows a positive diffAmount and favorable: true", () => {
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -9000 }];
    const groupBudgets = [{ id: "expense::Sähkö::2024", kind: "expense", group: "Sähkö", year: 2024, budgetAmount: -10000, active: true }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, groupBudgets, 2024);
    const sahko = vm.sections.find((s) => s.kind === "expense").groups.find((g) => g.group === "Sähkö");
    expect(sahko.diffAmount).toBe(1000); // -9000 - (-10000)
    expect(sahko.favorable).toBe(true); // |−9000| <= |−10000|: alitus, edullinen
  });

  it("sign convention: an income group that came in under budget shows a negative diffAmount and favorable: false", () => {
    const entries = [{ accountCode: "3200", year: 2024, actualAmount: 28000 }];
    const groupBudgets = [{ id: "income::Vuokrat::2024", kind: "income", group: "Vuokrat", year: 2024, budgetAmount: 30000, active: true }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, groupBudgets, 2024);
    const vuokrat = vm.sections.find((s) => s.kind === "income").groups.find((g) => g.group === "Vuokrat");
    expect(vuokrat.diffAmount).toBe(-2000); // 28000 - 30000
    expect(vuokrat.favorable).toBe(false); // tulot jäivät, epäedullinen
  });

  it("exposes the tili-level breakdown on rows for the detail panel", () => {
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -6000, budgetAmount: -5000 }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], 2024);
    const sahko = vm.sections.find((s) => s.kind === "expense").groups.find((g) => g.group === "Sähkö");
    expect(sahko.rows).toEqual([{ accountCode: "5400", name: "Sähkölasku", budget: -5000, actual: -6000, diffAmount: -1000, diffPercent: 20 }]);
  });

  it("kpis are split by kind instead of summed together (mixing signed expense and income totals is meaningless)", () => {
    const entries = [
      { accountCode: "5400", year: 2024, actualAmount: -9000, budgetAmount: -10000 }, // expense
      { accountCode: "3200", year: 2024, actualAmount: 28000, budgetAmount: 30000 }, // income
    ];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], 2024);
    expect(vm.kpis.expense).toEqual({ totalBudget: -10000, totalActual: -9000, netDiff: 1000, avgAbsDeviationPercent: 10 });
    expect(vm.kpis.income).toEqual({ totalBudget: 30000, totalActual: 28000, netDiff: -2000, avgAbsDeviationPercent: (2000 / 30000) * 100 });
  });

  it("kpis.<kind> is null when that kind has no accounts at all (mirrors sections not having that kind)", () => {
    const expenseOnlyAccounts = GROUP_BUDGET_ACCOUNTS.filter((a) => a.kind === "expense");
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -9000, budgetAmount: -10000 }];
    const vm = buildGroupBudgetVsActualViewModel(expenseOnlyAccounts, entries, [], 2024);
    expect(vm.sections.some((s) => s.kind === "income")).toBe(false);
    expect(vm.kpis.income).toBeNull();
    expect(vm.kpis.expense).not.toBeNull();
  });

  it("avgAbsDeviationPercent is computed per kind, not once across both (an income group would dilute the expense figure)", () => {
    // Shaped after the source Excel's Budjettitarkkuus sheet, which reports the
    // metric for expenses separately: with one income group at a near-zero
    // deviation, a single combined average understates how far expense
    // budgeting actually missed. Figures are synthetic but chosen to land on
    // the production 2025 pair (kulut 37,3 %, tulot 2,3 %) so the split stays
    // legible; the real dataset lives in the user's data, not in this repo.
    const entries = [
      { accountCode: "5400", year: 2025, actualAmount: -14000, budgetAmount: -10000 }, // Sähkö: |diffPercent| = 40
      { accountCode: "5500", year: 2025, actualAmount: -6730, budgetAmount: -5000 }, // Korjaukset: |diffPercent| = 34.6
      { accountCode: "3200", year: 2025, actualAmount: 30690, budgetAmount: 30000 }, // Vuokrat: |diffPercent| = 2.3
    ];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], 2025);
    expect(vm.kpis.expense.avgAbsDeviationPercent).toBeCloseTo(37.3, 6);
    expect(vm.kpis.income.avgAbsDeviationPercent).toBeCloseTo(2.3, 6);
    // and not the combined (40 + 34.6 + 2.3) / 3 the old top-level KPI showed
    expect(vm.kpis.expense.avgAbsDeviationPercent).not.toBeCloseTo((40 + 34.6 + 2.3) / 3, 6);
  });

  it("avgAbsDeviationPercent excludes a row whose diffPercent is undefined (one-sided row, or budget of 0)", () => {
    const entries = [
      { accountCode: "5400", year: 2024, actualAmount: -9000, budgetAmount: -10000 }, // Sähkö: |diffPercent| = 10
      { accountCode: "5500", year: 2024, actualAmount: -3200 }, // Korjaukset, one-sided: no budget, diffPercent undefined
    ];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], 2024);
    expect(vm.kpis.expense.avgAbsDeviationPercent).toBeCloseTo(10, 6);
  });

  it("avgAbsDeviationPercent is undefined (rendered \u2014, not 0 %) for a kind with rows but no computable deviation", () => {
    const entries = [
      { accountCode: "5400", year: 2024, actualAmount: -9000, budgetAmount: -10000 },
      { accountCode: "3200", year: 2024, actualAmount: 28000 }, // income, one-sided only
    ];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], 2024);
    expect(vm.kpis.income.avgAbsDeviationPercent).toBeUndefined();
    expect(vm.kpis.expense.avgAbsDeviationPercent).toBeCloseTo(10, 6);
  });

  it("kpis has no top-level avgAbsDeviationPercent any more (it lives on each kind)", () => {
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -9000, budgetAmount: -10000 }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], 2024);
    expect(vm.kpis.avgAbsDeviationPercent).toBeUndefined();
    expect(Object.keys(vm.kpis).sort()).toEqual(["expense", "income"]);
  });
});

describe("group budget separation from account-level views (rajaus regression)", () => {
  it("buildExpenseGroupViewModel totals are unaffected by the presence of groupBudgets", () => {
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -6000, budgetAmount: -5000 }];
    // buildExpenseGroupViewModel takes no groupBudgets parameter at all — this
    // test exists so a future signature change that accidentally wires it in
    // would have to also break this call, not silently change the totals.
    const vm = buildExpenseGroupViewModel(GROUP_BUDGET_ACCOUNTS, entries);
    const sahko = vm.groups.find((g) => g.group === "Sähkö");
    expect(sahko.actuals[2024]).toBe(-6000);
  });
});

/**
 * A model shaped like state.admin with one asset carrying the full chain:
 * observation → event (citing both the observation and two evidence rows),
 * plus a price-level confirmation and a second, unrelated asset.
 */
const DELETE_MODEL = {
  assets: [
    { id: "asset_roof", name: "Vesikatto", category: "envelope", active: true, sourceIds: ["s"] },
    { id: "asset_yard", name: "Piha-alue", category: "yard", active: true, sourceIds: ["s"] },
  ],
  observations: [
    { id: "obs_roof_leak", assetId: "asset_roof", description: "Vuoto katolla", observedAt: "2026-01-02", sourceIds: ["s"] },
    { id: "obs_yard_crack", assetId: "asset_yard", description: "Halkeama", observedAt: "2026-01-03", sourceIds: ["s"] },
  ],
  events: [
    {
      id: "event_roof_repair",
      assetId: "asset_roof",
      title: "Katon korjaus",
      observationIds: ["obs_roof_leak"],
      schedule: [
        { id: "base_2030", scenario: "base", year: 2030, costEvidenceId: "quote_roof_2026" },
        { id: "stress_2028", scenario: "stress", year: 2028, costEvidenceId: "quote_roof_2026" },
      ],
    },
    {
      id: "event_yard_repair",
      assetId: "asset_yard",
      title: "Pihan korjaus",
      observationIds: ["obs_roof_leak", "obs_yard_crack"],
      schedule: [{ id: "base_2031", scenario: "base", year: 2031, costEvidenceId: "quote_yard_2026" }],
    },
  ],
  costEvidence: [
    { id: "quote_roof_2026", assetId: "asset_roof", eventId: "event_roof_repair", status: "quote" },
    { id: "quote_yard_2026", assetId: "asset_yard", eventId: "event_yard_repair", status: "quote" },
    { id: "quote_loose_2026", status: "quote", eventId: "event_roof_repair" },
  ],
  priceLevelConfirmations: [{ costEvidenceId: "quote_roof_2026", confirmedYear: 2026 }],
  financialAccounts: [
    { accountCode: "5300", name: "Isännöintipalkkiot", kind: "expense", group: "Hallintopalvelut", active: true },
    { accountCode: "5400", name: "Sähkölasku", kind: "expense", group: "Sähkö", active: true },
  ],
  financialEntries: [
    { accountCode: "5300", year: 2024, actualAmount: -12000, sourceIds: ["tp_2024"] },
    { accountCode: "5300", year: 2025, actualAmount: -12800, sourceIds: ["tp_2025"] },
    { accountCode: "5400", year: 2025, actualAmount: -9000, sourceIds: ["tp_2025"] },
  ],
  balanceSheetSnapshots: [{ id: "tase-testi-2025", asOfDate: "2025-12-31", entries: [] }],
  groupBudgets: [{ id: "expense::Sähkö::2025", kind: "expense", group: "Sähkö", year: 2025, budgetAmount: -10000, active: true }],
};

/** @param {ReturnType<typeof planEntityDeletion>} plan */
function deletedKeys(plan) {
  return plan.deletes.map((item) => `${item.entityType}:${item.entityKey}`).sort();
}

describe("planEntityDeletion", () => {
  it("plans a lone entity as itself with nothing else affected", () => {
    const plan = planEntityDeletion(DELETE_MODEL, { entityType: "balance_sheet_snapshot", entityKey: "tase-testi-2025" });
    expect(deletedKeys(plan)).toEqual(["balance_sheet_snapshot:tase-testi-2025"]);
    expect(plan.updates).toEqual([]);
    expect(summarizeDeletionPlan(plan)).toEqual([]);
  });

  it("takes an asset's observations, events, evidence and price-level confirmation with it", () => {
    const plan = planEntityDeletion(DELETE_MODEL, { entityType: "asset", entityKey: "asset_roof" });
    expect(deletedKeys(plan)).toEqual([
      "asset:asset_roof",
      "building_event:event_roof_repair",
      "cost_evidence:quote_roof_2026",
      "observation:obs_roof_leak",
      "price_level_confirmation:quote_roof_2026",
    ]);
  });

  it("rewrites, rather than deletes, an unrelated event that referenced a deleted observation", () => {
    // Both events cite this observation; neither is destroyed by losing it.
    const plan = planEntityDeletion(DELETE_MODEL, { entityType: "observation", entityKey: "obs_roof_leak" });
    expect(deletedKeys(plan)).toEqual(["observation:obs_roof_leak"]);
    expect(plan.updates.map((item) => item.entityKey)).toEqual([
      "event_roof_repair",
      "event_yard_repair",
    ]);
    expect(plan.updates.every((item) => item.entityType === "building_event")).toBe(true);
    expect(plan.updates[0].value.observationIds).toEqual([]);
    expect(plan.updates[1].value.observationIds).toEqual(["obs_yard_crack"]);
  });

  it("clears eventId on surviving cost evidence instead of deleting the evidence", () => {
    // quote_loose_2026 has no assetId, so nothing else pulls it into the
    // cascade — it must survive the event's deletion with eventId gone.
    const plan = planEntityDeletion(DELETE_MODEL, { entityType: "building_event", entityKey: "event_roof_repair" });
    expect(deletedKeys(plan)).toEqual(["building_event:event_roof_repair"]);
    const update = plan.updates.find((item) => item.entityKey === "quote_loose_2026");
    expect(update).toBeDefined();
    expect("eventId" in update.value).toBe(false);
    expect(update.value.status).toBe("quote");
  });

  it("deletes every event citing a deleted cost evidence, and reports the schedule rows that go with them", () => {
    const plan = planEntityDeletion(DELETE_MODEL, { entityType: "cost_evidence", entityKey: "quote_roof_2026" });
    expect(deletedKeys(plan)).toEqual([
      "building_event:event_roof_repair",
      "cost_evidence:quote_roof_2026",
      "price_level_confirmation:quote_roof_2026",
    ]);
    expect(plan.scheduleRowCount).toBe(2);
    expect(summarizeDeletionPlan(plan)).toContain("1 korjaustapahtuma (2 aikatauluriviä)");
  });

  it("terminates on the event ↔ evidence cycle instead of looping", () => {
    // asset_yard's event cites quote_yard_2026, which points back at the event.
    const plan = planEntityDeletion(DELETE_MODEL, { entityType: "asset", entityKey: "asset_yard" });
    expect(deletedKeys(plan)).toEqual([
      "asset:asset_yard",
      "building_event:event_yard_repair",
      "cost_evidence:quote_yard_2026",
      "observation:obs_yard_crack",
    ]);
    // quote_loose_2026 pointed at the *other* event, so it is untouched here.
    expect(plan.updates).toEqual([]);
  });

  it("deletes a financial account's entries with it, leaving other accounts alone", () => {
    const plan = planEntityDeletion(DELETE_MODEL, { entityType: "financial_account", entityKey: "5300" });
    expect(deletedKeys(plan)).toEqual([
      "financial_account:5300",
      "financial_entry:5300:2024",
      "financial_entry:5300:2025",
    ]);
  });

  it("deletes a single financial entry without touching its account or sibling year", () => {
    const plan = planEntityDeletion(DELETE_MODEL, { entityType: "financial_entry", entityKey: "5300:2025" });
    expect(deletedKeys(plan)).toEqual(["financial_entry:5300:2025"]);
  });

  it("labels the target and the collateral in Finnish for the confirmation view", () => {
    const plan = planEntityDeletion(DELETE_MODEL, { entityType: "asset", entityKey: "asset_roof" });
    expect(plan.target.label).toBe("Vesikatto");
    expect(summarizeDeletionPlan(plan)).toEqual([
      "1 havainto · lähde: s",
      "1 korjaustapahtuma (2 aikatauluriviä)",
      "1 kustannusnäyttö",
      "1 hintatasovahvistus",
      "Pihan korjaus: viittaus poistettavaan havaintoon poistetaan",
      "quote_loose_2026: viittaus poistettavaan korjaustapahtumaan poistetaan, näyttö itse säilyy",
    ]);
  });

  // A live deletion once hit the real row instead of the test row because the
  // two shared a name. The confirmation has to name the source of the target
  // and of anything the cascade drags along with it.
  //
  // These assert the rendered sentence, not merely that a sources field
  // exists: the first version of this feature populated the field correctly
  // and still printed the wrong text.
  it("renders the target sentence with the source of an entity that keeps sourceIds", () => {
    const model = {
      assets: [
        { id: "asset_a", name: "Putki", sourceIds: ["excel_terminaali_2026_kuluva_kausi"] },
        { id: "asset_b", name: "Putki", sourceIds: ["ffg"] },
      ],
      observations: [
        { id: "obs_a", assetId: "asset_a", description: "Vuoto", sourceIds: ["inspection_2026"] },
      ],
    };

    expect(formatDeletionTarget(planEntityDeletion(model, { entityType: "asset", entityKey: "asset_b" })))
      .toBe("Putki (lähde: ffg)");
    const real = planEntityDeletion(model, { entityType: "asset", entityKey: "asset_a" });
    expect(formatDeletionTarget(real))
      .toBe("Putki (lähde: excel_terminaali_2026_kuluva_kausi)");
    // The observation came from a different import than its asset; that is
    // exactly the case the summary must not hide.
    expect(summarizeDeletionPlan(real)).toEqual(["1 havainto · lähde: inspection_2026"]);
  });

  // CostEvidence is the one entity with a singular `sourceId` string instead
  // of a `sourceIds` array; reading the array field left it sourceless.
  it("renders the singular sourceId of a cost evidence, and prefers its sourceUrl", () => {
    const model = {
      costEvidence: [
        { id: "quote_a", status: "quote", sourceId: "excel_terminaali_2026_pitka_aikavali" },
        { id: "quote_b", status: "quote", sourceId: "ffg", sourceUrl: "https://example.test/tarjous.pdf" },
      ],
    };

    expect(formatDeletionTarget(planEntityDeletion(model, { entityType: "cost_evidence", entityKey: "quote_a" })))
      .toBe("quote_a (lähde: excel_terminaali_2026_pitka_aikavali)");
    expect(formatDeletionTarget(planEntityDeletion(model, { entityType: "cost_evidence", entityKey: "quote_b" })))
      .toBe("quote_b (lähde: https://example.test/tarjous.pdf)");
  });

  // A source identifier that arrives as a bare string must not be spread into
  // its characters, and a numeric one must not lose its digits.
  it("keeps a non-array source identifier whole", () => {
    const model = { assets: [{ id: "a", name: "Putki", sourceIds: "ffg" }] };
    expect(formatDeletionTarget(planEntityDeletion(model, { entityType: "asset", entityKey: "a" })))
      .toBe("Putki (lähde: ffg)");

    const numeric = { assets: [{ id: "a", name: "Putki", sourceIds: [23] }] };
    expect(formatDeletionTarget(planEntityDeletion(numeric, { entityType: "asset", entityKey: "a" })))
      .toBe("Putki (lähde: 23)");
  });

  it("borrows an account's sources from its entries and prints none when there are none", () => {
    expect(formatDeletionTarget(planEntityDeletion(DELETE_MODEL, {
      entityType: "financial_account", entityKey: "5300",
    }))).toBe("5300 Isännöintipalkkiot (lähteet: tp_2024, tp_2025)");

    // The yard asset carries a source; its event does not, so the cascade
    // line for the event stays bare rather than inventing one.
    const plan = planEntityDeletion(DELETE_MODEL, { entityType: "asset", entityKey: "asset_yard" });
    expect(formatDeletionTarget(plan)).toBe("Piha-alue (lähde: s)");
    expect(summarizeDeletionPlan(plan)).toContain("1 korjaustapahtuma (1 aikataulurivi)");
    expect(formatDeletionSources([])).toBe("");
    expect(formatDeletionSources(["a", "b"])).toBe("lähteet: a, b");
  });

  it("prints the label alone for a target with no source at all", () => {
    const model = { balanceSheetSnapshots: [{ id: "tase-2025", entries: [] }] };
    expect(formatDeletionTarget(planEntityDeletion(model, {
      entityType: "balance_sheet_snapshot", entityKey: "tase-2025",
    }))).toBe("tase-2025");
  });
});

describe("buildDeletionOperations", () => {
  it("emits every update before every delete, with the target key as sourceIds", () => {
    const plan = planEntityDeletion(DELETE_MODEL, { entityType: "building_event", entityKey: "event_roof_repair" });
    const operations = buildDeletionOperations(plan, { explanation: "Testidataa, poistetaan." });

    // Both evidence rows pointed at this event and both survive it.
    expect(operations.map((item) => item.type)).toEqual([
      "save_cost_evidence",
      "save_cost_evidence",
      "delete_entity",
    ]);
    expect(operations.every((item) => item.explanation === "Testidataa, poistetaan.")).toBe(true);
    // A delete has no external source document; demanding one would be exactly
    // the friction this feature removes.
    expect(operations.every((item) => item.sourceIds.length === 1)).toBe(true);
    expect(operations[0].sourceIds).toEqual(["building_event:event_roof_repair"]);
    expect(operations.at(-1)).toMatchObject({
      type: "delete_entity",
      entityType: "building_event",
      entityKey: "event_roof_repair",
    });
  });

  it("produces a batch that applyAdminBatch accepts, and the result matches the preview", () => {
    const snapshot = createAdminDataSnapshot({
      housingCompany: { id: "company_1", name: "As Oy Testi", apartmentCount: 12 },
      assets: DELETE_MODEL.assets,
      observations: DELETE_MODEL.observations,
      updatedAt: "2026-09-01T09:00:00Z",
      updatedBy: "admin:pasi",
    });
    const plan = planEntityDeletion(snapshot, { entityType: "asset", entityKey: "asset_yard" });
    const next = applyAdminBatch(snapshot, {
      companyId: "company_1",
      expectedRevision: snapshot.revision,
      actorId: "admin:pasi",
      occurredAt: "2026-09-01T10:00:00Z",
      operations: buildDeletionOperations(plan, { explanation: "Testidataa." }),
    });

    // Exactly what the preview listed, no more and no less.
    expect(next.assets.map((item) => item.id)).toEqual(["asset_roof"]);
    expect(next.observations.map((item) => item.id)).toEqual(["obs_roof_leak"]);
    expect(next.auditTrail.map((item) => item.operation)).toEqual(["delete", "delete"]);
  });
});

describe("interpretRevisionConflict with a stale delete target", () => {
  it("treats DELETE_TARGET_NOT_FOUND as a conflict, so the UI asks for a reload", () => {
    const result = interpretRevisionConflict({ code: "DELETE_TARGET_NOT_FOUND", message: "x" });
    expect(result.isConflict).toBe(true);
    expect(result.message).toMatch(/Lataa työtila uudelleen/);
  });
});

describe("validateDeletionMeta", () => {
  it("requires an explanation", () => {
    expect(validateDeletionMeta({ explanation: "   " }).ok).toBe(false);
    expect(validateDeletionMeta({ explanation: "Testidataa." })).toEqual({
      ok: true,
      value: { explanation: "Testidataa." },
    });
  });

  it("does not ask for sourceIds at all", () => {
    expect(validateDeletionMeta({ explanation: "Testidataa." }).errors).toBeUndefined();
  });
});

describe("listDataImports / planImportDeletion", () => {
  const IMPORT_MODEL = {
    financialAccounts: [
      { accountCode: "5300", name: "Isännöintipalkkiot", kind: "expense", group: "Hallintopalvelut", active: true },
      { accountCode: "5400", name: "Sähkölasku", kind: "expense", group: "Sähkö", active: true },
      { accountCode: "5500", name: "Korjaus", kind: "expense", group: "Korjaukset", active: true },
    ],
    financialEntries: [
      { accountCode: "5300", year: 2024, actualAmount: -12000, sourceIds: ["tp_2024"] },
      { accountCode: "5300", year: 2025, actualAmount: -12800, sourceIds: ["tp_2025"] },
      { accountCode: "5400", year: 2025, actualAmount: -9000, sourceIds: ["tp_2025"] },
      // Two sources on one row: it belongs to neither single-id group.
      { accountCode: "5500", year: 2025, actualAmount: -3000, sourceIds: ["tp_2025", "korjauserittely"] },
    ],
    groupBudgets: [
      { id: "expense::Sähkö::2025", kind: "expense", group: "Sähkö", year: 2025, budgetAmount: -10000, active: true, sourceIds: ["ryhmabudjetti_2025"] },
    ],
  };

  it("groups rows by their whole sourceIds set, counting years and accounts", () => {
    const imports = listDataImports(IMPORT_MODEL);
    expect(imports.map((item) => item.key)).toEqual([
      "korjauserittely,tp_2025",
      "ryhmabudjetti_2025",
      "tp_2024",
      "tp_2025",
    ]);
    const tp2025 = imports.find((item) => item.key === "tp_2025");
    expect(tp2025).toMatchObject({ entryCount: 2, accountCount: 2, groupBudgetCount: 0, years: [2025] });
    expect(imports.find((item) => item.key === "ryhmabudjetti_2025")).toMatchObject({
      entryCount: 0,
      groupBudgetCount: 1,
    });
  });

  it("deletes exactly one import's rows and nothing else", () => {
    const plan = planImportDeletion(IMPORT_MODEL, "tp_2025");
    expect(deletedKeys(plan)).toEqual([
      "financial_account:5400",
      "financial_entry:5300:2025",
      "financial_entry:5400:2025",
    ]);
    // 5300 keeps its 2024 row, so the account stays; 5500's row carries a
    // different source set and is untouched.
    expect(plan.sourceIds).toEqual(["tp_2025"]);
  });

  it("uses the import's own source identifiers as the operations' sourceIds", () => {
    const plan = planImportDeletion(IMPORT_MODEL, "korjauserittely,tp_2025");
    const operations = buildDeletionOperations(plan, { explanation: "Väärä vuosi." });
    expect(operations.every((item) => item.sourceIds.join(",") === "korjauserittely,tp_2025")).toBe(true);
    expect(deletedKeys(plan)).toEqual(["financial_account:5500", "financial_entry:5500:2025"]);
  });

  it("reuses the same grouping for group budgets", () => {
    const plan = planImportDeletion(IMPORT_MODEL, "ryhmabudjetti_2025");
    expect(deletedKeys(plan)).toEqual(["group_budget:expense::Sähkö::2025"]);
    expect(summarizeDeletionPlan(plan)).toEqual([
      "1 ryhmäbudjetti · lähde: ryhmabudjetti_2025",
    ]);
  });

  it("reports an unknown key as an empty plan rather than deleting everything", () => {
    const plan = planImportDeletion(IMPORT_MODEL, "ei_tallaista");
    expect(plan.isEmpty).toBe(true);
    expect(plan.deletes).toEqual([]);
  });
});

describe("re-import value drops", () => {
  const EXISTING_ENTRIES = [
    { accountCode: "5300", year: 2025, budgetAmount: 13000, actualAmount: 12800 },
    { accountCode: "5400", year: 2025, actualAmount: -9000 },
  ];

  it("warns when a paste omits a column the stored row has a value in", () => {
    // Upsert replaces the row whole, so a toteuma-only paste erases the budget.
    const parsed = { entries: [{ accountCode: "5300", year: 2025, actualAmount: 12500 }] };
    expect(detectFinancialImportValueDrops(parsed, EXISTING_ENTRIES)).toEqual([
      "5300:2025: liitos ei sisällä budjettia, nykyinen arvo 13000 poistuu.",
    ]);
  });

  it("stays quiet when the paste carries both values, or the row is new", () => {
    expect(detectFinancialImportValueDrops(
      { entries: [{ accountCode: "5300", year: 2025, budgetAmount: 13000, actualAmount: 12500 }] },
      EXISTING_ENTRIES,
    )).toEqual([]);
    expect(detectFinancialImportValueDrops(
      { entries: [{ accountCode: "5999", year: 2025, actualAmount: 1 }] },
      EXISTING_ENTRIES,
    )).toEqual([]);
    // A stored row with no budget at all has nothing to lose.
    expect(detectFinancialImportValueDrops(
      { entries: [{ accountCode: "5400", year: 2025, actualAmount: -9500 }] },
      EXISTING_ENTRIES,
    )).toEqual([]);
  });

  it("warns when re-importing a balance snapshot leaves out entries it currently has", () => {
    const existing = [{
      id: "Tase-2025",
      entries: [{ key: "cash", name: "Rahat" }, { key: "receivables", name: "Saamiset" }],
    }];
    const parsed = { snapshot: { id: "Tase-2025", entries: [{ key: "cash" }] } };
    const warnings = detectBalanceImportValueDrops(parsed, existing);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Saamiset");
  });

  it("stays quiet for a balance snapshot id that does not exist yet", () => {
    const parsed = { snapshot: { id: "Tase-2026", entries: [{ key: "cash" }] } };
    expect(detectBalanceImportValueDrops(parsed, [{ id: "Tase-2025", entries: [{ key: "cash" }] }])).toEqual([]);
  });
});

describe("views after a deletion (regression)", () => {
  it("recomputes every finance view over the surviving rows, with no orphan references", () => {
    const accounts = [
      { accountCode: "5300", name: "Isännöintipalkkiot", kind: "expense", group: "Hallintopalvelut", active: true },
      { accountCode: "5400", name: "Sähkölasku", kind: "expense", group: "Sähkö", active: true },
      { accountCode: "3000", name: "Hoitovastikkeet", kind: "income", group: "Vastiketulot", active: true },
    ];
    const snapshot = createAdminDataSnapshot({
      housingCompany: { id: "company_1", name: "As Oy Testi", apartmentCount: 12 },
      financialAccounts: accounts,
      financialEntries: [
        { accountCode: "5300", year: 2025, budgetAmount: -13000, actualAmount: -12800, sourceIds: ["tp_2025"] },
        { accountCode: "5400", year: 2025, budgetAmount: -10000, actualAmount: -9000, sourceIds: ["tp_2025"] },
        { accountCode: "3000", year: 2025, budgetAmount: 500000, actualAmount: 495000, sourceIds: ["tp_2025"] },
      ],
      groupBudgets: [
        { id: "expense::Sähkö::2025", kind: "expense", group: "Sähkö", year: 2025, budgetAmount: -10000, active: true, sourceIds: ["rb_2025"] },
      ],
      updatedAt: "2026-09-01T09:00:00Z",
      updatedBy: "admin:pasi",
    });

    const plan = planEntityDeletion(snapshot, { entityType: "financial_account", entityKey: "5400" });
    const next = applyAdminBatch(snapshot, {
      companyId: "company_1",
      expectedRevision: snapshot.revision,
      actorId: "admin:pasi",
      occurredAt: "2026-09-01T10:00:00Z",
      operations: buildDeletionOperations(plan, { explanation: "Väärä tili." }),
    });

    const accountCosts = buildAccountCostsViewModel(next.financialAccounts, next.financialEntries);
    expect(accountCosts.groups.some((group) => group.group === "Sähkö")).toBe(false);
    expect(accountCosts.totals["actual-2025"]).toBe(-12800);

    const expenseGroups = buildExpenseGroupViewModel(next.financialAccounts, next.financialEntries);
    expect(expenseGroups.groups.map((group) => group.group)).toEqual(["Hallintopalvelut"]);

    const income = buildIncomeViewModel(next.financialAccounts, next.financialEntries);
    expect(income.isEmpty).toBe(false);

    // The group budget for the deleted account's group survives — it is an
    // independent row — and the comparison still renders it, now without an
    // actual, rather than crashing on the missing account.
    const budget = buildGroupBudgetVsActualViewModel(
      next.financialAccounts, next.financialEntries, next.groupBudgets, 2025,
    );
    const sahko = budget.sections
      .flatMap((section) => section.groups)
      .find((group) => group.group === "Sähkö");
    expect(sahko?.budget).toBe(-10000);
    expect(sahko?.actual).toBeUndefined();
    expect(sahko?.diffPercent).toBeUndefined();
  });
});
