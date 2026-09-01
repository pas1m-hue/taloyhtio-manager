// @ts-check
/**
 * Static cross-check between public/index.html and public/app.js. No jsdom,
 * no browser driver: this reads both files as text and verifies that every
 * `#id` CSS selector app.js references resolves to an id that actually
 * exists somewhere — either as a static `id="..."` attribute in index.html,
 * or as an `id="..."` inside markup app.js itself renders (form fields built
 * from template literals), or as a `.id = "..."` assignment for elements
 * app.js creates at runtime. It also checks that the view router's
 * `KNOWN_VIEWS` set and the sidebar's nav-link `data-view` values line up
 * exactly with the `data-view` attributes on `.view` sections.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const htmlPath = fileURLToPath(new URL("./index.html", import.meta.url));
const jsPath = fileURLToPath(new URL("./app.js", import.meta.url));
const html = readFileSync(htmlPath, "utf8");
const js = readFileSync(jsPath, "utf8");

/**
 * IDs referenced as CSS id selectors anywhere in app.js, e.g. from
 * `$("#foo")`, `$$("#foo .bar")`, or `clearFieldErrors("#foo-form")`.
 * Interpolated ids such as `` `#${id}-error` `` are skipped on purpose: the
 * character right after `#` is `$`, not a letter, so they never match.
 * @param {string} source
 * @returns {Set<string>}
 */
