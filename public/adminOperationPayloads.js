// @ts-check
/**
 * Pure, framework-free admin form logic shared by the browser UI (`app.js`)
 * and the Vitest suite (`adminOperationPayloads.test.js`). This module is the
 * single source of truth for admin operation payload shape and input
 * validation, so the same rules cannot drift between the app and its tests.
 *
 * The validation mirrors the server rules in
 * `src/admin/adminDataValidation.ts`. The server remains authoritative; this
 * only prevents obviously invalid requests and gives fast field-level errors.
 */

/** @typedef {"hvac"|"envelope"|"structures"|"yard"|"safety"|"other"} AssetCategory */

/**
 * @typedef {Object} HousingCompanyValue
 * @property {string} id
 * @property {string} name
 * @property {number} apartmentCount
 * @property {number} [chargeableAreaM2]
 * @property {{ bufferMonths?: number, userOverride?: number }} [operatingBuffer]
 */

/**
 * @typedef {Object} AssetValue
 * @property {string} id
 * @property {string} name
 * @property {AssetCategory} category
 * @property {string[]} sourceIds
 * @property {boolean} active
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, errors: Record<string, string> }} ValidationResult
 */

/**
 * @template T
 * @typedef {{ ok: true, operation: T } | { ok: false, errors: Record<string, string> }} OperationResult
 */

export const ASSET_CATEGORIES = [
  "hvac",
  "envelope",
  "structures",
  "yard",
  "safety",
  "other",
];

const CATEGORY_SET = new Set(ASSET_CATEGORIES);

/**
 * @param {unknown} raw
 * @returns {string}
 */
function toTrimmed(raw) {
  if (typeof raw === "string") return raw.trim();
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

/**
 * @param {unknown} raw
 * @returns {boolean}
 */
function isBlank(raw) {
  return raw === null || raw === undefined ||
    (typeof raw === "string" && raw.trim() === "");
}

/**
 * @param {unknown} raw
 * @returns {number}
 */
function parseNumber(raw) {
  if (typeof raw === "number") return raw;
  const trimmed = toTrimmed(raw);
  if (trimmed === "") return Number.NaN;
  return Number(trimmed);
}

/**
 * Optional numeric field: absent when blank, otherwise parsed with validity.
 * @param {unknown} raw
 * @returns {{ present: false } | { present: true, value: number, valid: boolean }}
 */
function optionalNumber(raw) {
  if (isBlank(raw)) return { present: false };
  const value = parseNumber(raw);
  return { present: true, value, valid: Number.isFinite(value) };
}

/**
 * Accepts an array or a comma/newline separated string of source identifiers.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseSourceIds(raw) {
  /** @type {unknown[]} */
  let list;
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string") list = raw.split(/[\n,]/);
  else if (raw === null || raw === undefined) list = [];
  else list = [raw];
  return list.map((item) => String(item).trim()).filter((item) => item !== "");
}

/**
 * Mirrors validateHousingCompany in adminDataValidation.ts.
 * @param {Record<string, unknown>} raw
 * @returns {ValidationResult<HousingCompanyValue>}
 */
