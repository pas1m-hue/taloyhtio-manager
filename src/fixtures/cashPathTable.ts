import type {
  Asset,
  BalanceSheetSnapshot,
  BuildingEvent,
  CostEvidence,
  FinancialAccount,
  FinancialEntry,
  GroupActual,
  GroupBudget,
} from "../domain/types.js";

/**
 * A company whose cash path table (feature/cashpath-rebuild) has every kind
 * of row: three closed years, one budget year, two balance sheets and a
 * repair plan that runs past the maintenance plan's coverage.
 *
 * SEPARATE FROM financialActualsFixture ON PURPOSE. That fixture's repair
 * years are the trailing-12m divisor's worked sample, and adding a 2023
 * repair row to it would move every figure those tests pin. This one shares
 * 2025 with it (the year confirmed against production) and states 2023 and
 * 2024 from plausible parts of its own.
 *
 * THE PARTS ARE THE POINT, NOT THE TOTALS. The handoff quotes hoitokate as
 * 4 321 / 10 010 / 9 877 for 2023-2025, but the first two are the author's
 * own arithmetic and were never checked against production, so this fixture
 * does not reverse-engineer its rows to land on them. Each year is a sum of
 * named account rows, and the tests prove the calculation from the parts;
 * the production figures are checked in the live test.
 *
 *   2023  income  37 207,38 = 36 237,38 (group-level) + 720,00 + 250,00
 *         costs   32 886,00 = 11 480,00 + 20 021,00 + 1 385,00 repairs
 *   2024  income  42 644,00 = 41 900,00 + 744,00
 *         costs   37 848,53 = 12 000,00 + 20 500,00 + 5 348,53 repairs
 *   2025  income  43 906,75 = 43 150,75 + 756,00 + 0,00
 *         costs   37 911,01 = 13 100,20 + 20 929,26 + 3 881,55 repairs
 *   2026  budget  income 42 714,26 = 41 958,26 + 756,00
 *         budget  costs  42 935,71 = 13 000,00 + 20 255,71 + 9 680,00 repairs,
 *                 where the repair figure is a group-level budget overriding
 *                 the 4600 account's own 9 000,00
 *
 * Balance sheets close 2024 (16 977,00 cash) and 2025 (22 208,00 cash); there
 * is none for 2023, so that year's cash columns have nothing to show.
 */
const SOURCE_2023 = "tilinpaatos_2023";
const SOURCE_2024 = "tilinpaatos_2024";
const SOURCE_2025 = "tilinpaatos_2025";
const SOURCE_BUDGET = "talousarvio";

export const cashPathFinancialAccounts: readonly FinancialAccount[] = [
  { accountCode: "3010", name: "Hoitovastikkeet", kind: "income", group: "Hoitovastikkeet", active: true },
  { accountCode: "3110", name: "Vuokratuotot", kind: "income", group: "Vuokrat", active: true },
  { accountCode: "3200", name: "Muut tuotot", kind: "income", group: "Muut tuotot", active: true },
  { accountCode: "4010", name: "Hallinto", kind: "expense", group: "Hallinto", nature: "maintenance", active: true },
  { accountCode: "4200", name: "Lämmitys", kind: "expense", group: "Lämmitys", nature: "maintenance", active: true },
  { accountCode: "4600", name: "Korjaukset", kind: "expense", group: "KORJAUKSET", nature: "repair", active: true },
];

