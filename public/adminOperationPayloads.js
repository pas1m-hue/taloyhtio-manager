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
 * @property {number} [maintenancePlanCoverageThroughYear]
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

/** Mirrors COST_EVIDENCE_STATUSES in domain/types.ts. */
export const COST_EVIDENCE_STATUSES = [
  "actual",
  "quote",
  "estimate",
  "estimate_from_actual",
  "data_gap",
];

const COST_EVIDENCE_STATUS_SET = new Set(COST_EVIDENCE_STATUSES);

/** Mirrors PROJECTION_PRICE_LEVEL_YEAR in domain/types.ts. */
export const PROJECTION_PRICE_LEVEL_YEAR = 2026;

/**
 * @typedef {Object} ObservationValue
 * @property {string} id
 * @property {string} assetId
 * @property {string} observedAt
 * @property {string} description
 * @property {string[]} sourceIds
 */

/** @typedef {"actual"|"quote"|"estimate"|"estimate_from_actual"|"data_gap"} CostEvidenceStatus */

/**
 * @typedef {Object} CostEvidenceValue
 * @property {string} id
 * @property {string} [assetId]
 * @property {string} [eventId]
 * @property {CostEvidenceStatus} status
 * @property {number} [amount]
 * @property {string} unit
 * @property {number} [quantity]
 * @property {number} priceLevelYear
 * @property {boolean} [vatIncluded]
 * @property {string} [observedAt]
 * @property {string} [validUntil]
 * @property {string} [sourceUrl]
 * @property {string} [sourceId]
 * @property {string} [notes]
 */

/**
 * @typedef {Object} PriceLevelConfirmationValue
 * @property {string} costEvidenceId
 * @property {number} targetYear
 * @property {string} confirmedAt
 * @property {string} confirmedBy
 */

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
 * Optional boolean field, read from a checkbox value or a tri-state select
 * ("", "true", "false"). Absent when blank, distinct from an explicit false.
 * @param {unknown} raw
 * @returns {{ present: false } | { present: true, value: boolean }}
 */
function optionalBoolean(raw) {
  if (isBlank(raw)) return { present: false };
  if (typeof raw === "boolean") return { present: true, value: raw };
  const trimmed = toTrimmed(raw);
  if (trimmed === "true") return { present: true, value: true };
  if (trimmed === "false") return { present: true, value: false };
  return { present: false };
}

/**
 * Mirrors validDate in adminDataValidation.ts.
 * @param {unknown} raw
 * @returns {boolean}
 */
function isValidDate(raw) {
  const trimmed = toTrimmed(raw);
  return trimmed !== "" && Number.isFinite(Date.parse(trimmed));
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

  // No range check on the year: a plan whose coverage already lapsed and one
  // reaching past the horizon are both legitimate answers, and the cash path
  // handles each. Only "not a year" is rejected.
  const coverageYear = optionalNumber(raw.maintenancePlanCoverageThroughYear);
  if (coverageYear.present &&
      (!coverageYear.valid || !Number.isInteger(coverageYear.value))) {
    errors.maintenancePlanCoverageThroughYear =
      "Kunnossapitosuunnitelman katteen on oltava vuosiluku.";
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
  if (coverageYear.present) {
    value.maintenancePlanCoverageThroughYear = coverageYear.value;
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
 * Mirrors validateObservation in adminDataValidation.ts. `assetId` must refer
 * to an asset the caller already knows about (UI selects it from a dropdown,
 * never free text), so the list of known assets is passed in explicitly.
 * @param {Record<string, unknown>} raw
 * @param {ReadonlyArray<{ id?: unknown }>} [assets]
 * @returns {ValidationResult<ObservationValue>}
 */
export function validateObservationInput(raw, assets) {
  /** @type {Record<string, string>} */
  const errors = {};
  const assetIds = new Set(
    (Array.isArray(assets) ? assets : []).map((asset) => String(asset.id ?? "")),
  );

  const id = toTrimmed(raw.id);
  if (id === "") errors.id = "Havainnon tunniste puuttuu.";

  const assetId = toTrimmed(raw.assetId);
  if (assetId === "") errors.assetId = "Valitse rakennusosa.";
  else if (!assetIds.has(assetId)) errors.assetId = "Valittua rakennusosaa ei löydy.";

  const observedAt = toTrimmed(raw.observedAt);
  if (!isValidDate(observedAt)) errors.observedAt = "Anna kelvollinen havaintopäivä.";

  const description = toTrimmed(raw.description);
  if (description === "") errors.description = "Kuvaus on pakollinen.";

  const sourceIds = parseSourceIds(raw.sourceIds);
  if (sourceIds.length === 0) {
    errors.sourceIds = "Havainnolla on oltava vähintään yksi lähdetunniste.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, value: { id, assetId, observedAt, description, sourceIds } };
}

/**
 * Builds a save_observation operation. The observation's own sourceIds come
 * from `raw.sourceIds`; the operation sourceIds come from
 * `raw.operationSourceIds` (same entity-vs-operation split as assets).
 * @param {Record<string, unknown>} raw
 * @param {ReadonlyArray<{ id?: unknown }>} [assets]
 * @returns {OperationResult<{ type: "save_observation", value: ObservationValue, sourceIds: string[], explanation: string }>}
 */
export function buildSaveObservationOperation(raw, assets) {
  const observation = validateObservationInput(raw, assets);
  const meta = validateOperationMeta({
    sourceIds: raw.operationSourceIds,
    explanation: raw.explanation,
  });
  if (!observation.ok || !meta.ok) {
    /** @type {Record<string, string>} */
    const errors = { ...(observation.ok ? {} : observation.errors) };
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
      type: "save_observation",
      value: observation.value,
      sourceIds: meta.value.sourceIds,
      explanation: meta.value.explanation,
    },
  };
}

/**
 * Mirrors validateCostEvidence in adminDataValidation.ts, including the
 * DATA GAP rule (L-004): status="data_gap" may never carry an amount, so an
 * unknown cost stays a named gap instead of a silent zero.
 * @param {Record<string, unknown>} raw
 * @param {ReadonlyArray<{ id?: unknown }>} [assets]
 * @param {ReadonlyArray<{ id?: unknown }>} [events]
 * @returns {ValidationResult<CostEvidenceValue>}
 */
export function validateCostEvidenceInput(raw, assets, events) {
  /** @type {Record<string, string>} */
  const errors = {};
  const assetIds = new Set(
    (Array.isArray(assets) ? assets : []).map((asset) => String(asset.id ?? "")),
  );
  const eventIds = new Set(
    (Array.isArray(events) ? events : []).map((event) => String(event.id ?? "")),
  );

  const id = toTrimmed(raw.id);
  if (id === "") errors.id = "Kustannusnäytön tunniste puuttuu.";

  const status = toTrimmed(raw.status);
  if (!COST_EVIDENCE_STATUS_SET.has(status)) errors.status = "Valitse sallittu tila.";

  const unit = toTrimmed(raw.unit);
  if (unit === "") errors.unit = "Yksikkö on pakollinen.";

  const priceLevelYear = parseNumber(raw.priceLevelYear);
  if (!Number.isInteger(priceLevelYear)) {
    errors.priceLevelYear = "Hintatasovuoden on oltava kokonaisluku.";
  }

  const assetId = toTrimmed(raw.assetId);
  const hasAssetId = assetId !== "";
  if (hasAssetId && !assetIds.has(assetId)) {
    errors.assetId = "Valittua rakennusosaa ei löydy.";
  }

  const eventId = toTrimmed(raw.eventId);
  const hasEventId = eventId !== "";
  if (hasEventId && !eventIds.has(eventId)) {
    errors.eventId = "Viitattua tapahtumaa ei löydy.";
  }

  const amount = optionalNumber(raw.amount);
  if (amount.present && (!amount.valid || amount.value < 0)) {
    errors.amount = "Summan on oltava vähintään 0.";
  }

  const quantity = optionalNumber(raw.quantity);
  if (quantity.present &&
      (!quantity.valid || !Number.isInteger(quantity.value) || quantity.value <= 0)) {
    errors.quantity = "Määrän on oltava positiivinen kokonaisluku.";
  }

  const sourceId = toTrimmed(raw.sourceId);
  const sourceUrl = toTrimmed(raw.sourceUrl);
  if (sourceId === "" && sourceUrl === "") {
    const message = "Anna lähdetunniste tai lähde-URL.";
    errors.sourceId = message;
    errors.sourceUrl = message;
  }

  const observedAt = toTrimmed(raw.observedAt);
  if (observedAt !== "" && !isValidDate(observedAt)) {
    errors.observedAt = "Anna kelvollinen havaintopäivä.";
  }

  const validUntil = toTrimmed(raw.validUntil);
  if (validUntil !== "" && !isValidDate(validUntil)) {
    errors.validUntil = "Anna kelvollinen voimassaolopäivä.";
  }

  // DATA GAP -kriittinen sääntö (L-004): tuntematon kustannus on nimetty
  // DATA GAP, ei nolla eikä tyhjä summa muun statuksen alla.
  if (status === "data_gap" && amount.present) {
    errors.amount = "DATA GAP -tilalla ei saa olla summaa.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  /** @type {CostEvidenceValue} */
  const value = {
    id,
    status: /** @type {CostEvidenceStatus} */ (status),
    unit,
    priceLevelYear,
  };
  if (hasAssetId) value.assetId = assetId;
  if (hasEventId) value.eventId = eventId;
  if (amount.present) value.amount = amount.value;
  if (quantity.present) value.quantity = quantity.value;
  const vatIncluded = optionalBoolean(raw.vatIncluded);
  if (vatIncluded.present) value.vatIncluded = vatIncluded.value;
  if (observedAt !== "") value.observedAt = observedAt;
  if (validUntil !== "") value.validUntil = validUntil;
  if (sourceId !== "") value.sourceId = sourceId;
  if (sourceUrl !== "") value.sourceUrl = sourceUrl;
  const notes = toTrimmed(raw.notes);
  if (notes !== "") value.notes = notes;

  return { ok: true, value };
}

/**
 * Builds a save_cost_evidence operation. Entity vs. operation sourceIds are
 * distinct: the evidence's own source is `sourceId`/`sourceUrl`, while the
 * change-metadata sourceIds come from `raw.operationSourceIds`.
 * @param {Record<string, unknown>} raw
 * @param {ReadonlyArray<{ id?: unknown }>} [assets]
 * @param {ReadonlyArray<{ id?: unknown }>} [events]
 * @returns {OperationResult<{ type: "save_cost_evidence", value: CostEvidenceValue, sourceIds: string[], explanation: string }>}
 */
export function buildSaveCostEvidenceOperation(raw, assets, events) {
  const evidence = validateCostEvidenceInput(raw, assets, events);
  const meta = validateOperationMeta({
    sourceIds: raw.operationSourceIds,
    explanation: raw.explanation,
  });
  if (!evidence.ok || !meta.ok) {
    /** @type {Record<string, string>} */
    const errors = { ...(evidence.ok ? {} : evidence.errors) };
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
      type: "save_cost_evidence",
      value: evidence.value,
      sourceIds: meta.value.sourceIds,
      explanation: meta.value.explanation,
    },
  };
}

/**
 * Mirrors validatePriceLevelConfirmation in adminDataValidation.ts.
 * `targetYear` is always the current projection price-level year; it is not
 * a user-editable field.
 * @param {Record<string, unknown>} raw
 * @param {ReadonlyArray<{ id?: unknown }>} [costEvidence]
 * @returns {ValidationResult<PriceLevelConfirmationValue>}
 */
export function validatePriceLevelConfirmationInput(raw, costEvidence) {
  /** @type {Record<string, string>} */
  const errors = {};
  const evidenceIds = new Set(
    (Array.isArray(costEvidence) ? costEvidence : []).map((item) => String(item.id ?? "")),
  );

  const costEvidenceId = toTrimmed(raw.costEvidenceId);
  if (costEvidenceId === "") errors.costEvidenceId = "Kustannusnäytön tunniste puuttuu.";
  else if (!evidenceIds.has(costEvidenceId)) {
    errors.costEvidenceId = "Viitattua kustannusnäyttöä ei löydy.";
  }

  const confirmedAt = toTrimmed(raw.confirmedAt);
  if (!isValidDate(confirmedAt)) errors.confirmedAt = "Anna kelvollinen vahvistuspäivä.";

  const confirmedBy = toTrimmed(raw.confirmedBy);
  if (confirmedBy === "") errors.confirmedBy = "Vahvistajan nimi tai tunniste on pakollinen.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      costEvidenceId,
      targetYear: PROJECTION_PRICE_LEVEL_YEAR,
      confirmedAt,
      confirmedBy,
    },
  };
}

/**
 * Builds a save_price_level_confirmation operation.
 * @param {Record<string, unknown>} raw
 * @param {ReadonlyArray<{ id?: unknown }>} [costEvidence]
 * @returns {OperationResult<{ type: "save_price_level_confirmation", value: PriceLevelConfirmationValue, sourceIds: string[], explanation: string }>}
 */
export function buildSavePriceLevelConfirmationOperation(raw, costEvidence) {
  const confirmation = validatePriceLevelConfirmationInput(raw, costEvidence);
  const meta = validateOperationMeta({
    sourceIds: raw.operationSourceIds,
    explanation: raw.explanation,
  });
  if (!confirmation.ok || !meta.ok) {
    /** @type {Record<string, string>} */
    const errors = { ...(confirmation.ok ? {} : confirmation.errors) };
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
      type: "save_price_level_confirmation",
      value: confirmation.value,
      sourceIds: meta.value.sourceIds,
      explanation: meta.value.explanation,
    },
  };
}

/** Mirrors EVENT_TYPES in domain/types.ts. */
export const EVENT_TYPES = [
  "inspection",
  "maintenance",
  "repair",
  "replacement",
  "renewal",
  "cleaning",
  "study",
  "other",
];

const EVENT_TYPE_SET = new Set(EVENT_TYPES);

/** Mirrors EVENT_STATUSES in domain/types.ts. */
export const EVENT_STATUSES = ["suggested", "approved", "actual", "cancelled"];

const EVENT_STATUS_SET = new Set(EVENT_STATUSES);

/** Mirrors EVENT_ORIGINS in domain/types.ts. */
export const EVENT_ORIGINS = ["initial_excel", "manual", "document_update"];

const EVENT_ORIGIN_SET = new Set(EVENT_ORIGINS);

/** Mirrors SCENARIOS in domain/types.ts. */
export const SCENARIOS = ["optimistic", "base", "stress"];

const SCENARIO_SET = new Set(SCENARIOS);

/**
 * @typedef {Object} EventScheduleEntryValue
 * @property {string} id
 * @property {"optimistic"|"base"|"stress"} scenario
 * @property {number} year
 * @property {number} [amount]
 * @property {number} [quantity]
 * @property {string} costEvidenceId
 * @property {string} [explanation]
 */

/**
 * @typedef {Object} ActualEventEntryValue
 * @property {number} year
 * @property {string} [occurredAt]
 * @property {number} [amount]
 * @property {number} [quantity]
 * @property {string} costEvidenceId
 */

/**
 * @typedef {Object} BuildingEventValue
 * @property {string} id
 * @property {string} assetId
 * @property {string} title
 * @property {"inspection"|"maintenance"|"repair"|"replacement"|"renewal"|"cleaning"|"study"|"other"} type
 * @property {"initial_excel"|"manual"|"document_update"} origin
 * @property {string[]} sourceIds
 * @property {string[]} [observationIds]
 * @property {string} [notes]
 * @property {"suggested"|"approved"|"actual"|"cancelled"} status
 * @property {EventScheduleEntryValue[]} [schedule]
 * @property {ActualEventEntryValue} [actual]
 */

/**
 * Parses and uniqueness-checks a list of observation ids. Mirrors the
 * observationIds check in validateBuildingEventRuntime: no blanks, no
 * duplicates.
 * @param {unknown} raw
 * @returns {{ ok: true, value: string[] } | { ok: false }}
 */
function parseObservationIds(raw) {
  const ids = parseSourceIds(raw);
  if (new Set(ids).size !== ids.length) return { ok: false };
  return { ok: true, value: ids };
}

/**
 * Validates one EventScheduleEntry row. Mirrors the schedule-row rules in
 * validateBuildingEventRuntime.
 * @param {Record<string, unknown>} raw
 * @param {Set<string>} seenIds Row ids already used earlier in the same event (mutated).
 * @param {ReadonlyArray<{ id?: unknown }>} costEvidence
 * @param {string} prefix Error-key prefix, e.g. "schedule.0".
 * @returns {{ ok: true, value: EventScheduleEntryValue } | { ok: false, errors: Record<string, string> }}
 */