export function validateCompanyInput(raw) {
  /** @type {Record<string, string>} */
  const errors = {};

  const id = toTrimmed(raw.id);
  if (id === "") errors.id = "Taloyhtiön tunniste puuttuu.";

  const name = toTrimmed(raw.name);
  if (name === "") errors.name = "Nimi on pakollinen.";

  const apartmentCount = parseNumber(raw.apartmentCount);
  if (!Number.isInteger(apartmentCount) || apartmentCount <= 0) {
    errors.apartmentCount =
      "Huoneistomäärän on oltava kokonaisluku, joka on suurempi kuin 0.";
  }

  const area = optionalNumber(raw.chargeableAreaM2);
  if (area.present && (!area.valid || area.value <= 0)) {
    errors.chargeableAreaM2 =
      "Laskutettavan pinta-alan on oltava suurempi kuin 0.";
  }

  const bufferMonths = optionalNumber(raw.bufferMonths);
  if (bufferMonths.present && (!bufferMonths.valid || bufferMonths.value <= 0)) {
    errors.bufferMonths = "Puskurikuukausien on oltava suurempi kuin 0.";
  }

  const userOverride = optionalNumber(raw.userOverride);
  if (userOverride.present && (!userOverride.valid || userOverride.value < 0)) {
    errors.userOverride =
      "Puskurin euromääräinen override ei voi olla negatiivinen.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  /** @type {HousingCompanyValue} */
  const value = { id, name, apartmentCount };
  if (area.present) value.chargeableAreaM2 = area.value;
  /** @type {{ bufferMonths?: number, userOverride?: number }} */
  const operatingBuffer = {};
  if (bufferMonths.present) operatingBuffer.bufferMonths = bufferMonths.value;
  if (userOverride.present) operatingBuffer.userOverride = userOverride.value;
  if (Object.keys(operatingBuffer).length > 0) {
    value.operatingBuffer = operatingBuffer;
  }
  return { ok: true, value };
}

/**
 * Mirrors validateAsset in adminDataValidation.ts. Reads the asset entity's own
 * sourceIds from `raw.sourceIds` (distinct from the operation-level sourceIds).
 * @param {Record<string, unknown>} raw
 * @returns {ValidationResult<AssetValue>}
 */
export function validateAssetInput(raw) {
  /** @type {Record<string, string>} */
  const errors = {};

  const id = toTrimmed(raw.id);
  if (id === "") errors.id = "Rakennusosan tunniste puuttuu.";

  const name = toTrimmed(raw.name);
  if (name === "") errors.name = "Nimi on pakollinen.";

  const category = toTrimmed(raw.category);
  if (!CATEGORY_SET.has(category)) {
    errors.category = "Valitse sallittu kategoria.";
  }

  const active = raw.active;
  if (typeof active !== "boolean") {
    errors.active = "Aktiivisuus on määriteltävä.";
  }

  const sourceIds = parseSourceIds(raw.sourceIds);
  if (sourceIds.length === 0) {
    errors.sourceIds = "Rakennusosalla on oltava vähintään yksi lähdetunniste.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      id,
      name,
      category: /** @type {AssetCategory} */ (category),
      sourceIds,
      active: /** @type {boolean} */ (active),
    },
  };
}

/**
 * Operation-level metadata required by every admin operation: at least one
 * source id and a user-written explanation. Not a generic hardcoded default.
 * @param {Record<string, unknown>} raw
 * @returns {ValidationResult<{ sourceIds: string[], explanation: string }>}
 */
export function validateOperationMeta(raw) {
  /** @type {Record<string, string>} */
  const errors = {};

  const sourceIds = parseSourceIds(raw.sourceIds);
  if (sourceIds.length === 0) {
    errors.sourceIds = "Lisää vähintään yksi muutoksen lähdetunniste.";
  }

  const explanation = toTrimmed(raw.explanation);
  if (explanation === "") {
    errors.explanation = "Muutoksen selitys on pakollinen.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { sourceIds, explanation } };
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {OperationResult<{ type: "save_housing_company", value: HousingCompanyValue, sourceIds: string[], explanation: string }>}
 */
export function buildSaveHousingCompanyOperation(raw) {
  const company = validateCompanyInput(raw);
  const meta = validateOperationMeta(raw);
  if (!company.ok || !meta.ok) {
    return {
      ok: false,
      errors: {
        ...(company.ok ? {} : company.errors),
        ...(meta.ok ? {} : meta.errors),
      },
    };
  }
  return {
    ok: true,
    operation: {
      type: "save_housing_company",
      value: company.value,
      sourceIds: meta.value.sourceIds,
      explanation: meta.value.explanation,
    },
  };
}

/**
 * Builds a save_asset operation. The asset's own sourceIds come from
 * `raw.sourceIds`; the operation sourceIds come from `raw.operationSourceIds`.
 * Operation-level source errors are reported under `operationSourceIds` so they
 * never collide with the entity's own `sourceIds` field.
 * @param {Record<string, unknown>} raw
 * @returns {OperationResult<{ type: "save_asset", value: AssetValue, sourceIds: string[], explanation: string }>}
 */
export function buildSaveAssetOperation(raw) {
  const asset = validateAssetInput(raw);
  const meta = validateOperationMeta({
    sourceIds: raw.operationSourceIds,
    explanation: raw.explanation,
  });
  if (!asset.ok || !meta.ok) {
    /** @type {Record<string, string>} */
    const errors = { ...(asset.ok ? {} : asset.errors) };
    if (!meta.ok) {
      for (const [key, message] of Object.entries(meta.errors)) {
        errors[key === "sourceIds" ? "operationSourceIds" : key] = message;
      }
    }
    return { ok: false, errors };
  }
  return {
    ok: true,
    operation: {
      type: "save_asset",
      value: asset.value,
      sourceIds: meta.value.sourceIds,
      explanation: meta.value.explanation,
    },
  };
}

/**
 * DATA GAP assets (decision 3.1): unique assetIds among cost-evidence rows with
 * status "data_gap" that carry an assetId. Never a silent zero.
 * @param {ReadonlyArray<{ status?: string, assetId?: string }>} [costEvidence]
 * @returns {{ assetIds: string[], count: number }}
 */
export function deriveDataGapAssets(costEvidence) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const row of costEvidence ?? []) {
    if (row && row.status === "data_gap" && toTrimmed(row.assetId) !== "") {
      ids.add(String(row.assetId));
    }
  }
  return { assetIds: [...ids], count: ids.size };
}