function referencedIds(source) {
  const ids = new Set();
  for (const match of source.matchAll(/#([A-Za-z][\w-]*)/g)) {
    ids.add(match[1]);
  }
  return ids;
}

/** Field-builder helpers in app.js whose first argument is the field's id. */
const FIELD_HELPERS = [
  "textField", "numberField", "selectField", "checkboxField",
  "dateField", "textareaField",
];

/**
 * IDs defined anywhere as a literal `id="..."` attribute (static HTML or a
 * template literal that renders HTML), ids assigned via
 * `element.id = "..."` for elements created at runtime, and ids passed as
 * the first argument to app.js's field-builder helpers (their `id="${id}"`
 * template interpolation means the id never appears literally next to
 * `id=`, only as that call argument).
 * @param {string} source
 * @returns {Set<string>}
 */
function definedIds(source) {
  const ids = new Set();
  for (const match of source.matchAll(/\bid=["']([\w-]+)["']/g)) {
    ids.add(match[1]);
  }
  for (const match of source.matchAll(/\.id\s*=\s*["']([\w-]+)["']/g)) {
    ids.add(match[1]);
  }
  const helperPattern = new RegExp(
    `\\b(?:${FIELD_HELPERS.join("|")})\\(\\s*["']([\\w-]+)["']`, "g",
  );
  for (const match of source.matchAll(helperPattern)) {
    ids.add(match[1]);
  }
  return ids;
}

describe("static id cross-check (index.html <-> app.js)", () => {
  it("resolves every #id selector app.js references to a real element id", () => {
    const referenced = referencedIds(js);
    const defined = new Set([...definedIds(html), ...definedIds(js)]);
    const missing = [...referenced].filter((id) => !defined.has(id)).sort();
    expect(missing).toEqual([]);
  });

  it("has at least the ids the maintenance views rely on", () => {
    const defined = new Set([...definedIds(html), ...definedIds(js)]);
    for (const id of [
      "observations-list", "observations-kpis", "observations-new",
      "observations-filter-asset", "observations-filter-from",
      "observations-filter-to", "observations-filter-search",
      "events-list", "events-kpis", "events-new",
      "events-filter-year", "events-filter-status", "events-filter-type",
      "events-filter-asset", "events-filter-gap-only",
      "cost-evidence-list", "cost-evidence-kpis", "cost-evidence-new",
      "cost-evidence-filter-status", "cost-evidence-filter-asset",
      "cost-evidence-filter-gap-only", "detail-panel", "detail-panel-title",
      "detail-panel-body",
      "finance-import-form", "finance-import-text", "finance-import-source-ids",
      "finance-import-explanation", "finance-import-preview",
      "finance-import-feedback", "finance-import-submit",
      "finance-costs-account-body",
      "finance-income-body", "finance-costs-group-body",
      "finance-budget-filter-year", "finance-budget-body",
      "balance-import-form", "balance-import-id", "balance-import-as-of-date",
      "balance-import-text", "balance-import-source-ids", "balance-import-explanation",
      "balance-import-preview", "balance-import-feedback", "balance-import-submit",
      "finance-position-snapshot", "finance-position-compare", "finance-position-selector", "finance-position-body",
    ]) {
      expect(defined.has(id), `expected #${id} to be defined`).toBe(true);
    }
  });
});

// This only proves the wireSourceIdsPrefill(...) call sites exist and point
// at real field ids — it cannot exercise the actual "type in source field,
// see op field update live" behavior without a DOM (jsdom is deliberately
// out of scope here). Verify that behavior manually: open the asset (or
// observation) editor in "new" mode, type into the entity source-ids field,
// confirm the operation source-ids field mirrors it, then type into the
// operation field directly and confirm further edits to the entity field no
// longer overwrite it.
describe("static source-ids prefill wiring (app.js -> field ids)", () => {
  it("wires wireSourceIdsPrefill for each entity/operation source-id field pair", () => {
    const defined = new Set([...definedIds(html), ...definedIds(js)]);
    const wired = new Set(
      [...js.matchAll(/wireSourceIdsPrefill\("([\w-]+)",\s*"([\w-]+)"\)/g)]
        .map((m) => `${m[1]}->${m[2]}`),
    );
    for (const pair of [
      "asset-source-ids->asset-op-source-ids",
      "observation-source-ids->observation-op-source-ids",
      "event-source-ids->event-op-source-ids",
    ]) {
      expect(wired.has(pair), `expected wireSourceIdsPrefill("${pair.replace("->", '", "')}") to be called`).toBe(true);
    }
    for (const pair of wired) {
      const [sourceId, opId] = pair.split("->");
      expect(defined.has(sourceId), `expected #${sourceId} to be a real field id`).toBe(true);
      expect(defined.has(opId), `expected #${opId} to be a real field id`).toBe(true);
    }
  });
});

/**
 * Ids toggled via a direct `$("#id").disabled = ...` assignment in app.js.
 * @param {string} source
 * @returns {Set<string>}
 */
function directlyToggledIds(source) {
  const ids = new Set();
  for (const match of source.matchAll(/\$\("#([\w-]+)"\)\.disabled\s*=/g)) {
    ids.add(match[1]);
  }
  return ids;
}

/**
 * Ids toggled via a `for (const x of ["#a", "#b"]) { $(x).disabled = ... }`
 * loop in app.js, e.g. renderAuthStatus()'s sign-in gate. Requires the loop
 * body to dereference the same loop variable, so unrelated loops don't
 * produce false matches.
 * @param {string} source
 * @returns {Set<string>}
 */
function loopToggledIds(source) {
  const ids = new Set();
  const loopPattern = /for \(const (\w+) of \[([^\]]*)\]\)\s*\{\s*\$\(\1\)\.disabled\s*=/g;
  for (const match of source.matchAll(loopPattern)) {
    for (const idMatch of match[2].matchAll(/#([\w-]+)/g)) {
      ids.add(idMatch[1]);
    }
  }
  return ids;
}

describe("static disabled/enabled toggle cross-check (index.html <-> app.js)", () => {
  it("wires an enable path in app.js for every element that starts out disabled in index.html", () => {
    const staticallyDisabled = [...html.matchAll(/\bid="([\w-]+)"[^>]*\bdisabled\b/g)]
      .map((m) => m[1]);
    const toggled = new Set([...directlyToggledIds(js), ...loopToggledIds(js)]);
    const missing = [...new Set(staticallyDisabled)].filter((id) => !toggled.has(id)).sort();
    expect(
      missing,
      "these ids start disabled in index.html but app.js never sets their .disabled property, so they can never become interactive",
    ).toEqual([]);
  });
});

describe("static view cross-check (KNOWN_VIEWS <-> data-view sections)", () => {
  /** @returns {string[]} */
  function knownViews() {
    const match = js.match(/const KNOWN_VIEWS = new Set\(\[([\s\S]*?)\]\);/);
    if (!match) throw new Error("KNOWN_VIEWS declaration not found in app.js");
    return [...match[1].matchAll(/"([\w-]+)"/g)].map((m) => m[1]);
  }

  /** @returns {string[]} */
  function htmlViewSections() {
    return [...html.matchAll(/<section class="view" data-view="([\w-]+)"/g)].map((m) => m[1]);
  }

  /** @returns {string[]} */
  function navLinkViews() {
    return [...html.matchAll(/class="nav-link"[^>]*data-view="([\w-]+)"/g)].map((m) => m[1]);
  }

  it("declares exactly one KNOWN_VIEWS entry per <section data-view> in index.html", () => {
    const known = new Set(knownViews());
    const sections = htmlViewSections();
    expect(new Set(sections).size, "duplicate data-view sections in index.html").toBe(sections.length);
    expect(sections.sort()).toEqual([...known].sort());
  });

  it("has a nav-link for every KNOWN_VIEWS entry the sidebar exposes", () => {
    const known = new Set(knownViews());
    for (const view of navLinkViews()) {
      expect(known.has(view), `nav-link data-view="${view}" is not in KNOWN_VIEWS`).toBe(true);
    }
  });
});

// UI-parannukset: #detail-panel is a centered overlay modal rather than a side
// panel (the previous 360px column couldn't fit wide multi-year tables). This
// only checks the static markup contract — the actual open/close/Esc/overlay-
// click/focus behavior needs a browser and is covered by the PR's manual test
// paths instead, not a jsdom simulation of listener wiring.
describe("static detail-panel modal markup", () => {
  it("has a dialog role and aria-modal on the modal panel", () => {
    expect(html).toMatch(/detail-modal-panel[^>]*role="dialog"/);
    expect(html).toMatch(/detail-modal-panel[^>]*aria-modal="true"/);
  });
});

// vaihe 3B: Tulot, Kulut ryhmittäin and Budjetti vs. toteuma reuse the shared
// #detail-panel (same click-to-select pattern as assets/observations/events/
// cost-evidence) for their account-level breakdown, so they must be in
// DETAIL_PANEL_VIEWS and have a renderDetailPanel() branch. This only proves
// the wiring exists, not the actual expand/select/close behavior in a
// browser — verify that manually: open Tulot, click "Näytä" on a group row,
// confirm the panel opens with that group's account rows; repeat for Kulut
// ryhmittäin and Budjetti vs. toteuma; then switch the Budjetti vs. toteuma
// year filter and confirm the table and any open detail panel update.
describe("static finance detail-panel cross-check (vaihe 3B)", () => {
  /** @returns {Set<string>} */
  function detailPanelViews() {
    const match = js.match(/const DETAIL_PANEL_VIEWS = new Set\(\[([\s\S]*?)\]\);/);
    if (!match) throw new Error("DETAIL_PANEL_VIEWS declaration not found in app.js");
    return new Set([...match[1].matchAll(/"([\w-]+)"/g)].map((m) => m[1]));
  }

  it("registers finance-income, finance-costs-group and finance-budget as detail-panel views", () => {
    const views = detailPanelViews();
    for (const view of ["finance-income", "finance-costs-group", "finance-budget"]) {
      expect(views.has(view), `expected DETAIL_PANEL_VIEWS to contain "${view}"`).toBe(true);
    }
  });

  it("has a renderDetailPanel() branch for each finance detail-panel view", () => {
    for (const [view, renderFn] of [
      ["finance-income", "renderIncomeGroupDetail"],
      ["finance-costs-group", "renderExpenseGroupDetail"],
      ["finance-budget", "renderBudgetVsActualDetail"],
    ]) {
      const pattern = new RegExp(
        `state\\.selection\\.view === "${view}"\\)\\s*${renderFn}\\(\\)`,
      );
      expect(pattern.test(js), `expected a renderDetailPanel() branch calling ${renderFn}() for "${view}"`).toBe(true);
    }
  });

  it("derives the Budjetti vs. toteuma year filter options from the data (deriveComparableGroupBudgetYears, feature/group-budget)", () => {
    expect(js).toContain("deriveComparableGroupBudgetYears(accounts, entries, groupBudgets)");
    expect(js).toContain('$("#finance-budget-filter-year").addEventListener("change", renderBudgetVsActual)');
  });
});
