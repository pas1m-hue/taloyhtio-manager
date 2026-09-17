/**
 * Corrected-workbook baseline input used only as a transparent V1.9 fixture:
 * cash is the 31.12.2025 money and bank deposits. The operating figures the
 * workbook also carried (Kulut!B19 costs, Kulut!L14 repair-budget proxy) are
 * computed from the account data now and no longer stored on the record.
 */
export const correctedWorkbookLiquidityBaseline = {
  currentCash: 22_208.49,
  sources: {
    currentCash: "Taloudellinen asema!C14",
  },
} as const;

/**
 * The workbook's operating figures, kept as inputs for the pure calculation
 * tests (buffer, cash path, required collection). In the application these
 * are computed from the account data, never stored:
 *
 * - operating costs: 2025 realised maintenance costs excluding repairs (Kulut!B19)
 * - operating margin proxy: 2026 repair budget line (Kulut!L14); the workbook
 *   does not identify a separate earmarked repair charge
 */
export const correctedWorkbookOperatingFigures = {
  trailing12mOperatingCosts: 34_029.46,
  currentAnnualOperatingMargin: 9_680,
} as const;
