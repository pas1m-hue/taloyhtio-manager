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