export const cashPathFinancialEntries: readonly FinancialEntry[] = [
  // 2023 - part of the income is group-level, see cashPathGroupActuals.
  { accountCode: "3010", year: 2023, actualAmount: 3_527.50, budgetAmount: 36_000.00, sourceIds: [SOURCE_2023] },
  { accountCode: "3110", year: 2023, actualAmount: 720.00, sourceIds: [SOURCE_2023] },
  { accountCode: "3200", year: 2023, actualAmount: 250.00, sourceIds: [SOURCE_2023] },
  { accountCode: "4010", year: 2023, actualAmount: -11_480.00, budgetAmount: -11_300.00, sourceIds: [SOURCE_2023] },
  { accountCode: "4200", year: 2023, actualAmount: -20_021.00, budgetAmount: -19_700.00, sourceIds: [SOURCE_2023] },
  { accountCode: "4600", year: 2023, actualAmount: -1_385.00, budgetAmount: -3_000.00, sourceIds: [SOURCE_2023] },
  // 2024
  { accountCode: "3010", year: 2024, actualAmount: 41_900.00, budgetAmount: 41_500.00, sourceIds: [SOURCE_2024] },
  { accountCode: "3110", year: 2024, actualAmount: 744.00, sourceIds: [SOURCE_2024] },
  { accountCode: "4010", year: 2024, actualAmount: -12_000.00, budgetAmount: -11_800.00, sourceIds: [SOURCE_2024] },
  { accountCode: "4200", year: 2024, actualAmount: -20_500.00, budgetAmount: -20_100.00, sourceIds: [SOURCE_2024] },
  { accountCode: "4600", year: 2024, actualAmount: -5_348.53, budgetAmount: -8_000.00, sourceIds: [SOURCE_2024] },
  // 2025 - the year confirmed against production.
  { accountCode: "3010", year: 2025, actualAmount: 43_150.75, budgetAmount: 42_000.00, sourceIds: [SOURCE_2025] },
  { accountCode: "3110", year: 2025, actualAmount: 756.00, budgetAmount: 700.00, sourceIds: [SOURCE_2025] },
  { accountCode: "3200", year: 2025, actualAmount: 0.00, sourceIds: [SOURCE_2025] },
  { accountCode: "4010", year: 2025, actualAmount: -13_100.20, budgetAmount: -12_950.00, sourceIds: [SOURCE_2025] },
  { accountCode: "4200", year: 2025, actualAmount: -20_929.26, budgetAmount: -20_400.00, sourceIds: [SOURCE_2025] },
  { accountCode: "4600", year: 2025, actualAmount: -3_881.55, budgetAmount: -9_400.00, sourceIds: [SOURCE_2025] },
  // 2026 - budget only; no actual has been closed yet.
  { accountCode: "3010", year: 2026, budgetAmount: 41_958.26, sourceIds: [SOURCE_BUDGET] },
  { accountCode: "3110", year: 2026, budgetAmount: 756.00, sourceIds: [SOURCE_BUDGET] },
  { accountCode: "4010", year: 2026, budgetAmount: -13_000.00, sourceIds: [SOURCE_BUDGET] },
  { accountCode: "4200", year: 2026, budgetAmount: -20_255.71, sourceIds: [SOURCE_BUDGET] },
  { accountCode: "4600", year: 2026, budgetAmount: -9_000.00, sourceIds: [SOURCE_BUDGET] },
];

export const cashPathGroupActuals: readonly GroupActual[] = [
  {
    id: "ga_income_hoitovastikkeet_2023",
    group: "Hoitovastikkeet",
    kind: "income",
    year: 2023,
    actualAmount: 36_237.38,
    active: true,
    sourceIds: [SOURCE_2023],
  },
];

/** The yhtiökokous approved 9 680,00 for repairs; the account row says 9 000,00. */
export const cashPathGroupBudgets: readonly GroupBudget[] = [
  {
    id: "gb_expense_korjaukset_2026",
    group: "KORJAUKSET",
    kind: "expense",
    year: 2026,
    budgetAmount: -9_680.00,
    active: true,
    sourceIds: [SOURCE_BUDGET],
  },
];

export const cashPathBalanceSheets: readonly BalanceSheetSnapshot[] = [
  {
    id: "tase_2024",
    asOfDate: "2024-12-31",
    sourceIds: [SOURCE_2024],
    entries: [
      { section: "current_assets", key: "myyntisaamiset", name: "Myyntisaamiset", amount: 412.00 },
      { section: "current_assets", key: "rahat", name: "Rahat ja pankkisaamiset", amount: 16_977.00 },
      { section: "unrestricted_equity", key: "voittovarat", name: "Edellisten tilikausien voitto", amount: 17_389.00 },
    ],
  },
  {
    id: "tase_2025",
    asOfDate: "2025-12-31",
    sourceIds: [SOURCE_2025],
    entries: [
      { section: "current_assets", key: "myyntisaamiset", name: "Myyntisaamiset", amount: 722.00 },
      // Matched by name, not key - the paste importer does not always give
      // the cash line the "rahat" key.
      { section: "current_assets", key: "ca_02", name: "Rahat ja pankkisaamiset", amount: 22_208.00 },
      { section: "unrestricted_equity", key: "voittovarat", name: "Edellisten tilikausien voitto", amount: 22_930.00 },
    ],
  },
];

export const cashPathAssets: readonly Asset[] = [
  { id: "asset_ventilation", name: "Ilmanvaihto", category: "hvac", sourceIds: ["pts_2024"], active: true },
  { id: "asset_facade", name: "Julkisivut", category: "envelope", sourceIds: ["pts_2024"], active: true },
  { id: "asset_water_heaters", name: "Lämminvesivaraajat", category: "hvac", sourceIds: ["pts_2024"], active: true },
];

