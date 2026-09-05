import {
  ASSET_CATEGORIES,
  buildAccountCostsViewModel,
  buildAssetListViewModel,
  buildBalanceComparisonViewModel,
  buildBalanceSheetImportOperation,
  buildBalanceSheetViewModel,
  buildCostEvidenceListViewModel,
  buildDeletionOperations,
  detectBalanceImportValueDrops,
  detectFinancialImportValueDrops,
  buildEventListViewModel,
  buildExpenseGroupViewModel,
  buildFinancialImportOperations,
  buildGroupBudgetImportOperations,
  buildGroupBudgetVsActualViewModel,
  buildGroupChartModel,
  buildIncomeViewModel,
  buildObservationListViewModel,
  buildSaveAssetOperation,
  buildSaveBuildingEventOperation,
  buildSaveCostEvidenceOperation,
  buildSaveHousingCompanyOperation,
  buildSummaryChartModel,
  buildSaveObservationOperation,
  buildSavePriceLevelConfirmationOperation,
  canSubmitAdminOperation,
  buildTrailing12mNote,
  computeBalanceRatios,
  computeBalanceReconciliation,
  computeTrailing12mOperatingCosts,
  copyScheduleRowToAllScenarios,
  COST_EVIDENCE_STATUSES,
  countActiveAssets,
  countObservationsWithoutEvent,
  deriveComparableGroupBudgetYears,
  deriveDataGapAssets,
  deriveEventYearOptions,
  EVENT_STATUSES,
  EVENT_TYPES,
  groupScheduleByScenario,
  interpretRevisionConflict,
  isCostEvidenceExpired,
  listDataImports,
  parseBalanceSheetPasteInput,
  parseFinancialPasteInput,
  parseGroupBudgetPasteInput,
  planEntityDeletion,
  planImportDeletion,
  summarizeDeletionPlan,
  formatDeletionTarget,
  PROJECTION_PRICE_LEVEL_YEAR,
  selectFinancialYearViewModel,
  validateDeletionMeta,
  validateOperationMeta,
} from "./adminOperationPayloads.js";

const KNOWN_VIEWS = new Set([
  "overview", "company", "assets", "observations", "events", "cost-evidence",
  "finance-summary", "finance-import", "finance-income", "finance-costs-group",
  "finance-costs-account", "group-budget-import", "finance-budget", "balance-import", "finance-position",
  "scenarios", "cashpath", "required-collection", "publish", "developer",
]);

// Views that own the right-hand detail panel; navigating to any other view
// closes it (decision: generalized from vaihe 1's assets-only behaviour).
const DETAIL_PANEL_VIEWS = new Set([
  "assets", "observations", "cost-evidence", "events",
  "finance-income", "finance-costs-group", "finance-budget",
]);

const CATEGORY_LABELS = {
  hvac: "LVI", envelope: "Vaippa", structures: "Rakenteet",
  yard: "Piha", safety: "Turvallisuus", other: "Muu",
};

const COST_EVIDENCE_STATUS_LABELS = {
  actual: "Toteuma",
  quote: "Tarjous",
  estimate: "Arvio",
  estimate_from_actual: "Arvio toteuman pohjalta",
  data_gap: "DATA GAP",
};

const EVENT_TYPE_LABELS = {
  inspection: "Tarkastus",
  maintenance: "Huolto",
  repair: "Korjaus",
  replacement: "Uusiminen",
  renewal: "Kunnostus",
  cleaning: "Puhdistus",
  study: "Selvitys",
  other: "Muu",
};

const EVENT_STATUS_LABELS = {
  suggested: "Ehdotettu",
  approved: "Hyväksytty",
  actual: "Toteutunut",
  cancelled: "Peruttu",
};

const FINANCE_NATURE_LABELS = { maintenance: "Hoito", repair: "Korjaus" };

const FINANCE_CONTROLLABILITY_LABELS = { fixed: "Kiinteä", variable: "Muuttuva", mixed: "Sekä" };

const SCENARIOS = ["optimistic", "base", "stress"];

const SCENARIO_LABELS = {
  optimistic: "Optimistinen",
  base: "Perusura",
  stress: "Stressi",
};

const state = {
  mode: "admin",
  view: "overview",
  admin: null,
  /**
   * Detail-panel selection: null or { view, id }. For finance-income/
   * finance-costs-group, id is the group name; for finance-budget it is
   * `${kind}::${group}` since a group name can appear in both sections.
   * @type {null | { view: "assets"|"observations"|"cost-evidence"|"events"|"finance-income"|"finance-costs-group"|"finance-budget", id: string }}
   */
  selection: null,
  selectedFiscalYear: null,
  cashpathScenario: "base",
  published: null,
  visitor: null,
  visitorCredential: readCredential(),
  auth: readAuthSession(),
  staleWorkspace: false,
  /** Set once per admin load so the year filter defaults to the current year without fighting user edits. */
  eventsYearFilterInitialized: false,
  /** Set once per admin load so the Budjetti vs. toteuma year filter defaults to the latest comparable year without fighting user edits. */
  financeBudgetYearFilterInitialized: false,
  /** Last parseFinancialPasteInput() result for the finance-import form, or null before any input. */
  financeImportParsed: null,
  /** Last parseBalanceSheetPasteInput() result for the balance-import form, or null before any input. */
  balanceImportParsed: null,
  groupBudgetImportParsed: null,
};

function selectionId(view) {
  return state.selection && state.selection.view === view ? state.selection.id : null;
}

function selectionStillExists(selection, model) {
  if (selection.view === "finance-income") {
    return buildIncomeViewModel(model.financialAccounts, model.financialEntries)
      .groups.some((g) => g.group === selection.id);
  }
  if (selection.view === "finance-costs-group") {
    return buildExpenseGroupViewModel(model.financialAccounts, model.financialEntries)
      .groups.some((g) => g.group === selection.id);
  }
  if (selection.view === "finance-budget") {
    const year = $("#finance-budget-filter-year")?.value;
    if (!year) return false;
    const vm = buildGroupBudgetVsActualViewModel(model.financialAccounts, model.financialEntries, model.groupBudgets, model.groupActuals, year);
    return vm.sections.some((section) =>
      section.groups.some((g) => `${section.kind}::${g.group}` === selection.id));
  }
  const lists = {
    assets: model.assets, observations: model.observations,
    "cost-evidence": model.costEvidence, events: model.events,
  };
  const list = lists[selection.view];
  return Boolean(list) && list.some((item) => item.id === selection.id);
}

let authRefreshPromise = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const companyId = () => $("#company-id").value.trim();
const horizon = () => ({
  startYear: Number($("#horizon-start").value),
  endYear: Number($("#horizon-end").value),
});

/* ---------------------------------------------------------------- boot */

function boot() {
  wireStaticControls();
  wireNavigation();
  wireModeSwitch();
  renderFinancePlaceholders();
  renderAuthStatus();
  applyRoute();
  checkHealth();
  if (state.visitorCredential) {
    loadVisitor().catch(() => {
      state.visitorCredential = null;
      sessionStorage.removeItem("tmVisitorCredential");
    });
  }
}

function wireStaticControls() {
  $("#health-button").addEventListener("click", checkHealth);
  $("#admin-auth-form").addEventListener("submit", signInAdmin);
  $("#admin-sign-out").addEventListener("click", signOutAdmin);
  $("#admin-load").addEventListener("click", () => loadAdmin());
  $("#admin-preview").addEventListener("click", () => loadAdmin());
  $("#admin-publish").addEventListener("click", publishAdmin);
  $("#admin-batch-form").addEventListener("submit", saveAdminBatch);
  $("#assets-new").addEventListener("click", () => openAssetEditor("new"));
  $("#assets-filter-category").addEventListener("change", renderAssets);
  $("#assets-filter-active").addEventListener("change", renderAssets);
  $("#assets-filter-search").addEventListener("input", renderAssets);
  $("#observations-new").addEventListener("click", () => openObservationEditor("new"));
  $("#observations-filter-asset").addEventListener("change", renderObservations);
  $("#observations-filter-from").addEventListener("change", renderObservations);
  $("#observations-filter-to").addEventListener("change", renderObservations);
  $("#observations-filter-search").addEventListener("input", renderObservations);
  $("#events-new").addEventListener("click", () => openEventEditor("new"));
  $("#events-filter-year").addEventListener("change", renderEvents);
  $("#events-filter-status").addEventListener("change", renderEvents);
  $("#events-filter-type").addEventListener("change", renderEvents);
  $("#events-filter-asset").addEventListener("change", renderEvents);
  $("#events-filter-gap-only").addEventListener("change", renderEvents);
  $("#cost-evidence-new").addEventListener("click", () => openCostEvidenceEditor("new"));
  $("#cost-evidence-filter-status").addEventListener("change", renderCostEvidence);
  $("#cost-evidence-filter-asset").addEventListener("change", renderCostEvidence);
  $("#cost-evidence-filter-gap-only").addEventListener("change", renderCostEvidence);
  $("#topbar-fiscal-year").addEventListener("change", (event) => {
    state.selectedFiscalYear = Number(event.target.value);
    renderOverview();
  });
  $("#detail-panel-close").addEventListener("click", () => closeDetailPanel({ restoreFocus: true }));
  $("#detail-panel").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeDetailPanel({ restoreFocus: true });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#detail-panel").hidden) closeDetailPanel({ restoreFocus: true });
  });
  $("#finance-import-form").addEventListener("submit", submitFinanceImport);
  $("#finance-import-text").addEventListener("input", updateFinanceImportPreview);
  $("#finance-budget-filter-year").addEventListener("change", renderBudgetVsActual);
  $("#group-budget-import-form").addEventListener("submit", submitGroupBudgetImport);
  $("#group-budget-import-text").addEventListener("input", updateGroupBudgetImportPreview);
  $("#balance-import-form").addEventListener("submit", submitBalanceImport);
  $("#balance-import-text").addEventListener("input", updateBalanceImportPreview);
  $("#balance-import-id").addEventListener("input", updateBalanceImportPreview);
  $("#balance-import-as-of-date").addEventListener("input", updateBalanceImportPreview);
  $("#finance-position-snapshot").addEventListener("change", renderBalancePosition);
  $("#finance-position-compare").addEventListener("change", renderBalancePosition);

  // Visitor
  $("#visitor-load-overview").addEventListener("click", loadPublished);
  $("#visitor-create-session").addEventListener("click", createSession);
  $("#visitor-reset").addEventListener("click", resetSession);
  $("#visitor-liquidity-form").addEventListener("submit", saveLiquidity);
  $("#visitor-custom-event-form").addEventListener("submit", saveCustomEvent);

  // Sidebar drawer (mobile)
  $("#sidebar-toggle").addEventListener("click", () => toggleSidebar());
  $("#sidebar-scrim").addEventListener("click", () => toggleSidebar(false));

  // Populate asset category filter once.
  const filter = $("#assets-filter-category");
  for (const category of ASSET_CATEGORIES) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = CATEGORY_LABELS[category] ?? category;
    filter.append(option);
  }

  // Populate cost-evidence status filter once.
  const statusFilter = $("#cost-evidence-filter-status");
  for (const status of COST_EVIDENCE_STATUSES) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = COST_EVIDENCE_STATUS_LABELS[status] ?? status;
    statusFilter.append(option);
  }

  // Populate events status/type filters once.
  const eventStatusFilter = $("#events-filter-status");
  for (const status of EVENT_STATUSES) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = EVENT_STATUS_LABELS[status] ?? status;
    eventStatusFilter.append(option);
  }
  const eventTypeFilter = $("#events-filter-type");
  for (const type of EVENT_TYPES) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = EVENT_TYPE_LABELS[type] ?? type;
    eventTypeFilter.append(option);
  }
}

/* ---------------------------------------------------------------- routing */

function wireNavigation() {
  window.addEventListener("hashchange", applyRoute);
  for (const link of $$(".nav-link")) {
    link.addEventListener("click", () => toggleSidebar(false));
  }
}

function applyRoute() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const view = KNOWN_VIEWS.has(raw) ? raw : "overview";
  state.view = view;
  for (const section of $$("#admin-workspace .view")) {
    section.hidden = section.dataset.view !== view;
  }
  for (const link of $$(".nav-link")) {
    link.classList.toggle("active", link.dataset.view === view);
  }
  if (!DETAIL_PANEL_VIEWS.has(view)) closeDetailPanel();
  else if (state.selection && state.selection.view === view) openDetailPanel();
}

function navigate(view) {
  window.location.hash = `#/${view}`;
}

function wireModeSwitch() {
  for (const tab of $$(".mode-tab")) {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  }
}

