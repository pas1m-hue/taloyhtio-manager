import { describe, expect, it } from "vitest";
import { applyAdminBatch, createAdminDataSnapshot } from "../src/admin/applyAdminBatch.js";
import {
  buildAccountCostsViewModel,
  buildAssetListViewModel,
  buildBudgetVsActualViewModel,
  buildCostEvidenceListViewModel,
  buildEventListViewModel,
  buildExpenseGroupViewModel,
  buildFinancialImportOperations,
  buildIncomeViewModel,
  buildObservationListViewModel,
  buildSaveAssetOperation,
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
  interpretRevisionConflict,
  isCostEvidenceExpired,
  parseFinancialPasteInput,
  parseSourceIds,
  PROJECTION_PRICE_LEVEL_YEAR,
  selectFinancialYearViewModel,
  validateAssetInput,
  validateBuildingEventInput,
  validateCompanyInput,
  validateCostEvidenceInput,
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
