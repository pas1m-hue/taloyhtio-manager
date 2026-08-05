import {
  ASSET_CATEGORIES,
  buildAssetListViewModel,
  buildCostEvidenceListViewModel,
  buildObservationListViewModel,
  buildSaveAssetOperation,
  buildSaveCostEvidenceOperation,
  buildSaveHousingCompanyOperation,
  buildSaveObservationOperation,
  buildSavePriceLevelConfirmationOperation,
  canSubmitAdminOperation,
  COST_EVIDENCE_STATUSES,
  countActiveAssets,
  countObservationsWithoutEvent,
  deriveDataGapAssets,
  interpretRevisionConflict,
  isCostEvidenceExpired,
  PROJECTION_PRICE_LEVEL_YEAR,
  selectFinancialYearViewModel,
} from "./adminOperationPayloads.js";

const KNOWN_VIEWS = new Set([
  "overview", "company", "assets", "observations", "events", "cost-evidence",
  "finance-summary", "finance-income", "finance-costs-group",
  "finance-costs-account", "finance-budget", "finance-position",
  "scenarios", "cashpath", "required-collection", "publish", "developer",
]);

// Views that own the right-hand detail panel; navigating to any other view
// closes it (decision: generalized from vaihe 1's assets-only behaviour).
const DETAIL_PANEL_VIEWS = new Set(["assets", "observations", "cost-evidence"]);

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

const SCENARIOS = ["optimistic", "base", "stress"];

const state = {
  mode: "admin",
  view: "overview",
  admin: null,
  /** Detail-panel selection: null or { view: "assets"|"observations"|"cost-evidence", id }. */
  selection: null,
  selectedFiscalYear: null,
  cashpathScenario: "base",
  published: null,
  visitor: null,
  visitorCredential: readCredential(),
  auth: readAuthSession(),
  staleWorkspace: false,
};

function selectionId(view) {
  return state.selection && state.selection.view === view ? state.selection.id : null;
}

function selectionStillExists(selection, model) {
  const lists = { assets: model.assets, observations: model.observations, "cost-evidence": model.costEvidence };
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
  renderEventsPlaceholder();
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
  $("#cost-evidence-new").addEventListener("click", () => openCostEvidenceEditor("new"));
  $("#cost-evidence-filter-status").addEventListener("change", renderCostEvidence);
  $("#cost-evidence-filter-asset").addEventListener("change", renderCostEvidence);
  $("#cost-evidence-filter-gap-only").addEventListener("change", renderCostEvidence);
  $("#topbar-fiscal-year").addEventListener("change", (event) => {
    state.selectedFiscalYear = Number(event.target.value);
    renderOverview();
  });
  $("#detail-panel-close").addEventListener("click", closeDetailPanel);

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
  for (const selector of ["#admin-load", "#admin-preview", "#admin-publish", "#assets-new", "#observations-new", "#cost-evidence-new"]) {
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
  renderCostEvidence();
  renderEventsPlaceholder();
  renderFinancePlaceholders();
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
  $("#cost-evidence-kpis").innerHTML = "";
  for (const id of [
    "#assets-list", "#observations-list", "#cost-evidence-list",
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
    </div>
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
    sourceIds: fieldValue("company-source-ids"),
    explanation: fieldValue("company-explanation"),
  };
  const result = buildSaveHousingCompanyOperation(raw);
  if (!result.ok) {
    applyFieldErrors("#company-form", {
      name: "company-name", apartmentCount: "company-apartments",
      chargeableAreaM2: "company-area", bufferMonths: "company-buffer-months",
      userOverride: "company-buffer-override", sourceIds: "company-source-ids",
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
    <div class="button-row"><button type="button" class="secondary" id="detail-edit-asset">Muokkaa</button></div>
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
}

function openDetailPanel() { $("#detail-panel").hidden = false; }
function closeDetailPanel() {
  $("#detail-panel").hidden = true;
  state.selection = null;
  for (const el of $$(".asset-card.is-selected, #observations-list tr.is-selected, #cost-evidence-list tr.is-selected")) {
    el.classList.remove("is-selected");
  }
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
    <div class="button-row"><button type="button" class="secondary" id="detail-edit-observation">Muokkaa</button></div>
    ${detailGroup("Linkitetyt tapahtumat", linkedEvents.map((event) =>
      `<li><strong>${escapeHtml(event.title)}</strong> · ${escapeHtml(event.status)}</li>`), "Ei linkitettyjä tapahtumia.")}
    <p class="muted">Korjaustapahtuman luonti havainnosta toteutetaan vaiheessa 2B.</p>
  `;
  $("#detail-edit-observation").addEventListener(
    "click", () => openObservationEditor("edit", observation.id),
  );
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
      ${needsConfirmation && !confirmed
        ? `<button type="button" class="secondary" id="detail-confirm-price-level">Vahvista hintataso ${PROJECTION_PRICE_LEVEL_YEAR}</button>`
        : ""}
    </div>
  `;
  $("#detail-edit-cost-evidence").addEventListener(
    "click", () => openCostEvidenceEditor("edit", evidence.id),
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

/* -------- Korjaustapahtumat placeholder + finance placeholders (decision 5) -------- */

function renderEventsPlaceholder() {
  $("#events-body").innerHTML = stateBlock({
    kind: "not-built",
    title: "Korjaustapahtumanäkymä tulossa vaiheessa 2B",
    body: "Suunnitellut, hyväksytyt ja toteutuneet korjaustapahtumat, skenaariorivit sekä havainnosta luotu tapahtuma toteutetaan vaiheessa 2B. Tapahtumatiedot ovat toistaiseksi nähtävissä rakennusosan detaljipaneelissa Rakennusosat-näkymässä.",
  });
}

function renderFinancePlaceholders() {
  for (const host of $$("[data-finance]")) {
    host.innerHTML = stateBlock({
      kind: "not-modelled",
      title: "Tietomalli ei vielä tue tätä näkymää",
      body: "Tilikohtainen talousmalli (FinancialAccount/FinancialEntry) toteutetaan vaiheessa 3. Yleiskuvan talousvuosivalitsin näyttää vuositason budjetti- ja toteumaluvut jo nyt.",
    });
  }
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
  const rows = cashPath.years.map((year) => `<tr>
    <td>${year.year}</td>
    <td class="num">${money(year.openingCash)}</td>
    <td class="num">${money(year.annualRepairCollection)}</td>
    <td class="num">${money(year.knownRepairCosts)}</td>
    <td class="num">${money(year.closingCash)}</td>
    <td class="num">${money(year.operatingBufferTarget)}</td>
    <td class="num">${year.bufferShortfall > 0 ? `<span class="warning">${money(year.bufferShortfall)}</span>` : money(0)}</td>
    <td class="num">${year.dataGaps.length}</td>
  </tr>`).join("");
  host.innerHTML = `
    <div class="mode-switch" style="margin-bottom:1rem">${tabs}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Vuosi</th><th class="num">Avaava kassa</th><th class="num">Vuosikeräys</th><th class="num">Tunnetut kulut</th><th class="num">Päättävä kassa</th><th class="num">Puskuritavoite</th><th class="num">Puskurivaje</th><th class="num">DATA GAP</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  for (const button of $$("#cashpath-body [data-cashpath]")) {
    button.addEventListener("click", () => { state.cashpathScenario = button.dataset.cashpath; renderCashpath(); });
  }
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
function money(value) {
  return new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(value);
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