function setMode(mode) {
  state.mode = mode;
  document.body.dataset.appMode = mode;
  $("#admin-mode").hidden = mode !== "admin";
  $("#visitor-mode").hidden = mode !== "visitor";
  $("#sidebar").hidden = mode !== "admin";
  if (mode !== "admin") closeDetailPanel();
  for (const tab of $$(".mode-tab")) {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
}

function toggleSidebar(force) {
  const open = force ?? document.body.dataset.sidebarOpen !== "true";
  document.body.dataset.sidebarOpen = String(open);
  $("#sidebar-scrim").hidden = !open;
  $("#sidebar-toggle").setAttribute("aria-expanded", String(open));
}

/* ---------------------------------------------------------------- status */

function setStatus(text, kind = "") {
  const pill = $("#topbar-status");
  pill.textContent = text;
  pill.classList.toggle("is-busy", kind === "busy");
  pill.classList.toggle("is-error", kind === "error");
}

/* ---------------------------------------------------------------- auth */

async function signInAdmin(event) {
  event.preventDefault();
  try {
    const session = await supabaseAuthRequest("/token?grant_type=password", {
      body: {
        email: $("#admin-email").value.trim(),
        password: $("#admin-password").value,
      },
    });
    saveAuthSession(session);
    $("#admin-password").value = "";
    renderAuthStatus();
    toast("Kirjautuminen onnistui.");
  } catch (error) { showError(error); }
}

async function signOutAdmin() {
  const accessToken = state.auth?.access_token;
  try {
    if (accessToken) {
      await supabaseAuthRequest("/logout?scope=local", {
        accessToken, expectJson: false,
      });
    }
  } catch (error) {
    console.warn("Supabase logout request failed", error);
  } finally {
    clearAuthSession();
    state.admin = null;
    closeDetailPanel();
    renderAuthStatus();
    toast("Kirjauduttu ulos.");
  }
}

async function getAdminAccessToken() {
  if (!state.auth?.access_token) throw new Error("Kirjaudu ensin admin-käyttäjänä.");
  const expiresAtMs = Number(state.auth.expires_at ?? 0) * 1_000;
  if (expiresAtMs > Date.now() + 60_000) return state.auth.access_token;
  if (!state.auth.refresh_token) {
    clearAuthSession();
    renderAuthStatus();
    throw new Error("Kirjautumisistunto on vanhentunut. Kirjaudu uudelleen.");
  }
  if (!authRefreshPromise) {
    authRefreshPromise = refreshAdminSession().finally(() => { authRefreshPromise = null; });
  }
  await authRefreshPromise;
  if (!state.auth?.access_token) throw new Error("Kirjautumisistunnon uusiminen epäonnistui.");
  return state.auth.access_token;
}

async function refreshAdminSession() {
  try {
    const session = await supabaseAuthRequest("/token?grant_type=refresh_token", {
      body: { refresh_token: state.auth.refresh_token },
    });
    saveAuthSession(session);
    renderAuthStatus();
  } catch (error) {
    clearAuthSession();
    renderAuthStatus();
    throw error;
  }
}

async function supabaseAuthRequest(path, options = {}) {
  const config = requireAuthConfig();
  const accessToken = options.accessToken ?? config.publishableKey;
  const headers = {
    accept: "application/json",
    apikey: config.publishableKey,
    authorization: `Bearer ${accessToken}`,
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${config.supabaseUrl}/auth/v1${path}`, {
    method: "POST",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.ok) {
    if (options.expectJson === false || response.status === 204) return undefined;
    return normalizeAuthSession(await response.json());
  }
  const data = await response.json().catch(() => ({}));
  throw new Error(data.msg ?? data.message ?? data.error_description ?? `Supabase Auth HTTP ${response.status}`);
}

function requireAuthConfig() {
  const config = globalThis.TM_AUTH_CONFIG;
  if (!config || typeof config.supabaseUrl !== "string" || typeof config.publishableKey !== "string") {
    throw new Error("Supabase Auth -konfiguraatio puuttuu.");
  }
  const supabaseUrl = config.supabaseUrl.replace(/\/$/, "");
  if (!supabaseUrl.startsWith("https://") || config.publishableKey.trim() === "") {
    throw new Error("Supabase Auth -konfiguraatio on virheellinen.");
  }
  return { supabaseUrl, publishableKey: config.publishableKey.trim() };
}

function normalizeAuthSession(session) {
  if (!session || typeof session.access_token !== "string" || typeof session.refresh_token !== "string") {
    throw new Error("Supabase Auth palautti virheellisen session.");
  }
  const expiresAt = Number(session.expires_at);
  const expiresIn = Number(session.expires_in);
  return {
    ...session,
    expires_at: Number.isFinite(expiresAt)
      ? expiresAt
      : Math.floor(Date.now() / 1_000) + (Number.isFinite(expiresIn) ? expiresIn : 3_600),
  };
}

function saveAuthSession(session) {
  state.auth = normalizeAuthSession(session);
  sessionStorage.setItem("tmAdminAuthSession", JSON.stringify(state.auth));
}

function clearAuthSession() {
  state.auth = null;
  sessionStorage.removeItem("tmAdminAuthSession");
}

function readAuthSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem("tmAdminAuthSession"));
    return value?.access_token ? value : null;
  } catch { return null; }
}

function renderAuthStatus() {
  const signedIn = canSubmitAdminOperation(state.auth);
  $("#topbar-user").textContent = signedIn
    ? `Kirjautunut: ${state.auth.user?.email ?? "Supabase-käyttäjä"}`
    : "Ei kirjautunutta käyttäjää.";
  $("#admin-auth-gate").hidden = signedIn;
  $("#admin-workspace").hidden = !signedIn;
  $("#admin-sign-out").disabled = !signedIn;
  for (const selector of ["#admin-load", "#admin-preview", "#admin-publish", "#assets-new", "#observations-new", "#events-new", "#cost-evidence-new"]) {
    $(selector).disabled = !signedIn;
  }
  $("#admin-batch-form button[type=submit]").disabled = !signedIn;
  ensureWorkspaceSignOut(signedIn);
  if (signedIn) renderWorkspace();
}

function ensureWorkspaceSignOut(signedIn) {
  let button = $("#workspace-sign-out");
  if (!signedIn) { button?.remove(); return; }
  if (!button) {
    button = document.createElement("button");
    button.id = "workspace-sign-out";
    button.type = "button";
    button.className = "secondary";
    button.textContent = "Kirjaudu ulos";
    button.addEventListener("click", signOutAdmin);
    $(".workspace-actions .button-row").append(button);
  }
}

/* ---------------------------------------------------------------- admin load */

async function loadAdmin() {
  try {
    setStatus("Ladataan työtilaa…", "busy");
    const model = await api(
      `/api/v1/admin/companies/${encodeURIComponent(companyId())}/workspace${horizonQuery()}`,
      { adminToken: await getAdminAccessToken() },
    );
    state.admin = model;
    state.staleWorkspace = false;
    if (state.selection && !selectionStillExists(state.selection, model)) {
      closeDetailPanel();
    }
    renderWorkspace();
    setStatus(`Revisio ${model.adminRevision} ladattu`);
    toast(`Admin-revisio ${model.adminRevision} ladattu.`);
  } catch (error) {
    setStatus("Lataus epäonnistui", "error");
    showError(error);
  }
}

async function sendAdminOperations(operations, { successMessage } = {}) {
  if (!canSubmitAdminOperation(state.auth)) {
    toast("Kirjaudu ensin admin-käyttäjänä.", true);
    return { ok: false };
  }
  if (!state.admin) await loadAdmin();
  if (!state.admin) return { ok: false };
  try {
    setStatus("Tallennetaan…", "busy");
    const model = await api(
      `/api/v1/admin/companies/${encodeURIComponent(companyId())}/changes`,
      {
        method: "POST",
        adminToken: await getAdminAccessToken(),
        body: { expectedRevision: state.admin.adminRevision, horizon: horizon(), operations },
      },
    );
    state.admin = model;
    state.staleWorkspace = false;
    renderWorkspace();
    setStatus(`Tallennettu · revisio ${model.adminRevision}`);
    if (successMessage) toast(successMessage);
    return { ok: true };
  } catch (error) {
    const conflict = interpretRevisionConflict(error);
    if (conflict.isConflict) {
      state.staleWorkspace = true;
      setStatus("Tiedot muuttuivat — lataa uudelleen", "error");
      renderWorkspace();
      toast(conflict.message, true);
    } else {
      setStatus("Tallennus epäonnistui", "error");
      showError(error);
    }
    return { ok: false, conflict: conflict.isConflict };
  }
}

/* ---------------------------------------------------------------- render */

function renderWorkspace() {
  if (!canSubmitAdminOperation(state.auth)) return;
  const revisionLine = $("#admin-revision-line");
  if (!state.admin) {
    revisionLine.textContent = "Ei ladattua työtilaa. Aloita painamalla ”Lataa työtila”.";
    renderLoadPrompts();
    return;
  }
  revisionLine.innerHTML = state.staleWorkspace
    ? `<span class="warning">Työtila on vanhentunut. Lataa uudelleen ennen muutoksia.</span>`
    : `Työrevisio ${state.admin.adminRevision} · päivitetty ${escapeHtml(String(state.admin.updatedAt))}`;
  renderOverview();
  renderFiscalSelector();
  renderCompanyForm();
  renderAssets();
  renderObservations();
  renderEvents();
  renderCostEvidence();
  renderFinancePlaceholders();
  renderIncome();
  renderExpenseGroups();
  renderAccountCosts();
  renderDataImportList();
  renderGroupBudgetList();
  renderBudgetVsActual();
  renderBalancePosition();
  renderScenarios();
  renderCashpath();
  renderRequiredCollection();
  renderPublish();
}

function renderLoadPrompts() {
  const prompt = stateBlock({
    kind: "empty",
    title: "Työtilaa ei ole vielä ladattu",
    body: "Lataa taloyhtiön työtila nähdäksesi yleiskuvan, rakennusosat ja laskennan.",
  });
  $("#overview-kpis").innerHTML = "";
  $("#overview-fiscal").innerHTML = "";
  $("#overview-notes").innerHTML = prompt;
  $("#observations-kpis").innerHTML = "";
  $("#events-kpis").innerHTML = "";
  $("#cost-evidence-kpis").innerHTML = "";
  for (const id of [
    "#assets-list", "#observations-list", "#events-list", "#cost-evidence-list",
    "#finance-income-body", "#finance-costs-group-body", "#finance-costs-account-body",
    "#finance-budget-body",
    "#scenarios-body", "#cashpath-body", "#required-collection-body", "#publish-summary",
  ]) {
    $(id).innerHTML = prompt;
  }
  $("#company-form").innerHTML = prompt;
}

/* -------- Overview (decision 3.6) -------- */

function renderOverview() {
  const model = state.admin;
  if (!model) return;
  const publication = model.publication ?? {};
  const dataGaps = deriveDataGapAssets(model.costEvidence);
  const projectionBase = model.calculations?.projection?.scenarios?.base;

  const kpis = [
    ["Työrevisio", model.adminRevision],
    ["Julkaisuversio", publication.latestPublicationVersion ?? 0],
    ["Aktiiviset rakennusosat", countActiveAssets(model.assets)],
    ["Kirjatut havainnot", model.observations.length],
    ["DATA GAP -rakennusosat", dataGaps.count],
    ["Hyväksytyt tapahtumat", model.counts?.approvedEvents ?? 0],
    ["Tunnetut kustannukset (perusura)", projectionBase ? money(projectionBase.horizonAmount) : "—"],
    ["Julkaisua odottavat muutokset", publication.publishableChanges ? "Kyllä" : "Ei"],
  ];

  const liquidity = model.calculations?.liquidity;
  if (liquidity?.status === "available" && model.latestLiquidityBaseline) {
    kpis.push(["Kassa (lähtötaso)", money(model.latestLiquidityBaseline.currentCash)]);
    kpis.push(["Puskuritavoite", money(liquidity.forecast.operatingBuffer.operatingBufferTarget)]);
  }
  $("#overview-kpis").innerHTML = kpis.map(kpiCard).join("");

  renderOverviewFiscal();
  renderOverviewNotes();
}

function renderOverviewFiscal() {
  const model = state.admin;
  const vm = selectFinancialYearViewModel(model.financialYears, state.selectedFiscalYear ?? undefined);
  const host = $("#overview-fiscal");
  if (!vm.hasData) {
    host.innerHTML = `<h3>Talousvuosi</h3>` + stateBlock({
      kind: "empty",
      title: "Ei talousvuosidataa",
      body: "Tälle taloyhtiölle ei ole vielä tallennettu talousvuosia. Vuosittaiset budjetti- ja toteumaluvut näkyvät tässä, kun ne on syötetty.",
    });
    return;
  }
  const f = vm.figures ?? {};
  const cards = [
    ["Budjetoidut tulot", f.budgetIncome],
    ["Toteutuneet tulot", f.actualIncome],
    ["Budjetoidut kulut", f.budgetCosts],
    ["Toteutuneet kulut", f.actualCosts],
  ].map(([label, value]) => kpiCard([label, value === undefined ? "—" : money(value)]));
  host.innerHTML = `<h3>Talousvuosi ${vm.selectedYear}</h3><div class="card-grid">${cards.join("")}</div>`;
}

function renderOverviewNotes() {
  const model = state.admin;
  const publication = model.publication ?? {};
  const notes = [];

  const liquidity = model.calculations?.liquidity;
  if (liquidity?.status === "available") {
    const needs = SCENARIOS.map((scenario) => {
      const signal = liquidity.forecast.scenarios[scenario]?.fundingNeed;
      const year = signal?.firstFundingNeedYear;
      return `<li><strong>${scenario}:</strong> ${year ? `ensimmäinen puskurivaje ${year}` : "ei puskurivajetta tunnetuilla kustannuksilla"}</li>`;
    }).join("");
    notes.push(infoCard("Puskurivaje skenaarioittain", `<ul>${needs}</ul>`));
  } else {
    notes.push(infoCard(
      "Likviditeetti",
      "Kassaa ja puskuritavoitetta ei näytetä, koska likviditeetin lähtötiedot puuttuvat. Lisää lähtötiedot Kehittäjäpaneelin kautta (save_liquidity_baseline).",
    ));
  }

  notes.push(infoCard(
    "Julkaisu",
    publication.publishableChanges
      ? `Työversiossa on julkaistavia muutoksia (${publication.unpublishedAuditEntryCount ?? 0} julkaisematonta audit-merkintää).`
      : "Ei julkaistavia muutoksia; työversio vastaa viimeisintä julkaisua.",
  ));
  $("#overview-notes").innerHTML = notes.join("");
}

/* -------- Fiscal year selector (decision 3.2) -------- */

function renderFiscalSelector() {
  const model = state.admin;
  const vm = selectFinancialYearViewModel(model.financialYears, state.selectedFiscalYear ?? undefined);
  const field = $("#topbar-fiscal-year-field");
  const select = $("#topbar-fiscal-year");
  if (!vm.hasData) {
    field.hidden = true;
    select.innerHTML = "";
    state.selectedFiscalYear = null;
    return;
  }
  field.hidden = false;
  state.selectedFiscalYear = vm.selectedYear;
  select.innerHTML = vm.availableYears
    .map((year) => `<option value="${year}"${year === vm.selectedYear ? " selected" : ""}>${year}</option>`)
    .join("");
}

/* -------- Company form -------- */

function renderCompanyForm() {
  const company = state.admin.housingCompany;
  const buffer = company.operatingBuffer ?? {};
  $("#company-form").innerHTML = `
    <div class="form-grid">
      ${textField("company-name", "Nimi", company.name, { required: true })}
      ${numberField("company-apartments", "Huoneistomäärä", company.apartmentCount, { required: true, min: 1, step: 1 })}
      ${numberField("company-area", "Laskutettava pinta-ala (m²)", company.chargeableAreaM2 ?? "", { min: 0, step: "0.01" })}
      ${numberField("company-buffer-months", "Käyttöpuskuri (kk)", buffer.bufferMonths ?? "", { min: 0, step: "0.1" })}
      ${numberField("company-buffer-override", "Puskurin override (€)", buffer.userOverride ?? "", { min: 0, step: "0.01" })}
      ${numberField("company-plan-coverage", "Kunnossapitosuunnitelma kattaa vuoteen", company.maintenancePlanCoverageThroughYear ?? "", { step: 1 })}
    </div>
    <p class="form-hint">Kunnossapitosuunnitelman kate rajaa kassapolun: sen jälkeisiä vuosia ei esitetä laskettuina. Tyhjä kenttä tarkoittaa ettei katetta ole asetettu — ei sitä että suunnitelma kattaisi koko horisontin.</p>
    <fieldset class="form-grid">
      <legend class="form-hint">Muutoksen metatiedot (pakollisia)</legend>
      ${textField("company-source-ids", "Lähdetunnisteet (pilkuin eroteltu)", "", { required: true })}
      ${textField("company-explanation", "Muutoksen selitys", "", { required: true })}
    </fieldset>
    <p id="company-feedback" class="form-feedback" role="status" aria-live="polite"></p>
    <div class="button-row"><button type="submit">Tallenna perustiedot</button></div>
  `;
  $("#company-form").onsubmit = submitCompanyForm;
}

async function submitCompanyForm(event) {
  event.preventDefault();
  clearFieldErrors("#company-form");
  const raw = {
    id: companyId(),
    name: fieldValue("company-name"),
    apartmentCount: fieldValue("company-apartments"),
    chargeableAreaM2: fieldValue("company-area"),
    bufferMonths: fieldValue("company-buffer-months"),
    userOverride: fieldValue("company-buffer-override"),
    maintenancePlanCoverageThroughYear: fieldValue("company-plan-coverage"),
    sourceIds: fieldValue("company-source-ids"),
    explanation: fieldValue("company-explanation"),
  };
  const result = buildSaveHousingCompanyOperation(raw);
  if (!result.ok) {
    applyFieldErrors("#company-form", {
      name: "company-name", apartmentCount: "company-apartments",
      chargeableAreaM2: "company-area", bufferMonths: "company-buffer-months",
      userOverride: "company-buffer-override", sourceIds: "company-source-ids",
      maintenancePlanCoverageThroughYear: "company-plan-coverage",
      explanation: "company-explanation",
    }, result.errors);
    setFeedback("#company-feedback", "Korjaa merkityt kentät.", "error");
    return;
  }
  const sent = await sendAdminOperations([result.operation], {
    successMessage: "Taloyhtiön perustiedot tallennettu.",
  });
  if (sent.ok) setFeedback("#company-feedback", "Tallennettu.", "ok");
  else if (sent.conflict) setFeedback("#company-feedback", "Tiedot muuttuivat — lataa työtila uudelleen.", "error");
}

/* -------- Assets -------- */

function filteredAssets() {
  const model = state.admin;
  const category = $("#assets-filter-category").value;
  const activeFilter = $("#assets-filter-active").value;
  const search = $("#assets-filter-search").value.trim().toLowerCase();
  return model.assets.filter((asset) => {
    if (category && asset.category !== category) return false;
    if (activeFilter === "active" && !asset.active) return false;
    if (activeFilter === "inactive" && asset.active) return false;
    if (search && !`${asset.id} ${asset.name}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

function renderAssets() {
  if (!state.admin) return;
  const gapAssets = new Set(deriveDataGapAssets(state.admin.costEvidence).assetIds);
  const vm = buildAssetListViewModel(filteredAssets());
  const host = $("#assets-list");
  if (vm.isEmpty) {
    const anyAssets = state.admin.assets.length > 0;
    host.innerHTML = stateBlock({
      kind: "empty",
      title: anyAssets ? "Ei osumia suodattimilla" : "Ei vielä rakennusosia",
      body: anyAssets ? "Muuta kategoria-, tila- tai hakusuodatinta." : vm.emptyMessage,
    });
    return;
  }
  const selectedAssetId = selectionId("assets");
  host.innerHTML = vm.rows.map((row) => {
    const selected = row.id === selectedAssetId ? " is-selected" : "";
    const gap = gapAssets.has(row.id) ? `<span class="badge gap">DATA GAP</span>` : "";
    const badge = row.active
      ? `<span class="badge active">Aktiivinen</span>`
      : `<span class="badge inactive">Ei aktiivinen</span>`;
    return `<button type="button" class="asset-card${selected}" data-asset-id="${escapeHtml(row.id)}">
      <span>
        <span class="asset-name">${escapeHtml(row.name)}</span><br>
        <span class="asset-meta">${escapeHtml(CATEGORY_LABELS[row.category] ?? row.category)} · ${escapeHtml(row.id)}</span>
      </span>
      <span class="badge-row">${badge} ${gap}</span>
    </button>`;
  }).join("");
  for (const card of $$("#assets-list .asset-card")) {
    card.addEventListener("click", () => selectAsset(card.dataset.assetId));
  }
}

function selectAsset(assetId) {
  state.selection = { view: "assets", id: assetId };
  renderAssets();
  renderDetailPanel();
  openDetailPanel();
}

/** Dispatches to the detail renderer for whichever entity is selected. */
function renderDetailPanel() {
  if (!state.selection) return;
  if (state.selection.view === "assets") renderAssetDetail();
  else if (state.selection.view === "observations") renderObservationDetail();
  else if (state.selection.view === "cost-evidence") renderCostEvidenceDetail();
  else if (state.selection.view === "events") renderEventDetail();
  else if (state.selection.view === "finance-income") renderIncomeGroupDetail();
  else if (state.selection.view === "finance-costs-group") renderExpenseGroupDetail();
  else if (state.selection.view === "finance-budget") renderBudgetVsActualDetail();
}

function renderAssetDetail() {
  const model = state.admin;
  const asset = model.assets.find((item) => item.id === selectionId("assets"));
  if (!asset) { closeDetailPanel(); return; }
  const observations = model.observations.filter((o) => o.assetId === asset.id);
  const events = model.events.filter((e) => e.assetId === asset.id);
  const evidence = model.costEvidence.filter((c) => c.assetId === asset.id);

  $("#detail-panel-title").textContent = asset.name;
  $("#detail-panel-body").innerHTML = `
    <div class="detail-group">
      <div class="detail-item"><span>Tunniste</span><strong>${escapeHtml(asset.id)}</strong></div>
      <div class="detail-item"><span>Kategoria</span><strong>${escapeHtml(CATEGORY_LABELS[asset.category] ?? asset.category)}</strong></div>
      <div class="detail-item"><span>Aktiivinen</span><strong>${asset.active ? "Kyllä" : "Ei"}</strong></div>
      <div class="detail-item"><span>Lähdetunnisteet</span><strong>${escapeHtml((asset.sourceIds ?? []).join(", ") || "—")}</strong></div>
    </div>
    <div class="button-row">
      <button type="button" class="secondary" id="detail-edit-asset">Muokkaa</button>
      <button type="button" class="danger" id="detail-delete-asset">Poista</button>
    </div>
    ${detailGroup("Havainnot", observations.map((o) =>
      `<li><strong>${escapeHtml(o.observedAt)}</strong><br>${escapeHtml(o.description)}</li>`), "Ei havaintoja.")}
    ${detailGroup("Tapahtumat", events.map((e) =>
      `<li><strong>${escapeHtml(e.title)}</strong> · ${escapeHtml(e.status)} · ${escapeHtml(e.type)}</li>`), "Ei tapahtumia.")}
    ${detailGroup("Kustannusnäyttö", evidence.map((c) => {
      const gap = c.status === "data_gap";
      const amount = gap ? `<span class="warning">DATA GAP</span>` : money(c.amount ?? 0);
      return `<li>${escapeHtml(c.status)} · ${amount} · ${escapeHtml(c.unit)}</li>`;
    }), "Ei kustannusnäyttöä.")}
  `;
  $("#detail-edit-asset").addEventListener("click", () => openAssetEditor("edit", asset.id));
  $("#detail-delete-asset").addEventListener(
    "click", () => openDeleteConfirmation("asset", asset.id, renderAssetDetail),
  );
}

/**
 * Renders the mandatory delete confirmation into the detail panel itself
 * rather than a second modal: the panel is already the place where a single
 * entity is inspected and edited, and reusing it keeps focus handling, Escape
 * and the backdrop click working exactly as before.
 *
 * Confirmation is required for every deletion, including one with nothing
 * attached — then it simply shows no list.
 *
 * @param {string} entityType
 * @param {string} entityKey
 * @param {() => void} [onCancel] Restores whatever the panel showed before.
 */
function openDeleteConfirmation(entityType, entityKey, onCancel) {
  if (!state.admin) return;
  const plan = planEntityDeletion(state.admin, { entityType, entityKey });
  const lines = summarizeDeletionPlan(plan);
  // The name on its own has already caused a real row to be deleted in place
  // of an identically named test row, so the target's source is spelled out
  // next to it here and in every cascade line below. The text comes from
  // formatDeletionTarget so that what the tests pin is what is rendered.
  const target = `<strong>${escapeHtml(formatDeletionTarget(plan))}</strong>`;
  const collateral = lines.length === 0
    ? `<p>Poistetaan ${target}. Mikään muu ei muutu.</p>`
    : `<p>Poistetaan ${target} ja sen mukana:</p>
       <ul class="detail-list">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;

  $("#detail-panel-title").textContent = `Poista: ${plan.target.label}`;
  $("#detail-panel-body").innerHTML = `
    <form id="delete-form" class="form-card" novalidate>
      ${collateral}
      <p class="warning">Poistoa ei voi perua.</p>
      <div class="form-grid">
        ${textField("delete-explanation", "Poiston selitys", "", { required: true })}
      </div>
      <p id="delete-feedback" class="form-feedback" role="status" aria-live="polite"></p>
      <div class="button-row">
        <button type="submit" class="danger">Poista pysyvästi</button>
        <button type="button" class="secondary" id="delete-cancel">Peruuta</button>
      </div>
    </form>
  `;
  openDetailPanel();
  $("#delete-explanation").focus();
  $("#delete-form").onsubmit = (event) => submitDeletion(event, plan);
  $("#delete-cancel").addEventListener("click", () => {
    if (onCancel) onCancel();
    else closeDetailPanel({ restoreFocus: true });
  });
}

/**
 * Same confirmation flow for a whole import. It is a different planner but the
 * same panel, the same mandatory explanation and the same batch — an import is
 * just a deletion whose target happens to be a set of rows rather than one row.
 * @param {string} key
 */
function openImportDeleteConfirmation(key) {
  if (!state.admin) return;
  const plan = planImportDeletion(state.admin, key);
  const lines = summarizeDeletionPlan(plan);
  $("#detail-panel-title").textContent = `Poista tuonti: ${plan.target.label}`;
  $("#detail-panel-body").innerHTML = `
    <form id="delete-form" class="form-card" novalidate>
      <p>Poistetaan kaikki lähdetunnisteella <strong>${escapeHtml(plan.target.label)}</strong> tuodut rivit:</p>
      <ul class="detail-list">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
      <p class="warning">Poistoa ei voi perua.</p>
      <div class="form-grid">
        ${textField("delete-explanation", "Poiston selitys", "", { required: true })}
      </div>
      <p id="delete-feedback" class="form-feedback" role="status" aria-live="polite"></p>
      <div class="button-row">
        <button type="submit" class="danger">Poista pysyvästi</button>
        <button type="button" class="secondary" id="delete-cancel">Peruuta</button>
      </div>
    </form>
  `;
  openDetailPanel();
  $("#delete-explanation").focus();
  $("#delete-form").onsubmit = (event) => submitDeletion(event, plan);
  $("#delete-cancel").addEventListener("click", () => closeDetailPanel({ restoreFocus: true }));
}

/** @param {SubmitEvent} event @param {ReturnType<typeof planEntityDeletion>} plan */
async function submitDeletion(event, plan) {
  event.preventDefault();
  clearFieldErrors("#delete-form");
  const meta = validateDeletionMeta({ explanation: fieldValue("delete-explanation") });
  if (!meta.ok) {
    applyFieldErrors("#delete-form", { explanation: "delete-explanation" }, meta.errors);
    setFeedback("#delete-feedback", "Korjaa merkityt kentät.", "error");
    return;
  }
  const sent = await sendAdminOperations(buildDeletionOperations(plan, meta.value), {
    successMessage: `${plan.target.label} poistettu.`,
  });
  if (sent.ok) {
    // The selection points at something that no longer exists; clearing it
    // before the panel closes keeps renderDetailPanel from looking it up.
    state.selection = null;
    closeDetailPanel({ restoreFocus: true });
  } else if (sent.conflict) {
    setFeedback("#delete-feedback", "Tiedot muuttuivat — lataa työtila uudelleen.", "error");
  }
}

/** Element focused just before the detail modal opened, for restoring focus on user-initiated close. */
let detailPanelOpenerElement = null;

function openDetailPanel() {
  const panel = $("#detail-panel");
  // Guard against overwriting the saved opener on a re-render while already open
  // (repeated openDetailPanel() calls should not clobber it with an element inside the modal).
  if (panel.hidden) detailPanelOpenerElement = document.activeElement;
  panel.hidden = false;
  $(".detail-modal-panel").focus();
}
function closeDetailPanel({ restoreFocus = false } = {}) {
  $("#detail-panel").hidden = true;
  state.selection = null;
  for (const el of $$(".asset-card.is-selected, #observations-list tr.is-selected, #cost-evidence-list tr.is-selected, #events-list tr.is-selected, #finance-income-body tr.is-selected, #finance-costs-group-body tr.is-selected, #finance-budget-body tr.is-selected")) {
    el.classList.remove("is-selected");
  }
  if (restoreFocus && detailPanelOpenerElement && document.contains(detailPanelOpenerElement)) {
    detailPanelOpenerElement.focus();
  }
  detailPanelOpenerElement = null;
}

// Mirrors sourceField into opField as the user types, unless the user has typed into opField directly.
function wireSourceIdsPrefill(sourceFieldId, opFieldId) {
  const sourceField = $(`#${sourceFieldId}`);
  const opField = $(`#${opFieldId}`);
  let opFieldTouched = false;
  opField.addEventListener("input", () => { opFieldTouched = true; });
  sourceField.addEventListener("input", () => {
    if (!opFieldTouched) opField.value = sourceField.value;
  });
}

function openAssetEditor(mode, assetId) {
  const model = state.admin;
  const asset = mode === "edit" ? model.assets.find((a) => a.id === assetId) : null;
  const entitySources = asset ? (asset.sourceIds ?? []).join(", ") : "";
  const host = ensureAssetEditorHost();
  host.hidden = false;
  host.innerHTML = `
    <form id="asset-form" class="card form-card" novalidate>
      <h3>${mode === "edit" ? "Muokkaa rakennusosaa" : "Uusi rakennusosa"}</h3>
      <div class="form-grid">
        ${textField("asset-id", "Tunniste", asset?.id ?? "", { required: true, readonly: mode === "edit" })}
        ${textField("asset-name", "Nimi", asset?.name ?? "", { required: true })}
        ${selectField("asset-category", "Kategoria", ASSET_CATEGORIES.map((c) => [c, CATEGORY_LABELS[c] ?? c]), asset?.category ?? "")}
        ${checkboxField("asset-active", "Aktiivinen", asset ? asset.active : true)}
        ${textField("asset-source-ids", "Rakennusosan lähdetunnisteet", entitySources, { required: true })}
      </div>
      <fieldset class="form-grid">
        <legend class="form-hint">Muutoksen metatiedot (operaation lähteet esitäytetään rakennusosan lähteistä, muokattavissa)</legend>
        ${textField("asset-op-source-ids", "Operaation lähdetunnisteet", entitySources, { required: true })}
        ${textField("asset-explanation", "Muutoksen selitys", "", { required: true })}
      </fieldset>
      <p id="asset-feedback" class="form-feedback" role="status" aria-live="polite"></p>
      <div class="button-row">
        <button type="submit">Tallenna rakennusosa</button>
        <button type="button" class="secondary" id="asset-cancel">Peruuta</button>
      </div>
    </form>
  `;
  $("#asset-form").onsubmit = (event) => submitAssetForm(event, mode);
  $("#asset-cancel").addEventListener("click", closeAssetEditor);
  wireSourceIdsPrefill("asset-source-ids", "asset-op-source-ids");
  host.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function ensureAssetEditorHost() {
  let host = $("#asset-editor");
  if (!host) {
    host = document.createElement("div");
    host.id = "asset-editor";
    host.className = "subsection";
    const view = document.querySelector('.view[data-view="assets"]');
    view.insertBefore(host, $("#assets-list"));
  }
  return host;
}

function closeAssetEditor() {
  const host = $("#asset-editor");
  if (host) { host.hidden = true; host.innerHTML = ""; }
}

async function submitAssetForm(event, mode) {
  event.preventDefault();
  clearFieldErrors("#asset-form");
  const raw = {
    id: fieldValue("asset-id"),
    name: fieldValue("asset-name"),
    category: fieldValue("asset-category"),
    active: $("#asset-active").checked,
    sourceIds: fieldValue("asset-source-ids"),
    operationSourceIds: fieldValue("asset-op-source-ids"),
    explanation: fieldValue("asset-explanation"),
  };
  const result = buildSaveAssetOperation(raw);
  if (!result.ok) {
    applyFieldErrors("#asset-form", {
      id: "asset-id", name: "asset-name", category: "asset-category",
      active: "asset-active", sourceIds: "asset-source-ids",
      operationSourceIds: "asset-op-source-ids", explanation: "asset-explanation",
    }, result.errors);
    setFeedback("#asset-feedback", "Korjaa merkityt kentät.", "error");
    return;
  }
  const sent = await sendAdminOperations([result.operation], {
    successMessage: mode === "edit" ? "Rakennusosa päivitetty." : "Rakennusosa lisätty.",
  });
  if (sent.ok) {
    state.selection = { view: "assets", id: result.operation.value.id };
    closeAssetEditor();
    renderAssets();
    renderDetailPanel();
    openDetailPanel();
  } else if (sent.conflict) {
    setFeedback("#asset-feedback", "Tiedot muuttuivat — lataa työtila uudelleen.", "error");
  }
}

/* -------- Havainnot -------- */

function filteredObservations() {
  const model = state.admin;
  const assetFilter = $("#observations-filter-asset").value;
  const from = $("#observations-filter-from").value;
  const to = $("#observations-filter-to").value;
  const search = $("#observations-filter-search").value.trim().toLowerCase();
  return model.observations.filter((observation) => {
    if (assetFilter && observation.assetId !== assetFilter) return false;
    if (from && observation.observedAt < from) return false;
    if (to && observation.observedAt > to) return false;
    if (search && !`${observation.id} ${observation.description}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

function populateAssetSelect(select, assets, { includeEmpty } = {}) {
  const current = select.value;
  const options = assets
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "fi"))
    .map((asset) => `<option value="${escapeHtml(asset.id)}">${escapeHtml(asset.name)}</option>`);
  select.innerHTML = (includeEmpty ? `<option value="">Kaikki</option>` : "") + options.join("");
  select.value = current;
}

function renderObservations() {
  if (!state.admin) return;
  const model = state.admin;
  populateAssetSelect($("#observations-filter-asset"), model.assets, { includeEmpty: true });

  const withoutEvent = countObservationsWithoutEvent(model.observations, model.events);
  $("#observations-kpis").innerHTML = [
    ["Havaintoja yhteensä", model.observations.length],
    ["Ilman tapahtumaa", withoutEvent],
  ].map(kpiCard).join("");

  const vm = buildObservationListViewModel(filteredObservations(), model.assets);
  const host = $("#observations-list");
  if (vm.isEmpty) {
    const anyObservations = model.observations.length > 0;
    host.innerHTML = stateBlock({
      kind: "empty",
      title: anyObservations ? "Ei osumia suodattimilla" : "Ei vielä havaintoja",
      body: anyObservations ? "Muuta rakennusosa-, ajanjakso- tai hakusuodatinta." : vm.emptyMessage,
    });
    return;
  }
  const selectedId = selectionId("observations");
  host.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Rakennusosa</th><th>Havaintopäivä</th><th>Kuvaus</th><th>Lähteet</th><th></th></tr></thead>
    <tbody>${vm.rows.map((row) => `
      <tr class="${row.id === selectedId ? "is-selected" : ""}" data-observation-id="${escapeHtml(row.id)}">
        <td>${escapeHtml(row.assetName)}</td>
        <td>${escapeHtml(row.observedAt)}</td>
        <td>${escapeHtml(row.description)}</td>
        <td>${escapeHtml(row.sourceIds.join(", ") || "—")}</td>
        <td><button type="button" class="secondary row-select">Näytä</button></td>
      </tr>`).join("")}</tbody>
  </table></div>`;
  for (const row of $$("#observations-list tr[data-observation-id]")) {
    row.querySelector(".row-select").addEventListener(
      "click", () => selectObservation(row.dataset.observationId),
    );
  }
}

function selectObservation(observationId) {
  state.selection = { view: "observations", id: observationId };
  renderObservations();
  renderDetailPanel();
  openDetailPanel();
}

function renderObservationDetail() {
  const model = state.admin;
  const observation = model.observations.find((item) => item.id === selectionId("observations"));
  if (!observation) { closeDetailPanel(); return; }
  const asset = model.assets.find((item) => item.id === observation.assetId);
  const linkedEvents = model.events.filter((event) =>
    (event.observationIds ?? []).includes(observation.id));

  $("#detail-panel-title").textContent = "Havainto";
  $("#detail-panel-body").innerHTML = `
    <div class="detail-group">
      <div class="detail-item"><span>Rakennusosa</span><strong>${escapeHtml(asset?.name ?? observation.assetId)}</strong></div>
      <div class="detail-item"><span>Havaintopäivä</span><strong>${escapeHtml(observation.observedAt)}</strong></div>
      <div class="detail-item"><span>Kuvaus</span><strong>${escapeHtml(observation.description)}</strong></div>
      <div class="detail-item"><span>Lähdetunnisteet</span><strong>${escapeHtml((observation.sourceIds ?? []).join(", ") || "—")}</strong></div>
    </div>
    <div class="button-row">
      <button type="button" class="secondary" id="detail-edit-observation">Muokkaa</button>
      <button type="button" class="secondary" id="detail-create-event-from-observation">Luo korjaustapahtuma</button>
      <button type="button" class="danger" id="detail-delete-observation">Poista</button>
    </div>
    ${detailGroup("Linkitetyt tapahtumat", linkedEvents.map((event) =>
      `<li><strong>${escapeHtml(event.title)}</strong> · ${escapeHtml(event.status)}</li>`), "Ei linkitettyjä tapahtumia.")}
  `;
  $("#detail-edit-observation").addEventListener(
    "click", () => openObservationEditor("edit", observation.id),
  );
  $("#detail-delete-observation").addEventListener(
    "click", () => openDeleteConfirmation("observation", observation.id, renderObservationDetail),
  );
  $("#detail-create-event-from-observation").addEventListener("click", () => {
    closeDetailPanel();
    navigate("events");
    openEventEditor("new", null, { assetId: observation.assetId, observationIds: [observation.id] });
  });
}

function ensureObservationEditorHost() {
  let host = $("#observation-editor");
  if (!host) {
    host = document.createElement("div");
    host.id = "observation-editor";
    host.className = "subsection";
    const view = document.querySelector('.view[data-view="observations"]');
    view.insertBefore(host, $("#observations-list"));
  }
  return host;
}

function closeObservationEditor() {
  const host = $("#observation-editor");
  if (host) { host.hidden = true; host.innerHTML = ""; }
}

function openObservationEditor(mode, observationId) {
  const model = state.admin;
  const observation = mode === "edit" ? model.observations.find((o) => o.id === observationId) : null;
  const entitySources = observation ? (observation.sourceIds ?? []).join(", ") : "";
  const assetOptions = model.assets
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "fi"))
    .map((asset) => [asset.id, asset.name]);
  const host = ensureObservationEditorHost();
  host.hidden = false;
  host.innerHTML = `
    <form id="observation-form" class="card form-card" novalidate>
      <h3>${mode === "edit" ? "Muokkaa havaintoa" : "Uusi havainto"}</h3>
      <div class="form-grid">
        ${textField("observation-id", "Tunniste", observation?.id ?? "", { required: true, readonly: mode === "edit" })}
        ${selectField("observation-asset", "Rakennusosa", assetOptions, observation?.assetId ?? "")}
        ${dateField("observation-observed-at", "Havaintopäivä", observation?.observedAt ?? "", { required: true })}
        ${textareaField("observation-description", "Kuvaus", observation?.description ?? "")}
        ${textField("observation-source-ids", "Havainnon lähdetunnisteet", entitySources, { required: true })}
      </div>
      <fieldset class="form-grid">
        <legend class="form-hint">Muutoksen metatiedot (operaation lähteet esitäytetään havainnon lähteistä, muokattavissa)</legend>
        ${textField("observation-op-source-ids", "Operaation lähdetunnisteet", entitySources, { required: true })}
        ${textField("observation-explanation", "Muutoksen selitys", "", { required: true })}
      </fieldset>
      <p id="observation-feedback" class="form-feedback" role="status" aria-live="polite"></p>
      <div class="button-row">
        <button type="submit">Tallenna havainto</button>
        <button type="button" class="secondary" id="observation-cancel">Peruuta</button>
      </div>
    </form>
  `;
  $("#observation-form").onsubmit = (event) => submitObservationForm(event, mode);
  $("#observation-cancel").addEventListener("click", closeObservationEditor);
  wireSourceIdsPrefill("observation-source-ids", "observation-op-source-ids");
  host.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function submitObservationForm(event, mode) {
  event.preventDefault();
  clearFieldErrors("#observation-form");
  const raw = {
    id: fieldValue("observation-id"),
    assetId: fieldValue("observation-asset"),
    observedAt: fieldValue("observation-observed-at"),
    description: fieldValue("observation-description"),
    sourceIds: fieldValue("observation-source-ids"),
    operationSourceIds: fieldValue("observation-op-source-ids"),
    explanation: fieldValue("observation-explanation"),
  };
  const result = buildSaveObservationOperation(raw, state.admin.assets);
  if (!result.ok) {
    applyFieldErrors("#observation-form", {
      id: "observation-id", assetId: "observation-asset",
      observedAt: "observation-observed-at", description: "observation-description",
      sourceIds: "observation-source-ids",
      operationSourceIds: "observation-op-source-ids", explanation: "observation-explanation",
    }, result.errors);
    setFeedback("#observation-feedback", "Korjaa merkityt kentät.", "error");
    return;
  }
  const sent = await sendAdminOperations([result.operation], {
    successMessage: mode === "edit" ? "Havainto päivitetty." : "Havainto lisätty.",
  });
  if (sent.ok) {
    state.selection = { view: "observations", id: result.operation.value.id };
    closeObservationEditor();
    renderObservations();
    renderDetailPanel();
    openDetailPanel();
  } else if (sent.conflict) {
    setFeedback("#observation-feedback", "Tiedot muuttuivat — lataa työtila uudelleen.", "error");
  }
}

/* -------- Kustannusnäyttö -------- */

function filteredCostEvidence() {
  const model = state.admin;
  const status = $("#cost-evidence-filter-status").value;
  const assetFilter = $("#cost-evidence-filter-asset").value;
  const gapOnly = $("#cost-evidence-filter-gap-only").checked;
  return model.costEvidence.filter((evidence) => {
    if (status && evidence.status !== status) return false;
    if (assetFilter && evidence.assetId !== assetFilter) return false;
    if (gapOnly && evidence.status !== "data_gap") return false;
    return true;
  });
}

function renderCostEvidence() {
  if (!state.admin) return;
  const model = state.admin;
  populateAssetSelect($("#cost-evidence-filter-asset"), model.assets, { includeEmpty: true });

  const allRows = buildCostEvidenceListViewModel(
    model.costEvidence, model.assets, model.priceLevelConfirmations,
  ).rows;
  const counts = {
    quote: allRows.filter((row) => row.status === "quote" && !isCostEvidenceExpired(row)).length,
    estimate: allRows.filter((row) =>
      (row.status === "estimate" || row.status === "estimate_from_actual") &&
      !isCostEvidenceExpired(row)).length,
    dataGap: allRows.filter((row) => row.isDataGap).length,
  };
  $("#cost-evidence-kpis").innerHTML = [
    ["Voimassa olevat tarjoukset", counts.quote],
    ["Voimassa olevat arviot", counts.estimate],
    ["DATA GAPit", counts.dataGap],
  ].map(kpiCard).join("");

  const vm = buildCostEvidenceListViewModel(
    filteredCostEvidence(), model.assets, model.priceLevelConfirmations,
  );
  const host = $("#cost-evidence-list");
  if (vm.isEmpty) {
    const anyEvidence = model.costEvidence.length > 0;
    host.innerHTML = stateBlock({
      kind: "empty",
      title: anyEvidence ? "Ei osumia suodattimilla" : "Ei vielä kustannusnäyttöä",
      body: anyEvidence ? "Muuta tila-, rakennusosa- tai DATA GAP -suodatinta." : vm.emptyMessage,
    });
    return;
  }
  const selectedId = selectionId("cost-evidence");
  host.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th>Kohde</th><th>Tila</th><th class="num">Summa</th><th>Yksikkö</th>
      <th class="num">Määrä</th><th>Hintatasovuosi</th><th>Hintatasovahvistus</th>
      <th>Voimassaolo</th><th>Lähde</th><th></th>
    </tr></thead>
    <tbody>${vm.rows.map((row) => costEvidenceRow(row, row.id === selectedId)).join("")}</tbody>
  </table></div>`;
  for (const row of $$("#cost-evidence-list tr[data-cost-evidence-id]")) {
    row.querySelector(".row-select").addEventListener(
      "click", () => selectCostEvidence(row.dataset.costEvidenceId),
    );
  }
}

function costEvidenceRow(row, selected) {
  const amount = row.isDataGap
    ? `<span class="badge gap">DATA GAP</span>`
    : money(row.amount ?? 0);
  const target = row.assetName ?? (row.eventId ? `Tapahtuma ${row.eventId}` : "—");
  const expired = isCostEvidenceExpired(row) ? ` <span class="badge inactive">Vanhentunut</span>` : "";
  const confirmation = row.isDataGap
    ? "—"
    : row.hasPriceLevelConfirmation
      ? `<span class="badge active">Vahvistettu</span>`
      : row.needsPriceLevelConfirmation
        ? `<span class="badge gap">Ei vahvistettu</span>`
        : "—";
  const source = row.sourceUrl
    ? `<a href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="noopener">Linkki</a>`
    : escapeHtml(row.sourceId ?? "—");
  const rowClasses = [selected ? "is-selected" : "", row.isDataGap ? "is-gap" : ""].filter(Boolean).join(" ");
  return `<tr class="${rowClasses}" data-cost-evidence-id="${escapeHtml(row.id)}">
    <td>${escapeHtml(target)}</td>
    <td>${escapeHtml(COST_EVIDENCE_STATUS_LABELS[row.status] ?? row.status)}</td>
    <td class="num">${amount}</td>
    <td>${escapeHtml(row.unit)}</td>
    <td class="num">${row.quantity ?? "—"}</td>
    <td>${row.priceLevelYear}</td>
    <td>${confirmation}</td>
    <td>${escapeHtml(row.validUntil ?? "—")}${expired}</td>
    <td>${source}</td>
    <td><button type="button" class="secondary row-select">Näytä</button></td>
  </tr>`;
}

function selectCostEvidence(costEvidenceId) {
  state.selection = { view: "cost-evidence", id: costEvidenceId };
  renderCostEvidence();
  renderDetailPanel();
  openDetailPanel();
}

function renderCostEvidenceDetail() {
  const model = state.admin;
  const evidence = model.costEvidence.find((item) => item.id === selectionId("cost-evidence"));
  if (!evidence) { closeDetailPanel(); return; }
  const asset = evidence.assetId ? model.assets.find((item) => item.id === evidence.assetId) : undefined;
  const isDataGap = evidence.status === "data_gap";
  const confirmed = model.priceLevelConfirmations.some((item) =>
    item.costEvidenceId === evidence.id && item.targetYear === PROJECTION_PRICE_LEVEL_YEAR);
  const needsConfirmation = !isDataGap && evidence.priceLevelYear !== PROJECTION_PRICE_LEVEL_YEAR;

  $("#detail-panel-title").textContent = "Kustannusnäyttö";
  $("#detail-panel-body").innerHTML = `
    <div class="detail-group">
      <div class="detail-item"><span>Kohde</span><strong>${escapeHtml(asset?.name ?? evidence.eventId ?? "—")}</strong></div>
      <div class="detail-item"><span>Tila</span><strong>${escapeHtml(COST_EVIDENCE_STATUS_LABELS[evidence.status] ?? evidence.status)}</strong></div>
      <div class="detail-item"><span>Summa</span><strong>${isDataGap ? "DATA GAP" : money(evidence.amount ?? 0)}</strong></div>
      <div class="detail-item"><span>Yksikkö / määrä</span><strong>${escapeHtml(evidence.unit)}${evidence.quantity !== undefined ? ` · ${evidence.quantity}` : ""}</strong></div>
      <div class="detail-item"><span>Hintatasovuosi</span><strong>${evidence.priceLevelYear}${confirmed ? ` · vahvistettu ${PROJECTION_PRICE_LEVEL_YEAR}` : ""}</strong></div>
      <div class="detail-item"><span>Voimassaolo</span><strong>${escapeHtml(evidence.validUntil ?? "—")}</strong></div>
      <div class="detail-item"><span>Lähde</span><strong>${evidence.sourceUrl ? `<a href="${escapeHtml(evidence.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(evidence.sourceUrl)}</a>` : escapeHtml(evidence.sourceId ?? "—")}</strong></div>
      <div class="detail-item"><span>Huomio</span><strong>${escapeHtml(evidence.notes ?? "—")}</strong></div>
    </div>
    <div class="button-row">
      <button type="button" class="secondary" id="detail-edit-cost-evidence">Muokkaa</button>
      <button type="button" class="danger" id="detail-delete-cost-evidence">Poista</button>
      ${needsConfirmation && !confirmed
        ? `<button type="button" class="secondary" id="detail-confirm-price-level">Vahvista hintataso ${PROJECTION_PRICE_LEVEL_YEAR}</button>`
        : ""}
    </div>
  `;
  $("#detail-edit-cost-evidence").addEventListener(
    "click", () => openCostEvidenceEditor("edit", evidence.id),
  );
  $("#detail-delete-cost-evidence").addEventListener(
    "click", () => openDeleteConfirmation("cost_evidence", evidence.id, renderCostEvidenceDetail),
  );
  const confirmButton = $("#detail-confirm-price-level");
  if (confirmButton) {
    confirmButton.addEventListener("click", () => openPriceLevelConfirmationEditor(evidence.id));
  }
}

function ensureCostEvidenceEditorHost() {
  let host = $("#cost-evidence-editor");
  if (!host) {
    host = document.createElement("div");
    host.id = "cost-evidence-editor";
    host.className = "subsection";
    const view = document.querySelector('.view[data-view="cost-evidence"]');
    view.insertBefore(host, $("#cost-evidence-list"));
  }
  return host;
}

function closeCostEvidenceEditor() {
  const host = $("#cost-evidence-editor");
  if (host) { host.hidden = true; host.innerHTML = ""; }
}

function openCostEvidenceEditor(mode, costEvidenceId) {
  const model = state.admin;
  const evidence = mode === "edit" ? model.costEvidence.find((item) => item.id === costEvidenceId) : null;
  const assetOptions = [["", "Ei kytkentää"]].concat(
    model.assets
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "fi"))
      .map((asset) => [asset.id, asset.name]),
  );
  const statusOptions = COST_EVIDENCE_STATUSES.map((status) => [status, COST_EVIDENCE_STATUS_LABELS[status] ?? status]);
  const host = ensureCostEvidenceEditorHost();
  host.hidden = false;
  host.innerHTML = `
    <form id="cost-evidence-form" class="card form-card" novalidate>
      <h3>${mode === "edit" ? "Muokkaa kustannusnäyttöä" : "Uusi kustannusnäyttö"}</h3>
      <div class="form-grid">
        ${textField("cost-evidence-id", "Tunniste", evidence?.id ?? "", { required: true, readonly: mode === "edit" })}
        ${selectField("cost-evidence-asset", "Rakennusosa", assetOptions, evidence?.assetId ?? "")}
        ${selectField("cost-evidence-status", "Tila", statusOptions, evidence?.status ?? "quote")}
        ${numberField("cost-evidence-amount", "Summa €", evidence?.amount ?? "", { min: 0, step: "0.01" })}
        ${textField("cost-evidence-unit", "Yksikkö", evidence?.unit ?? "", { required: true })}
        ${numberField("cost-evidence-quantity", "Määrä", evidence?.quantity ?? "", { min: 1, step: 1 })}
        ${numberField("cost-evidence-price-level-year", "Hintatasovuosi", evidence?.priceLevelYear ?? PROJECTION_PRICE_LEVEL_YEAR, { required: true, step: 1 })}
        ${selectField("cost-evidence-vat-included", "ALV sisältyy", [["", "Ei tiedossa"], ["true", "Kyllä"], ["false", "Ei"]], evidence?.vatIncluded === undefined ? "" : String(evidence.vatIncluded))}
        ${dateField("cost-evidence-observed-at", "Havaintopäivä", evidence?.observedAt ?? "")}
        ${dateField("cost-evidence-valid-until", "Voimassa asti", evidence?.validUntil ?? "")}
        ${textField("cost-evidence-source-id", "Lähdetunniste", evidence?.sourceId ?? "")}
        ${textField("cost-evidence-source-url", "Lähde-URL", evidence?.sourceUrl ?? "")}
        ${textareaField("cost-evidence-notes", "Huomio", evidence?.notes ?? "")}
      </div>
      <p class="form-hint">Anna joko lähdetunniste tai lähde-URL. DATA GAP -tilalla summakenttä tyhjennetään eikä sitä lähetetä.</p>
      <fieldset class="form-grid">
        <legend class="form-hint">Muutoksen metatiedot</legend>
        ${textField("cost-evidence-op-source-ids", "Operaation lähdetunnisteet", "", { required: true })}
        ${textField("cost-evidence-explanation", "Muutoksen selitys", "", { required: true })}
      </fieldset>
      <p id="cost-evidence-feedback" class="form-feedback" role="status" aria-live="polite"></p>
      <div class="button-row">
        <button type="submit">Tallenna kustannusnäyttö</button>
        <button type="button" class="secondary" id="cost-evidence-cancel">Peruuta</button>
      </div>
    </form>
  `;
  if (evidence?.eventId) {
    const eventIdField = document.createElement("input");
    eventIdField.type = "hidden";
    eventIdField.id = "cost-evidence-event-id";
    eventIdField.value = evidence.eventId;
    $("#cost-evidence-form").append(eventIdField);
  }
  $("#cost-evidence-status").addEventListener("change", updateCostEvidenceAmountState);
  updateCostEvidenceAmountState();
  $("#cost-evidence-form").onsubmit = (event) => submitCostEvidenceForm(event, mode);
  $("#cost-evidence-cancel").addEventListener("click", closeCostEvidenceEditor);
  host.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/**
 * DATA GAP -kriittinen sääntö (L-004): kun tila on data_gap, summakenttä
 * tyhjennetään ja lukitaan, jotta tuntematon kustannus ei koskaan tallennu
 * nollana tai jonkin muun statuksen alla piilotettuna summana.
 */
function updateCostEvidenceAmountState() {
  const status = fieldValue("cost-evidence-status");
  const amountField = $("#cost-evidence-amount");
  const isDataGap = status === "data_gap";
  amountField.disabled = isDataGap;
  if (isDataGap) amountField.value = "";
}

async function submitCostEvidenceForm(event, mode) {
  event.preventDefault();
  clearFieldErrors("#cost-evidence-form");
  const raw = {
    id: fieldValue("cost-evidence-id"),
    assetId: fieldValue("cost-evidence-asset"),
    eventId: $("#cost-evidence-event-id")?.value ?? "",
    status: fieldValue("cost-evidence-status"),
    amount: fieldValue("cost-evidence-amount"),
    unit: fieldValue("cost-evidence-unit"),
    quantity: fieldValue("cost-evidence-quantity"),
    priceLevelYear: fieldValue("cost-evidence-price-level-year"),
    vatIncluded: fieldValue("cost-evidence-vat-included"),
    observedAt: fieldValue("cost-evidence-observed-at"),
    validUntil: fieldValue("cost-evidence-valid-until"),
    sourceId: fieldValue("cost-evidence-source-id"),
    sourceUrl: fieldValue("cost-evidence-source-url"),
    notes: fieldValue("cost-evidence-notes"),
    operationSourceIds: fieldValue("cost-evidence-op-source-ids"),
    explanation: fieldValue("cost-evidence-explanation"),
  };
  const result = buildSaveCostEvidenceOperation(raw, state.admin.assets, state.admin.events);
  if (!result.ok) {
    applyFieldErrors("#cost-evidence-form", {
      id: "cost-evidence-id", assetId: "cost-evidence-asset", eventId: "cost-evidence-event-id",
      status: "cost-evidence-status", amount: "cost-evidence-amount", unit: "cost-evidence-unit",
      quantity: "cost-evidence-quantity", priceLevelYear: "cost-evidence-price-level-year",
      observedAt: "cost-evidence-observed-at", validUntil: "cost-evidence-valid-until",
      sourceId: "cost-evidence-source-id", sourceUrl: "cost-evidence-source-url",
      operationSourceIds: "cost-evidence-op-source-ids", explanation: "cost-evidence-explanation",
    }, result.errors);
    setFeedback("#cost-evidence-feedback", "Korjaa merkityt kentät.", "error");
    return;
  }
  const sent = await sendAdminOperations([result.operation], {
    successMessage: mode === "edit" ? "Kustannusnäyttö päivitetty." : "Kustannusnäyttö lisätty.",
  });
  if (sent.ok) {
    state.selection = { view: "cost-evidence", id: result.operation.value.id };
    closeCostEvidenceEditor();
    renderCostEvidence();
    renderDetailPanel();
    openDetailPanel();
  } else if (sent.conflict) {
    setFeedback("#cost-evidence-feedback", "Tiedot muuttuivat — lataa työtila uudelleen.", "error");
  }
}

/* -------- Hintatasovahvistus (kevyt rivitoiminto, decision 5.5) -------- */

function openPriceLevelConfirmationEditor(costEvidenceId) {
  const host = ensureCostEvidenceEditorHost();
  host.hidden = false;
  const confirmedBy = state.auth?.user?.email ?? "";
  host.innerHTML = `
    <form id="price-level-confirmation-form" class="card form-card narrow-card" novalidate>
      <h3>Vahvista hintataso ${PROJECTION_PRICE_LEVEL_YEAR}</h3>
      <div class="form-grid">
        ${textField("plc-confirmed-by", "Vahvistaja", confirmedBy, { required: true })}
        ${dateField("plc-confirmed-at", "Vahvistuspäivä", new Date().toISOString().slice(0, 10), { required: true })}
      </div>
      <fieldset class="form-grid">
        <legend class="form-hint">Muutoksen metatiedot</legend>
        ${textField("plc-op-source-ids", "Operaation lähdetunnisteet", "", { required: true })}
        ${textField("plc-explanation", "Muutoksen selitys", "", { required: true })}
      </fieldset>
      <p id="plc-feedback" class="form-feedback" role="status" aria-live="polite"></p>
      <div class="button-row">
        <button type="submit">Vahvista</button>
        <button type="button" class="secondary" id="plc-cancel">Peruuta</button>
      </div>
    </form>
  `;
  $("#price-level-confirmation-form").onsubmit = (event) =>
    submitPriceLevelConfirmationForm(event, costEvidenceId);
  $("#plc-cancel").addEventListener("click", closeCostEvidenceEditor);
  host.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function submitPriceLevelConfirmationForm(event, costEvidenceId) {
  event.preventDefault();
  clearFieldErrors("#price-level-confirmation-form");
  const raw = {
    costEvidenceId,
    confirmedAt: fieldValue("plc-confirmed-at"),
    confirmedBy: fieldValue("plc-confirmed-by"),
    operationSourceIds: fieldValue("plc-op-source-ids"),
    explanation: fieldValue("plc-explanation"),
  };
  const result = buildSavePriceLevelConfirmationOperation(raw, state.admin.costEvidence);
  if (!result.ok) {
    applyFieldErrors("#price-level-confirmation-form", {
      confirmedAt: "plc-confirmed-at",
      confirmedBy: "plc-confirmed-by",
      operationSourceIds: "plc-op-source-ids", explanation: "plc-explanation",
    }, result.errors);
    setFeedback(
      "#plc-feedback",
      result.errors.costEvidenceId ?? "Korjaa merkityt kentät.",
      "error",
    );
    return;
  }
  const sent = await sendAdminOperations([result.operation], {
    successMessage: "Hintataso vahvistettu.",
  });
  if (sent.ok) {
    closeCostEvidenceEditor();
    renderCostEvidence();
    renderDetailPanel();
  } else if (sent.conflict) {
    setFeedback("#plc-feedback", "Tiedot muuttuivat — lataa työtila uudelleen.", "error");
  }
}

/* -------- Korjaustapahtumat -------- */

function eventFilters() {
  const year = $("#events-filter-year").value;
  const status = $("#events-filter-status").value;
  const type = $("#events-filter-type").value;
  const assetId = $("#events-filter-asset").value;
  return {
    year: year === "" ? undefined : Number(year),
    status: status === "" ? undefined : status,
    type: type === "" ? undefined : type,
    assetId: assetId === "" ? undefined : assetId,
    gapOnly: $("#events-filter-gap-only").checked,
  };
}

// Defaults the year filter to "Kuluva kausi <nykyinen vuosi>" once per load
// (Näkymäspesifikaatio §7.3), but never overwrites a filter the user already
// touched.
function populateEventYearFilter(events) {
  const select = $("#events-filter-year");
  const years = deriveEventYearOptions(events);
  const current = select.value;
  select.innerHTML = `<option value="">Kaikki</option>` +
    years.map((year) => `<option value="${year}">${year}</option>`).join("");
  if (!state.eventsYearFilterInitialized) {
    state.eventsYearFilterInitialized = true;
    const nowYear = new Date().getFullYear();
    if (years.includes(nowYear)) { select.value = String(nowYear); return; }
  }
  select.value = current !== "" && years.includes(Number(current)) ? current : "";
}

function renderEvents() {
  if (!state.admin) return;
  const model = state.admin;
  populateAssetSelect($("#events-filter-asset"), model.assets, { includeEmpty: true });
  populateEventYearFilter(model.events);

  $("#events-kpis").innerHTML = [
    ["Ehdotettu", model.counts.suggestedEvents],
    ["Hyväksytty", model.counts.approvedEvents],
    ["Toteutunut", model.counts.actualEvents],
    ["Peruttu", model.counts.cancelledEvents],
  ].map(kpiCard).join("");

  const vm = buildEventListViewModel(model.events, model.assets, model.costEvidence, eventFilters());
  const host = $("#events-list");
  if (vm.isEmpty) {
    const anyEvents = model.events.length > 0;
    host.innerHTML = stateBlock({
      kind: "empty",
      title: anyEvents ? "Ei osumia suodattimilla" : "Ei vielä korjaustapahtumia",
      body: anyEvents ? "Muuta vuosi-, tila-, tyyppi- tai rakennusosasuodatinta." : vm.emptyMessage,
    });
    return;
  }
  const selectedId = selectionId("events");
  host.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Rakennusosa</th><th>Otsikko</th><th>Tyyppi</th><th>Tila</th><th>Vuodet</th><th></th></tr></thead>
    <tbody>${vm.rows.map((row) => {
      const rowClasses = [row.id === selectedId ? "is-selected" : "", row.hasDataGap ? "is-gap" : ""].filter(Boolean).join(" ");
      return `<tr class="${rowClasses}" data-event-id="${escapeHtml(row.id)}">
        <td>${escapeHtml(row.assetName)}</td>
        <td>${escapeHtml(row.title)}</td>
        <td>${escapeHtml(EVENT_TYPE_LABELS[row.type] ?? row.type)}</td>
        <td>${escapeHtml(EVENT_STATUS_LABELS[row.status] ?? row.status)}</td>
        <td>${escapeHtml(row.yearRange)}${row.hasDataGap ? ` <span class="badge gap">DATA GAP</span>` : ""}</td>
        <td><button type="button" class="secondary row-select">Näytä</button></td>
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;
  for (const row of $$("#events-list tr[data-event-id]")) {
    row.querySelector(".row-select").addEventListener("click", () => selectEvent(row.dataset.eventId));
  }
}

function selectEvent(eventId) {
  state.selection = { view: "events", id: eventId };
  renderEvents();
  renderDetailPanel();
  openDetailPanel();
}

function costEvidenceLabel(evidence, fallbackId) {
  if (!evidence) return fallbackId || "—";
  return evidence.status === "data_gap"
    ? `${evidence.id} (DATA GAP)`
    : `${evidence.id} · ${money(evidence.amount ?? 0)}`;
}

function renderEventDetail() {
  const model = state.admin;
  const event = model.events.find((item) => item.id === selectionId("events"));
  if (!event) { closeDetailPanel(); return; }
  const asset = model.assets.find((item) => item.id === event.assetId);
  const linkedObservations = model.observations.filter((o) =>
    (event.observationIds ?? []).includes(o.id));
  const evidenceById = new Map(model.costEvidence.map((item) => [item.id, item]));

  const scheduleBlock = event.status === "actual"
    ? detailGroup("Toteuma", event.actual ? [
        `<li>Vuosi ${event.actual.year}${event.actual.occurredAt ? ` · ${escapeHtml(event.actual.occurredAt)}` : ""}${event.actual.amount !== undefined ? ` · ${money(event.actual.amount)}` : ""}${event.actual.quantity !== undefined ? ` · ${event.actual.quantity} kpl` : ""}</li>`,
        `<li>${escapeHtml(costEvidenceLabel(evidenceById.get(event.actual.costEvidenceId), event.actual.costEvidenceId))}</li>`,
      ] : [], "Ei toteumatietoja.")
    : SCENARIOS.map((scenario) => {
        const rows = groupScheduleByScenario(event.schedule ?? [])[scenario] ?? [];
        return detailGroup(SCENARIO_LABELS[scenario], rows.map((entry) => {
          const evidence = evidenceById.get(entry.costEvidenceId);
          return `<li>${entry.year}${entry.amount !== undefined ? ` · ${money(entry.amount)}` : ""}${entry.quantity !== undefined ? ` · ${entry.quantity} kpl` : ""} · ${escapeHtml(costEvidenceLabel(evidence, entry.costEvidenceId))}</li>`;
        }), "Ei rivejä.");
      }).join("");

  $("#detail-panel-title").textContent = event.title;
  $("#detail-panel-body").innerHTML = `
    <div class="detail-group">
      <div class="detail-item"><span>Rakennusosa</span><strong>${escapeHtml(asset?.name ?? event.assetId)}</strong></div>
      <div class="detail-item"><span>Tyyppi</span><strong>${escapeHtml(EVENT_TYPE_LABELS[event.type] ?? event.type)}</strong></div>
      <div class="detail-item"><span>Tila</span><strong>${escapeHtml(EVENT_STATUS_LABELS[event.status] ?? event.status)}</strong></div>
      <div class="detail-item"><span>Alkuperä</span><strong>${escapeHtml(event.origin)}</strong></div>
      <div class="detail-item"><span>Huomio</span><strong>${escapeHtml(event.notes ?? "—")}</strong></div>
      <div class="detail-item"><span>Lähdetunnisteet</span><strong>${escapeHtml((event.sourceIds ?? []).join(", ") || "—")}</strong></div>
    </div>
    <div class="button-row">
      <button type="button" class="secondary" id="detail-edit-event">Muokkaa</button>
      <button type="button" class="danger" id="detail-delete-event">Poista</button>
    </div>
    ${scheduleBlock}
    ${detailGroup("Linkitetyt havainnot", linkedObservations.map((o) =>
      `<li><strong>${escapeHtml(o.observedAt)}</strong><br>${escapeHtml(o.description)}</li>`), "Ei linkitettyjä havaintoja.")}
  `;
  $("#detail-edit-event").addEventListener("click", () => openEventEditor("edit", event.id));
  $("#detail-delete-event").addEventListener(
    "click", () => openDeleteConfirmation("building_event", event.id, renderEventDetail),
  );
}

function ensureEventEditorHost() {
  let host = $("#event-editor");
  if (!host) {
    host = document.createElement("div");
    host.id = "event-editor";
    host.className = "subsection";
    const view = document.querySelector('.view[data-view="events"]');
    view.insertBefore(host, $("#events-list"));
  }
  return host;
}

function closeEventEditor() {
  const host = $("#event-editor");
  if (host) { host.hidden = true; host.innerHTML = ""; }
}

function costEvidenceOptions(model) {
  return [["", "Valitse kustannusnäyttö"]].concat(
    model.costEvidence
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id, "fi"))
      .map((item) => [
        item.id,
        item.status === "data_gap"
          ? `${item.id} (DATA GAP)`
          : `${item.id} · ${COST_EVIDENCE_STATUS_LABELS[item.status] ?? item.status}`,
      ]),
  );
}

function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Opens the building-event editor. `prefill` is used by the "Luo
 * korjaustapahtuma" button on a havainto's detail panel (decision 5.5):
 * `{ assetId, observationIds }` pre-fills the asset and the observation link,
 * the rest (schedule, cost evidence) is left for the user to fill in.
 */
function openEventEditor(mode, eventId, prefill) {
  const model = state.admin;
  const event = mode === "edit" ? model.events.find((e) => e.id === eventId) : null;
  const entitySources = event ? (event.sourceIds ?? []).join(", ") : "";
  const assetOptions = model.assets
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "fi"))
    .map((asset) => [asset.id, asset.name]);
  const typeOptions = EVENT_TYPES.map((type) => [type, EVENT_TYPE_LABELS[type] ?? type]);
  const statusOptions = EVENT_STATUSES.map((status) => [status, EVENT_STATUS_LABELS[status] ?? status]);
  const origin = event?.origin ?? "manual";
  const observationIds = event
    ? (event.observationIds ?? []).join(", ")
    : (prefill?.observationIds ?? []).join(", ");
  const assetId = event?.assetId ?? prefill?.assetId ?? "";

  const host = ensureEventEditorHost();
  host.hidden = false;
  host.innerHTML = `
    <form id="event-form" class="card form-card wide-card" novalidate>
      <h3>${mode === "edit" ? "Muokkaa korjaustapahtumaa" : "Uusi korjaustapahtuma"}</h3>
      <div class="form-grid">
        ${textField("event-id", "Tunniste", event?.id ?? "", { required: true, readonly: mode === "edit" })}
        ${selectField("event-asset", "Rakennusosa", assetOptions, assetId)}
        ${textField("event-title", "Otsikko", event?.title ?? "", { required: true })}
        ${selectField("event-type", "Tyyppi", typeOptions, event?.type ?? "")}
        ${selectField("event-status", "Tila", statusOptions, event?.status ?? "suggested")}
        ${textareaField("event-notes", "Huomio", event?.notes ?? "")}
        ${textField("event-observation-ids", "Linkitetyt havainnot (tunnisteet)", observationIds, {})}
        ${textField("event-source-ids", "Tapahtuman lähdetunnisteet", entitySources, { required: true })}
      </div>
      <p class="form-hint">Alkuperä: ${escapeHtml(origin === "manual" ? "Manuaalinen" : origin)}</p>
      <input type="hidden" id="event-origin" value="${escapeHtml(origin)}">

      <div id="event-schedule-editor" class="schedule-editor">
        <h4>Skenaariorivit</h4>
        <p class="form-hint">Tarkat rivit skenaarioittain. Ei automaattista sykliä tai generointia.</p>
        <span id="event-schedule-error" class="field-error"></span>
        <div class="schedule-scenario-columns">
          ${SCENARIOS.map((scenario) => `
            <div class="subsection schedule-scenario-column" data-scenario-column="${scenario}">
              <h5>${escapeHtml(SCENARIO_LABELS[scenario])}</h5>
              <div id="event-schedule-rows-${scenario}" class="schedule-rows"></div>
              <button type="button" class="secondary schedule-add-row" data-scenario="${scenario}">+ Lisää rivi</button>
            </div>
          `).join("")}
        </div>
      </div>

      <div id="event-actual-editor" class="card form-card" hidden>
        <h4>Toteuma</h4>
        <div class="form-grid">
          ${numberField("event-actual-year", "Toteumavuosi", event?.actual?.year ?? "", { required: true, step: 1 })}
          ${dateField("event-actual-occurred-at", "Toteutumispäivä", event?.actual?.occurredAt ?? "")}
          ${numberField("event-actual-amount", "Summa €", event?.actual?.amount ?? "", { min: 0, step: "0.01" })}
          ${numberField("event-actual-quantity", "Määrä", event?.actual?.quantity ?? "", { min: 1, step: 1 })}
          ${selectField("event-actual-cost-evidence", "Kustannusnäyttö", costEvidenceOptions(model), event?.actual?.costEvidenceId ?? "")}
        </div>
      </div>

      <fieldset class="form-grid">
        <legend class="form-hint">Muutoksen metatiedot (operaation lähteet esitäytetään tapahtuman lähteistä, muokattavissa)</legend>
        ${textField("event-op-source-ids", "Operaation lähdetunnisteet", entitySources, { required: true })}
        ${textField("event-explanation", "Muutoksen selitys", "", { required: true })}
      </fieldset>
      <p id="event-feedback" class="form-feedback" role="status" aria-live="polite"></p>
      <div class="button-row">
        <button type="submit">Tallenna tapahtuma</button>
        <button type="button" class="secondary" id="event-cancel">Peruuta</button>
      </div>
    </form>
  `;

  for (const scenario of SCENARIOS) {
    for (const row of (event?.schedule ?? []).filter((entry) => entry.scenario === scenario)) {
      appendScheduleRow(scenario, row);
    }
  }
  for (const button of $$("#event-schedule-editor .schedule-add-row")) {
    button.addEventListener("click", () => appendScheduleRow(button.dataset.scenario));
  }

  $("#event-status").addEventListener("change", updateEventEditorStatusState);
  updateEventEditorStatusState();
  $("#event-form").onsubmit = (formEvent) => submitEventForm(formEvent, mode);
  $("#event-cancel").addEventListener("click", closeEventEditor);
  wireSourceIdsPrefill("event-source-ids", "event-op-source-ids");
  host.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function appendScheduleRow(scenario, entry) {
  const rowsId = `event-schedule-rows-${scenario}`;
  const container = $(`#${rowsId}`);
  const uid = entry?.id ?? generateId("schedule_row");
  const row = document.createElement("div");
  row.className = "schedule-row";
  row.dataset.rowUid = uid;
  row.dataset.scenario = scenario;
  row.innerHTML = `
    <div class="form-grid compact">
      ${textField(`event-schedule-${uid}-id`, "Rivitunniste", uid, { readonly: true })}
      ${numberField(`event-schedule-${uid}-year`, "Vuosi", entry?.year ?? "", { required: true, step: 1 })}
      ${numberField(`event-schedule-${uid}-amount`, "Summa €", entry?.amount ?? "", { min: 0, step: "0.01" })}
      ${numberField(`event-schedule-${uid}-quantity`, "Määrä", entry?.quantity ?? "", { min: 1, step: 1 })}
      ${selectField(`event-schedule-${uid}-cost-evidence`, "Kustannusnäyttö", costEvidenceOptions(state.admin), entry?.costEvidenceId ?? "")}
      ${textField(`event-schedule-${uid}-explanation`, "Selitys", entry?.explanation ?? "")}
    </div>
    <div class="button-row">
      <button type="button" class="secondary schedule-copy-row">Kopioi kaikkiin skenaarioihin</button>
      <button type="button" class="secondary schedule-remove-row">Poista rivi</button>
    </div>
  `;
  container.append(row);
  row.querySelector(".schedule-copy-row").addEventListener("click", () => copyScheduleRowUiAction(uid));
  row.querySelector(".schedule-remove-row").addEventListener("click", () => row.remove());
}

// "Kopioi rivi kaikkiin skenaarioihin" (L-003): duplicates the row the user
// just filled in as a starting point for the other two scenarios. Never
// infers numbers — the user edits the per-scenario differences afterward.
function copyScheduleRowUiAction(uid) {
  const row = document.querySelector(`.schedule-row[data-row-uid="${uid}"]`);
  if (!row) return;
  const source = {
    id: uid,
    year: fieldValue(`event-schedule-${uid}-year`),
    amount: fieldValue(`event-schedule-${uid}-amount`),
    quantity: fieldValue(`event-schedule-${uid}-quantity`),
    costEvidenceId: fieldValue(`event-schedule-${uid}-cost-evidence`),
    explanation: fieldValue(`event-schedule-${uid}-explanation`),
  };
  const existingRows = $$(".schedule-row").map((el) => ({ id: el.dataset.rowUid }));
  for (const copy of copyScheduleRowToAllScenarios(source, existingRows)) {
    appendScheduleRow(copy.scenario, copy);
  }
}

function updateEventEditorStatusState() {
  const status = fieldValue("event-status");
  $("#event-schedule-editor").hidden = status === "actual";
  $("#event-actual-editor").hidden = status !== "actual";
}

async function submitEventForm(formEvent, mode) {
  formEvent.preventDefault();
  clearFieldErrors("#event-form");
  const status = fieldValue("event-status");
  const raw = {
    id: fieldValue("event-id"),
    assetId: fieldValue("event-asset"),
    title: fieldValue("event-title"),
    type: fieldValue("event-type"),
    status,
    origin: fieldValue("event-origin"),
    notes: fieldValue("event-notes"),
    observationIds: fieldValue("event-observation-ids"),
    sourceIds: fieldValue("event-source-ids"),
    operationSourceIds: fieldValue("event-op-source-ids"),
    explanation: fieldValue("event-explanation"),
  };

  /** Maps this submission's `schedule.<index>.<field>` error keys to real field ids. */
  const scheduleFieldMap = {};
  if (status === "actual") {
    raw.actualYear = fieldValue("event-actual-year");
    raw.actualOccurredAt = fieldValue("event-actual-occurred-at");
    raw.actualAmount = fieldValue("event-actual-amount");
    raw.actualQuantity = fieldValue("event-actual-quantity");
    raw.actualCostEvidenceId = fieldValue("event-actual-cost-evidence");
  } else {
    raw.schedule = $$("#event-schedule-editor .schedule-row").map((row, index) => {
      const uid = row.dataset.rowUid;
      scheduleFieldMap[`schedule.${index}.id`] = `event-schedule-${uid}-id`;
      scheduleFieldMap[`schedule.${index}.year`] = `event-schedule-${uid}-year`;
      scheduleFieldMap[`schedule.${index}.costEvidenceId`] = `event-schedule-${uid}-cost-evidence`;
      scheduleFieldMap[`schedule.${index}.amount`] = `event-schedule-${uid}-amount`;
      scheduleFieldMap[`schedule.${index}.quantity`] = `event-schedule-${uid}-quantity`;
      return {
        id: uid,
        scenario: row.dataset.scenario,
        year: fieldValue(`event-schedule-${uid}-year`),
        amount: fieldValue(`event-schedule-${uid}-amount`),
        quantity: fieldValue(`event-schedule-${uid}-quantity`),
        costEvidenceId: fieldValue(`event-schedule-${uid}-cost-evidence`),
        explanation: fieldValue(`event-schedule-${uid}-explanation`),
      };
    });
  }

  const result = buildSaveBuildingEventOperation(
    raw, state.admin.assets, state.admin.costEvidence, state.admin.observations,
  );
  if (!result.ok) {
    applyFieldErrors("#event-form", {
      id: "event-id", assetId: "event-asset", title: "event-title", type: "event-type",
      status: "event-status", sourceIds: "event-source-ids", observationIds: "event-observation-ids",
      schedule: "event-schedule",
      actualYear: "event-actual-year", actualOccurredAt: "event-actual-occurred-at",
      actualAmount: "event-actual-amount", actualQuantity: "event-actual-quantity",
      actualCostEvidenceId: "event-actual-cost-evidence",
      operationSourceIds: "event-op-source-ids", explanation: "event-explanation",
      ...scheduleFieldMap,
    }, result.errors);
    setFeedback("#event-feedback", "Korjaa merkityt kentät.", "error");
    return;
  }
  const sent = await sendAdminOperations([result.operation], {
    successMessage: mode === "edit" ? "Korjaustapahtuma päivitetty." : "Korjaustapahtuma lisätty.",
  });
  if (sent.ok) {
    state.selection = { view: "events", id: result.operation.value.id };
    closeEventEditor();
    renderEvents();
    renderDetailPanel();
    openDetailPanel();
  } else if (sent.conflict) {
    setFeedback("#event-feedback", "Tiedot muuttuivat — lataa työtila uudelleen.", "error");
  }
}

function renderFinancePlaceholders() {
  // The chart below is computed from the imported account data, so the old
  // "this view does not use account data yet" text would contradict what is
  // on the same screen. The block stays — the rest of a summary view is still
  // to come — but says what is actually true.
  for (const host of $$("[data-finance]")) {
    host.innerHTML = renderSummaryChart() + stateBlock({
      kind: "not-modelled",
      title: "Yhteenveto on vielä osittainen",
      body: "Kaavio yllä on laskettu tuodusta tilidatasta. Muu yhteenveto ei ole vielä oma laskettu näkymä; Tulot, Kulut ryhmittäin, Kulut tileittäin, Budjetti vs. toteuma ja Taloudellinen asema käyttävät jo tuotua dataa.",
    });
  }
}

const SUMMARY_SERIES_LABELS = { income: "Tulot", expense: "Kulut" };

/**
 * Tulot ja kulut -kaavio Yhteenveto-näkymään (handoff feature/summary-chart).
 * Shares buildBarChartGeometry() with the group detail chart through
 * buildSummaryChartModel(), and reuses the same .group-chart markup, CSS,
 * fixed-height SVG and HTML label row — see renderGroupChart() for why the
 * text is not inside the SVG.
 *
 * Two bars per year on one shared scale, both drawn upward: their height
 * difference is the hoitokate, and nobody reads a difference between bars
 * pointing opposite ways. The label keeps the stored sign, so costs still
 * read as negative.
 *
 * The series are distinguished by colour AND by the label row naming both,
 * never by colour alone. A partially reported year is marked by a faded fill
 * plus the group count in its label — deliberately neither a dashed outline
 * nor hatching, both of which already mean "budget, a forecast" in the group
 * chart. Reusing a mark for a second meaning is worse than leaving it unused.
 */
function renderSummaryChart() {
  if (!state.admin) return "";
  const model = buildSummaryChartModel(
    buildIncomeViewModel(state.admin.financialAccounts, state.admin.financialEntries),
    buildExpenseGroupViewModel(state.admin.financialAccounts, state.admin.financialEntries),
  );
  if (model.isEmpty) return "";

  const bars = model.columns.flatMap((column) => column.bars)
    .filter((bar) => !bar.missing)
    .map((bar) => {
      const classes = ["group-chart-bar", `is-${bar.series}`];
      if (bar.partial) classes.push("is-partial");
      return `<rect class="${classes.join(" ")}" x="${bar.xPercent.toFixed(3)}" ` +
        `y="${(100 - bar.heightPercent).toFixed(3)}" width="${bar.widthPercent.toFixed(3)}" ` +
        `height="${bar.heightPercent.toFixed(3)}" vector-effect="non-scaling-stroke" />`;
    }).join("");

  const labels = model.columns.map((column) => {
    const values = column.bars.map((bar) => {
      const name = SUMMARY_SERIES_LABELS[bar.series];
      const amount = bar.missing ? "—" : moneyCompact(bar.value);
      const partialNote = bar.partial
        ? ` <span class="group-chart-partial">osittainen (${bar.reportingGroups}/${bar.totalGroups} ryhmää)</span>`
        : "";
      const missingClass = bar.missing ? " is-missing" : "";
      return `<span class="group-chart-value${missingClass}">${escapeHtml(`${name} ${amount}`)}${partialNote}</span>`;
    }).join("");
    return `<div class="group-chart-label">
      ${values}
      <span class="group-chart-year">${escapeHtml(String(column.year))}</span>
    </div>`;
  }).join("");

  const summary = model.columns.map((column) => {
    const parts = column.bars.map((bar) => {
      const name = SUMMARY_SERIES_LABELS[bar.series].toLowerCase();
      if (bar.missing) return `${name}: ei tietoa`;
      const partial = bar.partial ? ` (osittainen, ${bar.reportingGroups}/${bar.totalGroups} ryhmää)` : "";
      return `${name}: ${moneyCompact(bar.value)}${partial}`;
    });
    return `${column.year} ${parts.join(", ")}`;
  }).join("; ");
  const hasMissing = model.columns.some((column) => column.bars.some((bar) => bar.missing));

  return `<figure class="group-chart summary-chart">
    <figcaption class="group-chart-caption">Tulot ja kulut vuosittain (toteumat). Pylväiden korkeusero on hoitokate.</figcaption>
    <svg class="group-chart-plot" viewBox="0 0 100 100" preserveAspectRatio="none"
         role="img" aria-label="${escapeHtml(`Pylväskaavio, tulot ja kulut vuosittain: ${summary}.`)}">
      ${bars}
      <line class="group-chart-baseline" x1="0" y1="100" x2="100" y2="100"
            vector-effect="non-scaling-stroke" />
    </svg>
    <div class="group-chart-labels" style="grid-template-columns: repeat(${model.columns.length}, minmax(0, 1fr));">
      ${labels}
    </div>
    <figcaption class="group-chart-legend">
      <span class="group-chart-key"><span class="group-chart-swatch is-income"></span>Tulot</span>
      <span class="group-chart-key"><span class="group-chart-swatch is-expense"></span>Kulut (piirretty ylöspäin, luku miinusmerkkinen)</span>
      ${model.hasPartial ? `<span class="group-chart-key"><span class="group-chart-swatch is-partial-key"></span>Haalea = osittain tuotu vuosi, ei koko vuoden summa</span>` : ""}
      ${hasMissing ? `<span class="group-chart-key">— = lukua ei ole, ei nolla</span>` : ""}
    </figcaption>
  </figure>`;
}

function renderAccountCosts() {
  if (!state.admin) return;
  const vm = buildAccountCostsViewModel(state.admin.financialAccounts, state.admin.financialEntries);
  const host = $("#finance-costs-account-body");
  if (vm.isEmpty) {
    host.innerHTML = stateBlock({
      kind: "empty",
      title: "Ei vielä tilidataa",
      body: vm.emptyMessage,
    });
    return;
  }
  const headerCells = vm.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const groupBlocks = vm.groups.map((group) => {
    const rows = group.rows.map((row) => {
      const cells = vm.columns.map((column) => {
        const value = row.values[column.key];
        return `<td>${value === undefined ? "—" : money(value)}</td>`;
      }).join("");
      // One delete button per year the account actually has a row for, plus
      // one for the account itself: a FinancialEntry is keyed by account+year,
      // so that is the smallest thing there is to delete (handoff §3,
      // priority 2). Whole-import deletion lives in Liitä tilidataa.
      const years = [...new Set((state.admin.financialEntries ?? [])
        .filter((entry) => entry.accountCode === row.accountCode)
        .map((entry) => Number(entry.year)))].sort((a, b) => a - b);
      const yearButtons = years.map((year) =>
        `<button type="button" class="secondary delete-financial-entry" data-key="${escapeHtml(`${row.accountCode}:${year}`)}" title="Poista ${row.accountCode} / ${year}">${year}</button>`
      ).join("");
      return `<tr><td>${escapeHtml(row.accountCode)}</td><td>${escapeHtml(row.name)}</td>${cells}
        <td class="row-actions">${yearButtons}<button type="button" class="danger delete-financial-account" data-account="${escapeHtml(row.accountCode)}" title="Poista koko tili ja kaikki sen vuodet">Tili</button></td>
      </tr>`;
    }).join("");
    const totalCells = vm.columns.map((column) => `<td>${money(group.totals[column.key] ?? 0)}</td>`).join("");
    return `<tbody>
      <tr class="group-header"><td colspan="${3 + vm.columns.length}">${escapeHtml(group.group)}</td></tr>
      ${rows}
      <tr class="group-total"><td colspan="2">Ryhmä yhteensä</td>${totalCells}<td></td></tr>
    </tbody>`;
  }).join("");
  const grandTotalCells = vm.columns.map((column) => `<td>${money(vm.totals[column.key] ?? 0)}</td>`).join("");
  host.innerHTML = `<table class="data-table">
    <thead><tr><th>Tili</th><th>Nimi</th>${headerCells}<th>Poista</th></tr></thead>
    ${groupBlocks}
    <tfoot><tr><td colspan="2">Kaikki yhteensä</td>${grandTotalCells}<td></td></tr></tfoot>
  </table>`;
  for (const button of host.querySelectorAll(".delete-financial-entry")) {
    button.addEventListener(
      "click", () => openDeleteConfirmation("financial_entry", button.dataset.key),
    );
  }
  for (const button of host.querySelectorAll(".delete-financial-account")) {
    button.addEventListener(
      "click", () => openDeleteConfirmation("financial_account", button.dataset.account),
    );
  }
}

/**
 * Lists the imports behind the stored financial rows and group budgets,
 * grouped by source identifier, so one bad paste can be undone as a unit
 * (handoff §3, priority 1) instead of row by row.
 */
function renderDataImportList() {
  if (!state.admin) return;
  const host = $("#finance-import-list");
  const imports = listDataImports(state.admin);
  if (imports.length === 0) {
    host.innerHTML = stateBlock({
      kind: "empty",
      title: "Ei vielä tuonteja",
      body: "Liitetyt rivit näkyvät tässä lähdetunnisteittain, ja koko tuonnin voi poistaa kerralla.",
    });
    return;
  }
  const rows = imports.map((item) => `<tr>
    <td>${escapeHtml(item.label)}</td>
    <td>${item.years.length === 0 ? "—" : escapeHtml(item.years.join(", "))}</td>
    <td>${item.entryCount === 0 ? "—" : `${item.entryCount} riviä / ${item.accountCount} tiliä`}</td>
    <td>${item.groupBudgetCount === 0 ? "—" : `${item.groupBudgetCount} riviä`}</td>
    <td><button type="button" class="danger delete-data-import" data-key="${escapeHtml(item.key)}">Poista tuonti</button></td>
  </tr>`).join("");
  host.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Lähdetunnisteet</th><th>Vuodet</th><th>Talousrivit</th><th>Ryhmäbudjetit</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
  for (const button of host.querySelectorAll(".delete-data-import")) {
    button.addEventListener("click", () => openImportDeleteConfirmation(button.dataset.key));
  }
}

/** Formats a "Muutos" cell: amount plus a parenthesised percentage, or "—" if not computable. */
function formatChangeCell(amount, percentValue) {
  if (amount === undefined) return "—";
  const pct = percentValue === undefined ? "" : ` (${percent(percentValue)})`;
  return `${money(amount)}${pct}`;
}

/**
 * Selects a group row in one of the grouped finance views (Tulot, Kulut
 * ryhmittäin, Budjetti vs. toteuma) and opens it in the shared detail panel —
 * the same click-to-select-then-detail-panel pattern as assets/observations/
 * events/cost-evidence (decision: consistency over inventing a new pattern).
 * `id` is the group name for finance-income/finance-costs-group (unique per
 * view), and `kind::group` for finance-budget (a group name can appear in
 * both the income and expense sections there).
 * @param {"finance-income"|"finance-costs-group"|"finance-budget"} view
 * @param {string} id
 */
function selectFinanceGroup(view, id) {
  state.selection = { view, id };
  if (view === "finance-income") renderIncome();
  else if (view === "finance-costs-group") renderExpenseGroups();
  else renderBudgetVsActual();
  renderDetailPanel();
  openDetailPanel();
}

/** -------- Tulot (spec §6.1) -------- */

function renderIncome() {
  if (!state.admin) return;
  const vm = buildIncomeViewModel(state.admin.financialAccounts, state.admin.financialEntries);
  const host = $("#finance-income-body");
  if (vm.isEmpty) {
    host.innerHTML = stateBlock({ kind: "empty", title: "Ei vielä talousdataa", body: vm.emptyMessage });
    return;
  }
  const changeLabel = vm.changeYears
    ? `Muutos ${vm.changeYears.previous} → ${vm.changeYears.latest}`
    : "Muutos";
  const budgetLabel = vm.budgetYear !== null ? `Budjetti ${vm.budgetYear}` : "Budjetti";
  const yearHeaderCells = vm.actualYears.map((year) => `<th>Toteuma ${year}</th>`).join("");
  const selectedGroup = selectionId("finance-income");

  const rows = vm.groups.map((group) => {
    const actualCells = vm.actualYears
      .map((year) => `<td>${group.actuals[year] === undefined ? "—" : money(group.actuals[year])}</td>`)
      .join("");
    const rowClass = group.group === selectedGroup ? "is-selected" : "";
    const groupRow = `<tr class="${rowClass}" data-group="${escapeHtml(group.group)}">
      <td>${escapeHtml(group.group)}</td>
      ${actualCells}
      <td>${group.budget === undefined ? "—" : money(group.budget)}</td>
      <td>${formatChangeCell(group.changeAmount, group.changePercent)}</td>
      <td>${group.sharePercent === undefined ? "—" : percent(group.sharePercent)}</td>
      <td>${escapeHtml(group.notes || "—")}</td>
      <td><button type="button" class="secondary row-select">Näytä</button></td>
    </tr>`;
    if (!vm.showAccountRowsInline) return groupRow;
    // Muutos/Osuus tuloista are group-level metrics with no account-level
    // equivalent, so those cells stay genuinely empty rather than "—" (which
    // means DATA GAP in this app, not "not applicable").
    const accountRows = group.accountRows.map((row) => {
      const accountActualCells = vm.actualYears
        .map((year) => `<td>${row.actuals[year] === undefined ? "—" : money(row.actuals[year])}</td>`)
        .join("");
      return `<tr class="account-row">
        <td class="indent">${escapeHtml(row.accountCode)} ${escapeHtml(row.name)}</td>
        ${accountActualCells}
        <td>${row.budget === undefined ? "—" : money(row.budget)}</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
      </tr>`;
    }).join("");
    return groupRow + accountRows;
  }).join("");

  host.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th>Ryhmä</th>${yearHeaderCells}<th>${escapeHtml(budgetLabel)}</th>
      <th>${escapeHtml(changeLabel)}</th><th>Osuus tuloista</th><th>Huomio</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
  for (const row of host.querySelectorAll("tr[data-group]")) {
    row.querySelector(".row-select")
      .addEventListener("click", () => selectFinanceGroup("finance-income", row.dataset.group));
  }
}

function renderIncomeGroupDetail() {
  const model = state.admin;
  const vm = buildIncomeViewModel(model.financialAccounts, model.financialEntries);
  const group = vm.groups.find((g) => g.group === selectionId("finance-income"));
  if (!group) { closeDetailPanel(); return; }
  const yearHeaderCells = vm.actualYears.map((year) => `<th>Toteuma ${year}</th>`).join("");
  const budgetLabel = vm.budgetYear !== null ? `Budjetti ${vm.budgetYear}` : "Budjetti";
  const rows = group.accountRows.map((row) => {
    const cells = vm.actualYears
      .map((year) => `<td>${row.actuals[year] === undefined ? "—" : money(row.actuals[year])}</td>`)
      .join("");
    return `<tr><td>${escapeHtml(row.accountCode)}</td><td>${escapeHtml(row.name)}</td>${cells}` +
      `<td>${row.budget === undefined ? "—" : money(row.budget)}</td></tr>`;
  }).join("");
  $("#detail-panel-title").textContent = group.group;
  $("#detail-panel-body").innerHTML = `
    <div class="detail-item"><span>Osuus tuloista</span><strong>${group.sharePercent === undefined ? "—" : percent(group.sharePercent)}</strong></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Tili</th><th>Nimi</th>${yearHeaderCells}<th>${escapeHtml(budgetLabel)}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;
}

/** -------- Kulut ryhmittäin (spec §6.2) -------- */

function renderExpenseGroups() {
  if (!state.admin) return;
  const vm = buildExpenseGroupViewModel(state.admin.financialAccounts, state.admin.financialEntries);
  const host = $("#finance-costs-group-body");
  if (vm.isEmpty) {
    host.innerHTML = stateBlock({ kind: "empty", title: "Ei vielä talousdataa", body: vm.emptyMessage });
    return;
  }
  const changeLabel = vm.changeYears
    ? `Muutos ${vm.changeYears.previous} → ${vm.changeYears.latest}`
    : "Muutos";
  const budgetLabel = vm.budgetYear !== null ? `Budjetti ${vm.budgetYear}` : "Budjetti";
  const yearHeaderCells = vm.actualYears.map((year) => `<th>Toteuma ${year}</th>`).join("");
  const selectedGroup = selectionId("finance-costs-group");

  const rows = vm.groups.map((group) => {
    const actualCells = vm.actualYears
      .map((year) => `<td>${group.actuals[year] === undefined ? "—" : money(group.actuals[year])}</td>`)
      .join("");
    const rowClass = group.group === selectedGroup ? "is-selected" : "";
    return `<tr class="${rowClass}" data-group="${escapeHtml(group.group)}">
      <td>${escapeHtml(group.group)}</td>
      <td>${escapeHtml(FINANCE_NATURE_LABELS[group.nature] ?? "—")}</td>
      <td>${escapeHtml(FINANCE_CONTROLLABILITY_LABELS[group.controllability] ?? "—")}</td>
      ${actualCells}
      <td>${group.budget === undefined ? "—" : money(group.budget)}</td>
      <td>${formatChangeCell(group.changeAmount, group.changePercent)}</td>
      <td>${escapeHtml(group.notes || "—")}</td>
      <td><button type="button" class="secondary row-select">Näytä</button></td>
    </tr>`;
  }).join("");

  host.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th>Ryhmä</th><th>Luonne</th><th>Ohjattavuus</th>${yearHeaderCells}
      <th>${escapeHtml(budgetLabel)}</th><th>${escapeHtml(changeLabel)}</th><th>Huomio</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
  for (const row of host.querySelectorAll("tr[data-group]")) {
    row.querySelector(".row-select")
      .addEventListener("click", () => selectFinanceGroup("finance-costs-group", row.dataset.group));
  }
}

function renderExpenseGroupDetail() {
  const model = state.admin;
  const vm = buildExpenseGroupViewModel(model.financialAccounts, model.financialEntries);
  const group = vm.groups.find((g) => g.group === selectionId("finance-costs-group"));
  if (!group) { closeDetailPanel(); return; }
  const yearHeaderCells = vm.actualYears.map((year) => `<th>Toteuma ${year}</th>`).join("");
  const budgetLabel = vm.budgetYear !== null ? `Budjetti ${vm.budgetYear}` : "Budjetti";
  const rows = group.accountRows.map((row) => {
    const cells = vm.actualYears
      .map((year) => `<td>${row.actuals[year] === undefined ? "—" : money(row.actuals[year])}</td>`)
      .join("");
    const nature = FINANCE_NATURE_LABELS[row.nature] ?? "—";
    const controllability = FINANCE_CONTROLLABILITY_LABELS[row.controllability] ?? "—";
    return `<tr><td>${escapeHtml(row.accountCode)}</td><td>${escapeHtml(row.name)}</td>` +
      `<td>${escapeHtml(nature)}</td><td>${escapeHtml(controllability)}</td>${cells}` +
      `<td>${row.budget === undefined ? "—" : money(row.budget)}</td></tr>`;
  }).join("");
  $("#detail-panel-title").textContent = group.group;
  $("#detail-panel-body").innerHTML = `
    ${renderGroupChart(group, vm)}
    <div class="table-wrap"><table>
      <thead><tr><th>Tili</th><th>Nimi</th><th>Luonne</th><th>Ohjattavuus</th>${yearHeaderCells}<th>${escapeHtml(budgetLabel)}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;
}

/** Whole euros: the chart shows shape, the tables below carry the cents. */
function moneyCompact(value) {
  return new Intl.NumberFormat("fi-FI", {
    style: "currency", currency: "EUR", maximumFractionDigits: 0,
  }).format(value);
}

/**
 * The group detail chart (handoff feature/group-chart). All arithmetic lives
 * in buildGroupChartModel(); this only turns the model into markup.
 *
 * The bars are an SVG with preserveAspectRatio="none" over a fixed CSS
 * height, so the columns stretch to whatever width the modal has (it ranges
 * from min(92vw, 1800px) down to a full-screen phone) while bar heights stay
 * pixel-accurate. Labels and values are deliberately NOT in that SVG: text
 * inside it would scale with the box and end up either huge in a wide modal
 * or unreadably small on a phone. They are HTML in a grid that shares the
 * bars' column count instead, so they behave like every other text on the
 * page.
 *
 * Strokes carry vector-effect="non-scaling-stroke" because the non-uniform
 * scaling would otherwise stretch the budget bar's dashes horizontally.
 *
 * Colors come only from CSS custom properties. Beyond the house rule, a
 * literal hex colour written out in this file would read as an id reference
 * to viewWiring.test.js's id scan (hash followed by a letter) and fail the
 * id cross-check — as an earlier draft of this very comment did.
 */
function renderGroupChart(group, vm) {
  const model = buildGroupChartModel(group, vm.actualYears, vm.budgetYear);
  if (model.isEmpty) return "";

  const bars = model.bars.map((bar) => {
    if (bar.missing) return "";
    const height = bar.heightPercent;
    const className = bar.isBudget ? "group-chart-bar is-budget" : "group-chart-bar";
    // y is measured from the top of a 100-unit tall viewBox; a zero-height
    // bar sits on the baseline and draws nothing visible, which is correct
    // for a real 0,00 € and unreachable for a missing year (skipped above).
    return `<rect class="${className}" x="${bar.xPercent.toFixed(3)}" y="${(100 - height).toFixed(3)}" ` +
      `width="${bar.widthPercent.toFixed(3)}" height="${height.toFixed(3)}" ` +
      `vector-effect="non-scaling-stroke" />`;
  }).join("");

  const labels = model.bars.map((bar) => {
    const yearLabel = bar.isBudget
      ? `${bar.year} · budjetti`
      : String(bar.year);
    const valueLabel = bar.missing ? "—" : moneyCompact(bar.value);
    const missingClass = bar.missing ? " is-missing" : "";
    return `<div class="group-chart-label${missingClass}">
      <span class="group-chart-value">${escapeHtml(valueLabel)}</span>
      <span class="group-chart-year">${escapeHtml(yearLabel)}</span>
    </div>`;
  }).join("");

  const summary = model.bars
    .map((bar) => {
      const what = bar.isBudget ? `budjetti ${bar.year}` : `toteuma ${bar.year}`;
      return bar.missing ? `${what}: ei tietoa` : `${what}: ${moneyCompact(bar.value)}`;
    })
    .join(", ");
  const hasMissing = model.bars.some((bar) => bar.missing);

  return `<figure class="group-chart">
    <svg class="group-chart-plot" viewBox="0 0 100 100" preserveAspectRatio="none"
         role="img" aria-label="${escapeHtml(`Pylväskaavio, ${group.group}: ${summary}.`)}">
      ${bars}
      <line class="group-chart-baseline" x1="0" y1="100" x2="100" y2="100"
            vector-effect="non-scaling-stroke" />
    </svg>
    <div class="group-chart-labels" style="grid-template-columns: repeat(${model.bars.length}, minmax(0, 1fr));">
      ${labels}
    </div>
    <figcaption class="group-chart-legend">
      <span class="group-chart-key"><span class="group-chart-swatch"></span>Toteuma</span>
      ${model.hasBudget ? `<span class="group-chart-key"><span class="group-chart-swatch is-budget"></span>Budjetti (ennuste, ei toteutunut)</span>` : ""}
      ${hasMissing ? `<span class="group-chart-key">— = lukua ei ole, ei nolla</span>` : ""}
    </figcaption>
  </figure>`;
}

/** -------- Budjetti vs. toteuma (spec §6.4) -------- */

function populateFinanceBudgetYearFilter(accounts, entries, groupBudgets, groupActuals) {
  const select = $("#finance-budget-filter-year");
  const years = deriveComparableGroupBudgetYears(accounts, entries, groupBudgets, groupActuals);
  const current = select.value;
  select.innerHTML = `<option value="">Valitse vuosi</option>` +
    years.map((year) => `<option value="${year}">${year}</option>`).join("");
  if (!state.financeBudgetYearFilterInitialized && years.length > 0) {
    state.financeBudgetYearFilterInitialized = true;
    select.value = String(years[years.length - 1]);
    return;
  }
  select.value = current !== "" && years.includes(Number(current)) ? current : "";
}

const FINANCE_SECTION_LABELS = { income: "Tulot", expense: "Kulut" };
const BUDGET_SOURCE_LABELS = { group: "Ryhmäbudjetti", accounts: "Tileistä summattu" };

/**
 * Builds the current `buildGroupBudgetVsActualViewModel` result for the
 * selected year filter, or null if none is selected. This view is
 * ryhmätasoinen (feature/group-budget handoff §1): the group's budget
 * prefers an active GroupBudget over the tili-summed FinancialEntry
 * figure, with `budgetSource` shown per row so the precedence rule stays
 * visible rather than hidden in the calculation.
 */
function currentBudgetVsActualViewModel() {
  if (!state.admin) return null;
  const year = $("#finance-budget-filter-year").value;
  if (year === "") return null;
  return buildGroupBudgetVsActualViewModel(
    state.admin.financialAccounts,
    state.admin.financialEntries,
    state.admin.groupBudgets,
    state.admin.groupActuals,
    year,
  );
}

function renderBudgetVsActual() {
  if (!state.admin) return;
  populateFinanceBudgetYearFilter(state.admin.financialAccounts, state.admin.financialEntries, state.admin.groupBudgets, state.admin.groupActuals);
  const vm = currentBudgetVsActualViewModel();
  const host = $("#finance-budget-body");

  if (!vm || vm.isEmpty) {
    host.innerHTML = stateBlock({
      kind: "empty",
      title: vm === null ? "Valitse vuosi" : "Ei vertailukelpoista dataa tälle vuodelle",
      body: vm?.emptyMessage ?? "Ei vielä talousdataa. Tuo se Liitä tilidataa -näkymästä.",
    });
    return;
  }

  const selected = selectionId("finance-budget");
  const sectionBlocks = vm.sections.map((section) => {
    const sectionKpis = vm.kpis[section.kind];
    const kpiRow = sectionKpis === null ? "" : `<div class="card-grid">
      ${[
        ["Budjetti", sectionKpis.totalBudget === undefined ? "—" : money(sectionKpis.totalBudget)],
        ["Toteuma", sectionKpis.totalActual === undefined ? "—" : money(sectionKpis.totalActual)],
        ["Nettoerotus", sectionKpis.netDiff === undefined ? "—" : money(sectionKpis.netDiff)],
        ["Keskim. abs. poikkeama", sectionKpis.avgAbsDeviationPercent === undefined ? "—" : percent(sectionKpis.avgAbsDeviationPercent)],
      ].map(kpiCard).join("")}
    </div>`;
    const rows = section.groups.map((group) => {
      const favorableClass = group.favorable === false ? " warning" : "";
      const groupKey = `${section.kind}::${group.group}`;
      const rowClass = `${groupKey === selected ? "is-selected" : ""}${favorableClass}`.trim();
      const overrideNote = group.budgetSource === "group" && group.overriddenAccountsBudget !== undefined
        ? `Ohitettu tilisumma: ${money(group.overriddenAccountsBudget)}`
        : "";
      const notesText = [group.notes, overrideNote].filter((n) => n !== "").join(" · ");
      return `<tr class="${rowClass}" data-group-key="${escapeHtml(groupKey)}">
        <td>${escapeHtml(group.group)}</td>
        <td>${group.budget === undefined ? "—" : money(group.budget)}</td>
        <td>${escapeHtml(BUDGET_SOURCE_LABELS[group.budgetSource] ?? "—")}</td>
        <td>${group.actual === undefined ? "—" : money(group.actual)}</td>
        <td>${group.diffAmount === undefined ? "—" : money(group.diffAmount)}</td>
        <td>${group.diffPercent === undefined ? "—" : percent(group.diffPercent)}</td>
        <td>${notesText === "" ? "—" : escapeHtml(notesText)}</td>
        <td><button type="button" class="secondary row-select">Näytä</button></td>
      </tr>`;
    }).join("");
    return `<section class="card">
      <h3>${escapeHtml(FINANCE_SECTION_LABELS[section.kind] ?? section.kind)}</h3>
      ${kpiRow}
      <div class="table-wrap"><table>
        <thead><tr><th>Ryhmä</th><th>Budjetti</th><th>Budjetin lähde</th><th>Toteuma</th><th>Erotus €</th><th>Erotus %</th><th>Huomio</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
  }).join("");

  host.innerHTML = sectionBlocks;
  for (const row of host.querySelectorAll("tr[data-group-key]")) {
    row.querySelector(".row-select")
      .addEventListener("click", () => selectFinanceGroup("finance-budget", row.dataset.groupKey));
  }
}

function renderBudgetVsActualDetail() {
  const vm = currentBudgetVsActualViewModel();
  const selected = selectionId("finance-budget");
  const group = vm?.sections
    .flatMap((section) => section.groups.map((g) => ({ ...g, groupKey: `${section.kind}::${g.group}` })))
    .find((g) => g.groupKey === selected);
  if (!group) { closeDetailPanel(); return; }
  const rows = group.rows.map((row) => `<tr>
    <td>${escapeHtml(row.accountCode)}</td><td>${escapeHtml(row.name)}</td>
    <td>${row.budget === undefined ? "—" : money(row.budget)}</td>
    <td>${row.actual === undefined ? "—" : money(row.actual)}</td>
    <td>${row.diffAmount === undefined ? "—" : money(row.diffAmount)}</td>
    <td>${row.diffPercent === undefined ? "—" : percent(row.diffPercent)}</td>
  </tr>`).join("");
  const sourceNote = group.budgetSource === "group"
    ? `<p class="muted">Ryhmän budjetti (${money(group.budget)}) tulee ryhmäbudjetista, ei tilien budjettisummasta.` +
      (group.overriddenAccountsBudget === undefined ? "" : ` Tileistä summattu budjetti olisi ollut ${money(group.overriddenAccountsBudget)} — ohitettu.`) +
      `</p>`
    : "";
  $("#detail-panel-title").textContent = group.group;
  $("#detail-panel-body").innerHTML = `
    ${sourceNote}
    <div class="table-wrap"><table>
      <thead><tr><th>Tili</th><th>Nimi</th><th>Budjetti</th><th>Toteuma</th><th>Erotus €</th><th>Erotus %</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;
}

/* -------- Group budget import ("Liitä ryhmäbudjetti", feature/group-budget handoff §2) -------- */

function updateGroupBudgetImportPreview() {
  const text = $("#group-budget-import-text").value;
  const host = $("#group-budget-import-preview");
  if (text.trim() === "") {
    host.innerHTML = "";
    state.groupBudgetImportParsed = null;
    $("#group-budget-import-submit").disabled = true;
    return;
  }
  const accounts = state.admin ? state.admin.financialAccounts : [];
  const parsed = parseGroupBudgetPasteInput(text, accounts);
  state.groupBudgetImportParsed = parsed;
  const summary = `${parsed.groupBudgets.length} ryhmäbudjettiriviä tunnistettu.`;
  const blocks = [];
  blocks.push(parsed.errors.length > 0
    ? stateBlock({
      kind: "error",
      title: summary,
      body: `${parsed.errors.length} virhettä. Tallennus on estetty, kunnes virheet on korjattu.`,
      items: parsed.errors.map((error) => error.message),
    })
    : `<article class="card"><p>${escapeHtml(summary)} Ei virheitä.</p></article>`);
  if (parsed.warnings.length > 0) {
    blocks.push(`<article class="card"><p class="warning">${parsed.warnings.length} varoitus(ta) ryhmänimen täsmäyksestä tilidataan (rivi hyväksytään silti):</p>` +
      `<ul>${parsed.warnings.map((warning) => `<li>${escapeHtml(warning.message)}</li>`).join("")}</ul></article>`);
  }
  host.innerHTML = blocks.join("");
  $("#group-budget-import-submit").disabled = parsed.groupBudgets.length === 0 || parsed.errors.length > 0;
}

async function submitGroupBudgetImport(event) {
  event.preventDefault();
  clearFieldErrors("#group-budget-import-form");
  const parsed = state.groupBudgetImportParsed;
  if (!parsed || parsed.errors.length > 0 || parsed.groupBudgets.length === 0) {
    setFeedback("#group-budget-import-feedback", "Korjaa virheet ennen tallennusta.", "error");
    return;
  }
  const meta = validateOperationMeta({
    sourceIds: fieldValue("group-budget-import-source-ids"),
    explanation: fieldValue("group-budget-import-explanation"),
  });
  if (!meta.ok) {
    applyFieldErrors("#group-budget-import-form", {
      sourceIds: "group-budget-import-source-ids",
      explanation: "group-budget-import-explanation",
    }, meta.errors);
    setFeedback("#group-budget-import-feedback", "Korjaa merkityt kentät.", "error");
    return;
  }
  const operations = buildGroupBudgetImportOperations(parsed, meta.value);
  const sent = await sendAdminOperations(operations, {
    successMessage: `Tuotu ${parsed.groupBudgets.length} ryhmäbudjettiriviä.`,
  });
  if (sent.ok) {
    setFeedback("#group-budget-import-feedback", "Tallennettu.", "ok");
    $("#group-budget-import-text").value = "";
    updateGroupBudgetImportPreview();
    renderGroupBudgetList();
    renderBudgetVsActual();
  } else if (sent.conflict) {
    setFeedback("#group-budget-import-feedback", "Tiedot muuttuivat — lataa työtila uudelleen.", "error");
  }
}

/**
 * Lists every GroupBudget row so a typo'd group name — whose id can never be
 * corrected by re-import, since the id is derived from the name itself — can
 * be deleted outright. `active` stays in the data model for a genuine "no
 * longer in force but kept" state, but the UI no longer offers retiring as a
 * stand-in for deletion: it only existed because deletion did not.
 */
function renderGroupBudgetList() {
  if (!state.admin) return;
  const host = $("#group-budget-list");
  const groupBudgets = state.admin.groupBudgets ?? [];
  if (groupBudgets.length === 0) {
    host.innerHTML = stateBlock({
      kind: "empty",
      title: "Ei vielä ryhmäbudjetteja",
      body: "Liitä ryhmäbudjettidata yllä olevalla lomakkeella.",
    });
    return;
  }
  const sorted = [...groupBudgets].sort((a, b) => (a.year === b.year ? a.group.localeCompare(b.group) : b.year - a.year));
  const rows = sorted.map((groupBudget) => `<tr class="${groupBudget.active ? "" : "is-gap"}">
    <td>${escapeHtml(groupBudget.kind === "income" ? "Tulo" : "Kulu")}</td>
    <td>${escapeHtml(groupBudget.group)}</td>
    <td>${groupBudget.year}</td>
    <td>${money(groupBudget.budgetAmount)}</td>
    <td>${groupBudget.active ? "Aktiivinen" : "Poistettu käytöstä"}</td>
    <td><button type="button" class="danger delete-group-budget" data-id="${escapeHtml(groupBudget.id)}">Poista</button></td>
  </tr>`).join("");
  host.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Kind</th><th>Ryhmä</th><th>Vuosi</th><th>Budjetti</th><th>Tila</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
  for (const button of host.querySelectorAll(".delete-group-budget")) {
    button.addEventListener("click", () => openDeleteConfirmation("group_budget", button.dataset.id));
  }
}

/* -------- Finance import ("Liitä tilikohtainen data") -------- */

function updateFinanceImportPreview() {
  const text = $("#finance-import-text").value;
  const host = $("#finance-import-preview");
  if (text.trim() === "") {
    host.innerHTML = "";
    state.financeImportParsed = null;
    $("#finance-import-submit").disabled = true;
    return;
  }
  const parsed = parseFinancialPasteInput(text);
  state.financeImportParsed = parsed;
  const summary = `${parsed.accounts.length} tiliä, ${parsed.entries.length} riviä tunnistettu.`;
  host.innerHTML = parsed.errors.length > 0
    ? stateBlock({
      kind: "error",
      title: summary,
      body: `${parsed.errors.length} virhettä. Tallennus on estetty, kunnes virheet on korjattu.`,
      items: parsed.errors.map((error) => error.message),
    })
    : `<article class="card"><p>${escapeHtml(summary)} Ei virheitä.</p></article>`;
  const drops = detectFinancialImportValueDrops(parsed, state.admin?.financialEntries);
  if (drops.length > 0) {
    host.innerHTML += stateBlock({
      kind: "warning",
      title: "Tuonti korvaa olemassa olevia arvoja",
      body: "Uudelleentuonti päivittää rivit eikä luo kaksoiskappaleita, mutta se korvaa rivin kokonaan. Tallennus on sallittu — tarkista että tämä on tarkoitus.",
      items: drops,
    });
  }
  const hasRows = parsed.accounts.length > 0 || parsed.entries.length > 0;
  $("#finance-import-submit").disabled = !hasRows || parsed.errors.length > 0;
}

async function submitFinanceImport(event) {
  event.preventDefault();
  clearFieldErrors("#finance-import-form");
  const parsed = state.financeImportParsed;
  if (!parsed || parsed.errors.length > 0 ||
      (parsed.accounts.length === 0 && parsed.entries.length === 0)) {
    setFeedback("#finance-import-feedback", "Korjaa virheet ennen tallennusta.", "error");
    return;
  }
  const meta = validateOperationMeta({
    sourceIds: fieldValue("finance-import-source-ids"),
    explanation: fieldValue("finance-import-explanation"),
  });
  if (!meta.ok) {
    applyFieldErrors("#finance-import-form", {
      sourceIds: "finance-import-source-ids",
      explanation: "finance-import-explanation",
    }, meta.errors);
    setFeedback("#finance-import-feedback", "Korjaa merkityt kentät.", "error");
    return;
  }
  const operations = buildFinancialImportOperations(parsed, meta.value);
  const sent = await sendAdminOperations(operations, {
    successMessage: `Tuotu ${parsed.accounts.length} tiliä ja ${parsed.entries.length} riviä.`,
  });
  if (sent.ok) {
    setFeedback("#finance-import-feedback", "Tallennettu.", "ok");
    $("#finance-import-text").value = "";
    updateFinanceImportPreview();
  } else if (sent.conflict) {
    setFeedback("#finance-import-feedback", "Tiedot muuttuivat — lataa työtila uudelleen.", "error");
  }
}

/* -------- Balance import ("Liitä tasedata", handoff vaihe-4A §5) -------- */

function currentBalanceImportMeta() {
  return { id: fieldValue("balance-import-id"), asOfDate: fieldValue("balance-import-as-of-date") };
}

function updateBalanceImportPreview() {
  const text = $("#balance-import-text").value;
  const host = $("#balance-import-preview");
  if (text.trim() === "") {
    host.innerHTML = "";
    state.balanceImportParsed = null;
    $("#balance-import-submit").disabled = true;
    return;
  }
  const parsed = parseBalanceSheetPasteInput(text, currentBalanceImportMeta());
  state.balanceImportParsed = parsed;
  const entryCount = parsed.snapshot.entries.length;
  const summary = `${entryCount} tase-erää tunnistettu.`;
  if (parsed.errors.length > 0) {
    host.innerHTML = stateBlock({
      kind: "error",
      title: summary,
      body: `${parsed.errors.length} virhettä. Tallennus on estetty, kunnes virheet on korjattu.`,
      items: parsed.errors.map((error) => error.message),
    });
  } else {
    const vm = buildBalanceSheetViewModel(parsed.snapshot);
    const totals = vm.topGroups.map((group) => `${group.label} ${money(group.groupTotal)}`).join(" · ");
    host.innerHTML = `<article class="card"><p>${escapeHtml(summary)} Ei virheitä.</p><p class="muted">${escapeHtml(totals)}</p></article>`;
    const drops = detectBalanceImportValueDrops(parsed, state.admin?.balanceSheetSnapshots);
    if (drops.length > 0) {
      host.innerHTML += stateBlock({
        kind: "warning",
        title: "Tuonti korvaa olemassa olevan snapshotin",
        body: "Saman tunnisteen liittäminen uudelleen päivittää snapshotin eikä luo kaksoiskappaletta, mutta se korvaa sen erät kokonaan.",
        items: drops,
      });
    }
  }
  $("#balance-import-submit").disabled = entryCount === 0 || parsed.errors.length > 0;
}

async function submitBalanceImport(event) {
  event.preventDefault();
  clearFieldErrors("#balance-import-form");
  const parsed = state.balanceImportParsed;
  if (!parsed || parsed.errors.length > 0 || parsed.snapshot.entries.length === 0) {
    setFeedback("#balance-import-feedback", "Korjaa virheet ennen tallennusta.", "error");
    return;
  }
  const meta = validateOperationMeta({
    sourceIds: fieldValue("balance-import-source-ids"),
    explanation: fieldValue("balance-import-explanation"),
  });
  if (!meta.ok) {
    applyFieldErrors("#balance-import-form", {
      sourceIds: "balance-import-source-ids",
      explanation: "balance-import-explanation",
    }, meta.errors);
    setFeedback("#balance-import-feedback", "Korjaa merkityt kentät.", "error");
    return;
  }
  const operation = buildBalanceSheetImportOperation(parsed, meta.value);
  const sent = await sendAdminOperations([operation], {
    successMessage: `Tallennettu tasesnapshot ${parsed.snapshot.id} (${parsed.snapshot.entries.length} erää).`,
  });
  if (sent.ok) {
    setFeedback("#balance-import-feedback", "Tallennettu.", "ok");
    $("#balance-import-text").value = "";
    updateBalanceImportPreview();
  } else if (sent.conflict) {
    setFeedback("#balance-import-feedback", "Tiedot muuttuivat — lataa työtila uudelleen.", "error");
  }
}

/* -------- Taloudellinen asema (spec §6.5, vaihe 4A: yksi snapshot kerrallaan) -------- */

/**
 * Populates the snapshot <select> from the loaded balanceSheetSnapshots,
 * sorted by asOfDate, defaulting to the latest one on first load (mirrors
 * populateFinanceBudgetYearFilter's "keep the user's choice if it still
 * exists, otherwise default" behaviour) — the dropdown itself is only shown
 * when there is more than one snapshot to choose from (handoff §6).
 * @returns {ReturnType<typeof state.admin.balanceSheetSnapshots.slice>} snapshots sorted by asOfDate
 */
function populateBalancePositionSelector(snapshots) {
  const select = $("#finance-position-snapshot");
  const sorted = [...snapshots].sort((a, b) => String(a.asOfDate).localeCompare(String(b.asOfDate)));
  const current = select.value;
  select.innerHTML = sorted.map((snapshot) =>
    `<option value="${escapeHtml(snapshot.id)}">${escapeHtml(snapshot.asOfDate)} (${escapeHtml(snapshot.id)})</option>`
  ).join("");
  $("#finance-position-selector").hidden = sorted.length <= 1;
  const stillExists = sorted.some((snapshot) => snapshot.id === current);
  select.value = stillExists ? current : (sorted.length > 0 ? sorted[sorted.length - 1].id : "");
  return sorted;
}

/**
 * Populates the "vertaa snapshotiin" <select> with every other snapshot plus
 * an "Ei vertailua" option, defaulting to the snapshot immediately before
 * the selected one in date order (handoff §3.1: "toiseksi viimeisin
 * snapshot jos useita" — since the primary selector defaults to the latest,
 * that is simply its previous neighbour here).
 * @returns {string} the selected compare id, or "" for no comparison
 */
function populateBalanceCompareSelector(sorted, selectedId) {
  const select = $("#finance-position-compare");
  const current = select.value;
  const otherOptions = sorted
    .filter((snapshot) => snapshot.id !== selectedId)
    .map((snapshot) => `<option value="${escapeHtml(snapshot.id)}">${escapeHtml(snapshot.asOfDate)} (${escapeHtml(snapshot.id)})</option>`)
    .join("");
  select.innerHTML = `<option value="">Ei vertailua</option>${otherOptions}`;

  const stillExists = current !== "" && sorted.some((snapshot) => snapshot.id === current && snapshot.id !== selectedId);
  if (stillExists) {
    select.value = current;
  } else {
    const selectedIndex = sorted.findIndex((snapshot) => snapshot.id === selectedId);
    const defaultOlder = selectedIndex > 0 ? sorted[selectedIndex - 1] : undefined;
    select.value = defaultOlder ? defaultOlder.id : "";
  }
  return select.value;
}

/** "+1 234,56 €" for positive/zero, "-1 234,56 €" for negative (money() already signs negatives). */
function moneyChange(value) {
  return value > 0 ? `+${money(value)}` : money(value);
}

function renderReconciliationCard(reconciliation, label) {
  const statusClass = reconciliation.balances ? "is-balanced" : "is-unbalanced";
  const statusText = reconciliation.balances
    ? "Tase täsmää"
    : `Tase ei täsmää — erotus ${money(reconciliation.difference)}`;
  return `<article class="reconciliation-card ${statusClass}">
    <h4>Taseen täsmäytys${label ? ` — ${escapeHtml(label)}` : ""}</h4>
    <p class="reconciliation-status">${escapeHtml(statusText)}</p>
    <p class="muted">VARAT ${money(reconciliation.assets)} · OMA PÄÄOMA JA VELAT ${money(reconciliation.equityPlusLiabilities)}</p>
  </article>`;
}

function renderBalancePosition() {
  if (!state.admin) return;
  const sorted = populateBalancePositionSelector(state.admin.balanceSheetSnapshots ?? []);
  const host = $("#finance-position-body");
  const selectedId = $("#finance-position-snapshot").value;
  const snapshot = sorted.find((item) => item.id === selectedId);
  const vm = buildBalanceSheetViewModel(snapshot);

  const deleteButton = $("#finance-position-delete");
  deleteButton.disabled = snapshot === undefined;
  deleteButton.onclick = snapshot === undefined
    ? null
    : () => openDeleteConfirmation("balance_sheet_snapshot", snapshot.id);

  if (vm.isEmpty) {
    $("#finance-position-compare").innerHTML = `<option value="">Ei vertailua</option>`;
    host.innerHTML = stateBlock({ kind: "empty", title: "Ei vielä tasedataa", body: vm.emptyMessage });
    return;
  }

  const compareId = populateBalanceCompareSelector(sorted, selectedId);
  const olderSnapshot = sorted.find((item) => item.id === compareId);
  const comparison = buildBalanceComparisonViewModel(snapshot, olderSnapshot);

  const reconciliation = computeBalanceReconciliation(snapshot);
  // The trailing-12m divisor is derived from account data, never from the
  // liquidity baseline's hand-entered figure (handoff feature/trailing-12m
  // §5): that value aged unnoticed and is exactly why this is computed.
  // The baseline still supplies the other liquidity inputs, and the operating
  // buffer / cash path still read its stored figure - see
  // docs/claude-code-handoff-likviditeetin-jakaja.md.
  const trailing12m = computeTrailing12mOperatingCosts(
    state.admin.financialAccounts,
    state.admin.financialEntries,
  );
  const ratios = computeBalanceRatios(
    snapshot,
    trailing12m.status === "available"
      ? { trailing12mOperatingCosts: trailing12m.value }
      : undefined,
  );

  const kpiNotes = [buildTrailing12mNote(trailing12m, money)];
  const balanceYear = Number(String(snapshot.asOfDate).slice(0, 4));
  if (trailing12m.status === "available" && Number.isInteger(balanceYear) &&
      trailing12m.latestActualYear !== balanceYear) {
    kpiNotes.push(`Kulutoteumat ovat vuodelta ${trailing12m.latestActualYear}, tase ${escapeHtml(snapshot.asOfDate)} — kassa kuukausina -tunnusluku yhdistää eri ajankohtien lukuja.`);
  }

  const kpis = `
    <div class="card-grid">
      ${kpiCard(["Maksuvalmius", ratios.liquidity === null ? "—" : ratios.liquidity.toFixed(2)])}
      ${kpiCard(["Kassa kuukausina hoitokuluja", ratios.monthsOfCash === null ? "—" : ratios.monthsOfCash.toFixed(1)])}
      ${kpiCard(["Korollinen vieras pääoma", ratios.interestBearingDebt === null ? "—" : money(ratios.interestBearingDebt)])}
    </div>
    ${kpiNotes.length > 0 ? `<p class="muted">${kpiNotes.map(escapeHtml).join(" ")}</p>` : ""}
  `;

  const reconciliationBlock = comparison.hasComparison
    ? `<div class="card-grid">
        ${renderReconciliationCard(reconciliation, snapshot.asOfDate)}
        ${renderReconciliationCard(computeBalanceReconciliation(olderSnapshot), olderSnapshot.asOfDate)}
      </div>`
    : renderReconciliationCard(reconciliation, "");

  let groupBlocks;
  if (comparison.hasComparison) {
    groupBlocks = comparison.topGroups.map((group) => {
      const sectionBlocks = group.sections
        .filter((section) => section.entries.length > 0)
        .map((section) => {
          const rows = section.entries.map((entry) => `<tr>
            <td>${escapeHtml(entry.name)}</td>
            <td>${entry.newerAmount === null ? "—" : money(entry.newerAmount)}</td>
            <td>${entry.olderAmount === null ? "—" : money(entry.olderAmount)}</td>
            <td>${moneyChange(entry.change)}</td>
          </tr>`).join("");
          return `<tbody>
            <tr class="group-header"><td colspan="4">${escapeHtml(section.label)}</td></tr>
            ${rows}
            <tr class="group-total">
              <td>${escapeHtml(section.label)} yhteensä</td>
              <td>${money(section.newerTotal)}</td>
              <td>${money(section.olderTotal)}</td>
              <td>${moneyChange(section.totalChange)}</td>
            </tr>
          </tbody>`;
        }).join("");
      return `<section class="card">
        <h3>${escapeHtml(group.label)}</h3>
        <div class="table-wrap"><table>
          <thead><tr><th></th><th>${escapeHtml(snapshot.asOfDate)}</th><th>${escapeHtml(olderSnapshot.asOfDate)}</th><th>Muutos €</th></tr></thead>
          ${sectionBlocks}
        </table></div>
        <p class="metric">${escapeHtml(group.label)} YHTEENSÄ: ${money(group.newerGroupTotal)} (${moneyChange(group.groupChange)})</p>
      </section>`;
    }).join("");
  } else {
    groupBlocks = vm.topGroups.map((group) => {
      const sectionBlocks = group.sections
        .filter((section) => section.entries.length > 0)
        .map((section) => {
          const rows = section.entries.map((entry) =>
            `<tr><td>${escapeHtml(entry.name)}</td><td>${money(entry.amount)}</td></tr>`
          ).join("");
          return `<tbody>
            <tr class="group-header"><td colspan="2">${escapeHtml(section.label)}</td></tr>
            ${rows}
            <tr class="group-total"><td>${escapeHtml(section.label)} yhteensä</td><td>${money(section.sectionTotal)}</td></tr>
          </tbody>`;
        }).join("");
      return `<section class="card">
        <h3>${escapeHtml(group.label)}</h3>
        <div class="table-wrap"><table>${sectionBlocks}</table></div>
        <p class="metric">${escapeHtml(group.label)} YHTEENSÄ: ${money(group.groupTotal)}</p>
      </section>`;
    }).join("");
  }

  host.innerHTML = `
    <div class="card-grid">
      ${kpiCard(["VARAT YHTEENSÄ", money(vm.assetsTotal)])}
      ${kpiCard(["OMA PÄÄOMA JA VELAT YHTEENSÄ", money(vm.equityAndLiabilitiesTotal)])}
    </div>
    ${kpis}
    ${reconciliationBlock}
    ${groupBlocks}
  `;
}

/* -------- Scenarios / cashpath / required collection (decision 3.3) -------- */

function renderScenarios() {
  const projection = state.admin.calculations?.projection;
  const host = $("#scenarios-body");
  if (!projection) { host.innerHTML = stateBlock({ kind: "empty", title: "Ei laskentaa", body: "Skenaariolaskentaa ei ole saatavilla." }); return; }
  host.innerHTML = `<div class="scenario-grid">${SCENARIOS.map((scenario) => {
    const p = projection.scenarios[scenario];
    return `<article class="card scenario-card">
      <h4>${scenario}</h4>
      <div class="metric">${money(p.horizonAmount)}</div>
      <div class="metric-label">tunnetut kustannukset horisontissa</div>
      <ul>
        <li>${p.horizonEventCount} tapahtumariviä</li>
        <li>${p.dataGaps.withinHorizon.length} DATA GAPia horisontissa</li>
        <li>${p.dataGaps.beforeHorizon.length + p.dataGaps.afterHorizon.length} DATA GAPia horisontin ulkopuolella</li>
      </ul>
    </article>`;
  }).join("")}</div>`;
}

function renderCashpath() {
  const liquidity = state.admin.calculations?.liquidity;
  const host = $("#cashpath-body");
  if (liquidity?.status !== "available") { host.innerHTML = liquidityUnavailableBlock(liquidity); return; }
  const scenario = state.cashpathScenario;
  const cashPath = liquidity.forecast.scenarios[scenario].cashPath;
  const tabs = SCENARIOS.map((s) =>
    `<button type="button" class="mode-tab${s === scenario ? " active" : ""}" data-cashpath="${s}">${s}</button>`).join("");
  const rows = cashPath.years.map((year) => `<tr${year.costsKnown ? "" : " class=\"beyond-coverage\""}>
    <td>${year.year}</td>
    <td class="num">${unknownOr(year.openingCash)}</td>
    <td class="num">${money(year.annualRepairCollection)}</td>
    <td class="num">${unknownOr(year.knownRepairCosts)}</td>
    <td class="num">${unknownOr(year.closingCash)}</td>
    <td class="num">${money(year.operatingBufferTarget)}</td>
    <td class="num">${year.bufferShortfall === undefined
      ? unknownCell()
      : year.bufferShortfall > 0
        ? `<span class="warning">${money(year.bufferShortfall)}</span>`
        : money(0)}</td>
    <td class="num">${year.dataGaps === undefined ? unknownCell() : year.dataGaps.length}</td>
  </tr>`).join("");
  host.innerHTML = `
    <div class="mode-switch" style="margin-bottom:1rem">${tabs}</div>
    ${cashpathCoverageNote(cashPath)}
    <div class="table-wrap"><table>
      <thead><tr><th>Vuosi</th><th class="num">Avaava kassa</th><th class="num">Vuosikeräys</th><th class="num">Tunnetut kulut</th><th class="num">Päättävä kassa</th><th class="num">Puskuritavoite</th><th class="num">Puskurivaje</th><th class="num">DATA GAP</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  for (const button of $$("#cashpath-body [data-cashpath]")) {
    button.addEventListener("click", () => { state.cashpathScenario = button.dataset.cashpath; renderCashpath(); });
  }
}

/**
 * The legend is the only thing separating "the plan covers every year" from
 * "nobody has said what the plan covers", because both render every row as a
 * computed number. It is deliberately the same state-block in both cases, not
 * a footnote in the unset one.
 */
function cashpathCoverageNote(cashPath) {
  const coverage = cashPath.maintenancePlanCoverageThroughYear;
  if (coverage === undefined) {
    return stateBlock({
      kind: "warning",
      title: "Kunnossapitosuunnitelman katetta ei ole asetettu",
      body: "Kaikki horisontin vuodet näytetään laskettuina. Se ei ole väite " +
        "siitä että suunnitelma kattaisi ne — asettamaton kate on tuntematon, " +
        "ei koko horisontti. Aseta kate Taloyhtiön perustiedoissa.",
    });
  }
  const beyond = cashPath.beyondCoverage;
  const items = [];
  if (beyond !== undefined) {
    items.push(
      `${beyond.firstYear}–${beyond.firstYear + beyond.yearCount - 1}: ` +
        `${beyond.yearCount} vuotta ilman suunnitelmaa.`,
    );
    if (beyond.scheduledCostTotal > 0) {
      items.push(
        `Näille vuosille on jo aikataulutettu ${money(beyond.scheduledCostTotal)} ` +
          "korjauksia. Niitä ei lasketa kassapolkuun, koska vuoden kokonaiskulu " +
          "on silti tuntematon — luvut näkyvät Skenaariot-näkymässä.",
      );
    }
  }
  return stateBlock({
    kind: beyond === undefined ? "unavailable" : "warning",
    title: `Kunnossapitosuunnitelma kattaa vuoteen ${coverage} asti`,
    body: beyond === undefined
      ? "Suunnitelma kattaa koko horisontin, joten jokainen vuosi on laskettu."
      : "Katteen jälkeisiä vuosia ei ole suunniteltu. Rivit näkyvät, mutta " +
        "kuluja, päättävää kassaa ja puskurivajetta ei esitetä laskettuina.",
    items,
  });
}

function renderRequiredCollection() {
  const liquidity = state.admin.calculations?.liquidity;
  const host = $("#required-collection-body");
  if (liquidity?.status !== "available") { host.innerHTML = liquidityUnavailableBlock(liquidity); return; }
  host.innerHTML = `<div class="scenario-grid">${SCENARIOS.map((scenario) => {
    const rc = liquidity.forecast.scenarios[scenario].requiredCollection;
    const fn = liquidity.forecast.scenarios[scenario].fundingNeed;
    const perApartment = rc.additionalMonthlyPerApartment;
    const perM2 = rc.additionalMonthlyPerM2;
    return `<article class="card scenario-card">
      <h4>${scenario}</h4>
      <div class="metric">${money(rc.knownCostRequiredAnnualCollection)}</div>
      <div class="metric-label">vaadittu vuosikeräys tunnetuille kustannuksille</div>
      <ul>
        <li>Nykyinen keräys ${money(rc.currentAnnualRepairCollection)}/v</li>
        <li>Lisätarve ${money(rc.additionalAnnualCollection)}/v</li>
        <li>Lisätarve ${money(rc.additionalMonthlyCollection)}/kk</li>
        ${perApartment === undefined ? "" : `<li>${money(perApartment)}/asunto/kk</li>`}
        ${perM2 === undefined ? "" : `<li>${money(perM2)}/m²/kk</li>`}
        <li>${fn.firstFundingNeedYear ? `Ensimmäinen rahoitustarve ${fn.firstFundingNeedYear}` : "Ei rahoitustarvetta tunnetuilla kustannuksilla"}</li>
        <li>${rc.forecastComplete ? "<span class=\"ok\">Ennuste täydellinen</span>" : "<span class=\"warning\">Ennuste puutteellinen (DATA GAP)</span>"}</li>
      </ul>
    </article>`;
  }).join("")}</div>`;
}

function liquidityUnavailableBlock(liquidity) {
  const missing = liquidity?.missingFields ?? ["liquidityBaseline"];
  return stateBlock({
    kind: "unavailable",
    title: "Likviditeettilaskentaa ei voi tehdä",
    body: "Kassapolku ja vastiketarve vaativat likviditeetin lähtötiedot. Puuttuvat kentät:",
    items: missing.map((field) => LIQUIDITY_FIELD_LABELS[field] ?? field),
  });
}

const LIQUIDITY_FIELD_LABELS = {
  liquidityBaseline: "Likviditeetin lähtötietue (save_liquidity_baseline)",
  currentCash: "Nykyinen kassa",
  trailing12mOperatingCosts: "12 kk hoitokulut",
  currentAnnualRepairCollection: "Nykyinen vuosittainen korjauskeräys",
};

/* -------- Publish -------- */

function renderPublish() {
  const model = state.admin;
  const publication = model.publication ?? {};
  $("#publish-summary").innerHTML = [
    ["Viimeisin julkaisu", publication.latestPublicationVersion ?? 0],
    ["Julkaistavia muutoksia", publication.publishableChanges ? "Kyllä" : "Ei"],
    ["Julkaisemattomia merkintöjä", publication.unpublishedAuditEntryCount ?? 0],
    ["Admin-revisio", model.adminRevision],
  ].map(kpiCard).join("");
}

async function publishAdmin() {
  try {
    if (!state.admin) await loadAdmin();
    const form = new FormData($("#admin-publish-form"));
    setStatus("Julkaistaan…", "busy");
    const item = await api(`/api/v1/admin/companies/${encodeURIComponent(companyId())}/publish`, {
      method: "POST",
      adminToken: await getAdminAccessToken(),
      body: {
        expectedAdminRevision: state.admin.adminRevision,
        expectedPublishedVersion: state.admin.publication.latestPublicationVersion,
        sourceIds: [String(form.get("sourceId"))],
        explanation: String(form.get("explanation")),
      },
    });
    setStatus(`Julkaisu ${item.publicationVersion} luotu`);
    toast(`Julkaisuversio ${item.publicationVersion} luotu.`);
    await loadAdmin();
  } catch (error) {
    setStatus("Julkaisu epäonnistui", "error");
    showError(error);
  }
}

/* -------- Developer batch -------- */

async function saveAdminBatch(event) {
  event.preventDefault();
  try {
    let operations;
    try { operations = JSON.parse($("#admin-operations").value); }
    catch { toast("Virheellinen JSON.", true); return; }
    await sendAdminOperations(operations, { successMessage: "Admin-batch tallennettu." });
  } catch (error) { showError(error); }
}

/* ---------------------------------------------------------------- visitor (preserved) */

async function loadPublished() {
  try {
    state.published = await api(`/api/v1/public/companies/${encodeURIComponent(companyId())}/overview${horizonQuery()}`);
    renderPublishedSummary(state.published);
    toast(`Julkaisu ${state.published.publicationVersion} ladattu.`);
  } catch (error) { showError(error); }
}

async function createSession() {
  try {
    if (!state.published) await loadPublished();
    const handle = await api(`/api/v1/public/companies/${encodeURIComponent(companyId())}/sessions`, {
      method: "POST",
      body: { publicationVersion: state.published.publicationVersion, horizon: horizon() },
    });
    state.visitorCredential = handle.credential;
    sessionStorage.setItem("tmVisitorCredential", JSON.stringify(handle.credential));
    state.visitor = handle.view;
    renderVisitor();
    toast("Visitor-sessio luotu.");
  } catch (error) { showError(error); }
}

async function loadVisitor() {
  if (!state.visitorCredential) throw new Error("Luo ensin visitor-sessio.");
  state.visitor = await api(`/api/v1/public/sessions/${encodeURIComponent(state.visitorCredential.sessionId)}`, {
    visitorToken: state.visitorCredential.accessToken,
  });
  renderVisitor();
}

async function applyVisitorOperations(operations) {
  if (!state.visitorCredential || !state.visitor) throw new Error("Visitor-sessiota ei ole.");
  state.visitor = await api(`/api/v1/public/sessions/${encodeURIComponent(state.visitorCredential.sessionId)}`, {
    method: "PATCH",
    visitorToken: state.visitorCredential.accessToken,
    body: { expectedRevision: state.visitor.sessionRevision, operations },
  });
  renderVisitor();
}

async function resetSession() {
  try {
    if (!state.visitorCredential || !state.visitor) throw new Error("Visitor-sessiota ei ole.");
    state.visitor = await api(`/api/v1/public/sessions/${encodeURIComponent(state.visitorCredential.sessionId)}/reset`, {
      method: "POST",
      visitorToken: state.visitorCredential.accessToken,
      body: { expectedRevision: state.visitor.sessionRevision },
    });
    renderVisitor();
    toast("Sessio palautettu julkaistuun lähtötilaan.");
  } catch (error) { showError(error); }
}

async function saveEventRow(button) {
  try {
    const row = button.closest("tr");
    const amountText = row.querySelector("[data-field=amount]").value.trim();
    const quantityText = row.querySelector("[data-field=quantity]").value.trim();
    const operation = {
      type: "save_event_override",
      value: {
        id: `ui_${row.dataset.eventId}_${row.dataset.entryId}`,
        eventId: row.dataset.eventId,
        scheduleEntryId: row.dataset.entryId,
        year: Number(row.querySelector("[data-field=year]").value),
        amount: amountText === "" ? null : Number(amountText),
        quantity: quantityText === "" ? null : Number(quantityText),
        excluded: row.querySelector("[data-field=excluded]").checked,
        explanation: "Visitorin selainmallinnus",
      },
    };
    await applyVisitorOperations([operation]);
    toast("Tapahtumarivi päivitetty sessioon.");
  } catch (error) { showError(error); }
}

async function saveLiquidity(event) {
  event.preventDefault();
  try {
    const data = new FormData(event.currentTarget);
    const value = compact({
      currentCash: optionalNumber(data.get("currentCash")),
      trailing12mOperatingCosts: optionalNumber(data.get("trailing12mOperatingCosts")),
      bufferMonths: optionalNumber(data.get("bufferMonths")),
      annualRepairCollectionByScenario: compact({
        optimistic: optionalNumber(data.get("optimistic")),
        base: optionalNumber(data.get("base")),
        stress: optionalNumber(data.get("stress")),
      }),
    });
    await applyVisitorOperations([{ type: "set_liquidity_overrides", value }]);
    toast("Likviditeettioletukset päivitetty.");
  } catch (error) { showError(error); }
}

async function saveCustomEvent(event) {
  event.preventDefault();
  try {
    const data = new FormData(event.currentTarget);
    const amount = optionalNumber(data.get("amount"));
    const id = `custom_${crypto.randomUUID()}`;
    const row = compact({
      id: `${id}_row`,
      scenario: String(data.get("scenario")),
      year: Number(data.get("year")),
      amount,
      explanation: "Visitorin väliaikainen tapahtuma",
    });
    await applyVisitorOperations([{
      type: "save_custom_event",
      value: {
        id,
        assetId: String(data.get("assetId")),
        title: String(data.get("title")),
        type: String(data.get("type")),
        schedule: [row],
        notes: "Luotu visitor-session aikana",
      },
    }]);
    event.currentTarget.reset();
    toast("Väliaikainen tapahtuma lisätty sessioon.");
  } catch (error) { showError(error); }
}

function renderPublishedSummary(model) {
  $("#visitor-summary").innerHTML = [
    ["Julkaisu", model.publicationVersion],
    ["Rakennusosat", model.data.assets.length],
    ["Suunnitellut tapahtumat", model.data.approvedEvents.length],
    ["Toteutunut historia", model.data.actualHistory.length],
  ].map(kpiCard).join("");
}

function renderVisitor() {
  const model = state.visitor;
  $("#visitor-session-status").textContent = `Sessio ${model.sessionId} · revisio ${model.sessionRevision} · julkaisu ${model.publicationVersion} · muutoksia ${model.changes.modificationCount}`;
  renderPublishedSummary({ publicationVersion: model.publicationVersion, data: model.publishedData });
  $("#custom-asset").innerHTML = model.publishedData.assets.map((asset) => `<option value="${escapeHtml(asset.id)}">${escapeHtml(asset.name)}</option>`).join("");
  $("#visitor-event-rows").innerHTML = model.effectiveApprovedEvents.flatMap((event) =>
    event.schedule.map((entry) => `
      <tr data-event-id="${escapeHtml(event.id)}" data-entry-id="${escapeHtml(entry.id)}">
        <td><strong>${escapeHtml(event.title)}</strong><br><span class="muted">${escapeHtml(event.assetId)}</span></td>
        <td>${escapeHtml(entry.scenario)}</td>
        <td><input data-field="year" type="number" value="${entry.year}"></td>
        <td><input data-field="amount" type="number" step="0.01" value="${entry.amount ?? ""}" placeholder="DATA GAP"></td>
        <td><input data-field="quantity" type="number" step="0.01" value="${entry.quantity ?? ""}"></td>
        <td><input data-field="excluded" type="checkbox"></td>
        <td><button class="row-save secondary">Tallenna</button></td>
      </tr>`)
  ).join("") || `<tr><td colspan="7" class="muted">Ei tapahtumia.</td></tr>`;
  for (const button of $$("#visitor-event-rows .row-save")) button.addEventListener("click", () => saveEventRow(button));
  renderVisitorScenarios(model.projection, model.liquidity);
  fillLiquidityForm(model);
}

function renderVisitorScenarios(projection, liquidity) {
  $("#visitor-scenarios").innerHTML = SCENARIOS.map((scenario) => {
    const p = projection.scenarios[scenario];
    const liq = liquidity.status === "available" ? liquidity.forecast.scenarios[scenario] : null;
    return `<article class="card scenario-card">
      <h4>${scenario}</h4>
      <div class="metric">${money(p.horizonAmount)}</div>
      <div class="metric-label">tunnetut kustannukset horisontissa</div>
      <ul>
        <li>${p.horizonEventCount} tapahtumariviä</li>
        <li>${p.dataGaps.withinHorizon.length} DATA GAPia</li>
        ${liq ? `<li>Vaadittu keräys ${money(liq.requiredCollection.knownCostRequiredAnnualCollection)}/v</li><li>${liq.fundingNeed.firstFundingNeedYear ? `Ensimmäinen puskurivaje ${liq.fundingNeed.firstFundingNeedYear}` : "Ei puskurivajetta tunnetuilla kustannuksilla"}</li>` : "<li>Likviditeettitiedot puuttuvat</li>"}
      </ul>
    </article>`;
  }).join("");
}

function fillLiquidityForm(model) {
  if (model.liquidity.status !== "available") return;
  const form = $("#visitor-liquidity-form");
  const a = model.liquidity.assumptions;
  form.elements.currentCash.value = a.currentCash;
  form.elements.trailing12mOperatingCosts.value = a.trailing12mOperatingCosts;
  form.elements.bufferMonths.value = a.operatingBufferSettings.bufferMonths ?? "";
  for (const scenario of SCENARIOS) {
    form.elements[scenario].value = a.annualRepairCollectionByScenario[scenario];
  }
}

/* ---------------------------------------------------------------- shared api + view helpers */

async function checkHealth() {
  try {
    const data = await api("/api/v1/health");
    setStatus(`API ${data.status} · ${data.apiVersion}`);
  } catch (error) {
    setStatus("API ei vastaa", "error");
    console.warn(error);
  }
}

async function api(url, options = {}) {
  const headers = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.adminToken) headers.authorization = `Bearer ${options.adminToken}`;
  if (options.visitorToken) headers["x-tm-session-token"] = options.visitorToken;
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message ?? `HTTP ${response.status}`);
    error.code = data.error?.code;
    if (response.status === 401 && options.adminToken) {
      clearAuthSession();
      state.admin = null;
      renderAuthStatus();
    }
    throw error;
  }
  return data;
}

function horizonQuery() {
  const value = horizon();
  return `?startYear=${encodeURIComponent(value.startYear)}&endYear=${encodeURIComponent(value.endYear)}`;
}

/* -------- field helpers -------- */

function textField(id, label, value, opts = {}) {
  const attrs = [
    opts.required ? "required" : "",
    opts.readonly ? "readonly" : "",
  ].filter(Boolean).join(" ");
  return `<label for="${id}">${escapeHtml(label)}
    <input id="${id}" value="${escapeHtml(String(value ?? ""))}" ${attrs} aria-describedby="${id}-error" autocomplete="off">
    <span class="field-error" id="${id}-error"></span>
  </label>`;
}

function numberField(id, label, value, opts = {}) {
  const attrs = [
    opts.required ? "required" : "",
    opts.min !== undefined ? `min="${opts.min}"` : "",
    opts.step !== undefined ? `step="${opts.step}"` : "",
  ].filter(Boolean).join(" ");
  return `<label for="${id}">${escapeHtml(label)}
    <input id="${id}" type="number" value="${escapeHtml(String(value ?? ""))}" ${attrs} aria-describedby="${id}-error">
    <span class="field-error" id="${id}-error"></span>
  </label>`;
}

function selectField(id, label, options, selected) {
  const opts = options.map(([value, text]) =>
    `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(text)}</option>`).join("");
  return `<label for="${id}">${escapeHtml(label)}
    <select id="${id}" aria-describedby="${id}-error">${opts}</select>
    <span class="field-error" id="${id}-error"></span>
  </label>`;
}

function checkboxField(id, label, checked) {
  return `<label class="checkbox-field" for="${id}">
    <input id="${id}" type="checkbox"${checked ? " checked" : ""}> ${escapeHtml(label)}
    <span class="field-error" id="${id}-error"></span>
  </label>`;
}

function dateField(id, label, value, opts = {}) {
  const attrs = [opts.required ? "required" : ""].filter(Boolean).join(" ");
  return `<label for="${id}">${escapeHtml(label)}
    <input id="${id}" type="date" value="${escapeHtml(String(value ?? ""))}" ${attrs} aria-describedby="${id}-error">
    <span class="field-error" id="${id}-error"></span>
  </label>`;
}

function textareaField(id, label, value, opts = {}) {
  const attrs = [opts.required ? "required" : ""].filter(Boolean).join(" ");
  return `<label for="${id}">${escapeHtml(label)}
    <textarea id="${id}" rows="${opts.rows ?? 3}" ${attrs} aria-describedby="${id}-error">${escapeHtml(String(value ?? ""))}</textarea>
    <span class="field-error" id="${id}-error"></span>
  </label>`;
}

function fieldValue(id) { return $(`#${id}`).value; }

function clearFieldErrors(formSelector) {
  for (const span of $$(`${formSelector} .field-error`)) span.textContent = "";
  for (const input of $$(`${formSelector} [aria-invalid]`)) input.removeAttribute("aria-invalid");
}

function applyFieldErrors(formSelector, fieldMap, errors) {
  for (const [key, message] of Object.entries(errors)) {
    const id = fieldMap[key];
    if (!id) continue;
    const errorSpan = $(`#${id}-error`);
    const input = $(`#${id}`);
    if (errorSpan) errorSpan.textContent = message;
    if (input) input.setAttribute("aria-invalid", "true");
  }
}

function setFeedback(selector, message, kind) {
  const el = $(selector);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("is-error", kind === "error");
  el.classList.toggle("is-ok", kind === "ok");
}

/* -------- render primitives -------- */

function kpiCard([label, value]) {
  const muted = value === "—" ? " is-muted" : "";
  return `<article class="card"><div class="metric-label">${escapeHtml(String(label))}</div><div class="metric${muted}">${escapeHtml(String(value))}</div></article>`;
}

function infoCard(title, bodyHtml) {
  return `<article class="card"><h4>${escapeHtml(String(title))}</h4><div class="muted">${bodyHtml}</div></article>`;
}

function detailGroup(title, items, emptyText) {
  const body = items.length > 0
    ? `<ul class="detail-list">${items.join("")}</ul>`
    : `<p class="muted">${escapeHtml(emptyText)}</p>`;
  return `<div class="detail-group"><h4>${escapeHtml(title)}</h4>${body}</div>`;
}

function stateBlock({ kind, title, body, items }) {
  const list = items && items.length > 0
    ? `<ul>${items.map((item) => `<li>${escapeHtml(String(item))}</li>`).join("")}</ul>`
    : "";
  return `<div class="state-block is-${kind}"><h4>${escapeHtml(title)}</h4><p>${escapeHtml(body)}</p>${list}</div>`;
}

function optionalNumber(value) {
  const text = String(value ?? "").trim();
  return text === "" ? undefined : Number(text);
}
function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
/** An unknown figure renders as an em dash, never as 0,00 €. */
function unknownCell() {
  return "<span class=\"muted\" title=\"Ei tiedossa\">—</span>";
}
function unknownOr(value) {
  return value === undefined ? unknownCell() : money(value);
}
function money(value) {
  return new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(value);
}
function percent(value) {
  return `${new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 1 }).format(value)} %`;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}
function readCredential() {
  try { return JSON.parse(sessionStorage.getItem("tmVisitorCredential")); } catch { return null; }
}
function toast(message, isError = false) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", isError);
  element.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("visible"), 4000);
}
function showError(error) {
  console.error(error);
  toast(`${error.code ? `${error.code}: ` : ""}${error.message}`, true);
}

boot();
