/**
 * One-time seed for vaihe 2B-2: pushes the water-heater (long-term) and
 * "Kuluva kausi 2026" data from the source Excel into housing_company_demo
 * through the app's own admin HTTP API. See scripts/README.md for how to
 * run this and what environment variables it needs.
 *
 * This script never runs automatically and never runs twice: it first
 * loads the current admin workspace and refuses if the seed data already
 * exists there.
 */
import {
  TrailingCostsDataGapError,
  buildSeedOperations,
  resolveTrailingCosts,
  shouldRunSeed,
  type SeedWorkspace,
} from "./seedOperations.js";

const DEFAULT_TARGET_URL = "http://127.0.0.1:8787";
const COMPANY_ID = process.env.TM_COMPANY_ID?.trim() || "housing_company_demo";
const HORIZON = { startYear: 2026, endYear: 2057 };

interface AdminErrorBody {
  readonly error?: { readonly code?: string; readonly message?: string };
}

async function main(): Promise<void> {
  const token = process.env.TM_ADMIN_TOKEN?.trim();
  if (!token) {
    fail(
      "TM_ADMIN_TOKEN puuttuu. Aseta ympäristömuuttujaksi kirjautuneen " +
        "adminin Supabase-sessiotoken (ei service-role-avainta). Katso " +
        "scripts/README.md.",
    );
  }

  const targetUrl = (process.argv[2] ?? process.env.TM_TARGET_URL ?? DEFAULT_TARGET_URL)
    .replace(/\/+$/, "");

  let trailingCosts;
  try {
    const rawTrailingCosts = process.env.TM_TRAILING_12M_OPERATING_COSTS;
    const rawAllowPlaceholder = process.env.TM_ALLOW_PLACEHOLDER;
    trailingCosts = resolveTrailingCosts({
      ...(rawTrailingCosts === undefined ? {} : { TM_TRAILING_12M_OPERATING_COSTS: rawTrailingCosts }),
      ...(rawAllowPlaceholder === undefined ? {} : { TM_ALLOW_PLACEHOLDER: rawAllowPlaceholder }),
    });
  } catch (error) {
    if (error instanceof TrailingCostsDataGapError) {
      fail(error.message);
    }
    throw error;
  }

  if (trailingCosts.isPlaceholder) {
    console.warn(
      "\n⚠ VAROITUS: trailing12mOperatingCosts on PAIKKAMERKKI (34 029.46 e, " +
        "Kulut-välilehden \"Hoito yhteensä 2025\"), ei vahvistettu 12 kk " +
        "hoitokululuku. Tarkista tämä ennen kuin likviditeettinäkymään " +
        "luotetaan.\n",
    );
  }

  console.log(`Kohde: ${targetUrl}, yhtiö: ${COMPANY_ID}`);

  const workspace = await getJson<SeedWorkspace & { readonly adminRevision: number }>(
    `${targetUrl}/api/v1/admin/companies/${COMPANY_ID}/workspace` +
      `?startYear=${HORIZON.startYear}&endYear=${HORIZON.endYear}`,
    token,
  );

  if (!shouldRunSeed(workspace)) {
    console.log("Seed on jo ajettu, ei tehdä mitään.");
    return;
  }

  const { operations, summary } = buildSeedOperations(trailingCosts);

  const response = await fetch(
    `${targetUrl}/api/v1/admin/companies/${COMPANY_ID}/changes`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        expectedRevision: workspace.adminRevision,
        horizon: HORIZON,
        operations,
      }),
    },
  );

  const body = (await response.json()) as AdminErrorBody & { adminRevision?: number };
  if (!response.ok) {
    fail(
      `Seed epäonnistui (HTTP ${response.status}): ` +
        `${body.error?.code ?? "UNKNOWN"} - ${body.error?.message ?? "no message"}`,
    );
  }

  console.log("Seed onnistui.");
  console.log(`Uusi adminRevision: ${body.adminRevision}`);
  console.log(`Luotiin ${summary.assetIds.length} rakennusosaa: ${summary.assetIds.join(", ")}`);
  console.log(
    `Luotiin ${summary.costEvidenceIds.length} kustannusnäyttöä: ${summary.costEvidenceIds.join(", ")}`,
  );
  console.log(
    `Luotiin tapahtuma ${summary.eventId} (${summary.scheduleRowCount} schedule-riviä; ` +
      `optimistic=${summary.scheduleQuantityByScenario.optimistic}, ` +
      `base=${summary.scheduleQuantityByScenario.base}, ` +
      `stress=${summary.scheduleQuantityByScenario.stress} kpl).`,
  );
  console.log(`Luotiin likviditeetin lähtötieto ${summary.liquidityBaselineId}.`);
  if (summary.trailingCostsIsPlaceholder) {
    console.log(
      "⚠ trailing12mOperatingCosts on yhä paikkamerkki - tarkenna ja aja uusi " +
        "save_liquidity_baseline-muutos UI:sta kun oikea luku on vahvistettu.",
    );
  }
}

async function getJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as AdminErrorBody & Record<string, unknown>;
  if (!response.ok) {
    fail(
      `Työtilan haku epäonnistui (HTTP ${response.status}): ` +
        `${body.error?.code ?? "UNKNOWN"} - ${body.error?.message ?? "no message"}`,
    );
  }
  return body as T;
}

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error("Odottamaton virhe seed-ajossa:");
  console.error(error);
  process.exit(1);
});
