import { describe, expect, it } from "vitest";
import { applyAdminBatch, createAdminDataSnapshot } from "../src/admin/applyAdminBatch.js";
import { isBalanceCashEntry } from "../src/finance/balanceCash.js";
import {
  buildAccountCostsViewModel,
  buildAssetListViewModel,
  buildBalanceSheetImportOperation,
  buildBalanceSheetViewModel,
  computeBalanceReconciliation,
  computeBalanceRatios,
  isCashEntry,
  buildBalanceComparisonViewModel,
  buildBudgetVsActualViewModel,
  buildCostEvidenceListViewModel,
  buildDeletionOperations,
  buildEventListViewModel,
  buildExpenseGroupViewModel,
  buildFinancialImportOperations,
  buildGroupBudgetId,
  buildGroupChartModel,
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
  buildSummaryChartModel,
  buildTrailing12mNote,
  buildOperatingMarginNote,
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
  buildForecastCompletenessLines,
  buildCashPathViewModel,
  formatFinnishDate,
  parseMaintenanceDocumentPasteInput,
  validateMaintenanceNeedHeaderInput,
  buildMaintenanceDocumentSourceId,
  buildMaintenanceDocumentOperation,
  buildMaintenanceDocumentViewModel,
  describeMaintenanceDocumentReplace,
  buildGroupActualId,
  buildGroupActualSeries,
  buildGroupActualImportOperations,
  describeApiError,
  deriveComparableGroupBudgetYears,
  interpretRevisionConflict,
  isCostEvidenceExpired,
  parseBalanceSheetPasteInput,
  parseFinancialPasteInput,
  parseGroupActualPasteInput,
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
  pickPrefillSource,
  slugifyIdentifier,
  generateEntityId,
  resolveGeneratedField,
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

  it("requires operation sourceIds (not hardcoded)", () => {
    const result = buildSaveHousingCompanyOperation({
      ...validRaw,
      sourceIds: "",
      explanation: "Hallitus tarkisti perustiedot.",
    });
    expect(result).toEqual({
      ok: false,
      errors: { sourceIds: expect.any(String) },
    });
  });

  it("accepts a blank explanation and sends it as an empty string", () => {
    const result = buildSaveHousingCompanyOperation({ ...validRaw, explanation: "   " });
    expect(result.ok).toBe(true);
    // Empty string, never undefined: the value crosses JSONB, which drops
    // undefined keys, so an absent key and an undefined one are the same
    // thing on the way back.
    expect(result.operation.explanation).toBe("");
    expect(Object.hasOwn(result.operation, "explanation")).toBe(true);
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

describe("validateCompanyInput maintenance plan coverage", () => {
  const base = { id: "c", name: "Nimi", apartmentCount: "13" };

  it("omits the field entirely when it is left empty", () => {
    const result = validateCompanyInput(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Absent, not defaulted: an empty field is unknown coverage, and a
    // number here would be a silent claim about which years are planned.
    expect("maintenancePlanCoverageThroughYear" in result.value).toBe(false);
  });

  it("accepts a year, including one already in the past", () => {
    for (const year of ["2030", "2020", "2060"]) {
      const result = validateCompanyInput({
        ...base,
        maintenancePlanCoverageThroughYear: year,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.maintenancePlanCoverageThroughYear).toBe(Number(year));
    }
  });

  it.each(["2030.5", "abc", "-"])("rejects %j as a coverage year", (value) => {
    const result = validateCompanyInput({
      ...base,
      maintenancePlanCoverageThroughYear: value,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.maintenancePlanCoverageThroughYear).toBeTruthy();
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

  it("rejects a missing sourceIds but accepts a missing explanation", () => {
    const missingSource = buildSaveFinancialAccountOperation({ ...validRaw, sourceIds: "" });
    expect(missingSource.ok).toBe(false);
    expect(missingSource.errors.sourceIds).toBeDefined();

    const missingExplanation = buildSaveFinancialAccountOperation({ ...validRaw, explanation: "" });
    expect(missingExplanation.ok).toBe(true);
    expect(missingExplanation.operation.explanation).toBe("");
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
      { accountCode: "5300", year: "2025", actualAmount: "12000", sourceIds: "row_source", operationSourceIds: "", explanation: "Tuonti." },
      FINANCIAL_ACCOUNTS,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.operationSourceIds).toBeDefined();
    expect(result.errors.sourceIds).toBeUndefined();
  });
});

describe("slugifyIdentifier", () => {
  it("lowercases and joins words with underscores", () => {
    expect(slugifyIdentifier("Julkisivun maalaus")).toBe("julkisivun_maalaus");
  });

  it("folds Finnish diacritics to their base letters", () => {
    expect(slugifyIdentifier("Ääkkösiä")).toBe("aakkosia");
    expect(slugifyIdentifier("Åke Öhman")).toBe("ake_ohman");
    expect(slugifyIdentifier("Lämmin vesi -varaajat")).toBe("lammin_vesi_varaajat");
  });

  it("collapses runs of punctuation into a single underscore", () => {
    expect(slugifyIdentifier("IV-puhdistus")).toBe("iv_puhdistus");
    expect(slugifyIdentifier("Katto:  vuoto!! (2026)")).toBe("katto_vuoto_2026");
    expect(slugifyIdentifier("a___b")).toBe("a_b");
  });

  it("trims underscores from both ends", () => {
    expect(slugifyIdentifier("  ...katto...  ")).toBe("katto");
  });

  it("returns an empty string when nothing survives", () => {
    expect(slugifyIdentifier("")).toBe("");
    expect(slugifyIdentifier("   ")).toBe("");
    expect(slugifyIdentifier("!!!___!!!")).toBe("");
    expect(slugifyIdentifier(undefined)).toBe("");
  });

  it("cuts a long title at a word boundary, never mid-word", () => {
    const long = "Tarkastuksessa havaittiin, että ullakon eristeissä on laajalti " +
      "kosteusjälkiä pohjoispäädyn alueella ja aluskate vaikuttaa repeytyneeltä.";
    const slug = slugifyIdentifier(long);
    expect(slug.length).toBeLessThanOrEqual(40);
    // The cut lands on a boundary, so the last word is whole.
    expect(slug).toBe("tarkastuksessa_havaittiin_etta_ullakon");
    expect(slug.endsWith("_")).toBe(false);
  });

  it("hard-truncates a single word with no boundary to cut at", () => {
    const slug = slugifyIdentifier("supercalifragilisticexpialidociousantidisestablishmentarianism");
    expect(slug).toBe("supercalifragilisticexpialidociousantidi");
    expect(slug.length).toBe(40);
  });

  it("keeps every identifier already in the data expressible", () => {
    expect(slugifyIdentifier("Lämmin vesi varaajat")).toBe("lammin_vesi_varaajat");
    expect(slugifyIdentifier("condensation a2 a3 b6 2026")).toBe("condensation_a2_a3_b6_2026");
  });
});

describe("generateEntityId", () => {
  it("prefixes by entity type", () => {
    expect(generateEntityId("asset", "Julkisivu", [])).toBe("asset_julkisivu");
    expect(generateEntityId("observation", "Kosteusjälki", [])).toBe("observation_kosteusjalki");
    expect(generateEntityId("building_event", "IV-puhdistus", [])).toBe("event_iv_puhdistus");
    expect(generateEntityId("cost_evidence", "Kuntoarvio", [])).toBe("cost_kuntoarvio");
  });

  it("numbers a collision instead of erroring, counting up from 2", () => {
    const taken = ["event_kuntoarvio"];
    const second = generateEntityId("building_event", "Kuntoarvio", taken);
    expect(second).toBe("event_kuntoarvio_2");

    // A second collision must not hand back _2 again.
    const third = generateEntityId("building_event", "Kuntoarvio", [...taken, second]);
    expect(third).toBe("event_kuntoarvio_3");
    expect(third).not.toBe(second);

    const fourth = generateEntityId("building_event", "Kuntoarvio", [...taken, second, third]);
    expect(fourth).toBe("event_kuntoarvio_4");
  });

  it("collides on the slug, so differently written titles still get separate ids", () => {
    const first = generateEntityId("building_event", "Kunto arvio", []);
    const second = generateEntityId("building_event", "kunto-arvio!", [first]);
    expect(first).toBe("event_kunto_arvio");
    expect(second).toBe("event_kunto_arvio_2");
  });

  it("numbers after truncation, so a long title still yields a free id", () => {
    const long = "Tarkastuksessa havaittiin että ullakon eristeissä kosteutta";
    const first = generateEntityId("observation", long, []);
    const second = generateEntityId("observation", long, [first]);
    expect(second).toBe(`${first}_2`);
  });

  it("returns an empty string for a title that slugifies to nothing", () => {
    expect(generateEntityId("asset", "   ", [])).toBe("");
    expect(generateEntityId("asset", "!!!", [])).toBe("");
  });

  it("returns an empty string for an unknown entity type", () => {
    expect(generateEntityId("housing_company", "Taloyhtiö", [])).toBe("");
  });
});

describe("resolveGeneratedField", () => {
  it("fills the field from the title while the user has not touched it", () => {
    expect(resolveGeneratedField({
      touched: false, current: "", generated: "event_kuntoarvio",
    })).toBe("event_kuntoarvio");
  });

  it("keeps regenerating as the title keeps changing", () => {
    expect(resolveGeneratedField({
      touched: false, current: "event_kunto", generated: "event_kuntoarvio",
    })).toBe("event_kuntoarvio");
  });

  it("never overwrites an identifier the user chose, however the title changes", () => {
    // The order matters and is the whole point: the user edits the identifier
    // FIRST and changes the title AFTER. Run the other way round, this passes
    // whether or not the touched flag exists.
    let touched = false;
    let value = "";

    // 1. User types a title; the field follows along.
    value = resolveGeneratedField({ touched, current: value, generated: "event_iv_puhdistus" });
    expect(value).toBe("event_iv_puhdistus");

    // 2. User edits the identifier by hand.
    touched = true;
    value = "event_iv_2026";

    // 3. User goes back and changes the title. The identifier must not move.
    value = resolveGeneratedField({ touched, current: value, generated: "event_ilmanvaihdon_puhdistus" });
    expect(value).toBe("event_iv_2026");

    // 4. And it must not come back on any later change either.
    value = resolveGeneratedField({ touched, current: value, generated: "event_jotain_muuta" });
    expect(value).toBe("event_iv_2026");
  });

  it("leaves the field alone when there is nothing to generate from yet", () => {
    // Clearing the title must not wipe an identifier that is already there.
    expect(resolveGeneratedField({
      touched: false, current: "event_kuntoarvio", generated: "",
    })).toBe("event_kuntoarvio");
  });

  it("keeps a touched empty field empty", () => {
    expect(resolveGeneratedField({
      touched: true, current: "", generated: "event_kuntoarvio",
    })).toBe("");
  });
});

describe("pickPrefillSource", () => {
  it("uses the first field that has content", () => {
    expect(pickPrefillSource(["kuntoarvio-2024", ""])).toBe("kuntoarvio-2024");
  });

  it("falls back to the sourceUrl when the sourceId is blank", () => {
    // The cost-evidence form is the only one whose source can live in either
    // of two fields, and the fallback is easy to write the wrong way round.
    // A blank sourceId must not win over a filled sourceUrl.
    expect(pickPrefillSource(["", "https://urakoitsija.fi/tarjous-2026.pdf"]))
      .toBe("https://urakoitsija.fi/tarjous-2026.pdf");
    expect(pickPrefillSource(["   ", "https://urakoitsija.fi/tarjous-2026.pdf"]))
      .toBe("https://urakoitsija.fi/tarjous-2026.pdf");
  });

  it("prefers the sourceId when both are filled", () => {
    expect(pickPrefillSource(["K003", "https://urakoitsija.fi/tarjous-2026.pdf"]))
      .toBe("K003");
  });

  it("returns an empty string when nothing is filled", () => {
    expect(pickPrefillSource(["", "   "])).toBe("");
    expect(pickPrefillSource([])).toBe("");
    expect(pickPrefillSource([undefined, undefined])).toBe("");
  });

  it("returns the untrimmed value so the mirror matches what was typed", () => {
    expect(pickPrefillSource([" board_2026 "])).toBe(" board_2026 ");
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

describe("isCashEntry", () => {
  it("picks the same line as the server's isBalanceCashEntry", () => {
    // The two rules are a deliberate duplicate across the browser/server
    // boundary (src/finance/balanceCash.ts). This is the test that fails
    // when one of them moves without the other; the set covers every branch
    // either rule has, so a new branch on one side shows up as a mismatch.
    const entries = [
      { key: "rahat", name: "Kassa" },
      { key: "ca_02", name: "Rahat ja pankkisaamiset" },
      { key: "ca_03", name: "RAHAT JA PANKKISAAMISET 31.12." },
      { key: "ca_04", name: "Rahat" },
      { key: "ca_05", name: "Pankkisaamiset" },
      { key: "myyntisaamiset", name: "Myyntisaamiset" },
      { key: "rahat_2", name: "Rahat ja pankki" },
      { key: "", name: "" },
    ];
    for (const entry of entries) {
      expect(isCashEntry(entry), JSON.stringify(entry)).toBe(isBalanceCashEntry(entry));
    }
    expect(entries.filter(isCashEntry).map((e) => e.key)).toEqual(["rahat", "ca_02", "ca_03", "rahat_2"]);
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

/**
 * Real Kulut-sheet figures (docs/product-spec/taloyhtio terminaali.xlsx):
 * one maintenance group standing for the nine stable ones, plus KORJAUKSET.
 * Actuals negative, as the expense sign convention stores them.
 */
describe("buildTrailing12mNote", () => {
  const euro = (value) => `${value.toFixed(2).replace(".", ",")} €`;

  /**
   * The shape the admin read model delivers as
   * calculations.operatingFigures.costs. Written out rather than computed:
   * the figure is produced by src/finance/operatingFigures.ts and tested
   * there, and what is under test here is the sentence built from it.
   */
  const AVAILABLE = {
    status: "available",
    latestActualYear: 2025,
    costsExcludingRepairs: 34_029.46,
    repairAverage: 4_615.04,
    repairYears: [2024, 2025],
    trailing12mOperatingCosts: 38_644.50,
  };

  it("names the year, the parts, and how many years the repair mean covers", () => {
    const note = buildTrailing12mNote(AVAILABLE, euro);

    expect(note).toContain("38644,50 €");
    expect(note).toContain("vuoden 2025 kulut ilman korjauksia");
    expect(note).toContain("34029,46 €");
    expect(note).toContain("vuosilta 2024–2025");
    expect(note).toContain("4615,04 €");
    expect(note).toContain("2 vuotta");
    expect(note).not.toContain("paikkamerkki");
  });

  it("says \"vuodelta\" and \"1 vuosi\" for a single-year repair mean", () => {
    const note = buildTrailing12mNote(
      { ...AVAILABLE, repairYears: [2025], repairAverage: 3_881.55 },
      euro,
    );

    expect(note).toContain("vuodelta 2025");
    expect(note).toContain("1 vuosi");
  });

  it("names the missing group and says a zero is not assumed", () => {
    const note = buildTrailing12mNote(
      { status: "unavailable", reason: "repair_group_missing" },
      euro,
    );

    expect(note).toContain("KORJAUKSET");
    expect(note).toContain("ei oleteta nollaksi");
  });

  it("tells the user to import cost data when there is none", () => {
    const note = buildTrailing12mNote(
      { status: "unavailable", reason: "no_expense_actuals" },
      euro,
    );

    expect(note).toContain("Liitä tilidataa");
  });

  it("explains a repair actual missing from the latest actual year", () => {
    const note = buildTrailing12mNote(
      { status: "unavailable", reason: "repair_actual_missing_for_latest_year" },
      euro,
    );

    expect(note).toContain("viimeisimmältä toteumavuodelta");
    expect(note).toContain("arvausta ei käytetä");
  });
});

describe("buildOperatingMarginNote", () => {
  const euro = (value) => `${value.toFixed(2).replace(".", ",")} €`;

  const AVAILABLE = {
    status: "available",
    latestActualYear: 2025,
    income: 43_906.75,
    costsExcludingRepairs: 34_029.46,
    operatingMargin: 9_877.29,
  };

  it("shows the subtraction rather than asserting the result", () => {
    const note = buildOperatingMarginNote(AVAILABLE, euro);

    expect(note).toContain("9877,29 €");
    expect(note).toContain("43906,75 €");
    expect(note).toContain("34029,46 €");
    expect(note).toContain("vuoden 2025 tulot");
  });

  it("says the price level, because the number looks like a forecast", () => {
    // Without this a reader takes it for next year's figure. It is last
    // year's, uninflated on purpose: the repair costs it is weighed against
    // in the cash path are in today's money too, and indexing one side alone
    // would make the cash look like it stretches further than it does.
    const note = buildOperatingMarginNote(AVAILABLE, euro);

    expect(note).toContain("eikä sisällä inflaatiota");
    expect(note).toContain("vuoden 2025 tasossa");
  });

  it("says repairs are already out of it", () => {
    expect(buildOperatingMarginNote(AVAILABLE, euro))
      .toContain("kassan kehitys laskuttaa ne erikseen");
  });

  it("refuses to call missing income a zero hoitokate", () => {
    // Zero income against real costs would show the entire year's operating
    // cost as a deficit and present it as a measurement.
    const note = buildOperatingMarginNote(
      { status: "unavailable", reason: "no_income_actuals" },
      euro,
    );

    expect(note).toContain("Nollaa ei käytetä");
    expect(note).not.toContain("9680");
  });

  it("explains income missing from the latest cost year specifically", () => {
    const note = buildOperatingMarginNote(
      { status: "unavailable", reason: "income_missing_for_latest_year" },
      euro,
    );

    expect(note).toContain("samalta tilikaudelta");
  });

  it("points at the cost-side reason when that is what failed", () => {
    const note = buildOperatingMarginNote(
      { status: "unavailable", reason: "repair_group_missing" },
      euro,
    );

    expect(note).toContain("12 kk hoitokuluissa");
  });
});

describe("buildGroupChartModel", () => {
  /** Hallintopalvelut: no account-level 2023 actual yet, 2026 budget present. */
  const HALLINTO = {
    actuals: { 2023: undefined, 2024: -7_885.63, 2025: -7_360.76 },
    budget: -7_972.32,
  };
  const YEARS = [2023, 2024, 2025];

  it("puts the budget last in the same row and marks it in the model", () => {
    const model = buildGroupChartModel(HALLINTO, YEARS, 2026);

    expect(model.isEmpty).toBe(false);
    expect(model.hasBudget).toBe(true);
    expect(model.bars.map((bar) => bar.year)).toEqual([2023, 2024, 2025, 2026]);
    expect(model.bars.map((bar) => bar.isBudget)).toEqual([false, false, false, true]);
  });

  it("leaves a missing year on the axis with no bar at all — never a zero bar", () => {
    // The regression this whole feature turns on (handoff §2): a zero-height
    // bar reads as "there were no costs" when the truth is "the figure is not
    // known". If someone later "simplifies" missing to 0, this fails.
    const model = buildGroupChartModel(HALLINTO, YEARS, 2026);
    const gap = model.bars.find((bar) => bar.year === 2023);

    expect(gap.missing).toBe(true);
    expect(gap.value).toBeNull();
    expect(gap.heightPercent).toBeNull();
    expect(gap.heightPercent).not.toBe(0);
  });

  it("keeps the missing year's column width and position on the axis", () => {
    const model = buildGroupChartModel(HALLINTO, YEARS, 2026);
    const [gap, second] = model.bars;

    expect(gap.widthPercent).toBeCloseTo(second.widthPercent, 10);
    expect(gap.xPercent).toBeLessThan(second.xPercent);
  });

  it("draws a genuine 0,00 € as a zero-height bar, distinct from missing", () => {
    const withRealZero = { actuals: { 2024: 0, 2025: -7_360.76 }, budget: undefined };
    const model = buildGroupChartModel(withRealZero, [2024, 2025], null);
    const zero = model.bars.find((bar) => bar.year === 2024);

    expect(zero.missing).toBe(false);
    expect(zero.value).toBe(0);
    expect(zero.heightPercent).toBe(0);
  });

  it("scales bar heights from zero to the largest absolute value", () => {
    const model = buildGroupChartModel(
      { actuals: { 2024: -5_000, 2025: -10_000 }, budget: undefined },
      [2024, 2025],
      null,
    );

    expect(model.maxAbsValue).toBe(10_000);
    expect(model.bars[1].heightPercent).toBe(100);
    expect(model.bars[0].heightPercent).toBe(50);
  });

  it("includes the budget in the scale so an over-budget year cannot overflow", () => {
    // KORJAUKSET: 9 680 € budgeted against a 3 881,55 € actual.
    const korjaukset = { actuals: { 2024: -5_348.53, 2025: -3_881.55 }, budget: -9_680 };
    const model = buildGroupChartModel(korjaukset, [2024, 2025], 2026);

    expect(model.maxAbsValue).toBe(9_680);
    const budgetBar = model.bars.find((bar) => bar.isBudget);
    expect(budgetBar.heightPercent).toBe(100);
    for (const bar of model.bars) expect(bar.heightPercent).toBeLessThanOrEqual(100);
  });

  it("uses absolute value for bar length but keeps the stored sign in value", () => {
    const model = buildGroupChartModel({ actuals: { 2025: -600 }, budget: undefined }, [2025], null);

    expect(model.bars[0].value).toBe(-600);
    expect(model.bars[0].heightPercent).toBe(100);
  });

  it("handles a single year of data without special-casing it", () => {
    const model = buildGroupChartModel({ actuals: { 2025: -360 }, budget: undefined }, [2025], null);

    expect(model.isEmpty).toBe(false);
    expect(model.bars).toHaveLength(1);
    expect(model.bars[0].heightPercent).toBe(100);
    expect(model.bars[0].xPercent).toBeCloseTo((100 - model.bars[0].widthPercent) / 2, 10);
  });

  it("reports empty when there are no years and no budget", () => {
    const model = buildGroupChartModel({ actuals: {}, budget: undefined }, [], null);

    expect(model.isEmpty).toBe(true);
    expect(model.bars).toEqual([]);
  });

  it("does not crash on a missing group or missing arguments", () => {
    expect(buildGroupChartModel(undefined, undefined, undefined).isEmpty).toBe(true);
    expect(buildGroupChartModel({}, [2025], null).bars[0].missing).toBe(true);
  });

  it("yields zero-height bars rather than NaN when every value is zero", () => {
    const model = buildGroupChartModel({ actuals: { 2024: 0, 2025: 0 }, budget: undefined }, [2024, 2025], null);

    expect(model.maxAbsValue).toBe(0);
    for (const bar of model.bars) {
      expect(bar.heightPercent).toBe(0);
      expect(Number.isNaN(bar.heightPercent)).toBe(false);
    }
  });

  it("renders a year that has both an actual and a budget as two bars", () => {
    const model = buildGroupChartModel(
      { actuals: { 2025: -7_360.76 }, budget: -7_972.32 },
      [2025],
      2025,
    );

    expect(model.bars).toHaveLength(2);
    expect(model.bars.map((bar) => bar.year)).toEqual([2025, 2025]);
    expect(model.bars.map((bar) => bar.isBudget)).toEqual([false, true]);
  });

  it("omits the budget bar when the group has no budget figure", () => {
    const model = buildGroupChartModel({ actuals: { 2025: -360 }, budget: undefined }, [2025], 2026);

    expect(model.hasBudget).toBe(false);
    expect(model.bars.some((bar) => bar.isBudget)).toBe(false);
  });

  it("lays the columns out left to right without overlapping", () => {
    const model = buildGroupChartModel(HALLINTO, YEARS, 2026);

    for (let i = 1; i < model.bars.length; i += 1) {
      const previous = model.bars[i - 1];
      expect(model.bars[i].xPercent).toBeGreaterThan(previous.xPercent + previous.widthPercent);
    }
    const last = model.bars[model.bars.length - 1];
    expect(last.xPercent + last.widthPercent).toBeLessThanOrEqual(100);
  });

  it("feeds straight from buildExpenseGroupViewModel without re-summing accounts", () => {
    const accounts = [
      { accountCode: "5300", name: "Isännöinti", kind: "expense", group: "HALLINTOPALVELUT" },
      { accountCode: "5301", name: "Kokouspalkkiot", kind: "expense", group: "HALLINTOPALVELUT" },
    ];
    const entries = [
      { accountCode: "5300", year: 2024, actualAmount: -6_985.63 },
      { accountCode: "5301", year: 2024, actualAmount: -900 },
      { accountCode: "5300", year: 2025, actualAmount: -6_460.76 },
      { accountCode: "5301", year: 2025, actualAmount: -900 },
      { accountCode: "5300", year: 2026, budgetAmount: -7_972.32 },
    ];
    const vm = buildExpenseGroupViewModel(accounts, entries);
    const group = vm.groups.find((g) => g.group === "HALLINTOPALVELUT");
    const model = buildGroupChartModel(group, vm.actualYears, vm.budgetYear);

    expect(model.bars.map((bar) => bar.value)).toEqual([-7_885.63, -7_360.76, -7_972.32]);
    expect(model.bars[2].isBudget).toBe(true);
  });
});

describe("buildSummaryChartModel", () => {
  /**
   * Real workbook figures. Income and expenses are complete for 2024–2025;
   * 2023 exists on both sides but only partially at account level, which is
   * the case this model has to mark rather than draw as a total.
   */
  const income = {
    actualYears: [2023, 2024, 2025],
    groups: [
      { actuals: { 2023: 3_527.5, 2024: 40_666.93, 2025: 43_150.75 } },
      { actuals: { 2024: 756, 2025: 756 } },
    ],
    totals: { actuals: { 2023: 3_527.5, 2024: 41_422.93, 2025: 43_906.75 } },
  };
  const expense = {
    actualYears: [2023, 2024, 2025],
    groups: [
      { actuals: { 2023: -360, 2024: -600, 2025: -600 } },
      { actuals: { 2024: -36_161.19, 2025: -37_311.01 } },
    ],
    totals: { actuals: { 2023: -360, 2024: -36_761.19, 2025: -37_911.01 } },
  };

  it("pairs income and expenses on one shared zero-based scale", () => {
    const model = buildSummaryChartModel(income, expense);

    expect(model.isEmpty).toBe(false);
    expect(model.years).toEqual([2023, 2024, 2025]);
    expect(model.maxAbsValue).toBe(43_906.75);
    const latest = model.columns.find((column) => column.year === 2025);
    expect(latest.bars.map((bar) => bar.series)).toEqual(["income", "expense"]);
    expect(latest.bars[0].heightPercent).toBe(100);
    // The height difference is the hoitokate, so both must share one scale.
    expect(latest.bars[1].heightPercent).toBeCloseTo((37_911.01 / 43_906.75) * 100, 8);
  });

  it("draws expenses upward but keeps the stored negative sign in value", () => {
    const model = buildSummaryChartModel(income, expense);
    const expenseBar = model.columns.find((c) => c.year === 2025).bars[1];

    expect(expenseBar.value).toBe(-37_911.01);
    expect(expenseBar.heightPercent).toBeGreaterThan(0);
  });

  it("flags a partially reported year instead of presenting it as a total", () => {
    // 2023 expenses sum to -360 from one group of two, against a real total of
    // 34 271,63. Unmarked that is the same failure as a zero bar for a missing
    // year: the unknown presented as known.
    const model = buildSummaryChartModel(income, expense);
    const year2023 = model.columns.find((column) => column.year === 2023);

    expect(model.hasPartial).toBe(true);
    for (const bar of year2023.bars) {
      expect(bar.partial).toBe(true);
      expect(bar.missing).toBe(false);
      expect(bar.reportingGroups).toBe(1);
      expect(bar.totalGroups).toBe(2);
    }
  });

  it("does not flag a fully reported year as partial", () => {
    const model = buildSummaryChartModel(income, expense);
    for (const year of [2024, 2025]) {
      const column = model.columns.find((c) => c.year === year);
      for (const bar of column.bars) {
        expect(bar.partial).toBe(false);
        expect(bar.reportingGroups).toBe(bar.totalGroups);
      }
    }
  });

  it("draws one series and marks the other missing when a year has only one", () => {
    // The genuinely new case versus the group chart: the two series are not
    // missing the same years, and neither may disappear because the other has
    // no figure.
    const incomeOnly2022 = {
      actualYears: [2022, 2025],
      groups: [{ actuals: { 2022: 30_000, 2025: 43_906.75 } }],
      totals: { actuals: { 2022: 30_000, 2025: 43_906.75 } },
    };
    const expenseNo2022 = {
      actualYears: [2025],
      groups: [{ actuals: { 2025: -37_911.01 } }],
      totals: { actuals: { 2025: -37_911.01 } },
    };
    const model = buildSummaryChartModel(incomeOnly2022, expenseNo2022);
    const year2022 = model.columns.find((column) => column.year === 2022);

    expect(model.years).toEqual([2022, 2025]);
    expect(year2022.bars[0].missing).toBe(false);
    expect(year2022.bars[0].value).toBe(30_000);
    expect(year2022.bars[1].missing).toBe(true);
    expect(year2022.bars[1].value).toBeNull();
    expect(year2022.bars[1].heightPercent).toBeNull();
  });

  it("never turns a missing series into a zero-height bar", () => {
    const model = buildSummaryChartModel(
      { actualYears: [2025], groups: [{ actuals: { 2025: 100 } }], totals: { actuals: { 2025: 100 } } },
      { actualYears: [], groups: [], totals: { actuals: {} } },
    );
    const bar = model.columns[0].bars[1];

    expect(bar.missing).toBe(true);
    expect(bar.heightPercent).toBeNull();
    expect(bar.heightPercent).not.toBe(0);
  });

  it("keeps a genuine 0 as a real zero-height bar, distinct from missing", () => {
    const model = buildSummaryChartModel(
      { actualYears: [2025], groups: [{ actuals: { 2025: 0 } }], totals: { actuals: { 2025: 0 } } },
      { actualYears: [2025], groups: [{ actuals: { 2025: -600 } }], totals: { actuals: { 2025: -600 } } },
    );
    const bar = model.columns[0].bars[0];

    expect(bar.missing).toBe(false);
    expect(bar.value).toBe(0);
    expect(bar.heightPercent).toBe(0);
  });

  it("takes the year axis from the union of both series", () => {
    const model = buildSummaryChartModel(
      { actualYears: [2023, 2025], groups: [], totals: { actuals: { 2023: 1, 2025: 2 } } },
      { actualYears: [2024, 2025], groups: [], totals: { actuals: { 2024: -1, 2025: -2 } } },
    );
    expect(model.years).toEqual([2023, 2024, 2025]);
  });

  it("lays the two bars side by side inside their year without overlapping", () => {
    const model = buildSummaryChartModel(income, expense);
    for (const column of model.columns) {
      const [first, second] = column.bars;
      expect(first.widthPercent).toBeCloseTo(second.widthPercent, 10);
      expect(second.xPercent).toBeGreaterThan(first.xPercent + first.widthPercent);
    }
    const last = model.columns[model.columns.length - 1].bars[1];
    expect(last.xPercent + last.widthPercent).toBeLessThanOrEqual(100);
  });

  it("reports empty when neither series has an actual year", () => {
    const model = buildSummaryChartModel(
      { actualYears: [], groups: [], totals: { actuals: {} } },
      { actualYears: [], groups: [], totals: { actuals: {} } },
    );
    expect(model.isEmpty).toBe(true);
    expect(model.columns).toEqual([]);
  });

  it("does not crash on missing arguments", () => {
    expect(buildSummaryChartModel(undefined, undefined).isEmpty).toBe(true);
    expect(buildSummaryChartModel({}, {}).isEmpty).toBe(true);
  });

  it("feeds straight from the Tulot and Kulut view models", () => {
    const accounts = [
      { accountCode: "3000", name: "Hoitovastike", kind: "income", group: "HOITOVASTIKKEET" },
      { accountCode: "5300", name: "Isännöinti", kind: "expense", group: "HALLINTOPALVELUT" },
    ];
    const entries = [
      { accountCode: "3000", year: 2024, actualAmount: 40_666.93 },
      { accountCode: "3000", year: 2025, actualAmount: 43_150.75 },
      { accountCode: "5300", year: 2024, actualAmount: -7_885.63 },
      { accountCode: "5300", year: 2025, actualAmount: -7_360.76 },
    ];
    const model = buildSummaryChartModel(
      buildIncomeViewModel(accounts, entries),
      buildExpenseGroupViewModel(accounts, entries),
    );

    expect(model.years).toEqual([2024, 2025]);
    expect(model.columns[1].bars.map((bar) => bar.value)).toEqual([43_150.75, -7_360.76]);
    expect(model.hasPartial).toBe(false);
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

describe("buildGroupActualId", () => {
  it("is deterministic per kind+group+year, so re-import updates instead of duplicating", () => {
    expect(buildGroupActualId("expense", "Sähkö", 2024)).toBe(buildGroupActualId("expense", "Sähkö", 2024));
    expect(buildGroupActualId("income", "Sähkö", 2024)).not.toBe(buildGroupActualId("expense", "Sähkö", 2024));
  });
});

describe("parseGroupActualPasteInput", () => {
  const accounts = [
    { accountCode: "5400", kind: "expense", group: "Sähkö" },
    { accountCode: "3000", kind: "income", group: "Hoitovastikkeet" },
  ];

  it("parses valid rows and skips a recognized header row", () => {
    const text = [
      "kind\tryhmä\tvuosi\ttoteuma",
      "kulu\tSähkö\t2023\t-9500,50",
      "tulo\tHoitovastikkeet\t2023\t36237,38",
    ].join("\n");
    const parsed = parseGroupActualPasteInput(text, accounts);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.groupActuals).toEqual([
      { id: "expense::Sähkö::2023", kind: "expense", group: "Sähkö", year: 2023, actualAmount: -9500.5 },
      { id: "income::Hoitovastikkeet::2023", kind: "income", group: "Hoitovastikkeet", year: 2023, actualAmount: 36237.38 },
    ]);
  });

  it("accepts a genuine 0,00 € total, which is a real figure and not a missing one", () => {
    const parsed = parseGroupActualPasteInput("kulu\tSähkö\t2023\t0", accounts);
    expect(parsed.errors).toEqual([]);
    expect(parsed.groupActuals[0].actualAmount).toBe(0);
  });

  it("rejects an unknown kind", () => {
    const parsed = parseGroupActualPasteInput("meno\tSähkö\t2023\t-9500", accounts);
    expect(parsed.groupActuals).toEqual([]);
    expect(parsed.errors[0].message).toMatch(/tuntematon kind/);
  });

  it("rejects a missing group", () => {
    const parsed = parseGroupActualPasteInput("kulu\t\t2023\t-9500", accounts);
    expect(parsed.errors[0].message).toMatch(/ryhmä puuttuu/);
  });

  it("rejects a non-integer year", () => {
    const parsed = parseGroupActualPasteInput("kulu\tSähkö\t2023.5\t-9500", accounts);
    expect(parsed.errors[0].message).toMatch(/vuosi/);
  });

  it("rejects a missing actual", () => {
    const parsed = parseGroupActualPasteInput("kulu\tSähkö\t2023\t", accounts);
    expect(parsed.errors[0].message).toMatch(/toteuma puuttuu/);
  });

  it("rejects a non-numeric actual", () => {
    const parsed = parseGroupActualPasteInput("kulu\tSähkö\t2023\tabc", accounts);
    expect(parsed.errors[0].message).toMatch(/ei ole luku/);
  });

  it("rejects a duplicate kind+group+year, reporting the second row's number", () => {
    const text = "kulu\tSähkö\t2023\t-9500\nkulu\tSähkö\t2023\t-9600";
    const parsed = parseGroupActualPasteInput(text, accounts);
    expect(parsed.groupActuals).toHaveLength(1);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].row).toBe(2);
    expect(parsed.errors[0].message).toMatch(/esiintyy jo aiemmalla rivillä/);
  });

  it("rejects a row with the wrong column count, naming the row", () => {
    const parsed = parseGroupActualPasteInput("kulu\tSähkö\t2023", accounts);
    expect(parsed.errors[0].row).toBe(1);
    expect(parsed.errors[0].message).toMatch(/saraketta/);
  });

  it("warns but does not block on a group matching no account, since an un-itemised group is legitimate here", () => {
    // Rental income exists in the source but was never itemised into the chart
    // of accounts. Blocking it would present known income as nonexistent; the
    // warning is there so a genuine typo still stands out.
    const parsed = parseGroupActualPasteInput("tulo\tVuokratuotot\t2023\t720", accounts);
    expect(parsed.errors).toEqual([]);
    expect(parsed.groupActuals).toHaveLength(1);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0].message).toMatch(/ei täsmää mihinkään tiliryhmään/);
  });

  it("warns on a positive expense, the sign the source Excel prints", () => {
    // The source table gives "Kulut yhteensä 34 271,63" positive while tilidata
    // stores costs negative. Pasted unchanged that would read as a group short
    // by twice its own total, so the mismatch is caught at import.
    const parsed = parseGroupActualPasteInput("kulu\tSähkö\t2023\t9500", accounts);
    expect(parsed.errors).toEqual([]);
    expect(parsed.groupActuals[0].actualAmount).toBe(9500);
    expect(parsed.warnings[0].message).toMatch(/kulut negatiivisina/);
  });

  it("warns on a negative income but stores the sign as pasted, never Math.abs", () => {
    // A credit-note year is real. Normalising the sign is the mistake that had
    // to be undone in the balance sheet, so the value is stored verbatim.
    const parsed = parseGroupActualPasteInput("tulo\tHoitovastikkeet\t2023\t-500", accounts);
    expect(parsed.errors).toEqual([]);
    expect(parsed.groupActuals[0].actualAmount).toBe(-500);
    expect(parsed.warnings[0].message).toMatch(/negatiivinen/);
  });

  it("does not warn about the sign on a zero", () => {
    const parsed = parseGroupActualPasteInput("kulu\tSähkö\t2023\t0", accounts);
    expect(parsed.warnings).toEqual([]);
  });
});

describe("buildGroupActualImportOperations", () => {
  it("builds save_group_actual operations defaulting active: true", () => {
    const parsed = { groupActuals: [{ id: "income::Hoitovastikkeet::2023", kind: "income", group: "Hoitovastikkeet", year: 2023, actualAmount: 36237.38 }] };
    const ops = buildGroupActualImportOperations(parsed, { sourceIds: ["tp2023"], explanation: "Tuonti" });
    expect(ops).toEqual([{
      type: "save_group_actual",
      value: { id: "income::Hoitovastikkeet::2023", kind: "income", group: "Hoitovastikkeet", year: 2023, actualAmount: 36237.38, active: true, sourceIds: ["tp2023"] },
      sourceIds: ["tp2023"],
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
    expect(deriveComparableGroupBudgetYears(GROUP_BUDGET_ACCOUNTS, entries, groupBudgets, [])).toEqual([2024]);
  });

  it("includes a year when a group has both actual and a tili-summed budget (no GroupBudget)", () => {
    const entries = [{ accountCode: "5400", year: 2025, actualAmount: -9000, budgetAmount: -10000 }];
    expect(deriveComparableGroupBudgetYears(GROUP_BUDGET_ACCOUNTS, entries, [], [])).toEqual([2025]);
  });

  it("excludes a year when only actual exists (no budget from either source)", () => {
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -9000 }];
    expect(deriveComparableGroupBudgetYears(GROUP_BUDGET_ACCOUNTS, entries, [], [])).toEqual([]);
  });

  it("excludes a year when only a GroupBudget exists with no actual anywhere in the group", () => {
    const groupBudgets = [{ id: "expense::Sähkö::2024", kind: "expense", group: "Sähkö", year: 2024, budgetAmount: -10000, active: true }];
    expect(deriveComparableGroupBudgetYears(GROUP_BUDGET_ACCOUNTS, [], groupBudgets, [])).toEqual([]);
  });

  it("ignores an inactive GroupBudget", () => {
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -9000 }];
    const groupBudgets = [{ id: "expense::Sähkö::2024", kind: "expense", group: "Sähkö", year: 2024, budgetAmount: -10000, active: false }];
    expect(deriveComparableGroupBudgetYears(GROUP_BUDGET_ACCOUNTS, entries, groupBudgets, [])).toEqual([]);
  });
});

describe("buildGroupBudgetVsActualViewModel", () => {
  it("is empty with no accounts or no year selected", () => {
    expect(buildGroupBudgetVsActualViewModel([], [], [], [], 2024).isEmpty).toBe(true);
    expect(buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, [], [], [], undefined).isEmpty).toBe(true);
  });

  it("is empty when the selected year has no data from either source", () => {
    const entries = [{ accountCode: "5400", year: 2023, actualAmount: -9000 }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], [], 2024);
    expect(vm.isEmpty).toBe(true);
    expect(vm.year).toBe(2024);
  });

  it("prefers an active GroupBudget over the tili-summed budget and surfaces the overridden figure (budgetSource etusijasääntö)", () => {
    const entries = [
      { accountCode: "5400", year: 2024, actualAmount: -6000, budgetAmount: -5000 },
      { accountCode: "5401", year: 2024, actualAmount: -3000, budgetAmount: -4000 },
    ];
    const groupBudgets = [{ id: "expense::Sähkö::2024", kind: "expense", group: "Sähkö", year: 2024, budgetAmount: -10000, active: true }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, groupBudgets, [], 2024);
    const sahko = vm.sections.find((s) => s.kind === "expense").groups.find((g) => g.group === "Sähkö");
    expect(sahko.budget).toBe(-10000);
    expect(sahko.budgetSource).toBe("group");
    expect(sahko.overriddenAccountsBudget).toBe(-9000); // -5000 + -4000, the tili-summed budget that lost
    expect(sahko.actual).toBe(-9000); // -6000 + -3000
  });

  it("falls back to the tili-summed budget when no active GroupBudget exists for the row", () => {
    const entries = [{ accountCode: "5500", year: 2024, actualAmount: -1500, budgetAmount: -2000 }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], [], 2024);
    const korjaukset = vm.sections.find((s) => s.kind === "expense").groups.find((g) => g.group === "Korjaukset");
    expect(korjaukset.budget).toBe(-2000);
    expect(korjaukset.budgetSource).toBe("accounts");
    expect(korjaukset.overriddenAccountsBudget).toBeUndefined();
  });

  it("ignores an inactive GroupBudget and falls back to the tili-summed budget", () => {
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -6000, budgetAmount: -5000 }];
    const groupBudgets = [{ id: "expense::Sähkö::2024", kind: "expense", group: "Sähkö", year: 2024, budgetAmount: -10000, active: false }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, groupBudgets, [], 2024);
    const sahko = vm.sections.find((s) => s.kind === "expense").groups.find((g) => g.group === "Sähkö");
    expect(sahko.budget).toBe(-5000);
    expect(sahko.budgetSource).toBe("accounts");
  });

  it("includes a row budgeted with no actual (one-sided, handoff §3(b)) without treating the missing side as zero", () => {
    const groupBudgets = [{ id: "expense::Korjaukset::2024", kind: "expense", group: "Korjaukset", year: 2024, budgetAmount: -5000, active: true }];
    // Another group needs *some* actual data this year so the view isn't
    // considered empty overall.
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -1000, budgetAmount: -1000 }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, groupBudgets, [], 2024);
    const korjaukset = vm.sections.find((s) => s.kind === "expense").groups.find((g) => g.group === "Korjaukset");
    expect(korjaukset.budget).toBe(-5000);
    expect(korjaukset.actual).toBeUndefined();
    expect(korjaukset.diffAmount).toBeUndefined();
    expect(korjaukset.diffPercent).toBeUndefined();
    expect(korjaukset.favorable).toBeUndefined();
  });

  it("includes a row with actual but no budget from either source (one-sided, handoff §3(b))", () => {
    const entries = [{ accountCode: "5500", year: 2024, actualAmount: -3200 }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], [], 2024);
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
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, groupBudgets, [], 2024);
    const sahko = vm.sections.find((s) => s.kind === "expense").groups.find((g) => g.group === "Sähkö");
    expect(sahko.diffAmount).toBe(1000); // -9000 - (-10000)
    expect(sahko.favorable).toBe(true); // |−9000| <= |−10000|: alitus, edullinen
  });

  it("sign convention: an income group that came in under budget shows a negative diffAmount and favorable: false", () => {
    const entries = [{ accountCode: "3200", year: 2024, actualAmount: 28000 }];
    const groupBudgets = [{ id: "income::Vuokrat::2024", kind: "income", group: "Vuokrat", year: 2024, budgetAmount: 30000, active: true }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, groupBudgets, [], 2024);
    const vuokrat = vm.sections.find((s) => s.kind === "income").groups.find((g) => g.group === "Vuokrat");
    expect(vuokrat.diffAmount).toBe(-2000); // 28000 - 30000
    expect(vuokrat.favorable).toBe(false); // tulot jäivät, epäedullinen
  });

  it("exposes the tili-level breakdown on rows for the detail panel", () => {
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -6000, budgetAmount: -5000 }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], [], 2024);
    const sahko = vm.sections.find((s) => s.kind === "expense").groups.find((g) => g.group === "Sähkö");
    expect(sahko.rows).toEqual([{ accountCode: "5400", name: "Sähkölasku", budget: -5000, actual: -6000, diffAmount: -1000, diffPercent: 20 }]);
  });

  it("kpis are split by kind instead of summed together (mixing signed expense and income totals is meaningless)", () => {
    const entries = [
      { accountCode: "5400", year: 2024, actualAmount: -9000, budgetAmount: -10000 }, // expense
      { accountCode: "3200", year: 2024, actualAmount: 28000, budgetAmount: 30000 }, // income
    ];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], [], 2024);
    expect(vm.kpis.expense).toEqual({ totalBudget: -10000, totalActual: -9000, netDiff: 1000, avgAbsDeviationPercent: 10 });
    expect(vm.kpis.income).toEqual({ totalBudget: 30000, totalActual: 28000, netDiff: -2000, avgAbsDeviationPercent: (2000 / 30000) * 100 });
  });

  it("kpis.<kind> is null when that kind has no accounts at all (mirrors sections not having that kind)", () => {
    const expenseOnlyAccounts = GROUP_BUDGET_ACCOUNTS.filter((a) => a.kind === "expense");
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -9000, budgetAmount: -10000 }];
    const vm = buildGroupBudgetVsActualViewModel(expenseOnlyAccounts, entries, [], [], 2024);
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
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], [], 2025);
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
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], [], 2024);
    expect(vm.kpis.expense.avgAbsDeviationPercent).toBeCloseTo(10, 6);
  });

  it("avgAbsDeviationPercent is undefined (rendered \u2014, not 0 %) for a kind with rows but no computable deviation", () => {
    const entries = [
      { accountCode: "5400", year: 2024, actualAmount: -9000, budgetAmount: -10000 },
      { accountCode: "3200", year: 2024, actualAmount: 28000 }, // income, one-sided only
    ];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], [], 2024);
    expect(vm.kpis.income.avgAbsDeviationPercent).toBeUndefined();
    expect(vm.kpis.expense.avgAbsDeviationPercent).toBeCloseTo(10, 6);
  });

  it("kpis has no top-level avgAbsDeviationPercent any more (it lives on each kind)", () => {
    const entries = [{ accountCode: "5400", year: 2024, actualAmount: -9000, budgetAmount: -10000 }];
    const vm = buildGroupBudgetVsActualViewModel(GROUP_BUDGET_ACCOUNTS, entries, [], [], 2024);
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
      next.financialAccounts, next.financialEntries, next.groupBudgets, next.groupActuals, 2025,
    );
    const sahko = budget.sections
      .flatMap((section) => section.groups)
      .find((group) => group.group === "Sähkö");
    expect(sahko?.budget).toBe(-10000);
    expect(sahko?.actual).toBeUndefined();
    expect(sahko?.diffPercent).toBeUndefined();
  });
});

