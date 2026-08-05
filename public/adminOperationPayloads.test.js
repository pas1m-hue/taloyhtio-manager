import { describe, expect, it } from "vitest";
import {
  buildAssetListViewModel,
  buildSaveAssetOperation,
  buildSaveHousingCompanyOperation,
  canSubmitAdminOperation,
  countActiveAssets,
  deriveDataGapAssets,
  interpretRevisionConflict,
  parseSourceIds,
  selectFinancialYearViewModel,
  validateAssetInput,
  validateCompanyInput,
} from "./adminOperationPayloads.js";

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