export const cashPathCostEvidence: readonly CostEvidence[] = [
  { id: "K_iv", assetId: "asset_ventilation", eventId: "event_iv_2026", status: "estimate", amount: 2_500, unit: "total", priceLevelYear: 2026, sourceId: "pts_2024" },
  { id: "K_facade", assetId: "asset_facade", eventId: "event_facade_2027", status: "quote", amount: 15_000, unit: "total", priceLevelYear: 2026, sourceId: "facade_quote_2026" },
  { id: "K_heater", assetId: "asset_water_heaters", status: "estimate", amount: 1_800, unit: "one_installed_water_heater", quantity: 1, priceLevelYear: 2026, sourceId: "pts_2024" },
  { id: "K_yard_gap", assetId: "asset_facade", eventId: "event_yard_2028", status: "data_gap", unit: "total", priceLevelYear: 2026, sourceId: "pts_2024" },
  { id: "K_iv_actual", assetId: "asset_ventilation", eventId: "event_iv_2025_actual", status: "actual", amount: 1_545, unit: "total", quantity: 1, priceLevelYear: 2025, sourceId: SOURCE_2025 },
];

export const cashPathEvents: readonly BuildingEvent[] = [
  {
    id: "event_iv_2026",
    assetId: "asset_ventilation",
    title: "Ilmanvaihdon puhdistus",
    type: "cleaning",
    origin: "manual",
    status: "approved",
    sourceIds: ["pts_2024"],
    schedule: [
      { id: "iv_o", scenario: "optimistic", year: 2026, amount: 2_500, costEvidenceId: "K_iv" },
      { id: "iv_b", scenario: "base", year: 2026, amount: 2_500, costEvidenceId: "K_iv" },
      { id: "iv_s", scenario: "stress", year: 2026, amount: 2_500, costEvidenceId: "K_iv" },
    ],
  },
  {
    id: "event_facade_2027",
    assetId: "asset_facade",
    title: "Julkisivujen huoltomaalaus",
    type: "maintenance",
    origin: "manual",
    status: "approved",
    sourceIds: ["pts_2024"],
    schedule: [
      { id: "fa_o", scenario: "optimistic", year: 2028, amount: 15_000, costEvidenceId: "K_facade" },
      { id: "fa_b", scenario: "base", year: 2027, amount: 15_000, costEvidenceId: "K_facade" },
      { id: "fa_s", scenario: "stress", year: 2027, amount: 15_000, costEvidenceId: "K_facade" },
    ],
  },
  {
    // One heater in the budget year in every scenario; the rest fan out past
    // the maintenance plan's coverage (2030) in the base and stress cases.
    id: "event_heaters",
    assetId: "asset_water_heaters",
    title: "Varaajien uusiminen",
    type: "replacement",
    origin: "manual",
    status: "approved",
    sourceIds: ["pts_2024"],
    schedule: [
      { id: "wh_o1", scenario: "optimistic", year: 2026, quantity: 1, amount: 1_800, costEvidenceId: "K_heater" },
      { id: "wh_o2", scenario: "optimistic", year: 2032, quantity: 1, amount: 1_800, costEvidenceId: "K_heater" },
      { id: "wh_b1", scenario: "base", year: 2026, quantity: 1, amount: 1_800, costEvidenceId: "K_heater" },
      { id: "wh_b2", scenario: "base", year: 2029, quantity: 2, amount: 3_600, costEvidenceId: "K_heater" },
      { id: "wh_b3", scenario: "base", year: 2033, quantity: 2, amount: 3_600, costEvidenceId: "K_heater" },
      { id: "wh_s1", scenario: "stress", year: 2026, quantity: 2, amount: 3_600, costEvidenceId: "K_heater" },
      { id: "wh_s2", scenario: "stress", year: 2028, quantity: 3, amount: 5_400, costEvidenceId: "K_heater" },
      { id: "wh_s3", scenario: "stress", year: 2033, quantity: 2, amount: 3_600, costEvidenceId: "K_heater" },
    ],
  },
  {
    // A stress-only DATA GAP inside the coverage window.
    id: "event_yard_2028",
    assetId: "asset_facade",
    title: "Piha-alueen salaojat",
    type: "repair",
    origin: "manual",
    status: "approved",
    sourceIds: ["pts_2024"],
    schedule: [
      { id: "yd_s", scenario: "stress", year: 2028, costEvidenceId: "K_yard_gap" },
    ],
  },
  {
    id: "event_iv_2025_actual",
    assetId: "asset_ventilation",
    title: "IV-putkien eristys",
    type: "repair",
    origin: "manual",
    status: "actual",
    sourceIds: [SOURCE_2025],
    actual: { year: 2025, occurredAt: "2025-11-14", amount: 1_545, quantity: 1, costEvidenceId: "K_iv_actual" },
  },
  {
    id: "event_suggested",
    assetId: "asset_facade",
    title: "Sokkelin kosteuseristys",
    type: "repair",
    origin: "manual",
    status: "suggested",
    sourceIds: ["pts_2024"],
    schedule: [
      { id: "so_b", scenario: "base", year: 2029, amount: 15_000, costEvidenceId: "K_facade" },
    ],
  },
];