/**
 * The production shape this feature exists for (handoff §0/§2), trimmed to the
 * accounts that matter. Hoitovastikkeet 2023 was itemised only for 3030 in the
 * source, so its account sum is 3 527,50 € against a true 36 237,38 €.
 * Hallintopalvelut 2023 is the control: fewer accounts report than in other
 * years, yet the year is complete.
 */
const GROUP_ACTUAL_ACCOUNTS = [
  { accountCode: "3000", name: "Hoitovastike, asunnot", kind: "income", group: "Hoitovastikkeet" },
  { accountCode: "3002", name: "Hoitovastike, autokatokset", kind: "income", group: "Hoitovastikkeet" },
  { accountCode: "3030", name: "Kulutusperusteinen vastike", kind: "income", group: "Hoitovastikkeet" },
  { accountCode: "3050", name: "Hoitovastike, kaapeli-TV", kind: "income", group: "Hoitovastikkeet" },
  { accountCode: "5310", name: "Isännöinnin erill. korv.", kind: "expense", group: "Hallintopalvelut" },
  { accountCode: "5320", name: "Isännöintipalkkio", kind: "expense", group: "Hallintopalvelut" },
  { accountCode: "5373", name: "Postikulut", kind: "expense", group: "Hallintopalvelut" },
];

