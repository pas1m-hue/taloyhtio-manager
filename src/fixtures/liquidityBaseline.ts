/**
 * Corrected-workbook baseline inputs used only as transparent V1.9 fixtures.
 *
 * - cash: 31.12.2025 money and bank deposits
 * - operating costs: 2025 realised maintenance costs excluding repairs
 * - annual repair collection proxy: 2026 repair budget line; the workbook does
 *   not identify a separate earmarked repair charge
 */
export const correctedWorkbookLiquidityBaseline = {
  currentCash: 22_208.49,
  trailing12mOperatingCosts: 34_029.46,
  currentAnnualRepairCollection: 9_680,
  sources: {
    currentCash: "Taloudellinen asema!C14",
    trailing12mOperatingCosts: "Kulut!B19",
    currentAnnualRepairCollection: "Kulut!L14",
  },
  notes: {
    currentAnnualRepairCollection:
      "Proxy from the 2026 repair budget, not a separately earmarked charge.",
  },
} as const;
