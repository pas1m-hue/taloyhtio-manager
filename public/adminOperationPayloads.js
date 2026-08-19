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
 * `group.accountRows` for the row-detail panel.
 * @param {ReadonlyArray<{accountCode?: unknown, name?: unknown, kind?: unknown, group?: unknown}>} [accounts]
 * @param {ReadonlyArray<{accountCode?: unknown, year?: unknown, budgetAmount?: unknown, actualAmount?: unknown, notes?: unknown}>} [entries]
 * @returns {{
 *   isEmpty: boolean,
 *   actualYears: number[],
 *   budgetYear: number|null,
 *   changeYears: { previous: number, latest: number }|null,
 *   latestActualYear: number|null,
 *   groups: Array<FinanceGroup & { sharePercent: number|undefined }>,
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
 * @property {Array<{ key: string, name: string, amount: number, notes?: string }>} entries Positive amounts.
 * @property {number} sectionTotal Positive.
 */

/**
 * @typedef {Object} BalanceSheetTopGroupViewModel
 * @property {"assets"|"equity"|"liabilities"} key
 * @property {string} label VARAT / OMA PÄÄOMA / VELAT.
 * @property {BalanceSheetSectionViewModel[]} sections
 * @property {number} groupTotal Positive.
 */

/**
 * View model for the Taloudellinen asema base view (handoff §6, vaihe 4A —
 * single snapshot only; comparison/reconciliation/ratios are 4B). Groups the
 * snapshot's entries into all five BALANCE_SECTIONS (always rendered, even
 * empty, so the view's structure never depends on which sections happen to
 * have data), nested under the three top-level groups, with section and
 * top-level totals. All amounts are shown positive (`Math.abs`) regardless
 * of the stored sign, per the spec's display rule (§6.5).
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
      amount: Math.abs(Number(entry.amount ?? 0)),
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
