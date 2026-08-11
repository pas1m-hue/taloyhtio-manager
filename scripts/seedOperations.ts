/**
 * Pure builder for the vaihe 2B-2 initial-data seed batch. No network I/O
 * here so the batch shape and the DATA GAP handling can be unit tested
 * without a running server. See scripts/seed-initial-data.ts for the driver
 * that calls the admin HTTP API.
 */
import type {
  AdminDataOperation,
  Asset,
  BuildingEvent,
  CostEvidence,
  EventScheduleEntry,
  LiquidityBaselineRecord,
  Scenario,
} from "../src/domain/types.js";

export const WATER_HEATER_ASSET_ID = "asset_lammin_vesi_varaajat";
export const VENTILATION_ASSET_ID = "asset_ilmanvaihto";
export const WATER_HEATER_COST_EVIDENCE_ID = "cost_varaaja_yksikko";
export const VENTILATION_CLEANING_COST_EVIDENCE_ID = "cost_ilmanvaihto_puhdistus";
export const WATER_HEATER_EVENT_ID = "event_varaajien_uusiminen";
export const LIQUIDITY_BASELINE_ID = "liquidity_2026";

const EXCEL_LONG_TERM_SOURCE_ID = "excel_terminaali_2026_pitka_aikavali";
const EXCEL_CURRENT_PERIOD_SOURCE_ID = "excel_terminaali_2026_kuluva_kausi";

const WATER_HEATER_UNIT_PRICE = 1_800;

/**
 * Verified against docs/product-spec/taloyhtio terminaali.xlsx, sheet
 * "Pitkä aikaväli", 2026-08-11 (only rows where kpl > 0).
 */
const WATER_HEATER_SCHEDULE_ROWS: Readonly<
  Record<Scenario, readonly (readonly [year: number, quantity: number])[]>
> = {
  optimistic: [
    [2027, 1],
    [2030, 1],
    [2033, 1],
    [2036, 1],
    [2039, 1],
  ],
  base: [
    [2026, 1],
    [2027, 1],
    [2028, 1],
    [2029, 2],
    [2030, 2],
    [2031, 2],
    [2032, 1],
    [2033, 1],
    [2034, 1],
  ],
  stress: [
    [2028, 5],
    [2029, 2],
    [2030, 2],
    [2031, 2],
    [2032, 1],
  ],
};

/**
 * The 12-month operating-cost figure the source Excel does not provide
 * (sheet "Kuluva kausi 2026" has no trailing-12m operating-cost line). This
 * is a named DATA GAP, never a silent zero.
 */
export interface TrailingCostsInput {
  readonly value: number;
  readonly sourceIds: readonly string[];
  readonly notes: string;
  readonly isPlaceholder: boolean;
}

export interface SeedOperationsSummary {
  readonly assetIds: readonly string[];
  readonly costEvidenceIds: readonly string[];
  readonly eventId: string;
  readonly scheduleRowCount: number;
  readonly scheduleQuantityByScenario: Readonly<Record<Scenario, number>>;
  readonly liquidityBaselineId: string;
  readonly trailingCostsIsPlaceholder: boolean;
}

export interface SeedOperationsResult {
  readonly operations: readonly AdminDataOperation[];
  readonly summary: SeedOperationsSummary;
}