/**
 * @param {boolean} active
 * @typedef {Object} AssetRow
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {boolean} active
 * @property {string[]} sourceIds
 */

/**
 * View model for the assets list. Empty content is a first-class state with its
 * own message (decision 7), distinct from a not-yet-modelled or error state.
 * @param {ReadonlyArray<{ id?: unknown, name?: unknown, category?: unknown, active?: unknown, sourceIds?: unknown }>} [assets]
 * @returns {{ isEmpty: boolean, rows: AssetRow[], emptyMessage: string }}
 */
export function buildAssetListViewModel(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const rows = list.map((asset) => ({
    id: String(asset.id ?? ""),
    name: String(asset.name ?? ""),
    category: String(asset.category ?? ""),
    active: asset.active === true,
    sourceIds: parseSourceIds(asset.sourceIds),
  }));
  return {
    isEmpty: rows.length === 0,
    rows,
    emptyMessage: "Ei vielä rakennusosia. Lisää ensimmäinen rakennusosa.",
  };
}

/**
 * Selected financial-year view model for the topbar year selector (decision
 * 3.2). Options come only from real financialYears data. When empty, the
 * selector has nothing to show and figures are null.
 * @param {ReadonlyArray<{ year: number, budgetIncome?: number, actualIncome?: number, budgetCosts?: number, actualCosts?: number }>} [financialYears]
 * @param {number} [selectedYear]
 * @returns {{
 *   hasData: boolean,
 *   availableYears: number[],
 *   selectedYear: number | null,
 *   figures: { budgetIncome?: number, actualIncome?: number, budgetCosts?: number, actualCosts?: number } | null,
 * }}
 */
export function selectFinancialYearViewModel(financialYears, selectedYear) {
  const rows = Array.isArray(financialYears) ? financialYears : [];
  if (rows.length === 0) {
    return {
      hasData: false,
      availableYears: [],
      selectedYear: null,
      figures: null,
    };
  }
  const availableYears = rows
    .map((row) => row.year)
    .sort((a, b) => b - a);
  const chosen = rows.find((row) => row.year === selectedYear) ??
    rows.find((row) => row.year === availableYears[0]);
  const row = chosen ?? rows[0];
  return {
    hasData: true,
    availableYears,
    selectedYear: row.year,
    figures: {
      ...(row.budgetIncome === undefined ? {} : { budgetIncome: row.budgetIncome }),
      ...(row.actualIncome === undefined ? {} : { actualIncome: row.actualIncome }),
      ...(row.budgetCosts === undefined ? {} : { budgetCosts: row.budgetCosts }),
      ...(row.actualCosts === undefined ? {} : { actualCosts: row.actualCosts }),
    },
  };
}

/**
 * Interpretation of a failed admin save (decision 6). A 409 revision conflict
 * must surface a clear reload path, never a silent overwrite.
 * @param {{ code?: string, message?: string } | null | undefined} error
 * @returns {{ isConflict: boolean, message: string }}
 */
export function interpretRevisionConflict(error) {
  if (error && error.code === "ADMIN_REVISION_CONFLICT") {
    return {
      isConflict: true,
      message:
        "Tiedot muuttuivat palvelimella. Lataa työtila uudelleen ja tee muutos uudestaan.",
    };
  }
  return {
    isConflict: false,
    message: (error && error.message) ? error.message : "Tuntematon virhe.",
  };
}

/**
 * Whether an admin operation may be sent at all (decision 7): an unauthenticated
 * admin must not trigger a request; the operation is gated before fetch.
 * @param {{ access_token?: unknown } | null | undefined} authState
 * @returns {boolean}
 */
export function canSubmitAdminOperation(authState) {
  return Boolean(
    authState &&
      typeof authState.access_token === "string" &&
      authState.access_token.trim() !== "",
  );
}

/**
 * @param {ReadonlyArray<{ active?: unknown }>} [assets]
 * @returns {number}
 */
export function countActiveAssets(assets) {
  return (Array.isArray(assets) ? assets : []).filter(
    (asset) => asset.active === true,
  ).length;
}