/** 2023 as the source itemised it: one income account, two of three admin accounts. */
const GROUP_ACTUAL_ENTRIES_2023 = [
  { accountCode: "3030", year: 2023, actualAmount: 3_527.5, budgetAmount: 3_600 },
  { accountCode: "3000", year: 2023, budgetAmount: 32_009.69 },
  { accountCode: "5320", year: 2023, actualAmount: -7_800, budgetAmount: -7_800 },
  { accountCode: "5373", year: 2023, actualAmount: -203.7, budgetAmount: -200 },
];

/** @param {string} group @param {number} amount */
const incomeActual2023 = (group, amount) => ({
  id: `income::${group}::2023`, kind: "income", group, year: 2023, actualAmount: amount, active: true,
});
/** @param {string} group @param {number} amount */
const expenseActual2023 = (group, amount) => ({
  id: `expense::${group}::2023`, kind: "expense", group, year: 2023, actualAmount: amount, active: true,
});

/** @param {ReturnType<typeof buildGroupBudgetVsActualViewModel>} vm @param {string} group */
function findGroupRow(vm, group) {
  return vm.sections.flatMap((section) => section.groups).find((row) => row.group === group);
}

describe("buildGroupBudgetVsActualViewModel — group-level actuals", () => {
  it("prefers the group-level actual over a partial account sum and reports what is un-itemised", () => {
    const vm = buildGroupBudgetVsActualViewModel(
      GROUP_ACTUAL_ACCOUNTS, GROUP_ACTUAL_ENTRIES_2023,
      [], [incomeActual2023("Hoitovastikkeet", 36_237.38)], 2023,
    );
    const row = findGroupRow(vm, "Hoitovastikkeet");

    expect(row.actual).toBe(36_237.38);
    expect(row.actualSource).toBe("group");
    // The account sum is kept, not discarded: the detail panel has to explain
    // why its rows do not add up to the group total.
    expect(row.accountsActual).toBe(3_527.5);
    expect(row.unitemizedActual).toBeCloseTo(32_709.88, 6);
  });

  it("computes the comparison against the true total, not the partial sum", () => {
    // Before this, the view read budget 35 609,69 / toteuma 3 527,50 / −90,1 %,
    // as if 32 000 € of vastike had gone uncollected. The budget was exceeded.
    const vm = buildGroupBudgetVsActualViewModel(
      GROUP_ACTUAL_ACCOUNTS, GROUP_ACTUAL_ENTRIES_2023,
      [], [incomeActual2023("Hoitovastikkeet", 36_237.38)], 2023,
    );
    const row = findGroupRow(vm, "Hoitovastikkeet");

    expect(row.budget).toBeCloseTo(35_609.69, 6);
    expect(row.diffAmount).toBeCloseTo(627.69, 6);
    expect(row.diffPercent).toBeCloseTo(1.7627, 3);
    expect(row.favorable).toBe(true);
  });

  it("carries the corrected actual into the kind's KPIs", () => {
    const vm = buildGroupBudgetVsActualViewModel(
      GROUP_ACTUAL_ACCOUNTS, GROUP_ACTUAL_ENTRIES_2023,
      [], [incomeActual2023("Hoitovastikkeet", 36_237.38)], 2023,
    );

    expect(vm.kpis.income.totalActual).toBe(36_237.38);
    expect(vm.kpis.income.netDiff).toBeCloseTo(627.69, 6);
    expect(vm.kpis.income.avgAbsDeviationPercent).toBeCloseTo(1.7627, 3);
  });

  it("marks nothing when the group-level actual agrees with the account sum", () => {
    // The mechanism checks itself: 2023 expenses match to the cent in the real
    // data, so importing them changes nothing anywhere. Only a genuine
    // shortfall stands out, which is what keeps the marking worth reading.
    const vm = buildGroupBudgetVsActualViewModel(
      GROUP_ACTUAL_ACCOUNTS, GROUP_ACTUAL_ENTRIES_2023,
      [], [expenseActual2023("Hallintopalvelut", -8_003.7)], 2023,
    );
    const row = findGroupRow(vm, "Hallintopalvelut");

    expect(row.actual).toBe(-8_003.7);
    expect(row.actualSource).toBe("group");
    expect(row.unitemizedActual).toBeUndefined();
  });

  it("REGRESSION (handoff §2): a group with fewer accounts reporting than other years is NOT partial", () => {
    // Hallintopalvelut 2023 reports 2 of its 3 accounts here (8 of 11 in
    // production) and is nonetheless complete — the missing accounts are
    // genuine zeros: 5310 Isännöinnin erill. korv. had no cost that year, and
    // 5373 Postikulut is absent from other years for the same reason.
    //
    // This test exists to stop the obvious fix from coming back. Counting how
    // many of a group's accounts reported looks like the natural way to detect
    // a partial year, and it is wrong: "no such cost" and "not itemised" are
    // numerically identical, so the count would flag this complete group and
    // train the user to ignore the marking. The only thing that separates the
    // two cases is the group's true total, and it agrees with the account sum
    // here — so nothing is marked.
    const vm = buildGroupBudgetVsActualViewModel(
      GROUP_ACTUAL_ACCOUNTS, GROUP_ACTUAL_ENTRIES_2023,
      [], [expenseActual2023("Hallintopalvelut", -8_003.7)], 2023,
    );
    const row = findGroupRow(vm, "Hallintopalvelut");

    expect(row.rows).toHaveLength(2);
    expect(row.rows.length).toBeLessThan(
      GROUP_ACTUAL_ACCOUNTS.filter((a) => a.group === "Hallintopalvelut").length,
    );
    expect(row.unitemizedActual).toBeUndefined();
  });

  it("treats a sub-cent difference as rounding, not as un-itemised money", () => {
    // The group total is one pasted figure; the account side is a sum of many
    // separately parsed floats. Without a tolerance every group would carry a
    // phantom gap and the marking would become noise.
    const vm = buildGroupBudgetVsActualViewModel(
      GROUP_ACTUAL_ACCOUNTS, GROUP_ACTUAL_ENTRIES_2023,
      [], [expenseActual2023("Hallintopalvelut", -8_003.7001)], 2023,
    );

    expect(findGroupRow(vm, "Hallintopalvelut").unitemizedActual).toBeUndefined();
  });

  it("does not mark a group whose actual is a genuine 0,00 €", () => {
    const entries = [{ accountCode: "5320", year: 2023, actualAmount: 0, budgetAmount: -500 }];
    const vm = buildGroupBudgetVsActualViewModel(
      GROUP_ACTUAL_ACCOUNTS, entries, [], [expenseActual2023("Hallintopalvelut", 0)], 2023,
    );
    const row = findGroupRow(vm, "Hallintopalvelut");

    expect(row.actual).toBe(0);
    expect(row.actualSource).toBe("group");
    expect(row.unitemizedActual).toBeUndefined();
  });

  it("renders a group that has no accounts at all, with nothing marked un-itemised", () => {
    // Rental income exists in the source but was never itemised into the chart
    // of accounts. Nothing was ever itemised, so nothing is *un*-itemised —
    // the row is complete, not partial.
    const vm = buildGroupBudgetVsActualViewModel(
      GROUP_ACTUAL_ACCOUNTS, GROUP_ACTUAL_ENTRIES_2023,
      [], [incomeActual2023("Vuokratuotot", 720)], 2023,
    );
    const row = findGroupRow(vm, "Vuokratuotot");

    expect(row.actual).toBe(720);
    expect(row.actualSource).toBe("group");
    expect(row.accountsActual).toBeUndefined();
    expect(row.unitemizedActual).toBeUndefined();
    expect(row.budget).toBeUndefined();
  });

  it("falls back to the account sum when no group-level actual exists (backward compatibility)", () => {
    const vm = buildGroupBudgetVsActualViewModel(
      GROUP_ACTUAL_ACCOUNTS, GROUP_ACTUAL_ENTRIES_2023, [], [], 2023,
    );
    const row = findGroupRow(vm, "Hoitovastikkeet");

    expect(row.actual).toBe(3_527.5);
    expect(row.actualSource).toBe("accounts");
    expect(row.unitemizedActual).toBeUndefined();
  });

  it("ignores an inactive group-level actual and falls back to the account sum", () => {
    const retired = { ...incomeActual2023("Hoitovastikkeet", 36_237.38), active: false };
    const vm = buildGroupBudgetVsActualViewModel(
      GROUP_ACTUAL_ACCOUNTS, GROUP_ACTUAL_ENTRIES_2023, [], [retired], 2023,
    );
    const row = findGroupRow(vm, "Hoitovastikkeet");

    expect(row.actual).toBe(3_527.5);
    expect(row.actualSource).toBe("accounts");
  });

  it("ignores a group-level actual from a different year", () => {
    const vm = buildGroupBudgetVsActualViewModel(
      GROUP_ACTUAL_ACCOUNTS, GROUP_ACTUAL_ENTRIES_2023,
      [], [{ ...incomeActual2023("Hoitovastikkeet", 40_666.93), id: "income::Hoitovastikkeet::2024", year: 2024 }],
      2023,
    );

    expect(findGroupRow(vm, "Hoitovastikkeet").actual).toBe(3_527.5);
  });
});

