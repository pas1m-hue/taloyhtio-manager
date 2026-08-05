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
      "cost-evidence-list", "cost-evidence-kpis", "cost-evidence-new",
      "cost-evidence-filter-status", "cost-evidence-filter-asset",
      "cost-evidence-filter-gap-only", "detail-panel", "detail-panel-title",
      "detail-panel-body",
    ]) {
      expect(defined.has(id), `expected #${id} to be defined`).toBe(true);
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