export function buildSeedOperations(
  trailingCosts: TrailingCostsInput,
): SeedOperationsResult {
  const waterHeaterAsset: Asset = {
    id: WATER_HEATER_ASSET_ID,
    name: "Lämminvesivaraajat",
    category: "hvac",
    sourceIds: [EXCEL_LONG_TERM_SOURCE_ID],
    active: true,
  };

  const ventilationAsset: Asset = {
    id: VENTILATION_ASSET_ID,
    name: "Ilmanvaihto",
    category: "hvac",
    sourceIds: [EXCEL_CURRENT_PERIOD_SOURCE_ID],
    active: true,
  };

  const waterHeaterCostEvidence: CostEvidence = {
    id: WATER_HEATER_COST_EVIDENCE_ID,
    assetId: WATER_HEATER_ASSET_ID,
    status: "estimate",
    amount: WATER_HEATER_UNIT_PRICE,
    unit: "kpl",
    priceLevelYear: 2026,
    sourceId: EXCEL_LONG_TERM_SOURCE_ID,
    notes:
      "Karkea arvio (ei muistettu tarkkaa summaa) - tärkeä tarkentaa seuraavan vaihdon yhteydessä.",
  };

  const ventilationCleaningCostEvidence: CostEvidence = {
    id: VENTILATION_CLEANING_COST_EVIDENCE_ID,
    assetId: VENTILATION_ASSET_ID,
    status: "data_gap",
    unit: "erä",
    priceLevelYear: 2026,
    sourceId: EXCEL_CURRENT_PERIOD_SOURCE_ID,
    notes:
      "Hallituksen kunnossapitotarveselvitys 2024-2028. Suunniteltu korjaus, hinta ei tiedossa.",
  };

  const schedule = buildScheduleRows();

  const waterHeaterEvent: BuildingEvent = {
    id: WATER_HEATER_EVENT_ID,
    assetId: WATER_HEATER_ASSET_ID,
    title: "Varaajien uusiminen",
    type: "replacement",
    status: "suggested",
    origin: "initial_excel",
    sourceIds: [EXCEL_LONG_TERM_SOURCE_ID],
    schedule,
  };

  const liquidityBaseline: LiquidityBaselineRecord = {
    id: LIQUIDITY_BASELINE_ID,
    asOfDate: "2025-12-31",
    currentCash: 22_208.49,
    currentAnnualRepairCollection: 9_680,
    trailing12mOperatingCosts: trailingCosts.value,
    sourceIds: [EXCEL_CURRENT_PERIOD_SOURCE_ID, ...trailingCosts.sourceIds],
    notes: trailingCosts.notes,
  };

  const operations: AdminDataOperation[] = [
    {
      type: "save_asset",
      value: waterHeaterAsset,
      sourceIds: [EXCEL_LONG_TERM_SOURCE_ID],
      explanation: "Seed-alkudata: lämminvesivaraajat-rakennusosa Excel-terminaalista.",
    },
    {
      type: "save_asset",
      value: ventilationAsset,
      sourceIds: [EXCEL_CURRENT_PERIOD_SOURCE_ID],
      explanation: "Seed-alkudata: ilmanvaihto-rakennusosa Excel-terminaalista.",
    },
    {
      type: "save_cost_evidence",
      value: waterHeaterCostEvidence,
      sourceIds: [EXCEL_LONG_TERM_SOURCE_ID],
      explanation: "Seed-alkudata: varaajan yksikköhinta Excel-terminaalista (karkea arvio).",
    },
    {
      type: "save_cost_evidence",
      value: ventilationCleaningCostEvidence,
      sourceIds: [EXCEL_CURRENT_PERIOD_SOURCE_ID],
      explanation:
        "Seed-alkudata: ilmanvaihdon puhdistus, DATA GAP - suunniteltu korjaus ilman hintaa.",
    },
    {
      type: "save_building_event",
      value: waterHeaterEvent,
      sourceIds: [EXCEL_LONG_TERM_SOURCE_ID],
      explanation:
        "Seed-alkudata: varaajien uusimisen eksplisiittinen skenaarioaikataulu Excel-terminaalista.",
    },
    {
      type: "save_liquidity_baseline",
      value: liquidityBaseline,
      sourceIds: [EXCEL_CURRENT_PERIOD_SOURCE_ID, ...trailingCosts.sourceIds],
      explanation: "Seed-alkudata: kuluvan kauden 2026 likviditeetin lähtötiedot.",
    },
  ];

  const scheduleQuantityByScenario = quantityByScenario(schedule);

  return {
    operations,
    summary: {
      assetIds: [WATER_HEATER_ASSET_ID, VENTILATION_ASSET_ID],
      costEvidenceIds: [
        WATER_HEATER_COST_EVIDENCE_ID,
        VENTILATION_CLEANING_COST_EVIDENCE_ID,
      ],
      eventId: WATER_HEATER_EVENT_ID,
      scheduleRowCount: schedule.length,
      scheduleQuantityByScenario,
      liquidityBaselineId: LIQUIDITY_BASELINE_ID,
      trailingCostsIsPlaceholder: trailingCosts.isPlaceholder,
    },
  };
}

function buildScheduleRows(): readonly EventScheduleEntry[] {
  // Amount is set explicitly (quantity x unit price) rather than left
  // undefined: projectEvents only allows an omitted amount when the linked
  // cost evidence is itself a data_gap, and cost_varaaja_yksikko is an
  // "estimate" with a real amount. A suggested event is re-validated here
  // as an approved copy (see adminDataValidation.ts), so this rule already
  // applies at seed time, not only after approval.
  return (Object.entries(WATER_HEATER_SCHEDULE_ROWS) as [
    Scenario,
    readonly (readonly [number, number])[],
  ][]).flatMap(([scenario, rows]) =>
    rows.map(([year, quantity]) => ({
      id: `${scenario}_${year}`,
      scenario,
      year,
      quantity,
      amount: quantity * WATER_HEATER_UNIT_PRICE,
      costEvidenceId: WATER_HEATER_COST_EVIDENCE_ID,
      explanation: `Excelin "Pitkä aikaväli" -taulukon ${scenario}-rivi: ${quantity} kpl vuonna ${year}.`,
    }))
  );
}