describe("deriveComparableGroupBudgetYears — group-level actuals", () => {
  it("counts a group-level actual as an actual, so a year with no account actuals is still selectable", () => {
    const entries = [{ accountCode: "3000", year: 2023, budgetAmount: 32_000 }];
    const groupActuals = [incomeActual2023("Hoitovastikkeet", 36_237.38)];
    expect(deriveComparableGroupBudgetYears(GROUP_ACTUAL_ACCOUNTS, entries, [], groupActuals))
      .toEqual([2023]);
  });

  it("ignores an inactive group-level actual", () => {
    const entries = [{ accountCode: "3000", year: 2023, budgetAmount: 32_000 }];
    const groupActuals = [{ ...incomeActual2023("Hoitovastikkeet", 36_237.38), active: false }];
    expect(deriveComparableGroupBudgetYears(GROUP_ACTUAL_ACCOUNTS, entries, [], groupActuals))
      .toEqual([]);
  });
});

describe("buildGroupActualSeries", () => {
  const entries = [
    { accountCode: "3030", year: 2023, actualAmount: 3_527.5 },
    { accountCode: "3000", year: 2024, actualAmount: 40_666.93 },
  ];

  it("overrides the account sum with the group-level figure per year", () => {
    const series = buildGroupActualSeries(
      GROUP_ACTUAL_ACCOUNTS, entries, [incomeActual2023("Hoitovastikkeet", 36_237.38)], "income",
    );

    expect(series.actualYears).toEqual([2023, 2024]);
    expect(series.totals.actuals[2023]).toBe(36_237.38);
    // 2024 has no group-level figure, so it stays the account sum.
    expect(series.totals.actuals[2024]).toBe(40_666.93);
  });

  it("unions in a group that has no accounts, so known income is not left out", () => {
    const series = buildGroupActualSeries(
      GROUP_ACTUAL_ACCOUNTS, entries,
      [incomeActual2023("Hoitovastikkeet", 36_237.38), incomeActual2023("Vuokratuotot", 720)],
      "income",
    );

    expect(series.groups.map((g) => g.group)).toEqual(["Hoitovastikkeet", "Vuokratuotot"]);
    expect(series.totals.actuals[2023]).toBeCloseTo(36_957.38, 6);
    // Absent from 2024 rather than counted as zero there.
    expect(series.groups.find((g) => g.group === "Vuokratuotot").actuals[2024]).toBeUndefined();
  });

  it("leaves the account sum untouched when no group-level actuals exist", () => {
    const series = buildGroupActualSeries(GROUP_ACTUAL_ACCOUNTS, entries, [], "income");
    expect(series.totals.actuals[2023]).toBe(3_527.5);
  });

  it("ignores group-level actuals of the other kind", () => {
    const series = buildGroupActualSeries(
      GROUP_ACTUAL_ACCOUNTS, entries, [expenseActual2023("Hoitovastikkeet", -99)], "income",
    );
    expect(series.totals.actuals[2023]).toBe(3_527.5);
  });

  it("is empty when there is neither account data nor a group-level actual", () => {
    expect(buildGroupActualSeries([], [], [], "income").isEmpty).toBe(true);
  });
});

