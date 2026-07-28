import {
  ASSET_CATEGORIES,
  buildAssetListViewModel,
  buildSaveAssetOperation,
  buildSaveHousingCompanyOperation,
  canSubmitAdminOperation,
  countActiveAssets,
  deriveDataGapAssets,
  interpretRevisionConflict,
  selectFinancialYearViewModel,
} from "./adminOperationPayloads.js";

const KNOWN_VIEWS = new Set([
  "overview", "company", "assets", "observations", "events", "cost-evidence",
  "finance-summary", "finance-income", "finance-costs-group",
  "finance-costs-account", "finance-budget", "finance-position",
  "scenarios", "cashpath", "required-collection", "publish", "developer",
]);

const CATEGORY_LABELS = {
  hvac: "LVI", envelope: "Vaippa", structures: "Rakenteet",
  yard: "Piha", safety: "Turvallisuus", other: "Muu",
};

const SCENARIOS = ["optimistic", "base", "stress"];

const state = {
  mode: "admin",
  view: "overview",
  admin: null,
  selectedAssetId: null,
  selectedFiscalYear: null,
  assetEditor: null,
  cashpathScenario: "base",
  published: null,
  visitor: null,
  visitorCredential: readCredential(),
  auth: readAuthSession(),
  staleWorkspace: false,
};

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
  if (view !== "assets") closeDetailPanel();
  else if (state.selectedAssetId) openDetailPanel();
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
    state.selectedAssetId = null;
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
  for (const selector of ["#admin-load", "#admin-preview", "#admin-publish", "#assets-new"]) {
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
    if (state.selectedAssetId && !model.assets.some((a) => a.id === state.selectedAssetId)) {
      state.selectedAssetId = null;
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
  renderMaintenancePlaceholders();
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
  for (const id of ["#assets-list", "#scenarios-body", "#cashpath-body", "#required-collection-body", "#publish-summary"]) {
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
  host.innerHTML = vm.rows.map((row) => {
    const selected = row.id === state.selectedAssetId ? " is-selected" : "";
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
  state.selectedAssetId = assetId;
  renderAssets();
  renderAssetDetail();
  openDetailPanel();
}

function renderAssetDetail() {
  const model = state.admin;
  const asset = model.assets.find((item) => item.id === state.selectedAssetId);
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
  state.selectedAssetId = null;
  for (const card of $$("#assets-list .asset-card.is-selected")) card.classList.remove("is-selected");
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
    state.selectedAssetId = result.operation.value.id;
    closeAssetEditor();
    renderAssets();
    renderAssetDetail();
    openDetailPanel();
  } else if (sent.conflict) {
    setFeedback("#asset-feedback", "Tiedot muuttuivat — lataa työtila uudelleen.", "error");
  }
}

/* -------- Maintenance & finance placeholders (decision 5) -------- */

function renderMaintenancePlaceholders() {
  const body = (title) => stateBlock({
    kind: "not-built",
    title,
    body: "Tämä näkymä toteutetaan vaiheessa 2. Tiedot ovat toistaiseksi nähtävissä rakennusosan detaljipaneelissa Rakennusosat-näkymässä.",
  });
  $("#observations-body").innerHTML = body("Havaintonäkymä tulossa");
  $("#events-body").innerHTML = body("Korjaustapahtumanäkymä tulossa");
  $("#cost-evidence-body").innerHTML = body("Kustannusnäyttö tulossa");
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