function quantityByScenario(
  schedule: readonly EventScheduleEntry[],
): Readonly<Record<Scenario, number>> {
  const totals: Record<Scenario, number> = { optimistic: 0, base: 0, stress: 0 };
  for (const entry of schedule) {
    totals[entry.scenario] += entry.quantity ?? 0;
  }
  return totals;
}

/**
 * The workbook fixture value is not a guess: it is the same "Hoito
 * yhteensä 2025" figure (Kulut!B19, 34 029.46 EUR) already cited as the
 * corrected trailing-12m operating-cost source in
 * src/fixtures/liquidityBaseline.ts. Using it here still requires an
 * explicit opt-in so it can never reach a real company silently.
 */
export const TRAILING_12M_OPERATING_COSTS_PLACEHOLDER = 34_029.46;
export const TRAILING_12M_PLACEHOLDER_SOURCE_ID =
  "kulut_valilehti_hoito_yhteensa_2025_PLACEHOLDER";

export interface SeedEnv {
  readonly TM_TRAILING_12M_OPERATING_COSTS?: string;
  readonly TM_ALLOW_PLACEHOLDER?: string;
}

export class TrailingCostsDataGapError extends Error {}

/**
 * Resolves the trailing-12m operating-cost DATA GAP from the environment.
 * Throws unless a confirmed value or an explicit placeholder opt-in is
 * given - the seed must never guess silently.
 */
export function resolveTrailingCosts(env: SeedEnv): TrailingCostsInput {
  const rawConfirmed = env.TM_TRAILING_12M_OPERATING_COSTS;
  if (rawConfirmed !== undefined && rawConfirmed.trim() !== "") {
    const value = Number(rawConfirmed);
    if (!Number.isFinite(value) || value < 0) {
      throw new TrailingCostsDataGapError(
        `TM_TRAILING_12M_OPERATING_COSTS="${rawConfirmed}" is not a valid non-negative number.`,
      );
    }
    return {
      value,
      sourceIds: ["manual_confirmed_trailing_12m_2026"],
      notes: "12 kk hoitokulut vahvistettu ajohetkellä (TM_TRAILING_12M_OPERATING_COSTS).",
      isPlaceholder: false,
    };
  }

  if (env.TM_ALLOW_PLACEHOLDER === "1") {
    return {
      value: TRAILING_12M_OPERATING_COSTS_PLACEHOLDER,
      sourceIds: [TRAILING_12M_PLACEHOLDER_SOURCE_ID],
      notes:
        "PAIKKAMERKKI - trailing12mOperatingCosts johdettu Kulut-valilehden " +
        "\"Hoito yhteensa 2025\" -luvusta (34 029,46 e), koska Excelin " +
        "\"Kuluva kausi 2026\" ei anna 12 kk hoitokuluja. VAHVISTETTAVA " +
        "tilinpaatoksesta tai muusta luotettavasta lahteesta ennen kuin " +
        "tata lukua kaytetaan paatoksenteossa.",
      isPlaceholder: true,
    };
  }

  throw new TrailingCostsDataGapError(
    "DATA GAP: trailing12mOperatingCosts (12 kk hoitokulut) puuttuu Excelistä " +
      "(\"Kuluva kausi 2026\" ei anna sitä). Anna oikea, vahvistettu luku " +
      "ympäristömuuttujassa TM_TRAILING_12M_OPERATING_COSTS, tai aja " +
      "TM_ALLOW_PLACEHOLDER=1 jos hyväksyt näkyvästi merkityn " +
      "paikkamerkkiarvon (34 029.46, Kulut-välilehden Hoito yhteensä 2025).",
  );
}

export interface SeedWorkspace {
  readonly assets: readonly { readonly id: string }[];
}

/** Refuses a second run so manual edits after the first seed are never overwritten. */
export function shouldRunSeed(workspace: SeedWorkspace): boolean {
  return !workspace.assets.some((asset) => asset.id === WATER_HEATER_ASSET_ID);
}