describe("buildSummaryChartModel with group-level actuals", () => {
  const accounts = [
    { accountCode: "3030", name: "Kulutusvastike", kind: "income", group: "Hoitovastikkeet" },
    { accountCode: "5320", name: "Isännöinti", kind: "expense", group: "Hallintopalvelut" },
  ];
  const entries = [
    { accountCode: "3030", year: 2023, actualAmount: 3_527.5 },
    { accountCode: "5320", year: 2023, actualAmount: -34_271.63 },
  ];
  const groupActuals = [
    incomeActual2023("Hoitovastikkeet", 36_237.38),
    incomeActual2023("Vuokratuotot", 720),
    expenseActual2023("Hallintopalvelut", -34_271.63),
  ];

  it("draws the 2023 income bar at its true height and turns hoitokate positive", () => {
    // Before this the chart showed income 3 528 € against expenses −34 272 €,
    // a hoitokate near −30 744 € for a year that was in surplus.
    const model = buildSummaryChartModel(
      buildGroupActualSeries(accounts, entries, groupActuals, "income"),
      buildGroupActualSeries(accounts, entries, groupActuals, "expense"),
    );
    const [incomeBar, expenseBar] = model.columns.find((c) => c.year === 2023).bars;

    expect(incomeBar.value).toBeCloseTo(36_957.38, 6);
    expect(expenseBar.value).toBe(-34_271.63);
    expect(incomeBar.value + expenseBar.value).toBeGreaterThan(0);
  });

  it("does not mark the corrected year partial: a group-level actual repairs a bar, it does not flag one", () => {
    // There is one partiality concept, not two. Coverage still asks how many
    // groups reported; a group-level actual simply counts as reporting. The
    // un-itemised remainder is a tili-level fact and stays in the tili-level
    // views.
    const model = buildSummaryChartModel(
      buildGroupActualSeries(accounts, entries, groupActuals, "income"),
      buildGroupActualSeries(accounts, entries, groupActuals, "expense"),
    );
    const year2023 = model.columns.find((c) => c.year === 2023);

    expect(model.hasPartial).toBe(false);
    for (const bar of year2023.bars) {
      expect(bar.partial).toBe(false);
      expect(bar.reportingGroups).toBe(bar.totalGroups);
    }
  });

  it("still marks a year where a group reports through neither source", () => {
    // The existing coverage rule is untouched: a group that has no account
    // actual and no group-level actual for a year leaves the bar partial.
    const withUncoveredGroup = [
      ...accounts,
      { accountCode: "3200", name: "Autopaikat", kind: "income", group: "Autopaikkatuotot" },
    ];
    const withOtherYear = [...entries, { accountCode: "3200", year: 2024, actualAmount: 1_200 }];
    const model = buildSummaryChartModel(
      buildGroupActualSeries(withUncoveredGroup, withOtherYear, groupActuals, "income"),
      buildGroupActualSeries(withUncoveredGroup, withOtherYear, groupActuals, "expense"),
    );
    const incomeBar = model.columns.find((c) => c.year === 2023).bars[0];

    expect(incomeBar.partial).toBe(true);
    expect(incomeBar.reportingGroups).toBe(2);
    expect(incomeBar.totalGroups).toBe(3);
  });
});

