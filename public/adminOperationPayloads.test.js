import { describe, expect, it } from "vitest";
import {
  buildAssetListViewModel,
  buildCostEvidenceListViewModel,
  buildObservationListViewModel,
  buildSaveAssetOperation,
  buildSaveCostEvidenceOperation,
  buildSaveHousingCompanyOperation,
  buildSaveObservationOperation,
  buildSavePriceLevelConfirmationOperation,
  canSubmitAdminOperation,
  countActiveAssets,
  countObservationsWithoutEvent,
  deriveDataGapAssets,
  interpretRevisionConflict,
  isCostEvidenceExpired,
  parseSourceIds,
  PROJECTION_PRICE_LEVEL_YEAR,
  selectFinancialYearViewModel,
  validateAssetInput,
  validateCompanyInput,
  validateCostEvidenceInput,
  validateObservationInput,
  validatePriceLevelConfirmationInput,
} from "./adminOperationPayloads.js";

const ASSETS = [
  { id: "asset_roof", name: "Vesikatto" },
  { id: "asset_yard", name: "Piha-alue" },
];

const EVENTS = [{ id: "event_roof_repair" }];

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
