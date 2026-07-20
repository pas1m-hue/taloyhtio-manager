const state = {
  published: null,
  visitor: null,
  visitorCredential: readCredential(),
  admin: null,
};

const $ = (selector) => document.querySelector(selector);
const companyId = () => $("#company-id").value.trim();
const horizon = () => ({
  startYear: Number($("#horizon-start").value),
  endYear: Number($("#horizon-end").value),
});
const adminToken = () => $("#admin-token").value.trim();

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => {
      item.classList.toggle("active", item === tab);
      item.setAttribute("aria-selected", String(item === tab));
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `${tab.dataset.tab}-panel`);
    });
  });
}

$("#health-button").addEventListener("click", checkHealth);
$("#visitor-load-overview").addEventListener("click", loadPublished);
$("#visitor-create-session").addEventListener("click", createSession);
$("#visitor-reset").addEventListener("click", resetSession);
$("#visitor-liquidity-form").addEventListener("submit", saveLiquidity);
$("#visitor-custom-event-form").addEventListener("submit", saveCustomEvent);
$("#admin-load").addEventListener("click", loadAdmin);
$("#admin-preview").addEventListener("click", loadAdmin);
$("#admin-publish").addEventListener("click", publishAdmin);
$("#admin-batch-form").addEventListener("submit", saveAdminBatch);

async function checkHealth() {
  try {
    const data = await api("/api/v1/health");
    $("#connection-status").textContent = `${data.status} · ${data.apiVersion}`;
    toast("API-yhteys toimii.");
  } catch (error) { showError(error); }
}

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
      body: {
        publicationVersion: state.published.publicationVersion,
        horizon: horizon(),
      },
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

async function loadAdmin() {
  try {
    state.admin = await api(`/api/v1/admin/companies/${encodeURIComponent(companyId())}/workspace${horizonQuery()}`, {
      adminToken: adminToken(),
    });
    renderAdmin();
    toast(`Admin-revisio ${state.admin.adminRevision} ladattu.`);
  } catch (error) { showError(error); }
}

async function saveAdminBatch(event) {
  event.preventDefault();
  try {
    if (!state.admin) await loadAdmin();
    const operations = JSON.parse($("#admin-operations").value);
    state.admin = await api(`/api/v1/admin/companies/${encodeURIComponent(companyId())}/changes`, {
      method: "POST",
      adminToken: adminToken(),
      body: { expectedRevision: state.admin.adminRevision, horizon: horizon(), operations },
    });
    renderAdmin();
    toast("Admin-batch tallennettu pysyvään työtilaan.");
  } catch (error) { showError(error); }
}

async function publishAdmin() {
  try {
    if (!state.admin) await loadAdmin();
    const form = new FormData($("#admin-publish-form"));
    const item = await api(`/api/v1/admin/companies/${encodeURIComponent(companyId())}/publish`, {
      method: "POST",
      adminToken: adminToken(),
      body: {
        expectedAdminRevision: state.admin.adminRevision,
        expectedPublishedVersion: state.admin.publication.latestPublicationVersion,
        sourceIds: [String(form.get("sourceId"))],
        explanation: String(form.get("explanation")),
      },
    });
    toast(`Julkaisuversio ${item.publicationVersion} luotu.`);
    await loadAdmin();
  } catch (error) { showError(error); }
}

function renderPublishedSummary(model) {
  $("#visitor-summary").innerHTML = cards([
    ["Julkaisu", model.publicationVersion],
    ["Rakennusosat", model.data.assets.length],
    ["Suunnitellut tapahtumat", model.data.approvedEvents.length],
    ["Toteutunut historia", model.data.actualHistory.length],
  ]);
}

function renderVisitor() {
  const model = state.visitor;
  $("#visitor-session-status").textContent = `Sessio ${model.sessionId} · revisio ${model.sessionRevision} · julkaisu ${model.publicationVersion} · muutoksia ${model.changes.modificationCount}`;
  renderPublishedSummary({
    publicationVersion: model.publicationVersion,
    data: model.publishedData,
  });
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
  document.querySelectorAll(".row-save").forEach((button) => button.addEventListener("click", () => saveEventRow(button)));
  renderScenarioCards($("#visitor-scenarios"), model.projection, model.liquidity);
  fillLiquidityForm(model);
}

function fillLiquidityForm(model) {
  if (model.liquidity.status !== "available") return;
  const form = $("#visitor-liquidity-form");
  const a = model.liquidity.assumptions;
  form.elements.currentCash.value = a.currentCash;
  form.elements.trailing12mOperatingCosts.value = a.trailing12mOperatingCosts;
  form.elements.bufferMonths.value = a.operatingBufferSettings.bufferMonths ?? "";
  for (const scenario of ["optimistic", "base", "stress"]) {
    form.elements[scenario].value = a.annualRepairCollectionByScenario[scenario];
  }
}

function renderAdmin() {
  const model = state.admin;
  $("#admin-summary").innerHTML = cards([
    ["Työrevisio", model.adminRevision],
    ["Julkaisu", model.publication.latestPublicationVersion],
    ["Rakennusosat", model.counts.assets],
    ["Hyväksytyt tapahtumat", model.counts.approvedEvents],
    ["DATA GAPit horisontissa", model.counts.dataGapsWithinHorizon],
    ["Julkaistavia muutoksia", model.publication.publishableChanges ? "Kyllä" : "Ei"],
  ]);
  $("#admin-event-rows").innerHTML = model.events.map((event) => `
    <tr><td>${escapeHtml(event.id)}</td><td>${escapeHtml(event.assetId)}</td><td>${escapeHtml(event.title)}</td><td>${escapeHtml(event.status)}</td><td>${escapeHtml(event.origin)}</td></tr>
  `).join("") || `<tr><td colspan="5" class="muted">Ei tapahtumia.</td></tr>`;
  renderScenarioCards($("#admin-scenarios"), model.calculations.projection, model.calculations.liquidity);
}

function renderScenarioCards(target, projection, liquidity) {
  target.innerHTML = ["optimistic", "base", "stress"].map((scenario) => {
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

function cards(items) {
  return items.map(([label, value]) => `<article class="card"><div class="metric-label">${escapeHtml(String(label))}</div><div class="metric">${escapeHtml(String(value))}</div></article>`).join("");
}

async function api(url, options = {}) {
  const headers = { "accept": "application/json" };
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
    throw error;
  }
  return data;
}

function horizonQuery() {
  const value = horizon();
  return `?startYear=${encodeURIComponent(value.startYear)}&endYear=${encodeURIComponent(value.endYear)}`;
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
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
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

checkHealth();
if (state.visitorCredential) loadVisitor().catch(() => {
  state.visitorCredential = null;
  sessionStorage.removeItem("tmVisitorCredential");
});