describe("interpretRevisionConflict — database access policy", () => {
  it("explains a policy rejection the browser can only identify by its code", () => {
    // A 500's message is replaced with "Internal server error." before it
    // leaves the server, so without this the user saw exactly that and had no
    // way to know the cause or the fix. The code survives; the message does not.
    const result = interpretRevisionConflict({
      code: "DATABASE_ACCESS_POLICY_ERROR",
      message: "Internal server error.",
    });

    expect(result.message).toContain("konfiguraatiovirhe");
    expect(result.message).toContain("migraatio 004");
    expect(result.message).toContain("tietoja ei muutettu");
  });

  it("does not call it a conflict, because reloading cannot fix it", () => {
    // isConflict drives a "reload the workspace and try again" prompt. Nothing
    // about reloading clears a row-level security policy, so offering it would
    // send the user round a loop with no exit.
    expect(interpretRevisionConflict({ code: "DATABASE_ACCESS_POLICY_ERROR" }).isConflict)
      .toBe(false);
  });

  it("leaves the revision conflict untouched", () => {
    const result = interpretRevisionConflict({ code: "ADMIN_REVISION_CONFLICT" });
    expect(result.isConflict).toBe(true);
    expect(result.message).toContain("Lataa työtila uudelleen");
  });
});

describe("describeApiError", () => {
  it("explains a code whose message the server withheld", () => {
    expect(describeApiError({
      code: "DATABASE_ACCESS_POLICY_ERROR",
      message: "Internal server error.",
    })).toContain("migraatio 004");
  });

  it("prefers the server's own message when there is a real one", () => {
    expect(describeApiError({ code: "INVALID_HTTP_REQUEST", message: "Vuosi puuttuu." }))
      .toBe("Vuosi puuttuu.");
  });

  it("falls back rather than rendering undefined", () => {
    expect(describeApiError(undefined)).toBe("Tuntematon virhe.");
    expect(describeApiError({})).toBe("Tuntematon virhe.");
  });
});