function validateScheduleRow(raw, seenIds, costEvidence, prefix) {
  /** @type {Record<string, string>} */
  const errors = {};
  const evidenceIds = new Set(
    (Array.isArray(costEvidence) ? costEvidence : []).map((item) => String(item.id ?? "")),
  );

  const id = toTrimmed(raw.id);
  if (id === "") errors[`${prefix}.id`] = "Rivin tunniste puuttuu.";
  else if (seenIds.has(id)) errors[`${prefix}.id`] = "Rivin tunniste on jo käytössä tässä tapahtumassa.";

  const scenario = toTrimmed(raw.scenario);
  if (!SCENARIO_SET.has(scenario)) errors[`${prefix}.scenario`] = "Valitse sallittu skenaario.";

  const year = parseNumber(raw.year);
  if (!Number.isInteger(year)) errors[`${prefix}.year`] = "Vuoden on oltava kokonaisluku.";

  const costEvidenceId = toTrimmed(raw.costEvidenceId);
  if (costEvidenceId === "") errors[`${prefix}.costEvidenceId`] = "Valitse kustannusnäyttö.";
  else if (!evidenceIds.has(costEvidenceId)) {
    errors[`${prefix}.costEvidenceId`] = "Viitattua kustannusnäyttöä ei löydy.";
  }

  const amount = optionalNumber(raw.amount);
  if (amount.present && (!amount.valid || amount.value < 0)) {
    errors[`${prefix}.amount`] = "Summan on oltava vähintään 0.";
  }

  const quantity = optionalNumber(raw.quantity);
  if (quantity.present &&
      (!quantity.valid || !Number.isInteger(quantity.value) || quantity.value <= 0)) {
    errors[`${prefix}.quantity`] = "Määrän on oltava positiivinen kokonaisluku.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  seenIds.add(id);

  /** @type {EventScheduleEntryValue} */
  const value = {
    id,
    scenario: /** @type {"optimistic"|"base"|"stress"} */ (scenario),
    year,
    costEvidenceId,
  };
  if (amount.present) value.amount = amount.value;
  if (quantity.present) value.quantity = quantity.value;
  const explanation = toTrimmed(raw.explanation);
  if (explanation !== "") value.explanation = explanation;
  return { ok: true, value };
}

/**
 * Validates a list of schedule rows, collecting all row errors.
 * @param {ReadonlyArray<Record<string, unknown>>} rows
 * @param {ReadonlyArray<{ id?: unknown }>} costEvidence
 * @returns {{ ok: true, value: EventScheduleEntryValue[] } | { ok: false, errors: Record<string, string> }}
 */
function validateScheduleRows(rows, costEvidence) {
  /** @type {Record<string, string>} */
  const errors = {};
  /** @type {EventScheduleEntryValue[]} */
  const values = [];
  const seenIds = new Set();
  rows.forEach((row, index) => {
    const result = validateScheduleRow(row, seenIds, costEvidence, `schedule.${index}`);
    if (result.ok) values.push(result.value);
    else Object.assign(errors, result.errors);
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: values };
}

/**
 * Validates the actual-event entry. Mirrors the status === "actual" branch
 * in validateBuildingEventRuntime.
 * @param {Record<string, unknown>} raw
 * @param {ReadonlyArray<{ id?: unknown }>} costEvidence
 * @returns {{ ok: true, value: ActualEventEntryValue } | { ok: false, errors: Record<string, string> }}
 */
function validateActualEntry(raw, costEvidence) {
  /** @type {Record<string, string>} */
  const errors = {};
  const evidenceIds = new Set(
    (Array.isArray(costEvidence) ? costEvidence : []).map((item) => String(item.id ?? "")),
  );

  const year = parseNumber(raw.actualYear);
  if (!Number.isInteger(year)) errors.actualYear = "Toteumavuoden on oltava kokonaisluku.";

  const costEvidenceId = toTrimmed(raw.actualCostEvidenceId);
  if (costEvidenceId === "") errors.actualCostEvidenceId = "Valitse kustannusnäyttö.";
  else if (!evidenceIds.has(costEvidenceId)) {
    errors.actualCostEvidenceId = "Viitattua kustannusnäyttöä ei löydy.";
  }

  const occurredAt = toTrimmed(raw.actualOccurredAt);
  if (occurredAt !== "" && !isValidDate(occurredAt)) {
    errors.actualOccurredAt = "Anna kelvollinen toteutumispäivä.";
  }

  const amount = optionalNumber(raw.actualAmount);
  if (amount.present && (!amount.valid || amount.value < 0)) {
    errors.actualAmount = "Summan on oltava vähintään 0.";
  }

  const quantity = optionalNumber(raw.actualQuantity);
  if (quantity.present &&
      (!quantity.valid || !Number.isInteger(quantity.value) || quantity.value <= 0)) {
    errors.actualQuantity = "Määrän on oltava positiivinen kokonaisluku.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  /** @type {ActualEventEntryValue} */
  const value = { year, costEvidenceId };
  if (occurredAt !== "") value.occurredAt = occurredAt;
  if (amount.present) value.amount = amount.value;
  if (quantity.present) value.quantity = quantity.value;
  return { ok: true, value };
}

/**
 * Mirrors validateBuildingEventRuntime in adminDataValidation.ts. `raw.schedule`
 * is expected as an array of row objects (built by the UI's schedule editor,
 * not typed by the user as text). `raw.observationIds` accepts an array or a
 * comma/newline separated string, same as sourceIds.
 * @param {Record<string, unknown>} raw
 * @param {ReadonlyArray<{ id?: unknown }>} [assets]
 * @param {ReadonlyArray<{ id?: unknown }>} [costEvidence]
 * @param {ReadonlyArray<{ id?: unknown, assetId?: unknown }>} [observations]
 * @returns {ValidationResult<BuildingEventValue>}
 */
export function validateBuildingEventInput(raw, assets, costEvidence, observations) {
  /** @type {Record<string, string>} */
  const errors = {};
  const assetIds = new Set(
    (Array.isArray(assets) ? assets : []).map((asset) => String(asset.id ?? "")),
  );
  const observationsById = new Map(
    (Array.isArray(observations) ? observations : [])
      .map((item) => [String(item.id ?? ""), item]),
  );

  const id = toTrimmed(raw.id);
  if (id === "") errors.id = "Tapahtuman tunniste puuttuu.";

  const assetId = toTrimmed(raw.assetId);
  if (assetId === "") errors.assetId = "Valitse rakennusosa.";
  else if (!assetIds.has(assetId)) errors.assetId = "Valittua rakennusosaa ei löydy.";

  const title = toTrimmed(raw.title);
  if (title === "") errors.title = "Otsikko on pakollinen.";

  const type = toTrimmed(raw.type);
  if (!EVENT_TYPE_SET.has(type)) errors.type = "Valitse sallittu tyyppi.";

  const status = toTrimmed(raw.status);
  if (!EVENT_STATUS_SET.has(status)) errors.status = "Valitse sallittu tila.";

  const origin = toTrimmed(raw.origin);
  if (!EVENT_ORIGIN_SET.has(origin)) errors.origin = "Alkuperä puuttuu.";

  const sourceIds = parseSourceIds(raw.sourceIds);
  if (sourceIds.length === 0) {
    errors.sourceIds = "Tapahtumalla on oltava vähintään yksi lähdetunniste.";
  }

  const observationIdsResult = parseObservationIds(raw.observationIds);
  if (!observationIdsResult.ok) {
    errors.observationIds = "Havaintotunnisteet eivät saa toistua.";
  } else if (assetId !== "") {
    for (const observationId of observationIdsResult.value) {
      const observation = observationsById.get(observationId);
      if (observation === undefined || String(observation.assetId ?? "") !== assetId) {
        errors.observationIds = "Kaikkien linkitettyjen havaintojen on kuuluttava samaan rakennusosaan.";
        break;
      }
    }
  }

  let schedule;
  let actual;
  if (status === "actual") {
    const actualResult = validateActualEntry(raw, costEvidence);
    if (!actualResult.ok) Object.assign(errors, actualResult.errors);
    else actual = actualResult.value;
  } else {
    const rows = Array.isArray(raw.schedule) ? raw.schedule : [];
    if (status !== "cancelled" && rows.length === 0) {
      errors.schedule = "Suunnitellulla tapahtumalla on oltava vähintään yksi skenaariorivi.";
    } else {
      const scheduleResult = validateScheduleRows(rows, costEvidence);
      if (!scheduleResult.ok) Object.assign(errors, scheduleResult.errors);
      else schedule = scheduleResult.value;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  /** @type {BuildingEventValue} */
  const value = {
    id,
    assetId,
    title,
    type: /** @type {any} */ (type),
    origin: /** @type {any} */ (origin),
    sourceIds,
    status: /** @type {any} */ (status),
  };
  if (observationIdsResult.ok && observationIdsResult.value.length > 0) {
    value.observationIds = observationIdsResult.value;
  }
  const notes = toTrimmed(raw.notes);
  if (notes !== "") value.notes = notes;
  if (status === "actual") value.actual = actual;
  else if (schedule !== undefined && (status !== "cancelled" || schedule.length > 0)) {
    value.schedule = schedule;
  }

  return { ok: true, value };
}

/**
 * Builds a save_building_event operation. Entity vs. operation sourceIds
 * split matches assets/observations/costEvidence: the event's own sourceIds
 * come from `raw.sourceIds`, the change metadata from `raw.operationSourceIds`.
 * @param {Record<string, unknown>} raw
 * @param {ReadonlyArray<{ id?: unknown }>} [assets]
 * @param {ReadonlyArray<{ id?: unknown }>} [costEvidence]
 * @param {ReadonlyArray<{ id?: unknown, assetId?: unknown }>} [observations]
 * @returns {OperationResult<{ type: "save_building_event", value: BuildingEventValue, sourceIds: string[], explanation: string }>}
 */
export function buildSaveBuildingEventOperation(raw, assets, costEvidence, observations) {
  const event = validateBuildingEventInput(raw, assets, costEvidence, observations);
  const meta = validateOperationMeta({
    sourceIds: raw.operationSourceIds,
    explanation: raw.explanation,
  });
  if (!event.ok || !meta.ok) {
    /** @type {Record<string, string>} */
    const errors = { ...(event.ok ? {} : event.errors) };
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
      type: "save_building_event",
      value: event.value,
      sourceIds: meta.value.sourceIds,
      explanation: meta.value.explanation,
    },
  };
}

/**
 * "Kopioi rivi kaikkiin skenaarioihin" (L-003): duplicates one schedule row
 * into all three scenarios as a starting point. Never infers numbers — it
 * only clones the row the user already entered; scenario-specific
 * differences remain the user's manual follow-up edit.
 * @param {{ year?: unknown, amount?: unknown, quantity?: unknown, costEvidenceId?: unknown, explanation?: unknown }} row
 * @param {ReadonlyArray<{ id?: unknown }>} existingRows Rows already in the event, for id uniqueness.
 * @returns {Array<{ id: string, scenario: "optimistic"|"base"|"stress", year: unknown, amount: unknown, quantity: unknown, costEvidenceId: unknown, explanation: unknown }>}
 */
export function copyScheduleRowToAllScenarios(row, existingRows) {
  const usedIds = new Set(
    (Array.isArray(existingRows) ? existingRows : []).map((item) => String(item.id ?? "")),
  );
  const baseId = toTrimmed(row.id) || "schedule_row";
  return SCENARIOS.map((scenario) => {
    let id = `${baseId}_${scenario}`;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}_${scenario}_${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return {
      id,
      scenario,
      year: row.year,
      amount: row.amount,
      quantity: row.quantity,
      costEvidenceId: row.costEvidenceId,
      explanation: row.explanation,
    };
  });
}

/**
 * View model for the building-events list. `filters` narrows on year,
 * status, type, asset and a "gap only" toggle (event links a data_gap
 * cost-evidence row). Empty content is a first-class state (decision 7).
 * @param {ReadonlyArray<{ id?: unknown, assetId?: unknown, title?: unknown, type?: unknown, status?: unknown, schedule?: ReadonlyArray<{ scenario?: unknown, year?: unknown, costEvidenceId?: unknown }>, actual?: { year?: unknown, costEvidenceId?: unknown } }>} [events]
 * @param {ReadonlyArray<{ id?: unknown, name?: unknown }>} [assets]
 * @param {ReadonlyArray<{ id?: unknown, status?: unknown }>} [costEvidence]
 * @param {{ year?: number|string, status?: string, type?: string, assetId?: string, gapOnly?: boolean }} [filters]
 * @returns {{ isEmpty: boolean, rows: Array<{ id: string, assetId: string, assetName: string, title: string, type: string, status: string, yearRange: string, hasDataGap: boolean, linkedCostEvidenceIds: string[] }>, emptyMessage: string }}
 */
export function buildEventListViewModel(events, assets, costEvidence, filters) {
  const list = Array.isArray(events) ? events : [];
  const assetNames = new Map(
    (Array.isArray(assets) ? assets : []).map((asset) => [String(asset.id ?? ""), String(asset.name ?? "")]),
  );
  const dataGapIds = new Set(
    (Array.isArray(costEvidence) ? costEvidence : [])
      .filter((item) => item.status === "data_gap")
      .map((item) => String(item.id ?? "")),
  );
  const opts = filters ?? {};

  const rows = [];
  for (const event of list) {
    const assetId = String(event.assetId ?? "");
    const status = String(event.status ?? "");
    const type = String(event.type ?? "");
    const schedule = Array.isArray(event.schedule) ? event.schedule : [];
    const years = status === "actual" && event.actual
      ? [Number(event.actual.year)]
      : schedule.map((entry) => Number(entry.year)).filter((year) => Number.isFinite(year));
    const linkedCostEvidenceIds = [
      ...(status === "actual" && event.actual?.costEvidenceId
        ? [String(event.actual.costEvidenceId)]
        : []),
      ...schedule
        .map((entry) => entry.costEvidenceId)
        .filter((value) => value !== undefined && value !== null)
        .map((value) => String(value)),
    ];
    const hasDataGap = linkedCostEvidenceIds.some((evidenceId) => dataGapIds.has(evidenceId));

    if (opts.assetId && assetId !== opts.assetId) continue;
    if (opts.status && status !== opts.status) continue;
    if (opts.type && type !== opts.type) continue;
    if (opts.gapOnly && !hasDataGap) continue;
    if (opts.year !== undefined && opts.year !== "" && !years.includes(Number(opts.year))) continue;

    const yearRange = years.length === 0
      ? "—"
      : years.length === 1 || Math.min(...years) === Math.max(...years)
        ? String(Math.min(...years))
        : `${Math.min(...years)}–${Math.max(...years)}`;

    rows.push({
      id: String(event.id ?? ""),
      assetId,
      assetName: assetNames.get(assetId) ?? assetId,
      title: String(event.title ?? ""),
      type,
      status,
      yearRange,
      hasDataGap,
      linkedCostEvidenceIds: [...new Set(linkedCostEvidenceIds)],
    });
  }

  return {
    isEmpty: rows.length === 0,
    rows,
    emptyMessage: "Ei vielä korjaustapahtumia. Lisää ensimmäinen tapahtuma.",
  };
}

/**
 * Building events available as year filter options (Näkymäspesifikaatio:
 * vuosisuodatin, oletuksena nykyinen vuosi jos sellainen data löytyy).
 * @param {ReadonlyArray<{ status?: unknown, schedule?: ReadonlyArray<{ year?: unknown }>, actual?: { year?: unknown } }>} [events]
 * @returns {number[]}
 */
export function deriveEventYearOptions(events) {
  const years = new Set();
  for (const event of Array.isArray(events) ? events : []) {
    if (event.status === "actual" && event.actual) {
      const year = Number(event.actual.year);
      if (Number.isFinite(year)) years.add(year);
    }
    for (const entry of Array.isArray(event.schedule) ? event.schedule : []) {
      const year = Number(entry.year);
      if (Number.isFinite(year)) years.add(year);
    }
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * Groups schedule rows by scenario for the schedule editor's three columns.
 * @param {ReadonlyArray<{ scenario?: unknown }>} [schedule]
 * @returns {Record<"optimistic"|"base"|"stress", Array<Record<string, unknown>>>}
 */
export function groupScheduleByScenario(schedule) {
  /** @type {Record<string, Array<Record<string, unknown>>>} */
  const groups = { optimistic: [], base: [], stress: [] };
  for (const entry of Array.isArray(schedule) ? schedule : []) {
    const scenario = String(entry.scenario ?? "");
    if (groups[scenario]) groups[scenario].push(entry);
  }
  return /** @type {any} */ (groups);
}

/**
 * View model for the observations list (decision 7: empty content is a
 * first-class state with its own message).
 * @param {ReadonlyArray<{ id?: unknown, assetId?: unknown, observedAt?: unknown, description?: unknown, sourceIds?: unknown }>} [observations]
 * @param {ReadonlyArray<{ id?: unknown, name?: unknown }>} [assets]
 * @returns {{ isEmpty: boolean, rows: Array<{ id: string, assetId: string, assetName: string, observedAt: string, description: string, sourceIds: string[] }>, emptyMessage: string }}
 */
export function buildObservationListViewModel(observations, assets) {
  const list = Array.isArray(observations) ? observations : [];
  const assetNames = new Map(
    (Array.isArray(assets) ? assets : []).map((asset) => [String(asset.id ?? ""), String(asset.name ?? "")]),
  );
  const rows = list.map((observation) => {
    const assetId = String(observation.assetId ?? "");
    return {
      id: String(observation.id ?? ""),
      assetId,
      assetName: assetNames.get(assetId) ?? assetId,
      observedAt: String(observation.observedAt ?? ""),
      description: String(observation.description ?? ""),
      sourceIds: parseSourceIds(observation.sourceIds),
    };
  });
  return {
    isEmpty: rows.length === 0,
    rows,
    emptyMessage: "Ei vielä havaintoja. Lisää ensimmäinen havainto.",
  };
}

/**
 * Count of observations no building event references yet (Näkymäspesifikaatio:
 * "ilman tapahtumaa olevat havainnot").
 * @param {ReadonlyArray<{ id?: unknown }>} [observations]
 * @param {ReadonlyArray<{ observationIds?: ReadonlyArray<unknown> }>} [events]
 * @returns {number}
 */
export function countObservationsWithoutEvent(observations, events) {
  /** @type {Set<string>} */
  const linked = new Set();
  for (const event of Array.isArray(events) ? events : []) {
    for (const id of event.observationIds ?? []) linked.add(String(id));
  }
  return (Array.isArray(observations) ? observations : [])
    .filter((observation) => !linked.has(String(observation.id ?? "")))
    .length;
}

/**
 * View model for the cost-evidence list. DATA GAP rows never carry an amount
 * (decision L-004/L-007): `amount` stays undefined so the UI cannot render 0.
 * @param {ReadonlyArray<{ id?: unknown, assetId?: unknown, eventId?: unknown, status?: unknown, amount?: unknown, unit?: unknown, quantity?: unknown, priceLevelYear?: unknown, vatIncluded?: unknown, observedAt?: unknown, validUntil?: unknown, sourceId?: unknown, sourceUrl?: unknown, notes?: unknown }>} [costEvidence]
 * @param {ReadonlyArray<{ id?: unknown, name?: unknown }>} [assets]
 * @param {ReadonlyArray<{ costEvidenceId?: unknown, targetYear?: unknown }>} [priceLevelConfirmations]
 * @returns {{ isEmpty: boolean, rows: Array<Record<string, unknown>>, emptyMessage: string }}
 */
export function buildCostEvidenceListViewModel(costEvidence, assets, priceLevelConfirmations) {
  const list = Array.isArray(costEvidence) ? costEvidence : [];
  const assetNames = new Map(
    (Array.isArray(assets) ? assets : []).map((asset) => [String(asset.id ?? ""), String(asset.name ?? "")]),
  );
  const confirmedIds = new Set(
    (Array.isArray(priceLevelConfirmations) ? priceLevelConfirmations : [])
      .filter((item) => Number(item.targetYear) === PROJECTION_PRICE_LEVEL_YEAR)
      .map((item) => String(item.costEvidenceId ?? "")),
  );
  const rows = list.map((evidence) => {
    const isDataGap = evidence.status === "data_gap";
    const priceLevelYear = Number(evidence.priceLevelYear);
    const assetId = evidence.assetId !== undefined ? String(evidence.assetId) : undefined;
    return {
      id: String(evidence.id ?? ""),
      assetId,
      assetName: assetId !== undefined ? (assetNames.get(assetId) ?? assetId) : undefined,
      eventId: evidence.eventId !== undefined ? String(evidence.eventId) : undefined,
      status: String(evidence.status ?? ""),
      isDataGap,
      amount: isDataGap ? undefined : evidence.amount,
      unit: String(evidence.unit ?? ""),
      quantity: evidence.quantity,
      priceLevelYear,
      vatIncluded: evidence.vatIncluded ?? undefined,
      observedAt: evidence.observedAt ?? undefined,
      validUntil: evidence.validUntil ?? undefined,
      sourceId: evidence.sourceId ?? undefined,
      sourceUrl: evidence.sourceUrl ?? undefined,
      notes: evidence.notes ?? undefined,
      needsPriceLevelConfirmation: !isDataGap && priceLevelYear !== PROJECTION_PRICE_LEVEL_YEAR,
      hasPriceLevelConfirmation: confirmedIds.has(String(evidence.id ?? "")),
    };
  });
  return {
    isEmpty: rows.length === 0,
    rows,
    emptyMessage: "Ei vielä kustannusnäyttöä. Lisää tarjous, arvio tai merkitse DATA GAP.",
  };
}

/**
 * Whether a cost-evidence row's validity window has passed (L-007 warning
 * state, distinct from an error).
 * @param {{ validUntil?: unknown }} row
 * @param {string} [nowIso]
 * @returns {boolean}
 */
export function isCostEvidenceExpired(row, nowIso) {
  if (!row.validUntil || typeof row.validUntil !== "string") return false;
  const validUntil = Date.parse(row.validUntil);
  if (!Number.isFinite(validUntil)) return false;
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  return validUntil < now;
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

/** Mirrors FINANCIAL_ACCOUNT_KINDS in domain/types.ts. */
export const FINANCIAL_ACCOUNT_KINDS = ["income", "expense"];

const FINANCIAL_ACCOUNT_KIND_SET = new Set(FINANCIAL_ACCOUNT_KINDS);

/** Mirrors FINANCIAL_ACCOUNT_NATURES in domain/types.ts. */
export const FINANCIAL_ACCOUNT_NATURES = ["maintenance", "repair"];

const FINANCIAL_ACCOUNT_NATURE_SET = new Set(FINANCIAL_ACCOUNT_NATURES);

/** Mirrors FINANCIAL_ACCOUNT_CONTROLLABILITIES in domain/types.ts. */
export const FINANCIAL_ACCOUNT_CONTROLLABILITIES = ["fixed", "variable", "mixed"];

const FINANCIAL_ACCOUNT_CONTROLLABILITY_SET = new Set(FINANCIAL_ACCOUNT_CONTROLLABILITIES);

/**
 * @typedef {Object} FinancialAccountValue
 * @property {string} accountCode
 * @property {string} name
 * @property {"income"|"expense"} kind
 * @property {string} group
 * @property {"maintenance"|"repair"} [nature]
 * @property {"fixed"|"variable"|"mixed"} [controllability]
 * @property {boolean} active
 */

/**
 * @typedef {Object} FinancialEntryValue
 * @property {string} accountCode
 * @property {number} year
 * @property {number} [budgetAmount]
 * @property {number} [actualAmount]
 * @property {string[]} sourceIds
 * @property {string} [notes]
 */

/**
 * Mirrors validateFinancialAccount in adminDataValidation.ts. FinancialAccount
 * has no sourceIds field of its own (like HousingCompany), so its operation
 * metadata reads sourceIds/explanation straight from `raw`.
 * @param {Record<string, unknown>} raw
 * @returns {ValidationResult<FinancialAccountValue>}
 */
export function validateFinancialAccountInput(raw) {
  /** @type {Record<string, string>} */
  const errors = {};

  const accountCode = toTrimmed(raw.accountCode);
  if (accountCode === "") errors.accountCode = "Tilinumero puuttuu.";

  const name = toTrimmed(raw.name);
  if (name === "") errors.name = "Nimi on pakollinen.";

  const kind = toTrimmed(raw.kind);
  if (!FINANCIAL_ACCOUNT_KIND_SET.has(kind)) errors.kind = "Valitse tulo tai kulu.";

  const group = toTrimmed(raw.group);
  if (group === "") errors.group = "Ryhmä on pakollinen.";

  const nature = toTrimmed(raw.nature);
  if (nature !== "" && !FINANCIAL_ACCOUNT_NATURE_SET.has(nature)) {
    errors.nature = "Valitse sallittu luonne.";
  }

  const controllability = toTrimmed(raw.controllability);
  if (controllability !== "" && !FINANCIAL_ACCOUNT_CONTROLLABILITY_SET.has(controllability)) {
    errors.controllability = "Valitse sallittu ohjattavuus.";
  }

  const active = raw.active;
  if (typeof active !== "boolean") errors.active = "Aktiivisuus on määriteltävä.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  /** @type {FinancialAccountValue} */
  const value = {
    accountCode,
    name,
    kind: /** @type {"income"|"expense"} */ (kind),
    group,
    active: /** @type {boolean} */ (active),
  };
  if (nature !== "") value.nature = /** @type {"maintenance"|"repair"} */ (nature);
  if (controllability !== "") {
    value.controllability = /** @type {"fixed"|"variable"|"mixed"} */ (controllability);
  }
  return { ok: true, value };
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {OperationResult<{ type: "save_financial_account", value: FinancialAccountValue, sourceIds: string[], explanation: string }>}
 */
export function buildSaveFinancialAccountOperation(raw) {
  const account = validateFinancialAccountInput(raw);
  const meta = validateOperationMeta(raw);
  if (!account.ok || !meta.ok) {
    return {
      ok: false,
      errors: {
        ...(account.ok ? {} : account.errors),
        ...(meta.ok ? {} : meta.errors),
      },
    };
  }
  return {
    ok: true,
    operation: {
      type: "save_financial_account",
      value: account.value,
      sourceIds: meta.value.sourceIds,
      explanation: meta.value.explanation,
    },
  };
}

/**
 * Mirrors validateFinancialEntry in adminDataValidation.ts. `accountCode` must
 * refer to a known account (mirrors observation->asset), and at least one of
 * budgetAmount/actualAmount must be present — a row with neither is rejected,
 * never silently coerced to zero.
 * @param {Record<string, unknown>} raw
 * @param {ReadonlyArray<{ accountCode?: unknown }>} [accounts]
 * @returns {ValidationResult<FinancialEntryValue>}
 */
export function validateFinancialEntryInput(raw, accounts) {
  /** @type {Record<string, string>} */
  const errors = {};
  const accountCodes = new Set(
    (Array.isArray(accounts) ? accounts : []).map((account) => String(account.accountCode ?? "")),
  );

  const accountCode = toTrimmed(raw.accountCode);
  if (accountCode === "") errors.accountCode = "Tilinumero puuttuu.";
  else if (!accountCodes.has(accountCode)) errors.accountCode = "Valittua tiliä ei löydy.";

  const year = parseNumber(raw.year);
  if (!Number.isInteger(year)) errors.year = "Vuoden on oltava kokonaisluku.";

  const budgetAmount = optionalNumber(raw.budgetAmount);
  if (budgetAmount.present && !budgetAmount.valid) {
    errors.budgetAmount = "Budjetin on oltava luku.";
  }

  const actualAmount = optionalNumber(raw.actualAmount);
  if (actualAmount.present && !actualAmount.valid) {
    errors.actualAmount = "Toteuman on oltava luku.";
  }

  if (!budgetAmount.present && !actualAmount.present) {
    const message = "Anna budjetti tai toteuma.";
    errors.budgetAmount = message;
    errors.actualAmount = message;
  }

  const sourceIds = parseSourceIds(raw.sourceIds);
  if (sourceIds.length === 0) {
    errors.sourceIds = "Rivillä on oltava vähintään yksi lähdetunniste.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  /** @type {FinancialEntryValue} */
  const value = { accountCode, year, sourceIds };
  if (budgetAmount.present) value.budgetAmount = budgetAmount.value;
  if (actualAmount.present) value.actualAmount = actualAmount.value;
  const notes = toTrimmed(raw.notes);
  if (notes !== "") value.notes = notes;
  return { ok: true, value };
}

/**
 * Builds a save_financial_entry operation. Entity vs. operation sourceIds
 * split matches asset/observation/costEvidence: the entry's own sourceIds
 * come from `raw.sourceIds`, the change metadata from `raw.operationSourceIds`.
 * @param {Record<string, unknown>} raw
 * @param {ReadonlyArray<{ accountCode?: unknown }>} [accounts]
 * @returns {OperationResult<{ type: "save_financial_entry", value: FinancialEntryValue, sourceIds: string[], explanation: string }>}
 */
export function buildSaveFinancialEntryOperation(raw, accounts) {
  const entry = validateFinancialEntryInput(raw, accounts);
  const meta = validateOperationMeta({
    sourceIds: raw.operationSourceIds,
    explanation: raw.explanation,
  });
  if (!entry.ok || !meta.ok) {
    /** @type {Record<string, string>} */
    const errors = { ...(entry.ok ? {} : entry.errors) };
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
      type: "save_financial_entry",
      value: entry.value,
      sourceIds: meta.value.sourceIds,
      explanation: meta.value.explanation,
    },
  };
}

/** Column headers recognized as the optional header row in a financial paste. */
const FINANCIAL_PASTE_HEADER = ["kind", "ryhmä", "tili", "nimi", "vuosi", "budjetti", "toteuma"];

/** Finnish paste-input kind tokens mapped to the domain kind. */
const FINANCIAL_PASTE_KIND_MAP = { kulu: "expense", tulo: "income" };

/**
 * Parses one decimal cell, accepting both "." and "," as the separator
 * (§6 of the vaihe-3A handoff: source data uses Finnish comma decimals).
 * The sign is preserved as-is, never flipped.
 * @param {string} trimmed
 * @returns {{ present: false } | { present: true, value: number, valid: boolean }}
 */
function parseFinancialAmountCell(trimmed) {
  if (trimmed === "") return { present: false };
  const value = Number(trimmed.replace(",", "."));
  return { present: true, value, valid: Number.isFinite(value) };
}

/**
 * @typedef {Object} ParsedFinancialAccount
 * @property {string} accountCode
 * @property {string} name
 * @property {"income"|"expense"} kind
 * @property {string} group
 * @property {boolean} active
 */

/**
 * @typedef {Object} ParsedFinancialEntry
 * @property {string} accountCode
 * @property {number} year
 * @property {number} [budgetAmount]
 * @property {number} [actualAmount]
 */

/**
 * @typedef {Object} ParsedFinancialError
 * @property {number} row 1-indexed line number in the pasted text.
 * @property {string} message
 */

/**
 * Strict, pure parser for the "Liitä tilikohtainen data" paste format (handoff
 * §6): one row per (account, year), tab-separated columns in the exact order
 * `kind, ryhmä, tili, nimi, vuosi, budjetti, toteuma`. Every rejected row
 * produces a named, row-numbered error — never a silent skip or a guessed
 * value. Blank lines are ignored without consuming a row number. A first row
 * that matches the column headers (case-insensitively) is skipped as a
 * header row.
 * @param {string} rawText
 * @returns {{ accounts: ParsedFinancialAccount[], entries: ParsedFinancialEntry[], errors: ParsedFinancialError[] }}
 */
export function parseFinancialPasteInput(rawText) {
  const text = typeof rawText === "string" ? rawText : "";
  const lines = text.split(/\r\n|\r|\n/);

  let startIndex = 0;
  const firstDataIndex = lines.findIndex((line) => line.trim() !== "");
  if (firstDataIndex !== -1) {
    const firstCols = lines[firstDataIndex].split("\t").map((cell) => cell.trim().toLowerCase());
    const isHeader = firstCols.length === FINANCIAL_PASTE_HEADER.length &&
      firstCols.every((cell, index) => cell === FINANCIAL_PASTE_HEADER[index]);
    if (isHeader) startIndex = firstDataIndex + 1;
  }

  /** @type {Map<string, ParsedFinancialAccount>} */
  const accountsByCode = new Map();
  /** @type {ParsedFinancialEntry[]} */
  const entries = [];
  /** @type {ParsedFinancialError[]} */
  const errors = [];
  const seenEntryKeys = new Set();

  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const row = i + 1;
    const cols = line.split("\t");
    if (cols.length !== 7) {
      errors.push({ row, message: `Rivi ${row}: odotettiin 7 saraketta, löytyi ${cols.length}.` });
      continue;
    }

    const [kindRaw, groupRaw, accountCodeRaw, nameRaw, yearRaw, budgetRaw, actualRaw] =
      cols.map((cell) => cell.trim());

    const kind = FINANCIAL_PASTE_KIND_MAP[kindRaw.toLowerCase()];
    if (!kind) {
      errors.push({
        row,
        message: `Rivi ${row}: tuntematon kind "${kindRaw}" (odotettiin "kulu" tai "tulo").`,
      });
      continue;
    }
    if (groupRaw === "") {
      errors.push({ row, message: `Rivi ${row}: ryhmä puuttuu.` });
      continue;
    }
    if (accountCodeRaw === "") {
      errors.push({ row, message: `Rivi ${row}: tilinumero puuttuu.` });
      continue;
    }
    if (nameRaw === "") {
      errors.push({ row, message: `Rivi ${row}: tilin nimi puuttuu.` });
      continue;
    }

    const year = Number(yearRaw);
    if (!Number.isInteger(year)) {
      errors.push({ row, message: `Rivi ${row}: vuosi "${yearRaw}" ei ole kokonaisluku.` });
      continue;
    }

    const budget = parseFinancialAmountCell(budgetRaw);
    if (budget.present && !budget.valid) {
      errors.push({ row, message: `Rivi ${row}: budjetti "${budgetRaw}" ei ole luku.` });
      continue;
    }
    const actual = parseFinancialAmountCell(actualRaw);
    if (actual.present && !actual.valid) {
      errors.push({ row, message: `Rivi ${row}: toteuma "${actualRaw}" ei ole luku.` });
      continue;
    }
    if (!budget.present && !actual.present) {
      errors.push({ row, message: `Rivi ${row}: sekä budjetti että toteuma puuttuvat.` });
      continue;
    }

    const existingAccount = accountsByCode.get(accountCodeRaw);
    if (existingAccount) {
      if (existingAccount.name !== nameRaw || existingAccount.group !== groupRaw ||
          existingAccount.kind !== kind) {
        errors.push({
          row,
          message: `Rivi ${row}: tili ${accountCodeRaw} on ristiriidassa aiemman rivin ` +
            `kanssa (nimi, ryhmä tai kind ei täsmää).`,
        });
        continue;
      }
    } else {
      accountsByCode.set(accountCodeRaw, {
        accountCode: accountCodeRaw,
        name: nameRaw,
        kind,
        group: groupRaw,
        active: true,
      });
    }

    const entryKey = `${accountCodeRaw}:${year}`;
    if (seenEntryKeys.has(entryKey)) {
      errors.push({
        row,
        message: `Rivi ${row}: tili ${accountCodeRaw} vuodelle ${year} esiintyy jo aiemmalla rivillä.`,
      });
      continue;
    }
    seenEntryKeys.add(entryKey);

    /** @type {ParsedFinancialEntry} */
    const entry = { accountCode: accountCodeRaw, year };
    if (budget.present) entry.budgetAmount = budget.value;
    if (actual.present) entry.actualAmount = actual.value;
    entries.push(entry);
  }

  return { accounts: [...accountsByCode.values()], entries, errors };
}

/**
 * Builds the save_financial_account / save_financial_entry operations for one
 * successfully parsed import, in cross-reference order: every account
 * operation before any entry operation (applyAdminBatch requires the account
 * to already exist in the same-or-earlier batch). One shared sourceIds +
 * explanation applies to the whole import, both as each operation's own
 * metadata and (for entries) as the entity's own sourceIds field.
 * @param {{ accounts: ParsedFinancialAccount[], entries: ParsedFinancialEntry[] }} parsed
 * @param {{ sourceIds: string[], explanation: string }} opMeta
 * @returns {Array<{ type: "save_financial_account", value: FinancialAccountValue, sourceIds: string[], explanation: string } | { type: "save_financial_entry", value: FinancialEntryValue, sourceIds: string[], explanation: string }>}
 */
export function buildFinancialImportOperations(parsed, opMeta) {
  const accountOperations = parsed.accounts.map((account) => ({
    type: /** @type {const} */ ("save_financial_account"),
    value: account,
    sourceIds: opMeta.sourceIds,
    explanation: opMeta.explanation,
  }));
  const entryOperations = parsed.entries.map((entry) => ({
    type: /** @type {const} */ ("save_financial_entry"),
    value: { ...entry, sourceIds: opMeta.sourceIds },
    sourceIds: opMeta.sourceIds,
    explanation: opMeta.explanation,
  }));
  return [...accountOperations, ...entryOperations];
}

/**
 * @typedef {Object} AccountCostsColumn
 * @property {string} key
 * @property {number} year
 * @property {"budget"|"actual"} kind
 * @property {string} label
 */

/**
 * @typedef {Object} AccountCostsRow
 * @property {string} accountCode
 * @property {string} name
 * @property {Record<string, number|undefined>} values Keyed by column key.
 */

/**
 * @typedef {Object} AccountCostsGroup
 * @property {string} group
 * @property {AccountCostsRow[]} rows
 * @property {Record<string, number>} totals Keyed by column key.
 */

/**
 * View model for "Kulut tileittäin" (spec §6.3, handoff §7): expense accounts
 * only, grouped by `group`, with year columns derived from the entry data
 * (never hardcoded). When both a budget and an actual column exist for the
 * same year, the budget column is ordered first (the rule that runs through
 * the whole spec, decision carried over from Budjetti vs. toteuma).
 * @param {ReadonlyArray<{ accountCode?: unknown, name?: unknown, kind?: unknown, group?: unknown }>} [accounts]
 * @param {ReadonlyArray<{ accountCode?: unknown, year?: unknown, budgetAmount?: unknown, actualAmount?: unknown }>} [entries]
 * @returns {{ isEmpty: boolean, columns: AccountCostsColumn[], groups: AccountCostsGroup[], totals: Record<string, number>, emptyMessage: string }}
 */
export function buildAccountCostsViewModel(accounts, entries) {
  const emptyMessage = "Ei vielä tilidataa. Tuo se Liitä-näkymästä.";
  const accountList = (Array.isArray(accounts) ? accounts : [])
    .filter((account) => account.kind === "expense");
  const accountCodes = new Set(accountList.map((account) => String(account.accountCode ?? "")));
  const entryList = (Array.isArray(entries) ? entries : [])
    .filter((entry) => accountCodes.has(String(entry.accountCode ?? "")));

  if (accountList.length === 0 || entryList.length === 0) {
    return { isEmpty: true, columns: [], groups: [], totals: {}, emptyMessage };
  }

  const yearsWithBudget = new Set();
  const yearsWithActual = new Set();
  for (const entry of entryList) {
    const year = Number(entry.year);
    if (entry.budgetAmount !== undefined) yearsWithBudget.add(year);
    if (entry.actualAmount !== undefined) yearsWithActual.add(year);
  }
  const years = [...new Set([...yearsWithBudget, ...yearsWithActual])].sort((a, b) => a - b);

  /** @type {AccountCostsColumn[]} */
  const columns = [];
  for (const year of years) {
    if (yearsWithBudget.has(year)) {
      columns.push({ key: `budget-${year}`, year, kind: "budget", label: `Budjetti ${year}` });
    }
    if (yearsWithActual.has(year)) {
      columns.push({ key: `actual-${year}`, year, kind: "actual", label: `Toteuma ${year}` });
    }
  }

  /** @type {Map<string, Array<{ accountCode?: unknown, year?: unknown, budgetAmount?: unknown, actualAmount?: unknown }>>} */
  const entriesByAccount = new Map();
  for (const entry of entryList) {
    const code = String(entry.accountCode ?? "");
    const list = entriesByAccount.get(code) ?? [];
    list.push(entry);
    entriesByAccount.set(code, list);
  }

  /** @type {Map<string, AccountCostsRow[]>} */
  const groupMap = new Map();
  for (const account of accountList) {
    const code = String(account.accountCode ?? "");
    const accountEntries = entriesByAccount.get(code);
    if (!accountEntries || accountEntries.length === 0) continue;
    const group = String(account.group ?? "");
    /** @type {Record<string, number|undefined>} */
    const values = {};
    for (const column of columns) {
      const entry = accountEntries.find((item) => Number(item.year) === column.year);
      const raw = entry
        ? (column.kind === "budget" ? entry.budgetAmount : entry.actualAmount)
        : undefined;
      values[column.key] = typeof raw === "number" ? raw : undefined;
    }
    const rows = groupMap.get(group) ?? [];
    rows.push({ accountCode: code, name: String(account.name ?? ""), values });
    groupMap.set(group, rows);
  }

  const groups = [...groupMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([group, rows]) => {
      const sortedRows = [...rows].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
      /** @type {Record<string, number>} */
      const groupTotals = {};
      for (const column of columns) {
        groupTotals[column.key] = sortedRows.reduce(
          (sum, row) => sum + (row.values[column.key] ?? 0),
          0,
        );
      }
      return { group, rows: sortedRows, totals: groupTotals };
    });

  /** @type {Record<string, number>} */
  const totals = {};
  for (const column of columns) {
    totals[column.key] = groups.reduce((sum, entry) => sum + (entry.totals[column.key] ?? 0), 0);
  }

  return { isEmpty: groups.length === 0, columns, groups, totals, emptyMessage };
}

/** Shared empty-state message for the vaihe 3B financial views (handoff §3). */
const FINANCE_VIEW_EMPTY_MESSAGE = "Ei vielä talousdataa. Tuo se Liitä tilidataa -näkymästä.";

/**
 * Years for which the data contains both a budget figure (on some account)
 * and an actual figure (on some, possibly different, account) — the only
 * years a budget-vs-actual comparison is meaningful for (handoff §3.3).
 * @param {ReadonlyArray<{year?: unknown, budgetAmount?: unknown, actualAmount?: unknown}>} [entries]
 * @returns {number[]}
 */
export function deriveComparableYears(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const budgetYears = new Set();
  const actualYears = new Set();
  for (const entry of list) {
    const year = Number(entry.year);
    if (!Number.isFinite(year)) continue;
    if (entry.budgetAmount !== undefined) budgetYears.add(year);
    if (entry.actualAmount !== undefined) actualYears.add(year);
  }
  return [...budgetYears].filter((year) => actualYears.has(year)).sort((a, b) => a - b);
}

/**
 * @typedef {Object} FinanceGroupRow
 * @property {string} accountCode
 * @property {string} name
 * @property {Record<number, number|undefined>} actuals Keyed by actual year.
 * @property {number|undefined} budget Latest-budget-year amount, if any.
 * @property {string[]} notes
 */

/**
 * @typedef {Object} FinanceGroup
 * @property {string} group
 * @property {FinanceGroupRow[]} rows Account-level breakdown for the detail panel.
 * @property {Record<number, number|undefined>} actuals Group sums per actual year (undefined = no data at all, never a silent zero).
 * @property {number|undefined} budget Group sum for the latest budget year.
 * @property {number|undefined} changeAmount Latest actual year minus the previous one.
 * @property {number|undefined} changePercent undefined when the previous year's value is 0 or missing (no division by zero).
 * @property {string} notes
 */

/**
 * Shared grouping/aggregation core for "Tulot" and "Kulut ryhmittäin" (spec
 * §6.1/§6.2): groups accounts of the given kind by their `group`, derives
 * actual-year columns and the single latest budget year from the data
 * (never hardcoded — historical budgets are intentionally excluded from both
 * views per the handoff), and computes the group-level change between the
 * two most recent actual years. Extracted because both views need identical
 * actual/budget/change math and differ only in the extra columns they attach
 * (osuus tuloista vs. nature/controllability).
 * @param {ReadonlyArray<{accountCode?: unknown, name?: unknown, kind?: unknown, group?: unknown, nature?: unknown, controllability?: unknown}>} accounts
 * @param {ReadonlyArray<{accountCode?: unknown, year?: unknown, budgetAmount?: unknown, actualAmount?: unknown, notes?: unknown}>} entries
 * @param {"income"|"expense"} kind
 * @returns {{
 *   isEmpty: boolean,
 *   actualYears: number[],
 *   budgetYear: number|null,
 *   changeYears: { previous: number, latest: number }|null,
 *   groups: Array<FinanceGroup & { accountRows: Array<FinanceGroupRow & { nature?: unknown, controllability?: unknown }> }>,
 *   totals: { actuals: Record<number, number|undefined>, budget: number|undefined },
 * }}
 */
function buildGroupedFinanceCore(accounts, entries, kind) {
  const accountList = (Array.isArray(accounts) ? accounts : []).filter((a) => a.kind === kind);
  const accountCodes = new Set(accountList.map((a) => String(a.accountCode ?? "")));
  const entryList = (Array.isArray(entries) ? entries : [])
    .filter((e) => accountCodes.has(String(e.accountCode ?? "")));

  if (accountList.length === 0 || entryList.length === 0) {
    return {
      isEmpty: true,
      actualYears: [],
      budgetYear: null,
      changeYears: null,
      groups: [],
      totals: { actuals: {}, budget: undefined },
    };
  }

  const actualYearsSet = new Set();
  const budgetYearsSet = new Set();
  for (const entry of entryList) {
    const year = Number(entry.year);
    if (entry.actualAmount !== undefined) actualYearsSet.add(year);
    if (entry.budgetAmount !== undefined) budgetYearsSet.add(year);
  }
  const actualYears = [...actualYearsSet].sort((a, b) => a - b);
  const budgetYear = budgetYearsSet.size > 0 ? Math.max(...budgetYearsSet) : null;
  const changeYears = actualYears.length >= 2
    ? { previous: actualYears[actualYears.length - 2], latest: actualYears[actualYears.length - 1] }
    : null;

  /** @type {Map<string, Array<{accountCode?: unknown, year?: unknown, budgetAmount?: unknown, actualAmount?: unknown, notes?: unknown}>>} */
  const entriesByAccount = new Map();
  for (const entry of entryList) {
    const code = String(entry.accountCode ?? "");
    const list = entriesByAccount.get(code) ?? [];
    list.push(entry);
    entriesByAccount.set(code, list);
  }

  /** @type {Map<string, Array<FinanceGroupRow & { nature?: unknown, controllability?: unknown }>>} */
  const groupMap = new Map();
  for (const account of accountList) {
    const code = String(account.accountCode ?? "");
    const accountEntries = entriesByAccount.get(code);
    if (!accountEntries || accountEntries.length === 0) continue;
    const group = String(account.group ?? "");

    /** @type {Record<number, number|undefined>} */
    const actuals = {};
    for (const year of actualYears) {
      const entry = accountEntries.find((e) => Number(e.year) === year);
      actuals[year] = entry && typeof entry.actualAmount === "number" ? entry.actualAmount : undefined;
    }
    let budget;
    if (budgetYear !== null) {
      const entry = accountEntries.find((e) => Number(e.year) === budgetYear);
      budget = entry && typeof entry.budgetAmount === "number" ? entry.budgetAmount : undefined;
    }
    const notes = accountEntries.map((e) => toTrimmed(e.notes)).filter((n) => n !== "");

    const rows = groupMap.get(group) ?? [];
    rows.push({
      accountCode: code,
      name: String(account.name ?? ""),
      actuals,
      budget,
      notes,
      nature: account.nature,
      controllability: account.controllability,
    });
    groupMap.set(group, rows);
  }

  const groups = [...groupMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([group, rows]) => {
      const sortedRows = [...rows].sort((a, b) => a.accountCode.localeCompare(b.accountCode));

      /** @type {Record<number, number|undefined>} */
      const actuals = {};
      for (const year of actualYears) {
        const values = sortedRows.map((r) => r.actuals[year]).filter((v) => v !== undefined);
        actuals[year] = values.length > 0 ? values.reduce((s, v) => s + v, 0) : undefined;
      }
      let budget;
      if (budgetYear !== null) {
        const values = sortedRows.map((r) => r.budget).filter((v) => v !== undefined);
        budget = values.length > 0 ? values.reduce((s, v) => s + v, 0) : undefined;
      }

      let changeAmount;
      let changePercent;
      if (changeYears) {
        const previous = actuals[changeYears.previous];
        const latest = actuals[changeYears.latest];
        if (previous !== undefined && latest !== undefined) {
          changeAmount = latest - previous;
          changePercent = previous !== 0 ? (changeAmount / Math.abs(previous)) * 100 : undefined;
        }
      }

      const notes = [...new Set(sortedRows.flatMap((r) => r.notes))].join("; ");

      return {
        group,
        accountRows: sortedRows,
        actuals,
        budget,
        changeAmount,
        changePercent,
        notes,
      };
    });

  /** @type {Record<number, number|undefined>} */
  const totalActuals = {};
  for (const year of actualYears) {
    const values = groups.map((g) => g.actuals[year]).filter((v) => v !== undefined);
    totalActuals[year] = values.length > 0 ? values.reduce((s, v) => s + v, 0) : undefined;
  }
  let totalBudget;
  if (budgetYear !== null) {
    const values = groups.map((g) => g.budget).filter((v) => v !== undefined);
    totalBudget = values.length > 0 ? values.reduce((s, v) => s + v, 0) : undefined;
  }

  return {
    isEmpty: groups.length === 0,
    actualYears,
    budgetYear,
    changeYears,
    groups,
    totals: { actuals: totalActuals, budget: totalBudget },
  };
}

/**
 * View model for "Tulot" (spec §6.1): income accounts grouped, with
 * actual-year columns derived from data, only the latest budget year (never
 * historical budgets — those belong to Budjetti vs. toteuma), the change
 * between the two most recent actual years, and each group's share of total
 * income for the latest actual year. Account-level breakdown lives on
 * `group.accountRows` for the row-detail panel. `showAccountRowsInline` is
 * true when there is exactly one group — a degenerate case (spec §6.1's
 * columns like "Muutos" and "Osuus tuloista" are meaningful per group, so
 * this stays a derived display flag rather than changing the row shape)
 * where the group-level table would otherwise be a single uninformative
 * row and the account breakdown (already on `accountRows`) is the
 * interesting data; the spec allows the breakdown "omassa alataulukossa"
 * (§6.1). With more than one group the existing group-row + detail-panel
 * behavior is unchanged.
 * @param {ReadonlyArray<{accountCode?: unknown, name?: unknown, kind?: unknown, group?: unknown}>} [accounts]
 * @param {ReadonlyArray<{accountCode?: unknown, year?: unknown, budgetAmount?: unknown, actualAmount?: unknown, notes?: unknown}>} [entries]
 * @returns {{
 *   isEmpty: boolean,
 *   actualYears: number[],
 *   budgetYear: number|null,
 *   changeYears: { previous: number, latest: number }|null,
 *   latestActualYear: number|null,
 *   groups: Array<FinanceGroup & { sharePercent: number|undefined }>,
 *   showAccountRowsInline: boolean,
 *   totals: { actuals: Record<number, number|undefined>, budget: number|undefined },
 *   emptyMessage: string,
 * }}
 */
export function buildIncomeViewModel(accounts, entries) {
  const core = buildGroupedFinanceCore(accounts, entries, "income");
  if (core.isEmpty) {
    return {
      isEmpty: true,
      actualYears: [],
      budgetYear: null,
      changeYears: null,
      latestActualYear: null,
      groups: [],
      showAccountRowsInline: false,
      totals: core.totals,
      emptyMessage: FINANCE_VIEW_EMPTY_MESSAGE,
    };
  }
  const latestActualYear = core.actualYears[core.actualYears.length - 1];
  const totalLatestActual = core.groups
    .map((g) => g.actuals[latestActualYear])
    .filter((v) => v !== undefined)
    .reduce((s, v) => s + v, 0);
  const groups = core.groups.map((g) => {
    const latest = g.actuals[latestActualYear];
    const sharePercent = latest !== undefined && totalLatestActual !== 0
      ? (latest / totalLatestActual) * 100
      : undefined;
    return { ...g, sharePercent };
  });
  return {
    isEmpty: false,
    actualYears: core.actualYears,
    budgetYear: core.budgetYear,
    changeYears: core.changeYears,
    latestActualYear,
    groups,
    showAccountRowsInline: groups.length === 1,
    totals: core.totals,
    emptyMessage: FINANCE_VIEW_EMPTY_MESSAGE,
  };
}

/**
 * View model for "Kulut ryhmittäin" (spec §6.2): expense accounts grouped,
 * with nature/controllability composed to the group level. Decision
 * (documented per handoff §3.2): when a group's accounts disagree, `nature`
 * has no natural combined value so it becomes "—"; `controllability` has one
 * ("mixed"/"sekä" is already a real domain value), so a conflict resolves to
 * that. Historical budgets are excluded — only the latest budget year shows.
 * @param {ReadonlyArray<{accountCode?: unknown, name?: unknown, kind?: unknown, group?: unknown, nature?: unknown, controllability?: unknown}>} [accounts]
 * @param {ReadonlyArray<{accountCode?: unknown, year?: unknown, budgetAmount?: unknown, actualAmount?: unknown, notes?: unknown}>} [entries]
 * @returns {{
 *   isEmpty: boolean,
 *   actualYears: number[],
 *   budgetYear: number|null,
 *   changeYears: { previous: number, latest: number }|null,
 *   groups: Array<FinanceGroup & { nature: string|undefined, controllability: string|undefined }>,
 *   totals: { actuals: Record<number, number|undefined>, budget: number|undefined },
 *   emptyMessage: string,
 * }}
 */
export function buildExpenseGroupViewModel(accounts, entries) {
  const core = buildGroupedFinanceCore(accounts, entries, "expense");
  if (core.isEmpty) {
    return {
      isEmpty: true,
      actualYears: [],
      budgetYear: null,
      changeYears: null,
      groups: [],
      totals: core.totals,
      emptyMessage: FINANCE_VIEW_EMPTY_MESSAGE,
    };
  }
  const groups = core.groups.map((g) => {
    const natures = [...new Set(
      g.accountRows.map((r) => r.nature).filter((v) => typeof v === "string" && v !== ""),
    )];
    const controllabilities = [...new Set(
      g.accountRows.map((r) => r.controllability).filter((v) => typeof v === "string" && v !== ""),
    )];
    const nature = natures.length === 1 ? natures[0] : undefined;
    const controllability = controllabilities.length === 0
      ? undefined
      : controllabilities.length === 1
        ? controllabilities[0]
        : "mixed";
    return { ...g, nature, controllability };
  });
  return {
    isEmpty: false,
    actualYears: core.actualYears,
    budgetYear: core.budgetYear,
    changeYears: core.changeYears,
    groups,
    totals: core.totals,
    emptyMessage: FINANCE_VIEW_EMPTY_MESSAGE,
  };
}

/** Group name that carries repair (korjaus) costs in the source chart of accounts. */
const REPAIR_GROUP_NAME = "KORJAUKSET";

/**
 * True when a grouped-expense group holds repair costs rather than recurring
 * maintenance. The group *name* is the primary signal because it is the only
 * one real data actually carries: parseFinancialPasteInput() has no `nature`
 * column, so imported accounts leave `nature` undefined and only the manual
 * account form can set it. `nature` is therefore accepted as a secondary
 * signal for hand-entered accounts — a group counts as repairs when every
 * account that declares a nature declares "repair".
 * @param {{ group: string, accountRows: ReadonlyArray<{ nature?: unknown }> }} group
 */
function isRepairGroup(group) {
  if (String(group.group ?? "").trim().toUpperCase() === REPAIR_GROUP_NAME) return true;
  const natures = group.accountRows
    .map((row) => row.nature)
    .filter((value) => typeof value === "string" && value !== "");
  return natures.length > 0 && natures.every((value) => value === "repair");
}

/**
 * Derives the trailing-12m operating-cost divisor from account data
 * (handoff feature/trailing-12m §1) instead of the hand-entered
 * LiquidityBaselineRecord placeholder, which aged unnoticed:
 *
 *   latest actual year's costs excluding repairs
 *   + mean of the repair actuals over every year that has one
 *
 * The formula is deliberately asymmetric. Every other group is stable enough
 * that the latest year stands for itself, but repairs do not follow the
 * financial year at all (2025 came in 58,7 % under budget, 2026 is
 * overrunning), so a single year says nothing about their normal level while
 * a multi-year mean starts to. The sample is thin today — two years, one of
 * them known to be exceptional — and that is an accepted limitation: the mean
 * is taken over however many years have repair actuals, one or ten, and
 * improves on its own as older and newer financial years are imported.
 *
 * DEPRECIATION (handoff §4, checked and closed, do not re-derive): poistot are
 * NOT in these figures and no exclusion is needed. The workbook's ten expense
 * groups contain no depreciation row, and the arithmetic settles it — 2025
 * hoitokate is 43 906,75 − 37 911,01 = 5 995,74 while retained earnings moved
 * 5 173,74, and the 822,00 difference is exactly the year's building
 * depreciation (1 593 017,83 → 1 592 195,83 on the balance sheet). It is
 * subtracted below hoitokate, not inside these expense groups. The one
 * consequence worth knowing: were an expense account in a "POISTOT" group ever
 * imported, this would count it — a documented limitation, not a filter to
 * build against data that does not exist.
 *
 * Never silently substitutes zero for a missing repair group (DATA GAP
 * principle): an unfound group returns `status: "unavailable"` so the caller
 * can show "—" and say what is missing. Dropping the normalisation instead
 * would not merely be less accurate, it would be biased in the flattering
 * direction — too small a divisor, too healthy a ratio.
 *
 * Actuals are stored negative (expense sign convention); the returned figures
 * are positive euro amounts, matching LiquidityBaselineRecord's `>= 0` rule,
 * with Math.abs applied only at that final step.
 *
 * @param {Parameters<typeof buildExpenseGroupViewModel>[0]} [accounts]
 * @param {Parameters<typeof buildExpenseGroupViewModel>[1]} [entries]
 * @returns {{
 *   status: "available"|"unavailable",
 *   value: number|null,
 *   latestActualYear: number|null,
 *   latestYearCostsExRepairs: number|null,
 *   repairAverage: number|null,
 *   repairYears: number[],
 *   reason: null|"no_expense_actuals"|"repair_group_missing"|"repair_actual_missing_for_latest_year",
 * }}
 */
export function computeTrailing12mOperatingCosts(accounts, entries) {
  /** @param {"no_expense_actuals"|"repair_group_missing"|"repair_actual_missing_for_latest_year"} reason */
  const unavailable = (reason) => ({
    status: /** @type {const} */ ("unavailable"),
    value: null,
    latestActualYear: null,
    latestYearCostsExRepairs: null,
    repairAverage: null,
    repairYears: [],
    reason,
  });

  const core = buildGroupedFinanceCore(accounts, entries, "expense");
  if (core.isEmpty || core.actualYears.length === 0) {
    return unavailable("no_expense_actuals");
  }

  const repairGroups = core.groups.filter(isRepairGroup);
  if (repairGroups.length === 0) return unavailable("repair_group_missing");

  /** Repair total per year, present only for years some repair group reports. */
  const repairByYear = new Map();
  for (const year of core.actualYears) {
    const values = repairGroups
      .map((group) => group.actuals[year])
      .filter((value) => value !== undefined);
    if (values.length > 0) {
      repairByYear.set(year, values.reduce((sum, value) => sum + value, 0));
    }
  }
  if (repairByYear.size === 0) return unavailable("repair_group_missing");

  const latestActualYear = core.actualYears[core.actualYears.length - 1];
  const latestRepairs = repairByYear.get(latestActualYear);
  if (latestRepairs === undefined) {
    return unavailable("repair_actual_missing_for_latest_year");
  }

  const latestTotalValues = core.groups
    .map((group) => group.actuals[latestActualYear])
    .filter((value) => value !== undefined);
  const latestTotal = latestTotalValues.reduce((sum, value) => sum + value, 0);

  const repairYears = [...repairByYear.keys()].sort((a, b) => a - b);
  const repairSum = repairYears.reduce((sum, year) => sum + repairByYear.get(year), 0);

  const latestYearCostsExRepairs = Math.abs(latestTotal - latestRepairs);
  const repairAverage = Math.abs(repairSum / repairYears.length);

  return {
    status: "available",
    value: latestYearCostsExRepairs + repairAverage,
    latestActualYear,
    latestYearCostsExRepairs,
    repairAverage,
    repairYears,
    reason: null,
  };
}

/**
 * The Finnish note shown beside "Kassa kuukausina hoitokuluja", saying what
 * the divisor actually contains (handoff feature/trailing-12m §6). This is
 * not cosmetic: the formula is deliberately asymmetric — one year for every
 * stable group, a multi-year mean for repairs — and no reader can infer that
 * from the number alone.
 *
 * Money formatting is injected rather than done here so this module stays
 * free of Intl and view concerns; app.js passes its own `money()`.
 *
 * @param {ReturnType<typeof computeTrailing12mOperatingCosts>} computed
 * @param {(value: number) => string} formatMoney
 * @returns {string}
 */
export function buildTrailing12mNote(computed, formatMoney) {
  if (computed.status !== "available") {
    if (computed.reason === "no_expense_actuals") {
      return "Kassa kuukausina hoitokuluja: ei vielä kulutoteumia, joten 12 kk hoitokuluja " +
        "ei voi laskea. Tuo tilikauden kulut Liitä tilidataa -näkymästä.";
    }
    if (computed.reason === "repair_actual_missing_for_latest_year") {
      return `Kassa kuukausina hoitokuluja: viimeisimmältä toteumavuodelta puuttuu ` +
        `${REPAIR_GROUP_NAME}-ryhmän toteuma, joten korjauksia ei voi erottaa muista ` +
        `kuluista. Tunnusluku näytetään vasta kun ryhmän toteuma on tuotu — ` +
        `arvausta ei käytetä.`;
    }
    return `Kassa kuukausina hoitokuluja: kuluryhmää "${REPAIR_GROUP_NAME}" ei löydy ` +
      `tilidatasta, joten korjauksia ei voi erottaa muista kuluista. Tunnusluku ` +
      `näytetään vasta kun ryhmä löytyy — korjauksia ei oleteta nollaksi, koska se ` +
      `antaisi liian pienen jakajan ja liian hyvän näköisen tunnusluvun.`;
  }

  const years = computed.repairYears;
  const yearsLabel = years.length === 1
    ? `vuodelta ${years[0]}`
    : `vuosilta ${years[0]}–${years[years.length - 1]}`;
  return `Kassa kuukausina hoitokuluja: jakaja ${formatMoney(computed.value)} on laskettu ` +
    `tilidatasta = vuoden ${computed.latestActualYear} kulut ilman korjauksia ` +
    `(${formatMoney(computed.latestYearCostsExRepairs)}) + korjausten keskiarvo ` +
    `${yearsLabel} (${formatMoney(computed.repairAverage)}, ${years.length} ` +
    `${years.length === 1 ? "vuosi" : "vuotta"}). Korjaukset normalisoidaan keskiarvolla, ` +
    `koska ne eivät noudata tilikautta; muut kuluryhmät ovat vakaita ja niistä ` +
    `käytetään viimeisimmän vuoden toteumaa sellaisenaan.`;
}

/** Share of a column's width taken by its bars; the rest is the gap between columns. */
const CHART_COLUMN_FILL_RATIO = 0.62;
/** Gap between the bars inside one column, as a share of their shared width. */
const CHART_INNER_GAP_RATIO = 0.08;

/**
 * Shared scaling and geometry for every bar chart in the app: the group
 * detail chart (one bar per column) and the summary chart (two). Extracted
 * rather than duplicated because the part that must never diverge is exactly
 * the part that is easiest to re-derive slightly differently — the
 * missing-versus-zero rule below. Two copies of it is how a "—" quietly turns
 * back into a zero-height bar.
 *
 * DATA GAP: a `null` value means the figure is not known and yields
 * `missing: true` with `heightPercent: null`, never a zero-height bar, which
 * would read as "there were none". A real 0 is a different thing and keeps a
 * genuine zero-height bar. The branch is written on `value === null` and not
 * on falsiness precisely because 0 is falsy.
 *
 * Everything is a percentage of the plot area, because the charts render into
 * an SVG with `preserveAspectRatio="none"` whose width is fluid and whose
 * height is fixed in CSS.
 *
 * With one bar per column the layout reduces to `columnWidth * fill` centred
 * in its column, which is what the group chart has always produced — its
 * geometry tests are the regression guard on that.
 *
 * @param {ReadonlyArray<{ values: ReadonlyArray<number|null> }>} columns
 * @returns {{
 *   isEmpty: boolean,
 *   maxAbsValue: number,
 *   columns: Array<{ bars: Array<{
 *     value: number|null, missing: boolean, heightPercent: number|null,
 *     xPercent: number, widthPercent: number,
 *   }> }>,
 * }}
 */
function buildBarChartGeometry(columns) {
  const list = Array.isArray(columns) ? columns : [];
  if (list.length === 0) return { isEmpty: true, maxAbsValue: 0, columns: [] };

  const allValues = list.flatMap((column) =>
    (Array.isArray(column.values) ? column.values : []).filter((value) => value !== null)
  );
  const maxAbsValue = allValues.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

  const columnWidth = 100 / list.length;
  const groupWidth = columnWidth * CHART_COLUMN_FILL_RATIO;

  const laidOut = list.map((column, columnIndex) => {
    const values = Array.isArray(column.values) ? column.values : [];
    const barCount = Math.max(values.length, 1);
    const innerGap = barCount > 1 ? groupWidth * CHART_INNER_GAP_RATIO : 0;
    const barWidth = (groupWidth - innerGap * (barCount - 1)) / barCount;
    const groupStart = columnIndex * columnWidth + (columnWidth - groupWidth) / 2;

    return {
      bars: values.map((value, barIndex) => ({
        value,
        missing: value === null,
        // maxAbsValue is 0 only when every present value is 0, and then every
        // bar is legitimately zero-height rather than NaN.
        heightPercent: value === null
          ? null
          : maxAbsValue === 0
            ? 0
            : (Math.abs(value) / maxAbsValue) * 100,
        xPercent: groupStart + barIndex * (barWidth + innerGap),
        widthPercent: barWidth,
      })),
    };
  });

  return { isEmpty: false, maxAbsValue, columns: laidOut };
}

/**
 * Geometry and values for the group detail modal's bar chart (handoff
 * feature/group-chart §3). Pure: it consumes a group that
 * buildExpenseGroupViewModel() has already totalled rather than re-summing
 * accounts, and it returns everything the renderer needs so no arithmetic
 * happens in the SVG-building code.
 *
 * One bar per column — the scaling, the DATA GAP rule and the layout all come
 * from buildBarChartGeometry(), which the summary chart shares.
 *
 * DATA GAP, the rule this function exists to protect (handoff §2): a year
 * with no figure gets `missing: true`, `value: null` and `heightPercent:
 * null`, never a zero-height bar. A zero bar tells the reader "there were no
 * costs" when the truth is "the figure is not known", and different groups
 * are missing different years (Henkilöstökulut has a 2023 actual, most groups
 * do not). A genuine 0,00 € is a different thing and does get a zero-height
 * bar. buildGroupedFinanceCore() already draws this distinction —
 * `actuals[year]` is `undefined` for absent and `0` for a real zero — so the
 * job here is to carry it through intact, not to reinvent it.
 *
 * Costs are stored negative. Math.abs applies only to bar length, which is
 * what a bar means; `value` keeps its original sign so the renderer formats a
 * truthful figure.
 *
 * The budget bar shares the row with the actuals as its last column, which is
 * what makes the comparison legible (KORJAUKSET: 9 680 € budgeted against a
 * 3 881,55 € actual). It is marked `isBudget: true` here rather than being
 * inferred from position by the renderer, and it counts toward the scale
 * maximum — a budget larger than every actual must not overflow the plot.
 * A budget year that also has actuals legitimately appears twice, once as
 * each, mirroring the table's separate actual and budget columns.
 *
 * @param {{ actuals?: Record<number, number|undefined>, budget?: number|undefined }} [group]
 * @param {ReadonlyArray<number>} [actualYears]
 * @param {number|null} [budgetYear]
 * @returns {{
 *   isEmpty: boolean,
 *   bars: Array<{
 *     year: number,
 *     value: number|null,
 *     missing: boolean,
 *     isBudget: boolean,
 *     heightPercent: number|null,
 *     xPercent: number,
 *     widthPercent: number,
 *   }>,
 *   maxAbsValue: number,
 *   hasBudget: boolean,
 * }}
 */
export function buildGroupChartModel(group, actualYears, budgetYear) {
  const years = Array.isArray(actualYears) ? actualYears : [];
  const actuals = group && typeof group === "object" && group.actuals ? group.actuals : {};
  const budget = group && typeof group === "object" ? group.budget : undefined;
  const hasBudget = typeof budgetYear === "number" && typeof budget === "number";

  /** @type {Array<{ year: number, value: number|null, isBudget: boolean }>} */
  const columns = years.map((year) => {
    const value = actuals[year];
    return {
      year: Number(year),
      value: typeof value === "number" ? value : null,
      isBudget: false,
    };
  });
  if (hasBudget) {
    columns.push({ year: Number(budgetYear), value: budget, isBudget: true });
  }

  const geometry = buildBarChartGeometry(columns.map((column) => ({ values: [column.value] })));
  if (geometry.isEmpty) {
    return { isEmpty: true, bars: [], maxAbsValue: 0, hasBudget: false };
  }

  const bars = columns.map((column, index) => ({
    year: column.year,
    isBudget: column.isBudget,
    ...geometry.columns[index].bars[0],
  }));

  return { isEmpty: false, bars, maxAbsValue: geometry.maxAbsValue, hasBudget };
}

/**
 * The smallest difference in euros that counts as un-itemised money rather
 * than float noise. A group total pasted as one figure is compared against a
 * sum of dozens of separately parsed floats, so -34271.63 and
 * -34271.629999999997 must read as equal — otherwise every group would carry
 * a phantom sub-cent gap and the marking would become noise the user learns
 * to ignore. Half a cent: below that nothing can be real money.
 */
const GROUP_ACTUAL_EPSILON = 0.005;

/**
 * Group-level actuals of one kind for a (kind, group, year), keyed
 * `group::year`. Only `active` rows count, mirroring how GroupBudget rows are
 * filtered — retiring a row must remove its effect without deleting history.
 * @param {ReadonlyArray<{kind?: unknown, group?: unknown, year?: unknown, actualAmount?: unknown, active?: unknown}>} [groupActuals]
 * @param {"income"|"expense"} kind
 * @returns {Map<string, number>}
 */
function indexGroupActuals(groupActuals, kind) {
  /** @type {Map<string, number>} */
  const index = new Map();
  for (const groupActual of Array.isArray(groupActuals) ? groupActuals : []) {
    if (groupActual.active === false) continue;
    if ((groupActual.kind === "income" ? "income" : "expense") !== kind) continue;
    const year = Number(groupActual.year);
    if (!Number.isFinite(year)) continue;
    if (typeof groupActual.actualAmount !== "number") continue;
    index.set(`${String(groupActual.group ?? "")}::${year}`, groupActual.actualAmount);
  }
  return index;
}

/**
 * One kind's actuals per group per year with group-level figures taking
 * precedence over the account sum (feature/group-level-actuals handoff §4.3).
 * Returns the shape buildSummaryChartModel already consumes, so the chart's
 * partiality logic is unchanged — a group "reports" for a year if it has
 * either a group-level actual or at least one account actual.
 *
 * WHY A SEPARATE LAYER over buildGroupedFinanceCore rather than a flag inside
 * it: the account-level views (Tulot, Kulut ryhmittäin, Kulut tileittäin)
 * describe the tilierittely specifically and must keep showing account sums.
 * Leaving the core untouched makes that structural instead of a promise.
 *
 * Groups with no accounts at all are unioned in. Rental income exists in the
 * source but was never itemised into the chart of accounts; excluding it would
 * leave 720 EUR of known income out of the yearly total, which is the same
 * "unknown presented as known" failure in the other direction — and it would
 * be inconsistent across years, since the group is absent from every year
 * equally.
 *
 * @param {Parameters<typeof buildIncomeViewModel>[0]} [accounts]
 * @param {Parameters<typeof buildIncomeViewModel>[1]} [entries]
 * @param {ReadonlyArray<{kind?: unknown, group?: unknown, year?: unknown, actualAmount?: unknown, active?: unknown}>} [groupActuals]
 * @param {"income"|"expense"} [kind]
 * @returns {{
 *   isEmpty: boolean,
 *   actualYears: number[],
 *   groups: Array<{ group: string, actuals: Record<number, number|undefined> }>,
 *   totals: { actuals: Record<number, number|undefined> },
 * }}
 */
export function buildGroupActualSeries(accounts, entries, groupActuals, kind) {
  const seriesKind = kind === "income" ? "income" : "expense";
  const core = buildGroupedFinanceCore(accounts, entries, seriesKind);
  const index = indexGroupActuals(groupActuals, seriesKind);

  const years = new Set(core.actualYears.map(Number));
  const groupNames = new Set(core.groups.map((group) => group.group));
  for (const key of index.keys()) {
    const separator = key.lastIndexOf("::");
    groupNames.add(key.slice(0, separator));
    years.add(Number(key.slice(separator + 2)));
  }

  const actualYears = [...years].sort((a, b) => a - b);
  if (actualYears.length === 0 || groupNames.size === 0) {
    return { isEmpty: true, actualYears: [], groups: [], totals: { actuals: {} } };
  }

  const coreByGroup = new Map(core.groups.map((group) => [group.group, group]));
  const groups = [...groupNames].sort((a, b) => a.localeCompare(b)).map((group) => {
    /** @type {Record<number, number|undefined>} */
    const actuals = {};
    for (const year of actualYears) {
      const groupLevel = index.get(`${group}::${year}`);
      actuals[year] = groupLevel !== undefined ? groupLevel : coreByGroup.get(group)?.actuals[year];
    }
    return { group, actuals };
  });

  /** @type {Record<number, number|undefined>} */
  const totals = {};
  for (const year of actualYears) {
    const values = groups.map((group) => group.actuals[year]).filter((v) => v !== undefined);
    totals[year] = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) : undefined;
  }

  return { isEmpty: false, actualYears, groups, totals: { actuals: totals } };
}

/**
 * Income and expenses side by side per year for the Yhteenveto view (handoff
 * feature/summary-chart). The height difference between the pair *is* the
 * hoitokate, which is why both series share one zero-based scale and why
 * expenses are drawn upward on the same axis rather than mirrored: nobody
 * reads a difference between bars pointing opposite ways. `value` keeps the
 * stored sign so the label can still show costs as negative.
 *
 * Totals come from buildGroupActualSeries, which layers group-level actuals
 * over the same grouping core the Tulot and Kulut views use, so this view can
 * disagree with them only where a group-level total is known to differ from
 * its account sum — which is the point. The year axis is the union of both
 * series' actual years, because the two are not missing the same years.
 *
 * PARTIAL YEARS, the subtlety this function exists to handle. `totals.actuals`
 * sums whichever groups reported and is `undefined` only when none did. A year
 * that is half-imported therefore yields a real number that looks like a total
 * without being one. Drawn unmarked that is the same failure as a zero bar for
 * a missing year: the unknown presented as known. So a year whose reporting
 * groups are fewer than the series' total is flagged `partial: true` with the
 * counts, for the renderer to mark and label. The test is coverage — how many
 * groups reported — not a guess about whether a financial year is "finished".
 *
 * There is exactly ONE partiality concept here, not two, even though the
 * feed now carries group-level actuals (buildGroupActualSeries). A group-level
 * actual does not mark a bar partial — it *repairs* it. Once the group's true
 * total is known the bar is a total, and the shortfall in its account
 * itemisation is a tili-level fact that belongs in the tili-level views. All
 * that changes here is what counts as a group having reported: a group-level
 * actual counts, exactly as an account actual does. 2023 income is 1/1
 * reporting and unmarked either way; only its height was wrong before.
 *
 * @param {{ isEmpty?: boolean, actualYears?: ReadonlyArray<number>, groups?: ReadonlyArray<{ actuals?: Record<number, number|undefined> }>, totals?: { actuals?: Record<number, number|undefined> } }} [incomeVm]
 * @param {{ isEmpty?: boolean, actualYears?: ReadonlyArray<number>, groups?: ReadonlyArray<{ actuals?: Record<number, number|undefined> }>, totals?: { actuals?: Record<number, number|undefined> } }} [expenseVm]
 * @returns {{
 *   isEmpty: boolean,
 *   maxAbsValue: number,
 *   hasPartial: boolean,
 *   years: number[],
 *   columns: Array<{
 *     year: number,
 *     bars: Array<{
 *       series: "income"|"expense",
 *       value: number|null,
 *       missing: boolean,
 *       partial: boolean,
 *       reportingGroups: number,
 *       totalGroups: number,
 *       heightPercent: number|null,
 *       xPercent: number,
 *       widthPercent: number,
 *     }>,
 *   }>,
 * }}
 */
export function buildSummaryChartModel(incomeVm, expenseVm) {
  const series = [
    { name: /** @type {const} */ ("income"), vm: incomeVm },
    { name: /** @type {const} */ ("expense"), vm: expenseVm },
  ].map(({ name, vm }) => {
    const source = vm && typeof vm === "object" ? vm : {};
    return {
      name,
      years: Array.isArray(source.actualYears) ? source.actualYears : [],
      groups: Array.isArray(source.groups) ? source.groups : [],
      totals: source.totals && source.totals.actuals ? source.totals.actuals : {},
    };
  });

  const years = [...new Set(series.flatMap((entry) => entry.years.map(Number)))]
    .sort((a, b) => a - b);
  if (years.length === 0) {
    return { isEmpty: true, maxAbsValue: 0, hasPartial: false, years: [], columns: [] };
  }

  const cells = years.map((year) =>
    series.map((entry) => {
      const total = entry.totals[year];
      const value = typeof total === "number" ? total : null;
      const reportingGroups = entry.groups.filter(
        (group) => group && group.actuals && group.actuals[year] !== undefined,
      ).length;
      const totalGroups = entry.groups.length;
      return {
        series: entry.name,
        value,
        reportingGroups,
        totalGroups,
        partial: value !== null && totalGroups > 0 && reportingGroups < totalGroups,
      };
    })
  );

  const geometry = buildBarChartGeometry(
    cells.map((columnCells) => ({ values: columnCells.map((cell) => cell.value) })),
  );

  const columns = years.map((year, index) => ({
    year,
    bars: cells[index].map((cell, barIndex) => ({
      series: cell.series,
      partial: cell.partial,
      reportingGroups: cell.reportingGroups,
      totalGroups: cell.totalGroups,
      ...geometry.columns[index].bars[barIndex],
    })),
  }));

  return {
    isEmpty: false,
    maxAbsValue: geometry.maxAbsValue,
    hasPartial: columns.some((column) => column.bars.some((bar) => bar.partial)),
    years,
    columns,
  };
}

/**
 * View model for "Budjetti vs. toteuma" for one selected year (spec §6.4,
 * the only view comparing historical budget to actual). Column order is
 * fixed to Budjetti → Toteuma → Erotus (the "Budjetti näkyy ennen toteumaa"
 * acceptance criterion). Rakeisuus (documented decision): grouped by
 * kind (income/expense sections, since the same sign means opposite things)
 * then by account group, composed; account-level rows live on
 * `group.rows` for the detail panel. `favorable` is undefined when the
 * difference cannot be computed, true/false otherwise, using the opposite
 * sign convention for expense vs. income.
 * @param {ReadonlyArray<{accountCode?: unknown, name?: unknown, kind?: unknown, group?: unknown}>} [accounts]
 * @param {ReadonlyArray<{accountCode?: unknown, year?: unknown, budgetAmount?: unknown, actualAmount?: unknown, notes?: unknown}>} [entries]
 * @param {number|string} [year]
 * @returns {{
 *   isEmpty: boolean,
 *   year: number|null,
 *   sections: Array<{ kind: "income"|"expense", groups: Array<{
 *     group: string,
 *     rows: Array<{ accountCode: string, name: string, budget: number|undefined, actual: number|undefined, diffAmount: number|undefined, diffPercent: number|undefined, notes: string }>,
 *     budget: number|undefined,
 *     actual: number|undefined,
 *     diffAmount: number|undefined,
 *     diffPercent: number|undefined,
 *     favorable: boolean|undefined,
 *     notes: string,
 *   }> }>,
 *   kpis: { totalBudget: number|undefined, totalActual: number|undefined, netDiff: number|undefined, avgAbsDeviation: number|undefined } | null,
 *   emptyMessage: string,
 * }}
 */
export function buildBudgetVsActualViewModel(accounts, entries, year) {
  const accountList = Array.isArray(accounts) ? accounts : [];
  const entryList = Array.isArray(entries) ? entries : [];
  const accountsByCode = new Map(accountList.map((a) => [String(a.accountCode ?? ""), a]));

  if (accountList.length === 0 || entryList.length === 0 || year === undefined || year === null || year === "") {
    return { isEmpty: true, year: null, sections: [], kpis: null, emptyMessage: FINANCE_VIEW_EMPTY_MESSAGE };
  }

  const selectedYear = Number(year);
  const yearEntries = entryList.filter((e) => Number(e.year) === selectedYear);

  /** @type {Map<string, Array<{accountCode: string, name: string, budget: number|undefined, actual: number|undefined, diffAmount: number|undefined, diffPercent: number|undefined, notes: string}>>} */
  const rowsByKindGroup = new Map();
  for (const entry of yearEntries) {
    const code = String(entry.accountCode ?? "");
    const account = accountsByCode.get(code);
    if (!account) continue;
    const kind = account.kind === "income" ? "income" : "expense";
    const group = String(account.group ?? "");
    const budget = typeof entry.budgetAmount === "number" ? entry.budgetAmount : undefined;
    const actual = typeof entry.actualAmount === "number" ? entry.actualAmount : undefined;
    let diffAmount;
    let diffPercent;
    if (budget !== undefined && actual !== undefined) {
      diffAmount = actual - budget;
      diffPercent = budget !== 0 ? (diffAmount / budget) * 100 : undefined;
    }
    const key = `${kind}::${group}`;
    const list = rowsByKindGroup.get(key) ?? [];
    list.push({
      accountCode: code,
      name: String(account.name ?? ""),
      budget,
      actual,
      diffAmount,
      diffPercent,
      notes: toTrimmed(entry.notes),
    });
    rowsByKindGroup.set(key, list);
  }

  if (rowsByKindGroup.size === 0) {
    return { isEmpty: true, year: selectedYear, sections: [], kpis: null, emptyMessage: FINANCE_VIEW_EMPTY_MESSAGE };
  }

  /** @type {Map<"income"|"expense", Array<[string, typeof rowsByKindGroup extends Map<string, infer V> ? V : never]>>} */
  const byKind = new Map();
  for (const [key, rows] of rowsByKindGroup) {
    const separatorIndex = key.indexOf("::");
    const kind = /** @type {"income"|"expense"} */ (key.slice(0, separatorIndex));
    const group = key.slice(separatorIndex + 2);
    const list = byKind.get(kind) ?? [];
    list.push([group, rows]);
    byKind.set(kind, list);
  }

  const sections = ["income", "expense"]
    .filter((kind) => byKind.has(kind))
    .map((kind) => {
      const groups = byKind.get(kind)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([group, rows]) => {
          const sortedRows = [...rows].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
          const budgetValues = sortedRows.map((r) => r.budget).filter((v) => v !== undefined);
          const actualValues = sortedRows.map((r) => r.actual).filter((v) => v !== undefined);
          const budget = budgetValues.length > 0 ? budgetValues.reduce((s, v) => s + v, 0) : undefined;
          const actual = actualValues.length > 0 ? actualValues.reduce((s, v) => s + v, 0) : undefined;
          let diffAmount;
          let diffPercent;
          if (budget !== undefined && actual !== undefined) {
            diffAmount = actual - budget;
            diffPercent = budget !== 0 ? (diffAmount / budget) * 100 : undefined;
          }
          // Favorability uses magnitude, not the raw signed diff: paste-imported
          // expense amounts often keep the source's negative sign (handoff
          // §6/ohje-tilinpaatosdatan-syotto.md), so a literal actual-budget
          // comparison would get the overrun direction backwards whenever costs
          // are stored negative. |actual| > |budget| is an overrun regardless of
          // which sign convention the data happens to use.
          const favorable = diffAmount === undefined
            ? undefined
            : kind === "expense"
              ? Math.abs(actual) <= Math.abs(budget)
              : diffAmount >= 0;
          const notes = [...new Set(sortedRows.map((r) => r.notes).filter((n) => n !== ""))].join("; ");
          return { group, rows: sortedRows, budget, actual, diffAmount, diffPercent, favorable, notes };
        });
      return { kind: /** @type {"income"|"expense"} */ (kind), groups };
    });

  const allRows = [...rowsByKindGroup.values()].flat();
  const totalBudgetValues = allRows.map((r) => r.budget).filter((v) => v !== undefined);
  const totalActualValues = allRows.map((r) => r.actual).filter((v) => v !== undefined);
  const totalBudget = totalBudgetValues.length > 0 ? totalBudgetValues.reduce((s, v) => s + v, 0) : undefined;
  const totalActual = totalActualValues.length > 0 ? totalActualValues.reduce((s, v) => s + v, 0) : undefined;
  const netDiff = totalBudget !== undefined && totalActual !== undefined ? totalActual - totalBudget : undefined;
  const allGroupDiffs = sections.flatMap((s) => s.groups.map((g) => g.diffAmount)).filter((v) => v !== undefined);
  const avgAbsDeviation = allGroupDiffs.length > 0
    ? allGroupDiffs.reduce((s, v) => s + Math.abs(v), 0) / allGroupDiffs.length
    : undefined;

  return {
    isEmpty: false,
    year: selectedYear,
    sections,
    kpis: { totalBudget, totalActual, netDiff, avgAbsDeviation },
    emptyMessage: FINANCE_VIEW_EMPTY_MESSAGE,
  };
}

/**
 * Interpretation of a failed admin save (decision 6). A 409 revision conflict
 * must surface a clear reload path, never a silent overwrite.
 * @param {{ code?: string, message?: string } | null | undefined} error
 * @returns {{ isConflict: boolean, message: string }}
 */
export function interpretRevisionConflict(error) {
  // The delete target was there when the cascade was computed and is gone
  // now — same remedy as a revision conflict: reload and look again.
  if (error && error.code === "DELETE_TARGET_NOT_FOUND") {
    return {
      isConflict: true,
      message:
        "Poistettavaa tietuetta ei enää ole. Lataa työtila uudelleen ja tarkista tilanne.",
    };
  }
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

/* -------- Taloudellinen asema (balance sheet, handoff vaihe-4A) -------- */

/** Mirrors BALANCE_SECTIONS in domain/types.ts. */
export const BALANCE_SECTIONS = [
  "fixed_assets",
  "current_assets",
  "restricted_equity",
  "unrestricted_equity",
  "liabilities",
];
const BALANCE_SECTION_SET = new Set(BALANCE_SECTIONS);

/**
 * Finnish section labels, per handoff vaihe-4A §4 (Excelin "Taloudellinen
 * asema" -välilehden rakenne). Used both for display (buildBalanceSheetViewModel)
 * and as the "Liitä tasedata" paste format's section column (handoff §5,
 * decision: Finnish name over the raw enum key — matches what the source
 * Excel already uses, no translation step for whoever pastes the data).
 * @type {Record<string, string>}
 */
export const BALANCE_SECTION_LABELS_FI = {
  fixed_assets: "Pysyvät vastaavat",
  current_assets: "Vaihtuvat vastaavat",
  restricted_equity: "Sidottu oma pääoma",
  unrestricted_equity: "Vapaa oma pääoma",
  liabilities: "Velat",
};

/** Finnish section name (lowercased) -> enum value, for parsing the paste format. */
const BALANCE_SECTION_BY_FI_LABEL = new Map(
  Object.entries(BALANCE_SECTION_LABELS_FI).map(([section, label]) => [label.toLowerCase(), section]),
);

/**
 * Groups the five BalanceSection values into the balance sheet's top-level
 * presentation groups (handoff §6): VARAT (assets), OMA PÄÄOMA (equity),
 * VELAT (liabilities). The view totals VARAT against OMA PÄÄOMA + VELAT
 * combined ("OMA PÄÄOMA JA VELAT YHTEENSÄ"), the standard balance-sheet
 * equation — not against equity and liabilities as separate top totals.
 */
export const BALANCE_TOP_GROUPS = [
  { key: "assets", label: "VARAT", sections: ["fixed_assets", "current_assets"] },
  { key: "equity", label: "OMA PÄÄOMA", sections: ["restricted_equity", "unrestricted_equity"] },
  { key: "liabilities", label: "VELAT", sections: ["liabilities"] },
];

/**
 * @typedef {Object} BalanceEntryValue
 * @property {string} section One of BALANCE_SECTIONS.
 * @property {string} key
 * @property {string} name
 * @property {number} amount Stored as-is (sign preserved).
 * @property {string} [notes]
 */

/**
 * @typedef {Object} BalanceSheetSnapshotValue
 * @property {string} id
 * @property {string} asOfDate
 * @property {string[]} sourceIds
 * @property {BalanceEntryValue[]} entries
 * @property {string} [notes]
 */

/**
 * Mirrors validateBalanceSheetSnapshot in adminDataValidation.ts. Entries are
 * expected already-structured (section as an enum value) — the Finnish-label
 * mapping only applies to the paste format, parsed separately by
 * parseBalanceSheetPasteInput. Reconciliation is intentionally not checked
 * here either, matching the domain validator (that's a 4B concern).
 * @param {Record<string, unknown>} raw
 * @returns {ValidationResult<BalanceSheetSnapshotValue>}
 */
export function validateBalanceSheetSnapshotInput(raw) {
  /** @type {Record<string, string>} */
  const errors = {};

  const id = toTrimmed(raw.id);
  if (id === "") errors.id = "Snapshotin tunniste (id) puuttuu.";

  const asOfDate = toTrimmed(raw.asOfDate);
  if (!isValidDate(asOfDate)) errors.asOfDate = "Anna kelvollinen tilinpäätöspäivä.";

  const sourceIds = parseSourceIds(raw.sourceIds);
  if (sourceIds.length === 0) {
    errors.sourceIds = "Snapshotilla on oltava vähintään yksi lähdetunniste.";
  }

  const rawEntries = Array.isArray(raw.entries) ? raw.entries : [];
  if (rawEntries.length === 0) {
    errors.entries = "Snapshotilla on oltava vähintään yksi tase-erä.";
  } else if (rawEntries.some((entry) =>
    !BALANCE_SECTION_SET.has(entry.section) ||
    toTrimmed(entry.key) === "" ||
    toTrimmed(entry.name) === "" ||
    !Number.isFinite(Number(entry.amount))
  )) {
    errors.entries = "Yksi tai useampi tase-erä on virheellinen.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  /** @type {BalanceEntryValue[]} */
  const entries = rawEntries.map((entry) => {
    /** @type {BalanceEntryValue} */
    const value = {
      section: entry.section,
      key: toTrimmed(entry.key),
      name: toTrimmed(entry.name),
      amount: Number(entry.amount),
    };
    const notes = toTrimmed(entry.notes);
    if (notes !== "") value.notes = notes;
    return value;
  });

  /** @type {BalanceSheetSnapshotValue} */
  const value = { id, asOfDate, sourceIds, entries };
  const notes = toTrimmed(raw.notes);
  if (notes !== "") value.notes = notes;
  return { ok: true, value };
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {OperationResult<{ type: "save_balance_sheet_snapshot", value: BalanceSheetSnapshotValue, sourceIds: string[], explanation: string }>}
 */
export function buildSaveBalanceSheetSnapshotOperation(raw) {
  const snapshot = validateBalanceSheetSnapshotInput(raw);
  const meta = validateOperationMeta({
    sourceIds: raw.operationSourceIds,
    explanation: raw.explanation,
  });
  if (!snapshot.ok || !meta.ok) {
    /** @type {Record<string, string>} */
    const errors = { ...(snapshot.ok ? {} : snapshot.errors) };
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
      type: "save_balance_sheet_snapshot",
      value: snapshot.value,
      sourceIds: meta.value.sourceIds,
      explanation: meta.value.explanation,
    },
  };
}

/** Column headers recognized as the optional header row in a balance-sheet paste. */
const BALANCE_PASTE_HEADER = ["section", "key", "name", "amount"];

/**
 * Parses one decimal cell for a balance-sheet amount, accepting "." or ","
 * as the separator. Unlike parseFinancialAmountCell this field is required
 * (a balance entry always has an amount), so blank is a distinct failure
 * from non-numeric — both are just "invalid" to the caller, which reports
 * one row-level error either way.
 * @param {string} trimmed
 * @returns {{ valid: boolean, value: number }}
 */
function parseBalanceAmountCell(trimmed) {
  if (trimmed === "") return { valid: false, value: Number.NaN };
  const value = Number(trimmed.replace(",", "."));
  return { valid: Number.isFinite(value), value };
}

/**
 * @typedef {Object} ParsedBalanceEntry
 * @property {string} section One of BALANCE_SECTIONS.
 * @property {string} key
 * @property {string} name
 * @property {number} amount
 */

/**
 * @typedef {Object} ParsedBalanceError
 * @property {number} row 1-indexed line number in the pasted text, or 0 for a snapshot-level (id/asOfDate) error.
 * @property {string} message
 */

/**
 * Strict, pure parser for the "Liitä tasedata" paste format (handoff
 * vaihe-4A §5): one row per balance entry, tab-separated
 * `section⇥key⇥name⇥amount`. `section` is the Finnish section name (e.g.
 * "Vaihtuvat vastaavat"), matched case-insensitively and mapped to the
 * BalanceSection enum — an unrecognized name is a row-level error, never
 * guessed. `id`/`asOfDate` describe the whole snapshot and are supplied once
 * via the second argument (one snapshot per paste, per the handoff's
 * recommendation), not per row. The sign of `amount` is preserved as-is;
 * display-time positivity is the view's responsibility
 * (buildBalanceSheetViewModel). A first row matching the column headers
 * (case-insensitively) is skipped as a header row. Every rejected row
 * produces a named, row-numbered error — never a silent skip or a guessed
 * value. The returned `snapshot` always reflects the successfully parsed
 * entries (mirrors parseFinancialPasteInput); callers gate saving on
 * `errors.length === 0`.
 * @param {string} rawText
 * @param {{ id: unknown, asOfDate: unknown }} meta
 * @returns {{ snapshot: { id: string, asOfDate: string, entries: ParsedBalanceEntry[] }, errors: ParsedBalanceError[] }}
 */
export function parseBalanceSheetPasteInput(rawText, meta) {
  const text = typeof rawText === "string" ? rawText : "";
  const lines = text.split(/\r\n|\r|\n/);
  /** @type {ParsedBalanceError[]} */
  const errors = [];

  const id = toTrimmed(meta && meta.id);
  if (id === "") errors.push({ row: 0, message: "Snapshotin tunniste (id) puuttuu." });
  const asOfDate = toTrimmed(meta && meta.asOfDate);
  if (!isValidDate(asOfDate)) errors.push({ row: 0, message: "Anna kelvollinen tilinpäätöspäivä." });

  let startIndex = 0;
  const firstDataIndex = lines.findIndex((line) => line.trim() !== "");
  if (firstDataIndex !== -1) {
    const firstCols = lines[firstDataIndex].split("\t").map((cell) => cell.trim().toLowerCase());
    const isHeader = firstCols.length === BALANCE_PASTE_HEADER.length &&
      firstCols.every((cell, index) => cell === BALANCE_PASTE_HEADER[index]);
    if (isHeader) startIndex = firstDataIndex + 1;
  }

  /** @type {ParsedBalanceEntry[]} */
  const entries = [];
  const seenKeys = new Set();

  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const row = i + 1;
    const cols = line.split("\t");
    if (cols.length !== 4) {
      errors.push({ row, message: `Rivi ${row}: odotettiin 4 saraketta, löytyi ${cols.length}.` });
      continue;
    }
    const [sectionRaw, keyRaw, nameRaw, amountRaw] = cols.map((cell) => cell.trim());

    const section = BALANCE_SECTION_BY_FI_LABEL.get(sectionRaw.toLowerCase());
    if (!section) {
      errors.push({
        row,
        message: `Rivi ${row}: tuntematon osio "${sectionRaw}" (sallitut: ${Object.values(BALANCE_SECTION_LABELS_FI).join(", ")}).`,
      });
      continue;
    }
    if (keyRaw === "") {
      errors.push({ row, message: `Rivi ${row}: erän tunniste (key) puuttuu.` });
      continue;
    }
    if (nameRaw === "") {
      errors.push({ row, message: `Rivi ${row}: erän nimi puuttuu.` });
      continue;
    }
    const amount = parseBalanceAmountCell(amountRaw);
    if (!amount.valid) {
      errors.push({ row, message: `Rivi ${row}: euromäärä "${amountRaw}" ei ole luku.` });
      continue;
    }
    if (seenKeys.has(keyRaw)) {
      errors.push({ row, message: `Rivi ${row}: erän tunniste "${keyRaw}" esiintyy jo aiemmalla rivillä.` });
      continue;
    }
    seenKeys.add(keyRaw);

    entries.push({ section, key: keyRaw, name: nameRaw, amount: amount.value });
  }

  if (entries.length === 0 && !errors.some((error) => error.row > 0)) {
    errors.push({ row: 0, message: "Liitetystä datasta ei löytynyt yhtään tase-erää." });
  }

  return { snapshot: { id, asOfDate, entries }, errors };
}

/**
 * Builds the save_balance_sheet_snapshot operation for one successfully
 * parsed "Liitä tasedata" import (handoff §5). One shared sourceIds +
 * explanation applies both as the operation's own metadata and as the
 * snapshot entity's own sourceIds field (mirrors buildFinancialImportOperations).
 * @param {{ snapshot: { id: string, asOfDate: string, entries: ParsedBalanceEntry[] } }} parsed
 * @param {{ sourceIds: string[], explanation: string }} opMeta
 * @returns {{ type: "save_balance_sheet_snapshot", value: BalanceSheetSnapshotValue, sourceIds: string[], explanation: string }}
 */
export function buildBalanceSheetImportOperation(parsed, opMeta) {
  return {
    type: "save_balance_sheet_snapshot",
    value: { ...parsed.snapshot, sourceIds: opMeta.sourceIds },
    sourceIds: opMeta.sourceIds,
    explanation: opMeta.explanation,
  };
}

/**
 * @typedef {Object} BalanceSheetSectionViewModel
 * @property {string} section One of BALANCE_SECTIONS.
 * @property {string} label Finnish section label.
 * @property {Array<{ key: string, name: string, amount: number, notes?: string }>} entries Sign preserved as stored — positive on real data, but a genuinely negative entry (e.g. an accrued loss) stays negative.
 * @property {number} sectionTotal Sign preserved (see entries).
 */

/**
 * @typedef {Object} BalanceSheetTopGroupViewModel
 * @property {"assets"|"equity"|"liabilities"} key
 * @property {string} label VARAT / OMA PÄÄOMA / VELAT.
 * @property {BalanceSheetSectionViewModel[]} sections
 * @property {number} groupTotal Sign preserved (see BalanceSheetSectionViewModel.entries).
 */

/**
 * View model for the Taloudellinen asema base view (handoff §6, vaihe 4A —
 * single snapshot only; comparison/reconciliation/ratios are 4B). Groups the
 * snapshot's entries into all five BALANCE_SECTIONS (always rendered, even
 * empty, so the view's structure never depends on which sections happen to
 * have data), nested under the three top-level groups, with section and
 * top-level totals. Amounts keep the sign they were stored with — the
 * spec's display rule (§6.5, "summat esitetään positiivisina") describes
 * the normal case where the source data has no sign quirks, not a
 * Math.abs: a genuinely negative entry (e.g. an accrued loss in Kertyneet
 * voittovarat) must stay negative, or section/group totals and everything
 * built on them (reconciliation, ratios, comparison) come out wrong.
 * @param {{ id?: unknown, asOfDate?: unknown, entries?: ReadonlyArray<{ section?: unknown, key?: unknown, name?: unknown, amount?: unknown, notes?: unknown }> } | null | undefined} snapshot
 * @returns {{
 *   isEmpty: boolean,
 *   id: string,
 *   asOfDate: string,
 *   topGroups: BalanceSheetTopGroupViewModel[],
 *   assetsTotal: number,
 *   equityAndLiabilitiesTotal: number,
 *   emptyMessage: string,
 * }}
 */
export function buildBalanceSheetViewModel(snapshot) {
  const emptyMessage = "Ei vielä tasedataa. Tuo se Liitä tasedata -näkymästä.";
  const entryList = snapshot && Array.isArray(snapshot.entries) ? snapshot.entries : [];
  if (!snapshot || entryList.length === 0) {
    return {
      isEmpty: true,
      id: "",
      asOfDate: "",
      topGroups: [],
      assetsTotal: 0,
      equityAndLiabilitiesTotal: 0,
      emptyMessage,
    };
  }

  /** @type {Map<string, Array<{ key: string, name: string, amount: number, notes?: string }>>} */
  const entriesBySection = new Map();
  for (const entry of entryList) {
    const section = String(entry.section ?? "");
    const list = entriesBySection.get(section) ?? [];
    /** @type {{ key: string, name: string, amount: number, notes?: string }} */
    const row = {
      key: String(entry.key ?? ""),
      name: String(entry.name ?? ""),
      amount: Number(entry.amount ?? 0),
    };
    if (typeof entry.notes === "string" && entry.notes.trim() !== "") row.notes = entry.notes;
    list.push(row);
    entriesBySection.set(section, list);
  }

  const topGroups = BALANCE_TOP_GROUPS.map((topGroup) => {
    const sections = topGroup.sections.map((section) => {
      const entries = entriesBySection.get(section) ?? [];
      const sectionTotal = entries.reduce((sum, entry) => sum + entry.amount, 0);
      return { section, label: BALANCE_SECTION_LABELS_FI[section], entries, sectionTotal };
    });
    const groupTotal = sections.reduce((sum, section) => sum + section.sectionTotal, 0);
    return { key: topGroup.key, label: topGroup.label, sections, groupTotal };
  });

  const assetsTotal = topGroups.find((group) => group.key === "assets")?.groupTotal ?? 0;
  const equityAndLiabilitiesTotal = topGroups
    .filter((group) => group.key !== "assets")
    .reduce((sum, group) => sum + group.groupTotal, 0);

  return {
    isEmpty: false,
    id: String(snapshot.id ?? ""),
    asOfDate: String(snapshot.asOfDate ?? ""),
    topGroups,
    assetsTotal,
    equityAndLiabilitiesTotal,
    emptyMessage,
  };
}

const BALANCE_RECONCILIATION_TOLERANCE = 0.01;

/**
 * Taseen täsmäytys (handoff vaihe-4B §3.2): VARAT − (OMA PÄÄOMA + VELAT).
 * Built on top of buildBalanceSheetViewModel's totals (sign preserved),
 * so it reuses the same grouping rather than re-summing entries itself. A
 * 0.01 € tolerance absorbs the rounding cents that show up in real
 * tilinpäätös data.
 * @param {Parameters<typeof buildBalanceSheetViewModel>[0]} snapshot
 * @returns {{ isEmpty: boolean, assets: number, equityPlusLiabilities: number, difference: number, balances: boolean }}
 */
export function computeBalanceReconciliation(snapshot) {
  const vm = buildBalanceSheetViewModel(snapshot);
  if (vm.isEmpty) {
    return { isEmpty: true, assets: 0, equityPlusLiabilities: 0, difference: 0, balances: true };
  }
  const difference = vm.assetsTotal - vm.equityAndLiabilitiesTotal;
  return {
    isEmpty: false,
    assets: vm.assetsTotal,
    equityPlusLiabilities: vm.equityAndLiabilitiesTotal,
    difference,
    balances: Math.abs(difference) < BALANCE_RECONCILIATION_TOLERANCE,
  };
}

/** Entries matched as "Rahat ja pankkisaamiset" for the kassa-kuukausina ratio. */
function isCashEntry(entry) {
  if (entry.key === "rahat") return true;
  return entry.name.toLowerCase().startsWith("rahat ja pankki");
}

/**
 * Kolme tunnuslukua valitulle snapshotille (handoff vaihe-4B §3.3), kukin
 * number tai null jos ei laskettavissa (nollalla jako / puuttuva lähtötieto):
 *  - liquidity: vaihtuvat vastaavat / velat (koko liabilities-summa —
 *    vahvistettu yksinkertaistus, mallissa on vain yksi velkaosio)
 *  - monthsOfCash: rahat ja pankkisaamiset / (trailing12mOperatingCosts / 12)
 *  - interestBearingDebt: koko liabilities-summa (sama yksinkertaistus)
 *
 * cashSource kertoo löytyikö erillinen "Rahat ja pankkisaamiset" -erä
 * (`"entry"`) vai jouduttiinko käyttämään koko current_assets-summaa
 * (`"section_total"`) — handoffin sallima fallback, dokumentoitu UI:ssa.
 * @param {Parameters<typeof buildBalanceSheetViewModel>[0]} snapshot
 * @param {{ currentCash?: number, trailing12mOperatingCosts?: number, asOfDate?: string, notes?: string } | undefined} latestLiquidityBaseline
 * @returns {{
 *   liquidity: number | null,
 *   monthsOfCash: number | null,
 *   interestBearingDebt: number | null,
 *   cashSource: "entry" | "section_total" | null,
 * }}
 */
export function computeBalanceRatios(snapshot, latestLiquidityBaseline) {
  const vm = buildBalanceSheetViewModel(snapshot);
  if (vm.isEmpty) {
    return { liquidity: null, monthsOfCash: null, interestBearingDebt: null, cashSource: null };
  }

  const currentAssetsSection = vm.topGroups
    .find((group) => group.key === "assets")
    ?.sections.find((section) => section.section === "current_assets");
  const currentAssetsTotal = currentAssetsSection?.sectionTotal ?? 0;
  const liabilitiesTotal = vm.topGroups.find((group) => group.key === "liabilities")?.groupTotal ?? 0;

  const liquidity = liabilitiesTotal === 0 ? null : currentAssetsTotal / liabilitiesTotal;
  const interestBearingDebt = liabilitiesTotal === 0 ? null : liabilitiesTotal;

  const cashEntry = currentAssetsSection?.entries.find(isCashEntry);
  const cashAmount = cashEntry ? cashEntry.amount : currentAssetsTotal;
  const cashSource = cashEntry ? "entry" : "section_total";
  const monthlyOperatingCosts = latestLiquidityBaseline?.trailing12mOperatingCosts
    ? latestLiquidityBaseline.trailing12mOperatingCosts / 12
    : 0;
  const monthsOfCash = monthlyOperatingCosts === 0 ? null : cashAmount / monthlyOperatingCosts;

  return { liquidity, monthsOfCash, interestBearingDebt, cashSource };
}

/**
 * @typedef {Object} BalanceComparisonEntryViewModel
 * @property {string} key
 * @property {string} name
 * @property {number|null} newerAmount Sign preserved, or null if only in olderSnapshot.
 * @property {number|null} olderAmount Sign preserved, or null if only in newerSnapshot.
 * @property {number} change newerAmount − olderAmount (missing side treated as 0).
 */

/**
 * @typedef {Object} BalanceComparisonSectionViewModel
 * @property {string} section One of BALANCE_SECTIONS.
 * @property {string} label Finnish section label.
 * @property {BalanceComparisonEntryViewModel[]} entries
 * @property {number} newerTotal
 * @property {number} olderTotal
 * @property {number} totalChange
 */

/**
 * Vertailu kahden tasesnapshotin välillä (handoff vaihe-4B §3.1). Rivit
 * yhdistetään section+key -parilla; erä joka esiintyy vain toisessa
 * snapshotissa saa null-arvon puuttuvalle puolelle, ja sen muutos on koko
 * arvo (missing side treated as 0). Kun olderSnapshot puuttuu (vain yksi
 * snapshotti olemassa), palautetaan hasComparison: false eikä kaadu — UI:n
 * pitäisi tällöin näyttää 4A:n yhden snapshotin näkymä.
 * @param {Parameters<typeof buildBalanceSheetViewModel>[0]} newerSnapshot
 * @param {Parameters<typeof buildBalanceSheetViewModel>[0] | null | undefined} olderSnapshot
 * @returns {{
 *   hasComparison: boolean,
 *   isEmpty: boolean,
 *   newer: ReturnType<typeof buildBalanceSheetViewModel>,
 *   older: ReturnType<typeof buildBalanceSheetViewModel> | null,
 *   topGroups: Array<{ key: string, label: string, sections: BalanceComparisonSectionViewModel[], newerGroupTotal: number, olderGroupTotal: number, groupChange: number }>,
 *   assetsChange: number,
 *   equityAndLiabilitiesChange: number,
 * }}
 */
export function buildBalanceComparisonViewModel(newerSnapshot, olderSnapshot) {
  const newer = buildBalanceSheetViewModel(newerSnapshot);
  const hasComparison = Boolean(olderSnapshot);
  const older = hasComparison ? buildBalanceSheetViewModel(olderSnapshot) : null;

  if (newer.isEmpty) {
    return {
      hasComparison: false,
      isEmpty: true,
      newer,
      older,
      topGroups: [],
      assetsChange: 0,
      equityAndLiabilitiesChange: 0,
    };
  }

  if (!hasComparison || older.isEmpty) {
    return {
      hasComparison: false,
      isEmpty: false,
      newer,
      older: null,
      topGroups: [],
      assetsChange: 0,
      equityAndLiabilitiesChange: 0,
    };
  }

  const topGroups = newer.topGroups.map((newerGroup) => {
    const olderGroup = older.topGroups.find((group) => group.key === newerGroup.key);
    const sections = newerGroup.sections.map((newerSection) => {
      const olderSection = olderGroup?.sections.find((section) => section.section === newerSection.section);
      const olderEntriesByKey = new Map((olderSection?.entries ?? []).map((entry) => [entry.key, entry]));
      const seenOlderKeys = new Set();

      const entries = newerSection.entries.map((newerEntry) => {
        const olderEntry = olderEntriesByKey.get(newerEntry.key);
        if (olderEntry) seenOlderKeys.add(newerEntry.key);
        const olderAmount = olderEntry ? olderEntry.amount : null;
        return {
          key: newerEntry.key,
          name: newerEntry.name,
          newerAmount: newerEntry.amount,
          olderAmount,
          change: newerEntry.amount - (olderAmount ?? 0),
        };
      });

      const onlyInOlder = (olderSection?.entries ?? [])
        .filter((entry) => !seenOlderKeys.has(entry.key))
        .map((olderEntry) => ({
          key: olderEntry.key,
          name: olderEntry.name,
          newerAmount: null,
          olderAmount: olderEntry.amount,
          change: 0 - olderEntry.amount,
        }));

      const olderTotal = olderSection?.sectionTotal ?? 0;
      return {
        section: newerSection.section,
        label: newerSection.label,
        entries: [...entries, ...onlyInOlder],
        newerTotal: newerSection.sectionTotal,
        olderTotal,
        totalChange: newerSection.sectionTotal - olderTotal,
      };
    });

    const olderGroupTotal = olderGroup?.groupTotal ?? 0;
    return {
      key: newerGroup.key,
      label: newerGroup.label,
      sections,
      newerGroupTotal: newerGroup.groupTotal,
      olderGroupTotal,
      groupChange: newerGroup.groupTotal - olderGroupTotal,
    };
  });

  return {
    hasComparison: true,
    isEmpty: false,
    newer,
    older,
    topGroups,
    assetsChange: newer.assetsTotal - older.assetsTotal,
    equityAndLiabilitiesChange: newer.equityAndLiabilitiesTotal - older.equityAndLiabilitiesTotal,
  };
}

/**
 * Deterministic id for a GroupBudget: re-importing the same kind+group+year
 * updates the existing row instead of creating a duplicate (feature/group-budget
 * handoff §1). One consequence: a typo'd group name gets a *different* id from
 * the correct one, so it can never be "fixed" by re-import — the stale row has
 * to be deleted (delete_entity) and the corrected name imported.
 * @param {"income"|"expense"} kind
 * @param {string} group
 * @param {number} year
 * @returns {string}
 */
export function buildGroupBudgetId(kind, group, year) {
  return `${kind}::${group}::${year}`;
}

/**
 * @typedef {Object} GroupBudgetValue
 * @property {string} id
 * @property {"income"|"expense"} kind
 * @property {string} group
 * @property {number} year
 * @property {number} budgetAmount
 * @property {boolean} active
 * @property {string[]} sourceIds
 * @property {string} [notes]
 */

const GROUP_BUDGET_PASTE_HEADER = ["kind", "ryhmä", "vuosi", "budjetti"];

/**
 * @typedef {Object} ParsedGroupBudget
 * @property {string} id
 * @property {"income"|"expense"} kind
 * @property {string} group
 * @property {number} year
 * @property {number} budgetAmount
 */

/**
 * @typedef {Object} ParsedGroupBudgetIssue
 * @property {number} row
 * @property {string} message
 */

/**
 * Strict, pure parser for the "Liitä ryhmäbudjetti" paste format
 * (feature/group-budget handoff §2): one row per (kind, group, year),
 * tab-separated `kind, ryhmä, vuosi, budjetti`. Actuals are never entered
 * here — they are always derived from FinancialEntry.actualAmount, summed
 * per group by buildGroupBudgetVsActualViewModel, so this format only ever
 * carries the approved budget figure.
 *
 * `accounts` (the currently loaded FinancialAccount list) is used only to
 * *warn*, never to block: a ryhmä name that doesn't match any account's
 * `group` for that kind produces a non-blocking warning, not an error — the
 * row is still accepted, because import order is the user's choice (a group
 * budget may legitimately arrive before its matching tilidata).
 * @param {string} rawText
 * @param {ReadonlyArray<{kind?: unknown, group?: unknown}>} [accounts]
 * @returns {{ groupBudgets: ParsedGroupBudget[], errors: ParsedGroupBudgetIssue[], warnings: ParsedGroupBudgetIssue[] }}
 */
export function parseGroupBudgetPasteInput(rawText, accounts) {
  const text = typeof rawText === "string" ? rawText : "";
  const lines = text.split(/\r\n|\r|\n/);
  const accountList = Array.isArray(accounts) ? accounts : [];

  /** @type {Map<"income"|"expense", Set<string>>} */
  const knownGroupsByKind = new Map();
  for (const account of accountList) {
    const kind = account.kind === "income" ? "income" : "expense";
    const set = knownGroupsByKind.get(kind) ?? new Set();
    set.add(String(account.group ?? ""));
    knownGroupsByKind.set(kind, set);
  }

  let startIndex = 0;
  const firstDataIndex = lines.findIndex((line) => line.trim() !== "");
  if (firstDataIndex !== -1) {
    const firstCols = lines[firstDataIndex].split("\t").map((cell) => cell.trim().toLowerCase());
    const isHeader = firstCols.length === GROUP_BUDGET_PASTE_HEADER.length &&
      firstCols.every((cell, index) => cell === GROUP_BUDGET_PASTE_HEADER[index]);
    if (isHeader) startIndex = firstDataIndex + 1;
  }

  /** @type {ParsedGroupBudget[]} */
  const groupBudgets = [];
  /** @type {ParsedGroupBudgetIssue[]} */
  const errors = [];
  /** @type {ParsedGroupBudgetIssue[]} */
  const warnings = [];
  const seenIds = new Set();

  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const row = i + 1;
    const cols = line.split("\t");
    if (cols.length !== GROUP_BUDGET_PASTE_HEADER.length) {
      errors.push({
        row,
        message: `Rivi ${row}: odotettiin ${GROUP_BUDGET_PASTE_HEADER.length} saraketta, löytyi ${cols.length}.`,
      });
      continue;
    }
    const [kindRaw, groupRaw, yearRaw, budgetRaw] = cols.map((cell) => cell.trim());

    const kind = FINANCIAL_PASTE_KIND_MAP[kindRaw.toLowerCase()];
    if (!kind) {
      errors.push({
        row,
        message: `Rivi ${row}: tuntematon kind "${kindRaw}" (odotettiin "kulu" tai "tulo").`,
      });
      continue;
    }
    if (groupRaw === "") {
      errors.push({ row, message: `Rivi ${row}: ryhmä puuttuu.` });
      continue;
    }
    const year = Number(yearRaw);
    if (!Number.isInteger(year)) {
      errors.push({ row, message: `Rivi ${row}: vuosi "${yearRaw}" ei ole kokonaisluku.` });
      continue;
    }
    const budget = parseFinancialAmountCell(budgetRaw);
    if (!budget.present) {
      errors.push({ row, message: `Rivi ${row}: budjetti puuttuu.` });
      continue;
    }
    if (!budget.valid) {
      errors.push({ row, message: `Rivi ${row}: budjetti "${budgetRaw}" ei ole luku.` });
      continue;
    }

    const id = buildGroupBudgetId(kind, groupRaw, year);
    if (seenIds.has(id)) {
      errors.push({
        row,
        message: `Rivi ${row}: ryhmä "${groupRaw}" (${kindRaw}) vuodelle ${year} esiintyy jo aiemmalla rivillä.`,
      });
      continue;
    }
    seenIds.add(id);

    const knownGroups = knownGroupsByKind.get(kind);
    if (!knownGroups || !knownGroups.has(groupRaw)) {
      warnings.push({
        row,
        message: `Rivi ${row}: ryhmä "${groupRaw}" ei täsmää mihinkään tiliryhmään — toteuma jää tyhjäksi kunnes tilidata täsmää.`,
      });
    }

    groupBudgets.push({ id, kind, group: groupRaw, year, budgetAmount: budget.value });
  }

  return { groupBudgets, errors, warnings };
}

/**
 * Builds save_group_budget operations for one successfully parsed "Liitä
 * ryhmäbudjetti" import. New rows default `active: true`.
 * @param {{ groupBudgets: ParsedGroupBudget[] }} parsed
 * @param {{ sourceIds: string[], explanation: string }} opMeta
 * @returns {Array<{ type: "save_group_budget", value: GroupBudgetValue, sourceIds: string[], explanation: string }>}
 */
export function buildGroupBudgetImportOperations(parsed, opMeta) {
  return parsed.groupBudgets.map((groupBudget) => ({
    type: /** @type {const} */ ("save_group_budget"),
    value: { ...groupBudget, active: true, sourceIds: opMeta.sourceIds },
    sourceIds: opMeta.sourceIds,
    explanation: opMeta.explanation,
  }));
}


/**
 * Deterministic id for a GroupActual, mirroring buildGroupBudgetId so the two
 * collections address the same (kind, group, year) cell by the same key. Same
 * consequence too: a typo'd group name gets a different id and can only be
 * removed with delete_entity, never corrected by re-import.
 * @param {"income"|"expense"} kind
 * @param {string} group
 * @param {number} year
 * @returns {string}
 */
export function buildGroupActualId(kind, group, year) {
  return `${kind}::${group}::${year}`;
}

/**
 * @typedef {Object} GroupActualValue
 * @property {string} id
 * @property {"income"|"expense"} kind
 * @property {string} group
 * @property {number} year
 * @property {number} actualAmount
 * @property {boolean} active
 * @property {string[]} sourceIds
 * @property {string} [notes]
 */

const GROUP_ACTUAL_PASTE_HEADER = ["kind", "ryhmä", "vuosi", "toteuma"];

/**
 * @typedef {Object} ParsedGroupActual
 * @property {string} id
 * @property {"income"|"expense"} kind
 * @property {string} group
 * @property {number} year
 * @property {number} actualAmount
 */

/**
 * Strict, pure parser for the "Liitä ryhmätason toteuma" paste format
 * (feature/group-level-actuals handoff §3): one row per (kind, group, year),
 * tab-separated `kind, ryhmä, vuosi, toteuma`. A separate format from the
 * ryhmäbudjetti paste rather than a fifth column on it, so a budget import can
 * never overwrite an actual and vice versa.
 *
 * TWO NON-BLOCKING WARNINGS, both about things a human should look at and
 * neither about things the parser can decide:
 *
 *  - A ryhmä matching no account group. Unlike the budget parser, this is not
 *    necessarily a mistake here: rental income exists in the source but was
 *    never itemised into the chart of accounts, and a group-level actual is
 *    the only way to represent it at all. The warning says the figure will be
 *    used without any account breakdown, so a typo still stands out.
 *  - A sign that contradicts the stored convention — a positive expense or a
 *    negative income. The source Excel prints costs positive ("Kulut yhteensä
 *    34 271,63") while tilidata stores them negative, and pasting the printed
 *    sign unchanged would make a group look like it was short by twice its own
 *    total. The value is still stored exactly as pasted: normalising it with
 *    Math.abs is the mistake that had to be undone in the balance sheet
 *    (handoff-korjaus-tase-etumerkki), because it destroys a genuinely
 *    negative figure — a credit-note year on an income group is real.
 *
 * @param {string} rawText
 * @param {ReadonlyArray<{kind?: unknown, group?: unknown}>} [accounts]
 * @returns {{ groupActuals: ParsedGroupActual[], errors: ParsedGroupBudgetIssue[], warnings: ParsedGroupBudgetIssue[] }}
 */
export function parseGroupActualPasteInput(rawText, accounts) {
  const text = typeof rawText === "string" ? rawText : "";
  const lines = text.split(/\r\n|\r|\n/);
  const accountList = Array.isArray(accounts) ? accounts : [];

  /** @type {Map<"income"|"expense", Set<string>>} */
  const knownGroupsByKind = new Map();
  for (const account of accountList) {
    const kind = account.kind === "income" ? "income" : "expense";
    const set = knownGroupsByKind.get(kind) ?? new Set();
    set.add(String(account.group ?? ""));
    knownGroupsByKind.set(kind, set);
  }

  let startIndex = 0;
  const firstDataIndex = lines.findIndex((line) => line.trim() !== "");
  if (firstDataIndex !== -1) {
    const firstCols = lines[firstDataIndex].split("\t").map((cell) => cell.trim().toLowerCase());
    const isHeader = firstCols.length === GROUP_ACTUAL_PASTE_HEADER.length &&
      firstCols.every((cell, index) => cell === GROUP_ACTUAL_PASTE_HEADER[index]);
    if (isHeader) startIndex = firstDataIndex + 1;
  }

  /** @type {ParsedGroupActual[]} */
  const groupActuals = [];
  /** @type {ParsedGroupBudgetIssue[]} */
  const errors = [];
  /** @type {ParsedGroupBudgetIssue[]} */
  const warnings = [];
  const seenIds = new Set();

  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const row = i + 1;
    const cols = line.split("\t");
    if (cols.length !== GROUP_ACTUAL_PASTE_HEADER.length) {
      errors.push({
        row,
        message: `Rivi ${row}: odotettiin ${GROUP_ACTUAL_PASTE_HEADER.length} saraketta, löytyi ${cols.length}.`,
      });
      continue;
    }
    const [kindRaw, groupRaw, yearRaw, actualRaw] = cols.map((cell) => cell.trim());

    const kind = FINANCIAL_PASTE_KIND_MAP[kindRaw.toLowerCase()];
    if (!kind) {
      errors.push({
        row,
        message: `Rivi ${row}: tuntematon kind "${kindRaw}" (odotettiin "kulu" tai "tulo").`,
      });
      continue;
    }
    if (groupRaw === "") {
      errors.push({ row, message: `Rivi ${row}: ryhmä puuttuu.` });
      continue;
    }
    const year = Number(yearRaw);
    if (!Number.isInteger(year)) {
      errors.push({ row, message: `Rivi ${row}: vuosi "${yearRaw}" ei ole kokonaisluku.` });
      continue;
    }
    const actual = parseFinancialAmountCell(actualRaw);
    if (!actual.present) {
      errors.push({ row, message: `Rivi ${row}: toteuma puuttuu.` });
      continue;
    }
    if (!actual.valid) {
      errors.push({ row, message: `Rivi ${row}: toteuma "${actualRaw}" ei ole luku.` });
      continue;
    }

    const id = buildGroupActualId(kind, groupRaw, year);
    if (seenIds.has(id)) {
      errors.push({
        row,
        message: `Rivi ${row}: ryhmä "${groupRaw}" (${kindRaw}) vuodelle ${year} esiintyy jo aiemmalla rivillä.`,
      });
      continue;
    }
    seenIds.add(id);

    const knownGroups = knownGroupsByKind.get(kind);
    if (!knownGroups || !knownGroups.has(groupRaw)) {
      warnings.push({
        row,
        message: `Rivi ${row}: ryhmä "${groupRaw}" ei täsmää mihinkään tiliryhmään — luku käytetään sellaisenaan ilman tilierittelyä. Tarkista ettei nimessä ole kirjoitusvirhettä.`,
      });
    }
    if (kind === "expense" && actual.value > 0) {
      warnings.push({
        row,
        message: `Rivi ${row}: kulun toteuma "${actualRaw}" on positiivinen, mutta tilidata tallentaa kulut negatiivisina. ` +
          `Jos tarkoitit kulua, lisää miinusmerkki — muuten ryhmä näyttää erittelemättömältä kaksinkertaisella summallaan.`,
      });
    }
    if (kind === "income" && actual.value < 0) {
      warnings.push({
        row,
        message: `Rivi ${row}: tulon toteuma "${actualRaw}" on negatiivinen. Rivi hyväksytään (hyvityslasku on aito tapaus), mutta tarkista etumerkki.`,
      });
    }

    groupActuals.push({ id, kind, group: groupRaw, year, actualAmount: actual.value });
  }

  return { groupActuals, errors, warnings };
}

/**
 * Builds save_group_actual operations for one successfully parsed "Liitä
 * ryhmätason toteuma" import. New rows default `active: true`.
 * @param {{ groupActuals: ParsedGroupActual[] }} parsed
 * @param {{ sourceIds: string[], explanation: string }} opMeta
 * @returns {Array<{ type: "save_group_actual", value: GroupActualValue, sourceIds: string[], explanation: string }>}
 */
export function buildGroupActualImportOperations(parsed, opMeta) {
  return parsed.groupActuals.map((groupActual) => ({
    type: /** @type {const} */ ("save_group_actual"),
    value: { ...groupActual, active: true, sourceIds: opMeta.sourceIds },
    sourceIds: opMeta.sourceIds,
    explanation: opMeta.explanation,
  }));
}

/**
 * Years for which at least one account group has both an actual (derived
 * from FinancialEntry.actualAmount) and a budget — either an active
 * GroupBudget or, absent that, a tili-summed FinancialEntry.budgetAmount —
 * for the same year (feature/group-budget handoff §3(a), the year-selection
 * half of "vuosi mukaan vain jos molemmat"; §3(b), the row-visibility half,
 * is handled separately by buildGroupBudgetVsActualViewModel including
 * one-sided rows rather than hiding them).
 * @param {ReadonlyArray<{accountCode?: unknown, group?: unknown, kind?: unknown}>} [accounts]
 * @param {ReadonlyArray<{accountCode?: unknown, year?: unknown, budgetAmount?: unknown, actualAmount?: unknown}>} [entries]
 * A group-level actual counts as an actual for its year exactly as an account
 * actual does — otherwise a group with no accounts at all (rental income) could
 * never make its year selectable, and the year would silently drop out of the
 * filter despite having a budget and a known total.
 * @param {ReadonlyArray<{kind?: unknown, group?: unknown, year?: unknown, active?: unknown}>} [groupBudgets]
 * @param {ReadonlyArray<{kind?: unknown, group?: unknown, year?: unknown, actualAmount?: unknown, active?: unknown}>} [groupActuals]
 * @returns {number[]}
 */
export function deriveComparableGroupBudgetYears(accounts, entries, groupBudgets, groupActuals) {
  const accountList = Array.isArray(accounts) ? accounts : [];
  const entryList = Array.isArray(entries) ? entries : [];
  const groupBudgetList = Array.isArray(groupBudgets) ? groupBudgets : [];
  const groupActualList = Array.isArray(groupActuals) ? groupActuals : [];
  const accountsByCode = new Map(accountList.map((a) => [String(a.accountCode ?? ""), a]));

  /** @type {Map<string, Set<number>>} */
  const actualYearsByGroup = new Map();
  /** @type {Map<string, Set<number>>} */
  const accountsBudgetYearsByGroup = new Map();
  for (const entry of entryList) {
    const account = accountsByCode.get(String(entry.accountCode ?? ""));
    if (!account) continue;
    const kind = account.kind === "income" ? "income" : "expense";
    const key = `${kind}::${String(account.group ?? "")}`;
    const year = Number(entry.year);
    if (!Number.isFinite(year)) continue;
    if (entry.actualAmount !== undefined) {
      const set = actualYearsByGroup.get(key) ?? new Set();
      set.add(year);
      actualYearsByGroup.set(key, set);
    }
    if (entry.budgetAmount !== undefined) {
      const set = accountsBudgetYearsByGroup.get(key) ?? new Set();
      set.add(year);
      accountsBudgetYearsByGroup.set(key, set);
    }
  }

  for (const groupActual of groupActualList) {
    if (groupActual.active === false) continue;
    const kind = groupActual.kind === "income" ? "income" : "expense";
    const key = `${kind}::${String(groupActual.group ?? "")}`;
    const year = Number(groupActual.year);
    if (!Number.isFinite(year)) continue;
    const set = actualYearsByGroup.get(key) ?? new Set();
    set.add(year);
    actualYearsByGroup.set(key, set);
  }

  /** @type {Map<string, Set<number>>} */
  const groupBudgetYearsByGroup = new Map();
  for (const groupBudget of groupBudgetList) {
    if (groupBudget.active === false) continue;
    const kind = groupBudget.kind === "income" ? "income" : "expense";
    const key = `${kind}::${String(groupBudget.group ?? "")}`;
    const year = Number(groupBudget.year);
    if (!Number.isFinite(year)) continue;
    const set = groupBudgetYearsByGroup.get(key) ?? new Set();
    set.add(year);
    groupBudgetYearsByGroup.set(key, set);
  }

  const comparableYears = new Set();
  const allGroupKeys = new Set([
    ...actualYearsByGroup.keys(),
    ...accountsBudgetYearsByGroup.keys(),
    ...groupBudgetYearsByGroup.keys(),
  ]);
  for (const key of allGroupKeys) {
    const actualYears = actualYearsByGroup.get(key) ?? new Set();
    const budgetYears = new Set([
      ...(accountsBudgetYearsByGroup.get(key) ?? []),
      ...(groupBudgetYearsByGroup.get(key) ?? []),
    ]);
    for (const year of budgetYears) {
      if (actualYears.has(year)) comparableYears.add(year);
    }
  }
  return [...comparableYears].sort((a, b) => a - b);
}

/**
 * @typedef {Object} GroupBudgetVsActualRow
 * @property {"income"|"expense"} kind
 * @property {string} group
 * @property {number|undefined} budget
 * @property {"group"|"accounts"|undefined} budgetSource Which source won (feature/group-budget handoff §1): an active GroupBudget always wins over a tili-summed budget when both exist for the row.
 * @property {number|undefined} overriddenAccountsBudget The tili-summed budget that was *not* used, only set when budgetSource is "group" and a tili-summed figure also existed — surfaced so the precedence rule is visible in the UI, not hidden in the calculation.
 * @property {number|undefined} actual The group's authoritative actual: the group-level figure when one exists, else the account sum.
 * @property {"group"|"accounts"|undefined} actualSource Which source the actual came from, exposed for the same reason as budgetSource — the precedence rule stays visible instead of hidden in the number.
 * @property {number|undefined} accountsActual The account sum, always present when any account reported, even when the group-level figure won. The detail panel needs it to explain why its rows do not add up to the group total.
 * @property {number|undefined} unitemizedActual The part of the group's total that no account accounts for: groupActual - accountsActual, set only when both exist and differ by more than rounding. `undefined` when they agree (nothing is missing) and when there are no accounts at all (nothing was ever itemised, so nothing is *un*-itemised).
 * @property {number|undefined} diffAmount
 * @property {number|undefined} diffPercent
 * @property {boolean|undefined} favorable
 * @property {string} notes
 * @property {Array<{ accountCode: string, name: string, budget: number|undefined, actual: number|undefined, diffAmount: number|undefined, diffPercent: number|undefined }>} rows Tili-level breakdown for the detail panel.
 */

/**
 * @typedef {Object} GroupBudgetVsActualKpis
 * @property {number|undefined} totalBudget
 * @property {number|undefined} totalActual
 * @property {number|undefined} netDiff
 * @property {number|undefined} avgAbsDeviationPercent Mean of |diffPercent| over this kind's group rows; rows without a computable diffPercent (one-sided, or budget 0) are excluded rather than counted as 0.
 */

/**
 * Ryhmätason "Budjetti vs. toteuma" (feature/group-budget handoff §1). The
 * group's budget prefers an active GroupBudget for that (kind, group, year)
 * — the yhtiökokous-approved figure — and falls back to the tili-level
 * FinancialEntry.budgetAmount summed per group when no GroupBudget exists
 * for that row. This is a per-row rule, not a per-year rule: the same year
 * can show budgetSource "group" for one group and "accounts" for another.
 * `budgetSource` (and `overriddenAccountsBudget` when applicable) is
 * exposed on every row rather than folded into the number, per the
 * handoff's explicit requirement that the precedence rule stays visible to
 * the user, not hidden in the calculation.
 *
 * THE ACTUAL follows the same precedence, one level down (handoff
 * feature/group-level-actuals): an active GroupActual for the (kind, group,
 * year) wins over the sum of FinancialEntry.actualAmount across the group's
 * accounts. This exists because a partial account sum is indistinguishable
 * from a complete one — an account with no entry for a year usually means "no
 * such cost", not "not itemised" — so the group's true total has to come from
 * outside the data. Hoitovastikkeet 2023 summed to 3 527,50 EUR from the one
 * account the source itemised, against a true 36 237,38 EUR, and the view
 * reported it as a 90,1 % shortfall against budget.
 *
 * `unitemizedActual` carries the difference so the user sees both the right
 * total and how much of it no account explains. It is set only when the two
 * figures actually differ; the mechanism therefore checks itself, since a
 * group-level actual that matches the account sum (2023 expenses do, to the
 * cent) marks nothing and changes nothing.
 *
 * A row is included whenever the group has *either* a budget or an actual
 * for the year — not only when both are present (handoff §3 clarification:
 * "vuosi mukaan vain jos molemmat" is a year-selection rule — see
 * deriveComparableGroupBudgetYears — not a row-visibility rule). The
 * missing side stays `undefined` (renders "—" in the UI), and
 * diffAmount/diffPercent/favorable are never computed against an implied
 * zero.
 *
 * Sign convention and column semantics are identical to
 * buildBudgetVsActualViewModel (kept as a separate function rather than
 * modified in place, so its existing tests and tili-level semantics stay
 * untouched): diffAmount = actual - budget; favorable uses |actual| vs
 * |budget| for expenses (source data often keeps costs negative) and the
 * raw sign for income.
 * @param {ReadonlyArray<{accountCode?: unknown, name?: unknown, kind?: unknown, group?: unknown}>} [accounts]
 * @param {ReadonlyArray<{accountCode?: unknown, year?: unknown, budgetAmount?: unknown, actualAmount?: unknown, notes?: unknown}>} [entries]
 * @param {ReadonlyArray<{id?: unknown, kind?: unknown, group?: unknown, year?: unknown, budgetAmount?: unknown, active?: unknown}>} [groupBudgets]
 * @param {ReadonlyArray<{id?: unknown, kind?: unknown, group?: unknown, year?: unknown, actualAmount?: unknown, active?: unknown}>} [groupActuals]
 * @param {number|string} [year]
 * KPI totals are split by kind (income vs. expense): summing budget or
 * actual euros across both would add figures of opposite dominant sign
 * (e.g. -44 000 € of expense budget + 42 187 € of income budget), producing
 * a number close to zero that means nothing (confirmed against real 2024/
 * 2025 production data during review). `avgAbsDeviationPercent` is split by
 * kind for a different reason: it mixes two unrelated questions when
 * combined — how well expenses were budgeted vs. how well vastike income
 * was forecast — and since there is typically a single income group, its
 * near-zero deviation dilutes the expense figure. The source Excel's
 * "Budjettitarkkuus" sheet computes it for expenses separately.
 * @returns {{
 *   isEmpty: boolean,
 *   year: number|null,
 *   sections: Array<{ kind: "income"|"expense", groups: GroupBudgetVsActualRow[] }>,
 *   kpis: {
 *     income: GroupBudgetVsActualKpis | null,
 *     expense: GroupBudgetVsActualKpis | null,
 *   } | null,
 *   emptyMessage: string,
 * }}
 */
export function buildGroupBudgetVsActualViewModel(accounts, entries, groupBudgets, groupActuals, year) {
  const accountList = Array.isArray(accounts) ? accounts : [];
  const entryList = Array.isArray(entries) ? entries : [];
  const groupBudgetList = Array.isArray(groupBudgets) ? groupBudgets : [];
  const groupActualList = Array.isArray(groupActuals) ? groupActuals : [];
  const accountsByCode = new Map(accountList.map((a) => [String(a.accountCode ?? ""), a]));

  // A group-level actual can stand alone, so the view is not empty just
  // because no accounts exist — rental income has a total and no accounts.
  if ((accountList.length === 0 && groupActualList.length === 0) ||
      year === undefined || year === null || year === "") {
    return { isEmpty: true, year: null, sections: [], kpis: null, emptyMessage: FINANCE_VIEW_EMPTY_MESSAGE };
  }
  const selectedYear = Number(year);

  /** @type {Map<string, { kind: "income"|"expense", group: string }>} */
  const groupKeys = new Map();
  for (const account of accountList) {
    const kind = account.kind === "income" ? "income" : "expense";
    const group = String(account.group ?? "");
    groupKeys.set(`${kind}::${group}`, { kind, group });
  }
  const activeGroupBudgetsThisYear = groupBudgetList.filter((groupBudget) =>
    groupBudget.active !== false && Number(groupBudget.year) === selectedYear
  );
  for (const groupBudget of activeGroupBudgetsThisYear) {
    const kind = groupBudget.kind === "income" ? "income" : "expense";
    const group = String(groupBudget.group ?? "");
    groupKeys.set(`${kind}::${group}`, { kind, group });
  }
  const groupBudgetByKey = new Map(
    activeGroupBudgetsThisYear.map((groupBudget) => [
      `${groupBudget.kind === "income" ? "income" : "expense"}::${String(groupBudget.group ?? "")}`,
      groupBudget,
    ])
  );

  const activeGroupActualsThisYear = groupActualList.filter((groupActual) =>
    groupActual.active !== false && Number(groupActual.year) === selectedYear
  );
  for (const groupActual of activeGroupActualsThisYear) {
    const kind = groupActual.kind === "income" ? "income" : "expense";
    groupKeys.set(`${kind}::${String(groupActual.group ?? "")}`, { kind, group: String(groupActual.group ?? "") });
  }
  const groupActualByKey = new Map(
    activeGroupActualsThisYear.map((groupActual) => [
      `${groupActual.kind === "income" ? "income" : "expense"}::${String(groupActual.group ?? "")}`,
      groupActual,
    ])
  );

  const yearEntries = entryList.filter((e) => Number(e.year) === selectedYear);

  /** @type {Map<string, GroupBudgetVsActualRow>} */
  const rowsByKey = new Map();
  for (const { kind, group } of groupKeys.values()) {
    const key = `${kind}::${group}`;
    const codesInGroup = new Set(
      accountList
        .filter((a) => (a.kind === "income" ? "income" : "expense") === kind && String(a.group ?? "") === group)
        .map((a) => String(a.accountCode ?? ""))
    );
    const entriesInGroup = yearEntries.filter((e) => codesInGroup.has(String(e.accountCode ?? "")));

    const accountRows = entriesInGroup
      .map((entry) => {
        const account = accountsByCode.get(String(entry.accountCode ?? ""));
        const budget = typeof entry.budgetAmount === "number" ? entry.budgetAmount : undefined;
        const actual = typeof entry.actualAmount === "number" ? entry.actualAmount : undefined;
        let diffAmount;
        let diffPercent;
        if (budget !== undefined && actual !== undefined) {
          diffAmount = actual - budget;
          diffPercent = budget !== 0 ? (diffAmount / budget) * 100 : undefined;
        }
        return {
          accountCode: String(entry.accountCode ?? ""),
          name: String(account?.name ?? ""),
          budget,
          actual,
          diffAmount,
          diffPercent,
        };
      })
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    const actualValues = accountRows.map((r) => r.actual).filter((v) => v !== undefined);
    const accountsActual = actualValues.length > 0 ? actualValues.reduce((s, v) => s + v, 0) : undefined;
    const groupActual = groupActualByKey.get(key);
    const actual = groupActual !== undefined
      ? (typeof groupActual.actualAmount === "number" ? groupActual.actualAmount : undefined)
      : accountsActual;
    const actualSource = actual === undefined
      ? undefined
      : (groupActual !== undefined ? "group" : "accounts");
    const unitemizedActual = actualSource === "group" && accountsActual !== undefined &&
        Math.abs(actual - accountsActual) >= GROUP_ACTUAL_EPSILON
      ? actual - accountsActual
      : undefined;
    const accountsBudgetValues = accountRows.map((r) => r.budget).filter((v) => v !== undefined);
    const accountsBudget = accountsBudgetValues.length > 0
      ? accountsBudgetValues.reduce((s, v) => s + v, 0)
      : undefined;

    const groupBudget = groupBudgetByKey.get(key);
    const budget = groupBudget !== undefined ? groupBudget.budgetAmount : accountsBudget;
    const budgetSource = groupBudget !== undefined
      ? "group"
      : (accountsBudget !== undefined ? "accounts" : undefined);
    const overriddenAccountsBudget = groupBudget !== undefined ? accountsBudget : undefined;

    let diffAmount;
    let diffPercent;
    if (budget !== undefined && actual !== undefined) {
      diffAmount = actual - budget;
      diffPercent = budget !== 0 ? (diffAmount / budget) * 100 : undefined;
    }
    const favorable = diffAmount === undefined
      ? undefined
      : kind === "expense"
        ? Math.abs(actual) <= Math.abs(budget)
        : diffAmount >= 0;

    const notes = [...new Set(entriesInGroup.map((e) => toTrimmed(e.notes)).filter((n) => n !== ""))].join("; ");

    rowsByKey.set(key, {
      kind,
      group,
      budget,
      budgetSource,
      overriddenAccountsBudget,
      actual,
      actualSource,
      accountsActual,
      unitemizedActual,
      diffAmount,
      diffPercent,
      favorable,
      notes,
      rows: accountRows,
    });
  }

  const allRows = [...rowsByKey.values()];
  const hasAnyData = allRows.some((r) => r.budget !== undefined || r.actual !== undefined);
  if (!hasAnyData) {
    return { isEmpty: true, year: selectedYear, sections: [], kpis: null, emptyMessage: FINANCE_VIEW_EMPTY_MESSAGE };
  }

  const sections = (/** @type {Array<"income"|"expense">} */ (["income", "expense"]))
    .filter((kind) => allRows.some((r) => r.kind === kind))
    .map((kind) => ({
      kind,
      groups: allRows.filter((r) => r.kind === kind).sort((a, b) => a.group.localeCompare(b.group)),
    }));

  /** @param {"income"|"expense"} kind */
  function kpisForKind(kind) {
    const rows = allRows.filter((r) => r.kind === kind);
    if (rows.length === 0) return null;
    const budgetValues = rows.map((r) => r.budget).filter((v) => v !== undefined);
    const actualValues = rows.map((r) => r.actual).filter((v) => v !== undefined);
    const totalBudget = budgetValues.length > 0 ? budgetValues.reduce((s, v) => s + v, 0) : undefined;
    const totalActual = actualValues.length > 0 ? actualValues.reduce((s, v) => s + v, 0) : undefined;
    const netDiff = totalBudget !== undefined && totalActual !== undefined ? totalActual - totalBudget : undefined;
    const diffPercents = rows.map((r) => r.diffPercent).filter((v) => v !== undefined);
    const avgAbsDeviationPercent = diffPercents.length > 0
      ? diffPercents.reduce((s, v) => s + Math.abs(v), 0) / diffPercents.length
      : undefined;
    return { totalBudget, totalActual, netDiff, avgAbsDeviationPercent };
  }

  return {
    isEmpty: false,
    year: selectedYear,
    sections,
    kpis: {
      income: kpisForKind("income"),
      expense: kpisForKind("expense"),
    },
    emptyMessage: FINANCE_VIEW_EMPTY_MESSAGE,
  };
}

/* -------- Forecast completeness (feature/forecast-complete) -------- */

/**
 * One line per reason the forecast falls short, or a single "complete" line.
 *
 * ONE LINE PER REASON, not one merged sentence: a DATA GAP is fixed by
 * entering a cost and an uncovered horizon by extending — or declaring — the
 * maintenance plan. Two different jobs do not belong in one sentence, and the
 * old text named the wrong one ("Ennuste puutteellinen (DATA GAP)") whenever
 * the real cause was coverage.
 *
 * EVERY FIGURE COMES FROM THE ONE CASH PATH the card is rendering. The
 * uncovered-year count is `beyondCoverage.yearCount`, computed inside the same
 * projectCashPath call over the same horizon, and the horizon's last year is
 * that path's own last row. Neither is read from a global or recomputed here,
 * because horizons differ between views (2050 in one place, 2057 in another)
 * and a card must never caption itself with another view's horizon.
 *
 * `yearCount` is also more correct than horizonEnd − coverage would be: a plan
 * whose coverage ended before the horizon even starts has fewer uncovered
 * years than that subtraction suggests, and the count already excludes the
 * years outside the horizon.
 *
 * @param {ReadonlyArray<string>} [reasons] `forecastIncompleteReasons`.
 * @param {{ maintenancePlanCoverageThroughYear?: number, beyondCoverage?: { yearCount?: number }, years?: ReadonlyArray<{ year: number }>, blockingDataGaps?: ReadonlyArray<unknown> }} [cashPath]
 * @returns {Array<{ tone: "ok"|"warning", text: string }>}
 */
export function buildForecastCompletenessLines(reasons, cashPath) {
  const list = Array.isArray(reasons) ? reasons : [];
  if (list.length === 0) {
    return [{ tone: /** @type {const} */ ("ok"), text: "Ennuste täydellinen" }];
  }

  const path = cashPath && typeof cashPath === "object" ? cashPath : {};
  const coverage = path.maintenancePlanCoverageThroughYear;
  const years = Array.isArray(path.years) ? path.years : [];
  const horizonEndYear = years.length > 0 ? years[years.length - 1].year : undefined;
  const uncoveredYearCount = path.beyondCoverage?.yearCount;
  const gapCount = Array.isArray(path.blockingDataGaps) ? path.blockingDataGaps.length : 0;

  /** @param {string} text */
  const warn = (text) => ({ tone: /** @type {const} */ ("warning"), text });

  return list.map((reason) => {
    if (reason === "data_gap") {
      const count = gapCount > 0 ? `${gapCount} DATA GAPia` : "nimettyjä DATA GAPeja";
      return warn(`Ennuste puutteellinen: ${count} — syötä puuttuvat kustannusnäytöt`);
    }
    if (reason === "coverage_unset") {
      return warn(
        "Ennuste puutteellinen: kunnossapitosuunnitelman kate on kertomatta — " +
        "syötä se yhtiön perustietoihin",
      );
    }
    if (reason === "coverage_ends_before_horizon") {
      const span = coverage !== undefined && horizonEndYear !== undefined
        ? `suunnitelma kattaa vuoteen ${coverage}, horisontti ulottuu vuoteen ${horizonEndYear}`
        : "suunnitelma ei kata koko horisonttia";
      const tail = uncoveredYearCount === undefined
        ? ""
        : ` — ${uncoveredYearCount} vuotta suunnittelematta`;
      return warn(`Ennuste puutteellinen: ${span}${tail}`);
    }
    return warn("Ennuste puutteellinen");
  });
}

/* ------------------------------------------------------------------ delete */

/**
 * Finnish label per entity type, singular and partitive-plural, for the
 * confirmation summary ("1 havainto", "2 havaintoa").
 */
const DELETE_ENTITY_LABELS = {
  asset: ["rakennusosa", "rakennusosaa"],
  observation: ["havainto", "havaintoa"],
  building_event: ["korjaustapahtuma", "korjaustapahtumaa"],
  cost_evidence: ["kustannusnäyttö", "kustannusnäyttöä"],
  price_level_confirmation: ["hintatasovahvistus", "hintatasovahvistusta"],
  financial_account: ["tili", "tiliä"],
  financial_entry: ["talousrivi", "talousriviä"],
  balance_sheet_snapshot: ["tasesnapshot", "tasesnapshottia"],
  group_budget: ["ryhmäbudjetti", "ryhmäbudjettia"],
  group_actual: ["ryhmätason toteuma", "ryhmätason toteumaa"],
  financial_year: ["tilikausi", "tilikautta"],
  liquidity_baseline: ["maksuvalmiuden lähtötieto", "maksuvalmiuden lähtötietoa"],
};

/** Order the confirmation lists things in — the deletion target's own kind first is handled by the caller. */
const DELETE_ENTITY_ORDER = [
  "asset",
  "observation",
  "building_event",
  "cost_evidence",
  "price_level_confirmation",
  "financial_account",
  "financial_entry",
  "balance_sheet_snapshot",
  "group_budget",
  "group_actual",
  "financial_year",
  "liquidity_baseline",
];

/** @param {{ entityType: string, entityKey: string }} ref */
function deleteRefKey(ref) {
  return `${ref.entityType}:${ref.entityKey}`;
}

/**
 * Human label for one entity, used in the confirmation view. Falls back to the
 * key, which is always meaningful (an id the user typed, or accountCode:year).
 * @param {any} model
 * @param {string} entityType
 * @param {string} entityKey
 */
function describeDeleteTarget(model, entityType, entityKey) {
  switch (entityType) {
    case "asset":
      return (model.assets ?? []).find((item) => item.id === entityKey)?.name ?? entityKey;
    case "observation": {
      const observation = (model.observations ?? []).find((item) => item.id === entityKey);
      if (observation === undefined) return entityKey;
      const description = String(observation.description ?? "");
      return description.length > 60 ? `${description.slice(0, 57)}…` : description || entityKey;
    }
    case "building_event":
      return (model.events ?? []).find((item) => item.id === entityKey)?.title ?? entityKey;
    case "financial_entry": {
      const [accountCode, year] = entityKey.split(":");
      const account = (model.financialAccounts ?? []).find((item) => item.accountCode === accountCode);
      return `${accountCode} ${account?.name ?? ""} · ${year}`.replace(/\s+/g, " ").trim();
    }
    case "financial_account": {
      const account = (model.financialAccounts ?? []).find((item) => item.accountCode === entityKey);
      return account === undefined ? entityKey : `${entityKey} ${account.name}`;
    }
    case "group_budget": {
      const groupBudget = (model.groupBudgets ?? []).find((item) => item.id === entityKey);
      return groupBudget === undefined ? entityKey : `${groupBudget.group} ${groupBudget.year}`;
    }
    case "group_actual": {
      const groupActual = (model.groupActuals ?? []).find((item) => item.id === entityKey);
      return groupActual === undefined ? entityKey : `${groupActual.group} ${groupActual.year}`;
    }
    default:
      return entityKey;
  }
}

/**
 * One entity's source identifiers, normalised to a list of non-empty strings.
 *
 * The model does not use one shape for this. Asset, Observation,
 * BuildingEvent, FinancialEntry, GroupBudget and BalanceSheetSnapshot carry
 * `sourceIds: string[]`; CostEvidence instead carries a singular
 * `sourceId?: string` (with `sourceUrl` taking precedence, exactly as its
 * detail view renders it); FinancialAccount and PriceLevelConfirmation carry
 * no source of their own.
 *
 * Spreading is deliberately avoided: `[..."ffg"]` yields ["f","f","g"], so a
 * singular string source id would be rendered as unrelated fragments. A
 * non-array value is wrapped, never iterated.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeSourceList(value) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => String(item).trim()).filter((item) => item !== "");
}

/**
 * The source identifiers a deletable entity carries, so the confirmation can
 * say where the row came from and not only what it is called. Two rows about
 * the same building part routinely share a name — one imported from the real
 * accounting export, one from a test paste — and the name alone has already
 * been enough to delete the wrong one.
 *
 * Read-only: nothing here feeds buildDeletionOperations, which keeps using
 * plan.sourceIds as before.
 *
 * @param {any} model
 * @param {string} entityType
 * @param {string} entityKey
 * @returns {string[]}
 */
function deleteTargetSourceIds(model, entityType, entityKey) {
  const find = (rows, predicate) => (rows ?? []).find(predicate);
  switch (entityType) {
    case "import":
      return entityKey === "" ? [] : entityKey.split(",");
    case "asset":
      return normalizeSourceList(find(model.assets, (item) => item.id === entityKey)?.sourceIds);
    case "observation":
      return normalizeSourceList(find(model.observations, (item) => item.id === entityKey)?.sourceIds);
    case "building_event":
      return normalizeSourceList(find(model.events, (item) => item.id === entityKey)?.sourceIds);
    case "cost_evidence": {
      const evidence = find(model.costEvidence, (item) => item.id === entityKey);
      return normalizeSourceList(evidence?.sourceUrl ?? evidence?.sourceId);
    }
    case "financial_entry": {
      const [accountCode, year] = entityKey.split(":");
      return normalizeSourceList(find(
        model.financialEntries,
        (item) => item.accountCode === accountCode && String(item.year) === year,
      )?.sourceIds);
    }
    case "financial_account": {
      // An account carries no source of its own, so the distinct sources of
      // its entries stand in: that is what actually says which import brought
      // this account into the workspace.
      const sources = new Set();
      for (const entry of model.financialEntries ?? []) {
        if (entry.accountCode !== entityKey) continue;
        for (const source of normalizeSourceList(entry.sourceIds)) sources.add(source);
      }
      return [...sources];
    }
    case "balance_sheet_snapshot":
      return normalizeSourceList(find(model.balanceSheetSnapshots, (item) => item.id === entityKey)?.sourceIds);
    case "group_budget":
      return normalizeSourceList(find(model.groupBudgets, (item) => item.id === entityKey)?.sourceIds);
    case "group_actual":
      return normalizeSourceList(find(model.groupActuals, (item) => item.id === entityKey)?.sourceIds);
    default:
      // PriceLevelConfirmation has no source field; it only ever appears as a
      // cascade child of the cost evidence it confirms.
      return [];
  }
}

/**
 * Computes the complete cascade for deleting one entity: every other entity
 * that must go with it, and every entity that must be rewritten because a
 * reference to the deleted one is disappearing.
 *
 * The reference map this implements was read off the validators, not the
 * spec — every edge below is one that validateAdminDataSnapshot or
 * projectEvents actually enforces, so a missed edge fails the batch rather
 * than corrupting the snapshot:
 *
 * - Observation.assetId, BuildingEvent.assetId, CostEvidence.assetId
 *   → deleting an asset deletes its observations, events and evidence.
 * - BuildingEvent.schedule[].costEvidenceId / actual.costEvidenceId are
 *   required, and a non-cancelled future event may not have an empty
 *   schedule → deleting cost evidence deletes every event citing it. This is
 *   the one cascade that runs "upwards"; the alternative (refuse the delete
 *   and ask the user to fix the event first) is a dead end, because schedule
 *   rows cannot be edited away one by one in the UI.
 * - PriceLevelConfirmation.costEvidenceId → deleted with its evidence.
 * - FinancialEntry.accountCode → deleting an account deletes its entries.
 *
 * Two references are cleared instead of cascaded, because both targets are
 * legal without them:
 * - BuildingEvent.observationIds: the event is a real repair that happened;
 *   losing its background observation does not unmake it.
 * - CostEvidence.eventId (optional in the model): a contractor quote is
 *   expensive to obtain and still says what the work costs after the planned
 *   event is dropped. Clearing the back-reference leaves the evidence on its
 *   asset, where the user can delete it separately if they want to.
 *
 * The walk is a fixed point because the graph has a cycle (event → evidence
 * → event) and cascades are transitive.
 *
 * @param {any} model The admin dashboard read model (state.admin).
 * @param {{ entityType: string, entityKey: string }} target
 * @returns {{
 *   target: { entityType: string, entityKey: string, label: string },
 *   deletes: Array<{ entityType: string, entityKey: string, label: string }>,
 *   updates: Array<{ entityType: string, entityKey: string, label: string, reason: string, value: any }>,
 *   scheduleRowCount: number,
 *   isEmpty: boolean,
 * }}
 */
export function planEntityDeletion(model, target) {
  const assets = model?.assets ?? [];
  const observations = model?.observations ?? [];
  const events = model?.events ?? [];
  const costEvidence = model?.costEvidence ?? [];
  const priceLevelConfirmations = model?.priceLevelConfirmations ?? [];
  const financialEntries = model?.financialEntries ?? [];

  /** @type {Map<string, { entityType: string, entityKey: string }>} */
  const deletes = new Map();
  /** @type {Array<{ entityType: string, entityKey: string }>} */
  const queue = [{ entityType: target.entityType, entityKey: target.entityKey }];

  while (queue.length > 0) {
    const current = queue.shift();
    const key = deleteRefKey(current);
    if (deletes.has(key)) continue;
    deletes.set(key, current);

    switch (current.entityType) {
      case "asset":
        for (const item of observations) {
          if (item.assetId === current.entityKey) queue.push({ entityType: "observation", entityKey: item.id });
        }
        for (const item of events) {
          if (item.assetId === current.entityKey) queue.push({ entityType: "building_event", entityKey: item.id });
        }
        for (const item of costEvidence) {
          if (item.assetId === current.entityKey) queue.push({ entityType: "cost_evidence", entityKey: item.id });
        }
        break;
      case "cost_evidence":
        for (const item of priceLevelConfirmations) {
          if (item.costEvidenceId === current.entityKey) {
            queue.push({ entityType: "price_level_confirmation", entityKey: item.costEvidenceId });
          }
        }
        for (const item of events) {
          if (eventCitesEvidence(item, current.entityKey)) {
            queue.push({ entityType: "building_event", entityKey: item.id });
          }
        }
        break;
      case "financial_account":
        for (const item of financialEntries) {
          if (item.accountCode === current.entityKey) {
            queue.push({ entityType: "financial_entry", entityKey: `${item.accountCode}:${item.year}` });
          }
        }
        break;
      default:
        break;
    }
  }

  const deletedObservationIds = new Set(
    [...deletes.values()].filter((item) => item.entityType === "observation").map((item) => item.entityKey),
  );
  const deletedEventIds = new Set(
    [...deletes.values()].filter((item) => item.entityType === "building_event").map((item) => item.entityKey),
  );

  /** @type {Array<{ entityType: string, entityKey: string, label: string, reason: string, value: any }>} */
  const updates = [];
  for (const event of events) {
    if (deletes.has(deleteRefKey({ entityType: "building_event", entityKey: event.id }))) continue;
    const remaining = (event.observationIds ?? []).filter((id) => !deletedObservationIds.has(id));
    if (remaining.length === (event.observationIds ?? []).length) continue;
    updates.push({
      entityType: "building_event",
      entityKey: event.id,
      label: event.title ?? event.id,
      reason: "viittaus poistettavaan havaintoon poistetaan",
      value: { ...event, observationIds: remaining },
    });
  }
  for (const evidence of costEvidence) {
    if (deletes.has(deleteRefKey({ entityType: "cost_evidence", entityKey: evidence.id }))) continue;
    if (evidence.eventId === undefined || !deletedEventIds.has(evidence.eventId)) continue;
    const { eventId: _cleared, ...withoutEvent } = evidence;
    updates.push({
      entityType: "cost_evidence",
      entityKey: evidence.id,
      label: evidence.id,
      reason: "viittaus poistettavaan korjaustapahtumaan poistetaan, näyttö itse säilyy",
      value: withoutEvent,
    });
  }

  const scheduleRowCount = events
    .filter((event) => deletedEventIds.has(event.id))
    .reduce((sum, event) => sum + (event.schedule ?? []).length, 0);

  const ordered = [...deletes.values()].sort((a, b) => {
    const order = DELETE_ENTITY_ORDER.indexOf(a.entityType) - DELETE_ENTITY_ORDER.indexOf(b.entityType);
    return order === 0 ? a.entityKey.localeCompare(b.entityKey) : order;
  });

  return {
    target: {
      entityType: target.entityType,
      entityKey: target.entityKey,
      label: describeDeleteTarget(model, target.entityType, target.entityKey),
      sources: deleteTargetSourceIds(model, target.entityType, target.entityKey),
    },
    sourceIds: [`${target.entityType}:${target.entityKey}`],
    deletes: ordered.map((item) => ({
      ...item,
      label: describeDeleteTarget(model, item.entityType, item.entityKey),
      sources: deleteTargetSourceIds(model, item.entityType, item.entityKey),
    })),
    updates,
    scheduleRowCount,
    isEmpty: deletes.size === 0,
  };
}

/** @param {any} event @param {string} evidenceId */
function eventCitesEvidence(event, evidenceId) {
  if (event.actual?.costEvidenceId === evidenceId) return true;
  return (event.schedule ?? []).some((row) => row.costEvidenceId === evidenceId);
}

/**
 * Renders source identifiers for the confirmation view. Empty string when the
 * entity carries none, so callers can drop the whole clause rather than print
 * an empty label.
 * @param {readonly string[] | undefined} sources
 * @returns {string}
 */
export function formatDeletionSources(sources) {
  const list = normalizeSourceList(sources);
  if (list.length === 0) return "";
  // Same joining the detail views use for sourceIds, so one identifier reads
  // identically wherever it appears.
  return `${list.length === 1 ? "lähde" : "lähteet"}: ${list.join(", ")}`;
}

/**
 * The exact sentence subject the delete confirmation prints: the target's
 * label, and its source in parentheses when it has one. Lives here rather
 * than in the view so the rendered text is the thing under test.
 * @param {ReturnType<typeof planEntityDeletion>} plan
 * @returns {string}
 */
export function formatDeletionTarget(plan) {
  const label = String(plan?.target?.label ?? "");
  const sources = formatDeletionSources(plan?.target?.sources);
  return sources === "" ? label : `${label} (${sources})`;
}

/**
 * Finnish confirmation lines for one plan: what goes besides the target, and
 * what gets rewritten. Returns [] when nothing but the target is affected —
 * the confirmation is still shown (handoff §2 requires it for every delete),
 * just without a list.
 * @param {ReturnType<typeof planEntityDeletion>} plan
 * @returns {string[]}
 */
export function summarizeDeletionPlan(plan) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {Map<string, Set<string>>} */
  const sources = new Map();
  for (const item of plan.deletes) {
    if (item.entityType === plan.target.entityType && item.entityKey === plan.target.entityKey) continue;
    counts.set(item.entityType, (counts.get(item.entityType) ?? 0) + 1);
    const seen = sources.get(item.entityType) ?? new Set();
    for (const source of item.sources ?? []) seen.add(source);
    sources.set(item.entityType, seen);
  }

  const lines = DELETE_ENTITY_ORDER
    .filter((entityType) => counts.has(entityType))
    .map((entityType) => {
      const count = counts.get(entityType);
      const [singular, plural] = DELETE_ENTITY_LABELS[entityType] ?? [entityType, entityType];
      const noun = count === 1 ? singular : plural;
      // The sources of a whole group are collapsed into one distinct list:
      // the point is to show which import the cascade reaches into, not to
      // repeat an identifier once per row.
      const suffix = formatDeletionSources([...(sources.get(entityType) ?? [])]);
      const tail = suffix === "" ? "" : ` · ${suffix}`;
      if (entityType === "building_event" && plan.scheduleRowCount > 0) {
        const rows = plan.scheduleRowCount === 1 ? "aikataulurivi" : "aikatauluriviä";
        return `${count} ${noun} (${plan.scheduleRowCount} ${rows})${tail}`;
      }
      return `${count} ${noun}${tail}`;
    });

  for (const update of plan.updates) {
    lines.push(`${update.label}: ${update.reason}`);
  }
  return lines;
}

/**
 * Turns a plan into the operations for one batch. Every operation carries the
 * deletion target's own key as its sourceIds: a delete has no external source
 * document, and demanding one would be exactly the friction this feature
 * exists to remove. The explanation stays mandatory and comes from the user —
 * that is the field that actually says why the row went.
 * An import deletion instead carries the import's own source identifiers,
 * which is exactly what the user typed to say where those rows came from.
 * @param {ReturnType<typeof planEntityDeletion>} plan
 * @param {{ explanation: string }} meta
 * @returns {Array<Record<string, unknown>>}
 */
export function buildDeletionOperations(plan, meta) {
  const sourceIds = plan.sourceIds;
  const explanation = toTrimmed(meta.explanation);
  const updates = plan.updates.map((update) => ({
    type: update.entityType === "building_event" ? "save_building_event" : "save_cost_evidence",
    value: update.value,
    sourceIds,
    explanation,
  }));
  const deletes = plan.deletes.map((item) => ({
    type: "delete_entity",
    entityType: item.entityType,
    entityKey: item.entityKey,
    sourceIds,
    explanation,
  }));
  // Updates first: applyAdminBatch stages operations in order, and rewriting a
  // surviving row before its neighbours disappear keeps every intermediate
  // state readable in the audit trail.
  return [...updates, ...deletes];
}

/**
 * Validates the one field a deletion asks the user for.
 * @param {Record<string, unknown>} raw
 * @returns {OperationResult<{ explanation: string }>}
 */
export function validateDeletionMeta(raw) {
  const explanation = toTrimmed(raw.explanation);
  if (explanation === "") {
    return { ok: false, errors: { explanation: "Poiston selitys on pakollinen." } };
  }
  return { ok: true, value: { explanation } };
}

/**
 * Groups every imported financial row and group budget by the source
 * identifiers it carries, so one paste can be undone as a unit.
 *
 * There is no import id or timestamp on the rows — but there does not need to
 * be: buildFinancialImportOperations and buildGroupBudgetImportOperations both
 * stamp every row of one paste with that paste's shared sourceIds field, and
 * the single-row entry form is not wired into the UI, so in practice every row
 * carries the source identifier of the import that last wrote it. "Last
 * wrote", not "created", is the right grouping here: a row corrected by a
 * later paste belongs to that later paste, not the one being undone.
 *
 * Rows are keyed by their whole sorted sourceIds set, not by any single id, so
 * a row tagged with two sources is never swept up by a group named after one
 * of them.
 *
 * @param {any} model
 * @returns {Array<{ key: string, sourceIds: string[], label: string, years: number[], entryCount: number, accountCount: number, groupBudgetCount: number }>}
 */
export function listDataImports(model) {
  /** @type {Map<string, { key: string, sourceIds: string[], years: Set<number>, accounts: Set<string>, entryCount: number, groupBudgetCount: number, groupActualCount: number }>} */
  const imports = new Map();

  /** @param {readonly string[] | undefined} rawSourceIds */
  function bucket(rawSourceIds) {
    const sourceIds = [...(rawSourceIds ?? [])].map((item) => String(item)).sort();
    if (sourceIds.length === 0) return undefined;
    const key = sourceIds.join(",");
    let entry = imports.get(key);
    if (entry === undefined) {
      entry = { key, sourceIds, years: new Set(), accounts: new Set(), entryCount: 0, groupBudgetCount: 0, groupActualCount: 0 };
      imports.set(key, entry);
    }
    return entry;
  }

  for (const row of model?.financialEntries ?? []) {
    const entry = bucket(row.sourceIds);
    if (entry === undefined) continue;
    entry.entryCount += 1;
    entry.years.add(Number(row.year));
    entry.accounts.add(String(row.accountCode));
  }
  for (const row of model?.groupBudgets ?? []) {
    const entry = bucket(row.sourceIds);
    if (entry === undefined) continue;
    entry.groupBudgetCount += 1;
    entry.years.add(Number(row.year));
  }
  for (const row of model?.groupActuals ?? []) {
    const entry = bucket(row.sourceIds);
    if (entry === undefined) continue;
    entry.groupActualCount += 1;
    entry.years.add(Number(row.year));
  }

  return [...imports.values()]
    .map((entry) => ({
      key: entry.key,
      sourceIds: entry.sourceIds,
      label: entry.sourceIds.join(", "),
      years: [...entry.years].sort((a, b) => a - b),
      entryCount: entry.entryCount,
      accountCount: entry.accounts.size,
      groupBudgetCount: entry.groupBudgetCount,
      groupActualCount: entry.groupActualCount,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Plans the deletion of one whole import: its financial entries, its group
 * budgets, and any financial account left with no entries at all once they are
 * gone — an account with no figures is residue of the import, and would
 * otherwise linger as an empty row in the per-account views.
 *
 * Accounts that still hold rows from another year or another import are kept.
 *
 * @param {any} model
 * @param {string} key An import key from listDataImports.
 * @returns {ReturnType<typeof planEntityDeletion>}
 */
export function planImportDeletion(model, key) {
  const financialEntries = model?.financialEntries ?? [];
  const groupBudgets = model?.groupBudgets ?? [];
  const groupActuals = model?.groupActuals ?? [];
  const financialAccounts = model?.financialAccounts ?? [];
  /** @param {readonly string[] | undefined} rawSourceIds */
  const matches = (rawSourceIds) =>
    [...(rawSourceIds ?? [])].map((item) => String(item)).sort().join(",") === key;

  const removedEntries = financialEntries.filter((row) => matches(row.sourceIds));
  const removedEntryKeys = new Set(removedEntries.map((row) => `${row.accountCode}:${row.year}`));
  const emptiedAccounts = financialAccounts.filter((account) =>
    financialEntries.some((row) => row.accountCode === account.accountCode) &&
    financialEntries
      .filter((row) => row.accountCode === account.accountCode)
      .every((row) => removedEntryKeys.has(`${row.accountCode}:${row.year}`))
  );

  /** @type {Array<{ entityType: string, entityKey: string }>} */
  const refs = [
    ...emptiedAccounts.map((account) => ({ entityType: "financial_account", entityKey: account.accountCode })),
    ...removedEntries.map((row) => ({ entityType: "financial_entry", entityKey: `${row.accountCode}:${row.year}` })),
    ...groupBudgets.filter((row) => matches(row.sourceIds))
      .map((row) => ({ entityType: "group_budget", entityKey: row.id })),
    ...groupActuals.filter((row) => matches(row.sourceIds))
      .map((row) => ({ entityType: "group_actual", entityKey: row.id })),
  ];

  return {
    target: {
      entityType: "import",
      entityKey: key,
      label: key.split(",").join(", "),
      sources: deleteTargetSourceIds(model, "import", key),
    },
    sourceIds: key.split(","),
    deletes: refs.map((ref) => ({
      ...ref,
      label: describeDeleteTarget(model, ref.entityType, ref.entityKey),
      sources: deleteTargetSourceIds(model, ref.entityType, ref.entityKey),
    })),
    updates: [],
    scheduleRowCount: 0,
    isEmpty: refs.length === 0,
  };
}

/**
 * Warns about values a re-import would silently drop.
 *
 * Re-importing updates rather than duplicates — every save_* operation is an
 * upsert on a deterministic key (FinancialEntry on accountCode+year,
 * BalanceSheetSnapshot on id) — but it replaces the row *whole*. A paste that
 * leaves the budget column empty for an account/year that already has one
 * therefore erases that budget without saying so, which is the DATA GAP
 * principle failing in the other direction: a figure quietly becoming nothing.
 *
 * This does not block the import. Emptying a value on purpose has to stay
 * possible; the user just has to see it coming.
 *
 * @param {{ entries?: ReadonlyArray<{ accountCode?: unknown, year?: unknown, budgetAmount?: unknown, actualAmount?: unknown }> }} parsed
 * @param {ReadonlyArray<{ accountCode?: unknown, year?: unknown, budgetAmount?: unknown, actualAmount?: unknown }>} [existingEntries]
 * @returns {string[]} Finnish warning lines, empty when nothing would be lost.
 */
export function detectFinancialImportValueDrops(parsed, existingEntries) {
  const existing = new Map(
    (existingEntries ?? []).map((row) => [`${String(row.accountCode)}:${Number(row.year)}`, row]),
  );
  /** @type {string[]} */
  const warnings = [];
  for (const entry of parsed?.entries ?? []) {
    const key = `${String(entry.accountCode)}:${Number(entry.year)}`;
    const current = existing.get(key);
    if (current === undefined) continue;
    for (const [field, label] of [["budgetAmount", "budjetti"], ["actualAmount", "toteuma"]]) {
      if (typeof current[field] === "number" && typeof entry[field] !== "number") {
        warnings.push(
          `${key}: liitos ei sisällä ${label}a, nykyinen arvo ${current[field]} poistuu.`,
        );
      }
    }
  }
  return warnings;
}

/**
 * The same warning for balance data, where re-importing an existing snapshot
 * id replaces its entries wholesale: any entry key missing from the paste
 * disappears from the snapshot.
 * @param {{ snapshot?: { id?: unknown, entries?: ReadonlyArray<{ key?: unknown }> } }} parsed
 * @param {ReadonlyArray<{ id?: unknown, entries?: ReadonlyArray<{ key?: unknown, name?: unknown }> }>} [existingSnapshots]
 * @returns {string[]}
 */
export function detectBalanceImportValueDrops(parsed, existingSnapshots) {
  const id = String(parsed?.snapshot?.id ?? "");
  const current = (existingSnapshots ?? []).find((item) => String(item.id) === id);
  if (current === undefined) return [];
  const pastedKeys = new Set((parsed?.snapshot?.entries ?? []).map((entry) => String(entry.key)));
  const dropped = (current.entries ?? []).filter((entry) => !pastedKeys.has(String(entry.key)));
  if (dropped.length === 0) return [];
  return [
    `Snapshotti ${id} on jo olemassa ja korvataan kokonaan. Liitoksesta puuttuu ` +
      `${dropped.length} nykyistä erää, jotka poistuvat: ` +
      dropped.map((entry) => String(entry.name ?? entry.key)).join(", "),
  ];
}