describe("formatFinnishDate", () => {
  it("turns an ISO date into a Finnish one, without leading zeros", () => {
    expect(formatFinnishDate("2026-04-28")).toBe("28.4.2026");
    expect(formatFinnishDate("2025-12-31")).toBe("31.12.2025");
    expect(formatFinnishDate("2026-01-05")).toBe("5.1.2026");
  });

  it("returns anything that is not exactly YYYY-MM-DD unchanged", () => {
    expect(formatFinnishDate("2025-Q4")).toBe("2025-Q4");
    expect(formatFinnishDate("2026-07-17T15:00:00+03:00")).toBe("2026-07-17T15:00:00+03:00");
    expect(formatFinnishDate("kevät 2026")).toBe("kevät 2026");
    expect(formatFinnishDate("")).toBe("");
  });

  it("gives an empty string for a missing value, so callers can fall back to a dash", () => {
    expect(formatFinnishDate(undefined)).toBe("");
    expect(formatFinnishDate(null)).toBe("");
    expect(formatFinnishDate(undefined) || "—").toBe("—");
  });

  it("does not go through Date: the day must not shift with the time zone", () => {
    // A date-only ISO string is UTC midnight to the Date constructor. West of
    // UTC that reads back as the previous day, and in Finland it does the
    // same the moment anyone round-trips it through toISOString(). Both are
    // shown here on purpose, so a later "simplification" to new Date() has
    // its bug spelled out beside the assertion that catches it.
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      expect(new Date("2026-04-28").getDate()).toBe(27); // the trap, west of UTC
      expect(formatFinnishDate("2026-04-28")).toBe("28.4.2026");

      process.env.TZ = "Europe/Helsinki";
      expect(new Date("2026-04-28T00:00").toISOString().slice(0, 10)).toBe("2026-04-27"); // the trap, at home
      expect(formatFinnishDate("2026-04-28")).toBe("28.4.2026");
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it("does not construct a Date at all", () => {
    // Belt to the braces above: with Date replaced by something that throws,
    // a string transform still works and a Date-based one cannot.
    const RealDate = globalThis.Date;
    globalThis.Date = function BrokenDate() { throw new Error("formatFinnishDate must not use Date"); };
    try {
      expect(formatFinnishDate("2026-04-28")).toBe("28.4.2026");
      expect(formatFinnishDate("2025-Q4")).toBe("2025-Q4");
    } finally {
      globalThis.Date = RealDate;
    }
  });
});

describe("Selvitykset (feature/selvitykset)", () => {
  describe("parseMaintenanceDocumentPasteInput", () => {
    it("parses two columns and keeps the pasted order", () => {
      const parsed = parseMaintenanceDocumentPasteInput(
        "technical_lifespan",
        "Vesikatto, tiili\t30–50 v\nViemärit\t50 v – rakennuksen ikä\nIkkunat\tyli 50 v",
      );
      expect(parsed.errors).toEqual([]);
      expect(parsed.rows).toEqual([
        { item: "Vesikatto, tiili", interval: "30–50 v" },
        { item: "Viemärit", interval: "50 v – rakennuksen ikä" },
        { item: "Ikkunat", interval: "yli 50 v" },
      ]);
    });

    it("recognises and skips a header row", () => {
      const parsed = parseMaintenanceDocumentPasteInput("completed_works", "Vuosi\tToimenpide\n2012\tVesikaton uusiminen");
      expect(parsed.errors).toEqual([]);
      expect(parsed.rows).toEqual([{ year: 2012, description: "Vesikaton uusiminen" }]);
    });

    it("keeps two rows of the same year, as pasted", () => {
      const parsed = parseMaintenanceDocumentPasteInput("completed_works", "2025\tA\n2025\tB\n2019\tC");
      expect(parsed.rows.map((row) => row.description)).toEqual(["A", "B", "C"]);
    });

    it("accepts an empty target timing on any row, including the last one", () => {
      // The browser drops an empty last cell from the last pasted line, so
      // the last row arrives with one column. An empty timing is the normal
      // state of this table, so a one-column row is simply a row without a
      // timing - on the last line and on every other.
      const parsed = parseMaintenanceDocumentPasteInput(
        "maintenance_need",
        "Ilmanvaihdon puhdistus\tkevät 2026\nJulkisivut\nVaraajat\t\nSalaojat",
      );
      expect(parsed.errors).toEqual([]);
      expect(parsed.rows).toEqual([
        { measure: "Ilmanvaihdon puhdistus", targetTiming: "kevät 2026" },
        { measure: "Julkisivut" },
        { measure: "Varaajat" },
        { measure: "Salaojat" },
      ]);
    });

    it("reports a missing required second column on the last line by name, not with tab advice", () => {
      // A trailing tab would be dropped by the same browser behaviour, so
      // "add a tab" is advice that cannot work. The row is missing data.
      const parsed = parseMaintenanceDocumentPasteInput("technical_lifespan", "Viemärit\t50 v\nIkkunat");
      expect(parsed.rows).toHaveLength(1);
      expect(parsed.errors).toEqual([{ row: 2, message: "Rivi 2: kunnossapitojakso puuttuu (odotettiin 2 saraketta, löytyi 1)." }]);
      expect(parsed.errors[0].message).not.toMatch(/sarkai/i);
    });

    it("reports bad rows by line number and keeps the good ones", () => {
      const parsed = parseMaintenanceDocumentPasteInput(
        "completed_works",
        "2012\tVesikatto\n\nkaksituhatta\tX\n2019\t\n2020\tA\tB\n\t Ikkunat",
      );
      expect(parsed.rows).toEqual([{ year: 2012, description: "Vesikatto" }]);
      expect(parsed.errors.map((e) => e.row)).toEqual([3, 4, 5, 6]);
      expect(parsed.errors[0].message).toContain("ei ole kokonaisluku");
      expect(parsed.errors[1].message).toContain("toimenpide puuttuu");
      expect(parsed.errors[2].message).toContain("löytyi 3");
      expect(parsed.errors[3].message).toContain("vuosi puuttuu");
    });

    it("handles CRLF, an unknown kind, and non-string input without throwing", () => {
      expect(parseMaintenanceDocumentPasteInput("technical_lifespan", "A\t1 v\r\nB\t2 v").rows).toHaveLength(2);
      expect(parseMaintenanceDocumentPasteInput("bogus", "A\tB").errors[0].message).toContain("Tuntematon");
      expect(parseMaintenanceDocumentPasteInput("completed_works", undefined)).toEqual({ kind: "completed_works", rows: [], errors: [] });
    });
  });

  describe("validateMaintenanceNeedHeaderInput", () => {
    it("requires the period and accepts the dates as optional", () => {
      expect(validateMaintenanceNeedHeaderInput({ periodStartYear: "2026", periodEndYear: "2030", boardHandledAt: "", meetingPresentedAt: "" }))
        .toEqual({ ok: true, value: { period: { startYear: 2026, endYear: 2030 } } });
      const missing = validateMaintenanceNeedHeaderInput({ periodStartYear: "", periodEndYear: "2030" });
      expect(missing.ok).toBe(false);
      expect(Object.keys(missing.errors)).toEqual(["periodStartYear"]);
    });

    it("rejects an inverted period and a malformed date", () => {
      const inverted = validateMaintenanceNeedHeaderInput({ periodStartYear: "2030", periodEndYear: "2026" });
      expect(inverted.ok).toBe(false);
      expect(inverted.errors.periodEndYear).toContain("ennen alkuvuotta");
      const badDate = validateMaintenanceNeedHeaderInput({ periodStartYear: "2026", periodEndYear: "2030", boardHandledAt: "eilen" });
      expect(badDate.ok).toBe(false);
      expect(Object.keys(badDate.errors)).toEqual(["boardHandledAt"]);
    });
  });

  describe("buildMaintenanceDocumentSourceId", () => {
    it("names the document, with the period for the statement", () => {
      expect(buildMaintenanceDocumentSourceId("completed_works")).toBe("tehdyt_toimenpiteet");
      expect(buildMaintenanceDocumentSourceId("technical_lifespan")).toBe("tekninen_kayttoika");
      expect(buildMaintenanceDocumentSourceId("maintenance_need", { periodStartYear: "2026", periodEndYear: "2030" }))
        .toBe("kunnossapitotarveselvitys_2026_2030");
      expect(buildMaintenanceDocumentSourceId("maintenance_need", { periodStartYear: "", periodEndYear: "" }))
        .toBe("kunnossapitotarveselvitys");
    });

    it("does not overwrite a hand-written source when the period changes", () => {
      // The PR #24 trap with a different trigger: the period fields regenerate
      // the source, and a source the user typed must survive that.
      const generated = buildMaintenanceDocumentSourceId("maintenance_need", { periodStartYear: "2027", periodEndYear: "2031" });
      expect(resolveGeneratedField({ touched: true, current: "poytakirja_2026_03", generated })).toBe("poytakirja_2026_03");
      expect(resolveGeneratedField({ touched: false, current: "kunnossapitotarveselvitys_2026_2030", generated }))
        .toBe("kunnossapitotarveselvitys_2027_2031");
    });
  });

  describe("buildMaintenanceDocumentOperation", () => {
    it("builds one replace operation with the header only on the statement", () => {
      const meta = { sourceIds: ["tekninen_kayttoika"], explanation: "" };
      const lifespan = buildMaintenanceDocumentOperation(
        { kind: "technical_lifespan", rows: [{ item: "A", interval: "1 v" }] },
        { period: { startYear: 2026, endYear: 2030 } },
        meta,
      );
      expect(lifespan).toEqual({
        type: "save_maintenance_document",
        value: { id: "technical_lifespan", kind: "technical_lifespan", sourceIds: ["tekninen_kayttoika"], rows: [{ item: "A", interval: "1 v" }] },
        sourceIds: ["tekninen_kayttoika"],
        explanation: "",
      });
      const statement = buildMaintenanceDocumentOperation(
        { kind: "maintenance_need", rows: [{ measure: "X" }] },
        { period: { startYear: 2026, endYear: 2030 }, boardHandledAt: "2026-03-10" },
        meta,
      );
      expect(statement.value).toMatchObject({ id: "maintenance_need", period: { startYear: 2026, endYear: 2030 }, boardHandledAt: "2026-03-10" });
    });

    it("round-trips through the real batch: the operation replaces the table", () => {
      const snapshot = createAdminDataSnapshot({
        housingCompany: { id: "c", name: "As Oy", apartmentCount: 4 },
        maintenanceDocuments: [{
          id: "technical_lifespan", kind: "technical_lifespan", sourceIds: ["x"],
          rows: Array.from({ length: 19 }, (_, i) => ({ item: `Kohde ${i}`, interval: "1 v" })),
        }],
        updatedAt: "2026-09-11T10:00:00.123+03:00",
        updatedBy: "admin:test",
      });
      const parsed = parseMaintenanceDocumentPasteInput("technical_lifespan", "A\t1 v\nB\t2 v\nC\t3 v");
      const operation = buildMaintenanceDocumentOperation(parsed, undefined, { sourceIds: ["tekninen_kayttoika"], explanation: "" });
      const next = applyAdminBatch(snapshot, {
        companyId: "c", expectedRevision: 0, actorId: "admin:test",
        occurredAt: "2026-09-11T10:01:00.456+03:00", operations: [operation],
      });
      expect(next.maintenanceDocuments[0].rows).toHaveLength(3);
      expect(next.maintenanceDocuments[0].rows.map((r) => r.item)).toEqual(["A", "B", "C"]);
    });
  });

  describe("buildMaintenanceDocumentViewModel", () => {
    const documents = [
      { id: "completed_works", kind: "completed_works", sourceIds: ["s"], rows: [
        { year: 2025, description: "A" }, { year: 2012, description: "B" }, { year: 2025, description: "C" },
      ] },
      { id: "technical_lifespan", kind: "technical_lifespan", sourceIds: ["s"], rows: [
        { item: "Vesikatto", interval: "30 v" }, { item: "Ikkunat", interval: "50 v" }, { item: "Hissi", interval: "25 v" },
      ] },
      { id: "maintenance_need", kind: "maintenance_need", sourceIds: ["s"], period: { startYear: 2026, endYear: 2030 },
        boardHandledAt: "2026-03-10", rows: [{ measure: "X", targetTiming: "kevät 2026" }, { measure: "Y" }] },
    ];

    it("sorts completed works by year, stably", () => {
      const vm = buildMaintenanceDocumentViewModel(documents, "completed_works");
      expect(vm.rows).toEqual([
        { first: "2012", second: "B" }, { first: "2025", second: "A" }, { first: "2025", second: "C" },
      ]);
    });

    it("leaves the technical lifespan list in its stored (subject) order", () => {
      const vm = buildMaintenanceDocumentViewModel(documents, "technical_lifespan");
      expect(vm.rows.map((row) => row.first)).toEqual(["Vesikatto", "Ikkunat", "Hissi"]);
      expect(vm.notes).toHaveLength(2);
      expect(vm.notes[1]).toContain("suuntaa antavia");
    });

    it("carries the statement's header, standing text and empty timing", () => {
      const vm = buildMaintenanceDocumentViewModel(documents, "maintenance_need");
      expect(vm.header).toEqual({ periodLabel: "2026–2030", boardHandledAtLabel: "10.3.2026", meetingPresentedAtLabel: "" });
      expect(vm.standingText).toContain("hallituksen tämän hetken näkemys");
      expect(vm.rows[1]).toEqual({ first: "Y", second: "" });
    });

    it("is empty, and does not throw, without documents", () => {
      const vm = buildMaintenanceDocumentViewModel(undefined, "completed_works");
      expect(vm).toMatchObject({ isEmpty: true, rowCount: 0, rows: [], header: null, current: null, title: "Tehdyt toimenpiteet" });
    });

    it("withholds the lifespan notes until there is a table for them to qualify", () => {
      // "Yllä olevat vuosimäärät" refers to rows; over "Ei sisältöä" it
      // refers to nothing.
      expect(buildMaintenanceDocumentViewModel(undefined, "technical_lifespan").notes).toEqual([]);
      expect(buildMaintenanceDocumentViewModel(
        [{ id: "technical_lifespan", kind: "technical_lifespan", sourceIds: ["s"], rows: [] }],
        "technical_lifespan",
      ).notes).toEqual([]);
      expect(buildMaintenanceDocumentViewModel(documents, "technical_lifespan").notes).toHaveLength(2);
    });

    it("shows the statement's standing text even without rows, since it describes the document", () => {
      expect(buildMaintenanceDocumentViewModel(undefined, "maintenance_need").standingText).toContain("hallituksen tämän hetken näkemys");
    });
  });

  describe("describeMaintenanceDocumentReplace", () => {
    const documents = [{ id: "technical_lifespan", kind: "technical_lifespan", sourceIds: ["s"],
      rows: Array.from({ length: 19 }, (_, i) => ({ item: `K${i}`, interval: "1 v" })) }];

    it("says the paste replaces the current rows", () => {
      const parsed = { rows: [{}, {}, {}], errors: [] };
      expect(describeMaintenanceDocumentReplace(parsed, documents, "technical_lifespan"))
        .toEqual({ parsedCount: 3, currentCount: 19, summary: "3 riviä tunnistettu. Korvaa nykyiset 19 riviä.", canSubmit: true });
    });

    it("says there is nothing to replace, and blocks an empty or erroneous paste", () => {
      expect(describeMaintenanceDocumentReplace({ rows: [{}], errors: [] }, documents, "completed_works").summary)
        .toBe("1 riviä tunnistettu. Ei aiempaa sisältöä.");
      expect(describeMaintenanceDocumentReplace({ rows: [], errors: [] }, documents, "technical_lifespan").canSubmit).toBe(false);
      expect(describeMaintenanceDocumentReplace({ rows: [{}], errors: [{ row: 1, message: "x" }] }, documents, "technical_lifespan").canSubmit).toBe(false);
    });
  });

  describe("planEntityDeletion for a maintenance document", () => {
    it("deletes only the document, labelled with its row count", () => {
      const model = {
        assets: [], observations: [], events: [], costEvidence: [], priceLevelConfirmations: [], financialEntries: [],
        maintenanceDocuments: [{ id: "technical_lifespan", kind: "technical_lifespan", sourceIds: ["tekninen_kayttoika"],
          rows: [{ item: "A", interval: "1 v" }, { item: "B", interval: "2 v" }] }],
      };
      const plan = planEntityDeletion(model, { entityType: "maintenance_document", entityKey: "technical_lifespan" });
      expect(plan.target.label).toBe("Tekninen käyttöikä (2 riviä)");
      expect(plan.target.sources).toEqual(["tekninen_kayttoika"]);
      // The target is its own only delete; nothing cascades from a document.
      expect(plan.deletes.map((item) => `${item.entityType}:${item.entityKey}`))
        .toEqual(["maintenance_document:technical_lifespan"]);
      expect(plan.updates).toEqual([]);
      const ops = buildDeletionOperations(plan, { explanation: "" });
      expect(ops).toEqual([{
        type: "delete_entity", entityType: "maintenance_document", entityKey: "technical_lifespan",
        sourceIds: ["maintenance_document:technical_lifespan"], explanation: "",
      }]);
    });
  });
});

describe("buildCashPathViewModel", () => {
  const model = {
    latestActualYear: 2025,
    maintenancePlanCoverageThroughYear: 2030,
    scenarios: {
      base: {
        scenario: "base",
        rows: [
          { rowKind: "actual", year: 2025, openingCash: 16977, operatingMargin: 9877.29, repairs: 3881.55, closingCash: 22208, repairBudget: 9400, marginVsBudget: 527.29 },
          { rowKind: "budget", year: 2026, openingCash: 22208, operatingMargin: 9458.55, repairs: 4300, repairDataGapCount: 0, closingCash: 27366.55, repairBudget: 9680 },
        ],
        knownRepairs: {
          rows: [
            { year: 2026, eventId: "e1", scheduleEntryId: "s1", assetId: "a", title: "Ilmanvaihdon puhdistus", amount: 2500, priceQuality: "estimate" },
            { year: 2028, eventId: "e2", scheduleEntryId: "s2", assetId: "a", title: "Salaojat", priceQuality: "data_gap" },
          ],
          total: 2500,
          dataGapCount: 1,
        },
      },
      stress: { scenario: "stress", rows: [], knownRepairs: { rows: [], total: 0, dataGapCount: 0 } },
    },
    completedRepairs: [{ year: 2025, eventId: "e0", assetId: "a", title: "IV-eristys", amount: 1545 }],
  };

  it("attaches the row class from rowKind, and from nothing else", () => {
    // Both rows have every cell filled; only the discriminant tells them
    // apart. If the renderer inferred quality from the cells, both would
    // read as actual.
    const vm = buildCashPathViewModel(model, "base");

    expect(vm.rows.map((row) => [row.year, row.rowKind, row.rowClass, row.yearLabel])).toEqual([
      [2025, "actual", "row-actual", "2025"],
      [2026, "budget", "row-budget", "2026 (budjetti)"],
    ]);
    expect(vm.hasBudgetRow).toBe(true);
  });

  it("labels the price quality on each banner row", () => {
    const vm = buildCashPathViewModel(model, "base");

    expect(vm.knownRepairs.rows.map((row) => row.qualityLabel)).toEqual(["arvio", "DATA GAP"]);
    expect(vm.knownRepairs.total).toBe(2500);
    expect(vm.knownRepairs.dataGapCount).toBe(1);
    expect(vm.knownRepairs.isEmpty).toBe(false);
  });

  it("follows the scenario", () => {
    const vm = buildCashPathViewModel(model, "stress");

    expect(vm.isEmpty).toBe(true);
    expect(vm.knownRepairs.isEmpty).toBe(true);
    // Completed repairs are not a scenario: they are the same in every tab.
    expect(vm.completedRepairs.rows).toEqual(model.completedRepairs);
  });

  it("says the coverage is unset instead of implying the table is complete", () => {
    const vm = buildCashPathViewModel({ ...model, maintenancePlanCoverageThroughYear: undefined }, "base");

    expect(vm.coverageLine).toContain("ei ole asetettu");
    expect(buildCashPathViewModel(model, "base").coverageLine).toContain("2030");
  });

  it("is empty, and does not throw, for a missing model or scenario", () => {
    for (const input of [undefined, null, {}, { scenarios: {} }]) {
      const vm = buildCashPathViewModel(input, "base");
      expect(vm.isEmpty).toBe(true);
      expect(vm.rows).toEqual([]);
      expect(vm.knownRepairs).toEqual({ isEmpty: true, rows: [], total: 0, dataGapCount: 0 });
      expect(vm.completedRepairs).toEqual({ isEmpty: true, rows: [] });
    }
  });
});

describe("buildForecastCompletenessLines", () => {
  /** The production case: a plan to 2030 under a horizon reaching 2050. */
  const shortCoveragePath = {
    maintenancePlanCoverageThroughYear: 2030,
    beyondCoverage: { firstYear: 2031, yearCount: 20 },
    years: Array.from({ length: 24 }, (_, i) => ({ year: 2027 + i })),
    blockingDataGaps: [],
  };

  it("says complete, once, when there are no reasons", () => {
    expect(buildForecastCompletenessLines([], shortCoveragePath))
      .toEqual([{ tone: "ok", text: "Ennuste täydellinen" }]);
  });

  it("names the coverage gap in years, not DATA GAPs, when coverage is the cause", () => {
    // The old text said "Ennuste puutteellinen (DATA GAP)" for every cause.
    // With no gaps at all that named the wrong problem and pointed the user at
    // the wrong fix.
    const [line, ...rest] = buildForecastCompletenessLines(
      ["coverage_ends_before_horizon"], shortCoveragePath,
    );

    expect(rest).toEqual([]);
    expect(line.tone).toBe("warning");
    expect(line.text).toContain("suunnitelma kattaa vuoteen 2030");
    expect(line.text).toContain("horisontti ulottuu vuoteen 2050");
    expect(line.text).toContain("20 vuotta suunnittelematta");
    expect(line.text).not.toContain("DATA GAP");
  });

  it("quotes the horizon of the cash path it was given, not any other view's", () => {
    // Horizons differ between views (2050 here, 2057 elsewhere). Both the last
    // year and the uncovered count come from this one path, so a card cannot
    // caption itself with another view's horizon.
    const longerHorizon = {
      ...shortCoveragePath,
      beyondCoverage: { firstYear: 2031, yearCount: 27 },
      years: Array.from({ length: 31 }, (_, i) => ({ year: 2027 + i })),
    };
    const [line] = buildForecastCompletenessLines(["coverage_ends_before_horizon"], longerHorizon);

    expect(line.text).toContain("vuoteen 2057");
    expect(line.text).toContain("27 vuotta suunnittelematta");
  });

  it("asks for the coverage year when nobody has set one", () => {
    const [line] = buildForecastCompletenessLines(["coverage_unset"], {
      years: [{ year: 2027 }, { year: 2050 }],
      blockingDataGaps: [],
    });

    expect(line.tone).toBe("warning");
    expect(line.text).toContain("kate on kertomatta");
    expect(line.text).not.toContain("DATA GAP");
  });

  it("counts the DATA GAPs when they are the cause", () => {
    const [line] = buildForecastCompletenessLines(["data_gap"], {
      ...shortCoveragePath,
      maintenancePlanCoverageThroughYear: 2050,
      beyondCoverage: undefined,
      blockingDataGaps: [{}, {}, {}],
    });

    expect(line.text).toContain("3 DATA GAPia");
    expect(line.text).toContain("kustannusnäytöt");
  });

  it("gives one line per reason when both apply, because they need different work", () => {
    const lines = buildForecastCompletenessLines(
      ["data_gap", "coverage_ends_before_horizon"],
      { ...shortCoveragePath, blockingDataGaps: [{}] },
    );

    expect(lines).toHaveLength(2);
    expect(lines[0].text).toContain("DATA GAP");
    expect(lines[1].text).toContain("suunnitelma kattaa vuoteen 2030");
    expect(lines.every((line) => line.tone === "warning")).toBe(true);
  });

  it("still says something useful when the cash path is missing its detail", () => {
    const lines = buildForecastCompletenessLines(["coverage_ends_before_horizon"], undefined);

    expect(lines).toHaveLength(1);
    expect(lines[0].tone).toBe("warning");
    expect(lines[0].text).toContain("ei kata koko horisonttia");
  });
});
