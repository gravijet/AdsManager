import { api } from "./api.js";
import { renderLineChart, renderMeterList } from "./charts.js";

// ---------- Router ----------

const views = document.querySelectorAll(".view");
const navLinks = document.querySelectorAll(".nav-link");
let sitesCache = [];
let adsCache = [];

function navigate(route) {
  if (!document.getElementById(`view-${route}`)) route = "dashboard";
  views.forEach((v) => v.classList.toggle("active", v.id === `view-${route}`));
  navLinks.forEach((l) => l.classList.toggle("active", l.dataset.route === route));
  if (route === "dashboard") loadDashboard();
  if (route === "ads") loadAds();
  if (route === "sites") loadSites();
  if (route === "stats") loadStats();
  if (route === "settings") loadSettings();
}

navLinks.forEach((l) => l.addEventListener("click", () => { location.hash = l.dataset.route; }));
window.addEventListener("hashchange", () => navigate(location.hash.slice(1)));

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function fmtInt(n) { return (n || 0).toLocaleString("de-AT"); }
function fmtPct(n, d) { return d ? `${((n / d) * 100).toFixed(1)}%` : "—"; }

// ---------- whoami ----------

fetch("/admin/api/whoami").then((r) => r.json()).then((d) => {
  document.getElementById("actor-email").textContent = d.email;
}).catch(() => {});

// ---------- Dashboard ----------

async function loadDashboard() {
  const [stats] = await Promise.all([api.stats({ from: daysAgoIso(14), to: nowIso() })]);
  renderKpis(document.getElementById("dash-kpis"), stats.totals);
  renderTimeseriesChart(document.getElementById("dash-chart"), stats.timeseries);
  const topAds = [...stats.perAd].filter((a) => a.impressions > 0).slice(0, 6)
    .map((a) => ({ label: a.name, value: a.impressions }));
  renderMeterList(document.getElementById("dash-top-ads"), topAds);
}

function renderKpis(container, totals) {
  const byType = Object.fromEntries((totals || []).map((t) => [t.event_type, t.c]));
  const impressions = byType.impression || 0;
  const clicks = byType.click || 0;
  const completes = byType.complete || 0;
  const skips = byType.skip || 0;

  const tiles = [
    ["Impressionen", fmtInt(impressions)],
    ["Klicks", fmtInt(clicks)],
    ["CTR", fmtPct(clicks, impressions)],
    ["Abschlüsse", fmtInt(completes)],
    ["Abschlussrate", fmtPct(completes, impressions)],
    ["Übersprungen", fmtInt(skips)],
  ];
  container.innerHTML = "";
  for (const [label, value] of tiles) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<p class="kpi-label">${label}</p><p class="kpi-value">${value}</p>`;
    container.appendChild(card);
  }
}

function renderTimeseriesChart(container, timeseries) {
  const days = [...new Set(timeseries.map((t) => t.day))].sort();
  const rows = days.map((day) => {
    const row = { day };
    for (const t of timeseries) if (t.day === day) row[t.event_type] = t.c;
    return row;
  });
  renderLineChart(container, {
    series: [
      { key: "impression", label: "Impressionen", colorVar: "--series-1" },
      { key: "click", label: "Klicks", colorVar: "--series-2" },
      { key: "complete", label: "Abschlüsse", colorVar: "--series-3" },
    ],
    rows,
  });
}

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 16);
}
function nowIso() { return new Date().toISOString().slice(0, 16); }

// ---------- Ads ----------

async function loadAds() {
  [adsCache, sitesCache] = await Promise.all([api.ads.list(), api.sites.list()]);
  const tbody = document.querySelector("#ads-table tbody");
  tbody.innerHTML = "";
  for (const ad of adsCache) {
    const tr = document.createElement("tr");
    const period = ad.startsAt || ad.endsAt ? `${fmtDate(ad.startsAt)} – ${fmtDate(ad.endsAt)}` : "unbegrenzt";
    tr.innerHTML = `
      <td>${escapeHtml(ad.name)}</td>
      <td>${typeLabel(ad.type)}</td>
      <td><span class="pill ${ad.enabled ? "pill-on" : "pill-off"}">${ad.enabled ? "Aktiv" : "Inaktiv"}</span></td>
      <td class="num">${ad.weight}</td>
      <td class="num">${ad.priority}</td>
      <td>${period}</td>
      <td class="row-actions"><button class="btn btn-sm" data-edit="${ad.id}">Bearbeiten</button></td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => openAdModal(btn.dataset.edit)));
}

function typeLabel(t) {
  return { image: "Bild", video: "Video", text: "Text", link: "Link", html: "HTML" }[t] || t;
}
function fmtDate(s) { return s ? s.slice(0, 16).replace("T", " ") : "–"; }
function escapeHtml(s) { return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// -- Ad modal --

const adModal = document.getElementById("ad-modal-backdrop");
const adForm = document.getElementById("ad-form");
let editingAdId = null;
let pendingMedia = null;

document.getElementById("btn-new-ad").addEventListener("click", () => openAdModal(null));
adModal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => adModal.hidden = true));

document.getElementById("ad-type").addEventListener("change", updateAdFieldVisibility);
document.getElementById("ad-click-action").addEventListener("change", updateAdFieldVisibility);
document.getElementById("ad-duration-mode").addEventListener("change", updateAdFieldVisibility);

function updateAdFieldVisibility() {
  const type = document.getElementById("ad-type").value;
  const clickAction = document.getElementById("ad-click-action").value;
  const durationMode = document.getElementById("ad-duration-mode").value;

  document.getElementById("ad-media-field").hidden = !(type === "image" || type === "video");
  document.getElementById("ad-title-field").hidden = type === "html";
  document.getElementById("ad-content-field").hidden = false;
  document.getElementById("ad-content-label").textContent = type === "html" ? "HTML-Quellcode" : type === "link" ? "Beschreibung" : "Inhalt";

  document.getElementById("ad-click-url-field").hidden = !(clickAction === "open_url" || clickAction === "redirect_top" || type === "link");
  document.getElementById("ad-postmessage-field").hidden = clickAction !== "postmessage";

  const untilFinishedOpt = document.querySelector('#ad-duration-mode option[value="until_finished"]');
  untilFinishedOpt.disabled = type !== "video";
  if (type !== "video" && durationMode === "until_finished") document.getElementById("ad-duration-mode").value = "fixed";
  document.getElementById("ad-duration-seconds-field").hidden = document.getElementById("ad-duration-mode").value !== "fixed";
}

function renderRulesTable(existingRules) {
  const tbody = document.querySelector("#ad-rules-table tbody");
  tbody.innerHTML = "";
  const map = new Map((existingRules || []).map((r) => [r.siteId, r.weightOverride]));
  for (const site of sitesCache) {
    const tr = document.createElement("tr");
    const value = map.has(site.id) && map.get(site.id) !== null ? map.get(site.id) : "";
    tr.innerHTML = `<td>${escapeHtml(site.name)}</td><td><input type="number" min="0" data-site="${site.id}" placeholder="Standard" value="${value}"></td>`;
    tbody.appendChild(tr);
  }
}

function collectRules() {
  return [...document.querySelectorAll("#ad-rules-table input")].map((input) => ({
    siteId: input.dataset.site,
    weightOverride: input.value === "" ? null : Number(input.value),
  }));
}

async function openAdModal(id) {
  editingAdId = id;
  pendingMedia = null;
  adForm.reset();
  document.getElementById("ad-form-error").hidden = true;
  document.getElementById("ad-media-preview").hidden = true;
  document.getElementById("ad-media-preview-video").hidden = true;
  document.getElementById("btn-delete-ad").hidden = !id;

  if (!sitesCache.length) sitesCache = await api.sites.list();

  if (id) {
    const ad = await api.ads.get(id);
    document.getElementById("ad-modal-title").textContent = "Anzeige bearbeiten";
    document.getElementById("ad-name").value = ad.name;
    document.getElementById("ad-type").value = ad.type;
    document.getElementById("ad-title").value = ad.title || "";
    document.getElementById("ad-content").value = ad.content || "";
    document.getElementById("ad-click-action").value = ad.clickAction;
    document.getElementById("ad-click-url").value = ad.clickUrl || "";
    document.getElementById("ad-postmessage-payload").value = ad.postmessagePayload ? JSON.stringify(ad.postmessagePayload) : "";
    document.getElementById("ad-duration-mode").value = ad.durationMode;
    document.getElementById("ad-duration-seconds").value = ad.durationSeconds || 6;
    document.getElementById("ad-skip-after").value = ad.skipAfterSeconds ?? "";
    document.getElementById("ad-weight").value = ad.weight;
    document.getElementById("ad-priority").value = ad.priority;
    document.getElementById("ad-frequency-cap").value = ad.frequencyCapPerDay ?? "";
    document.getElementById("ad-starts-at").value = ad.startsAt ? ad.startsAt.slice(0, 16) : "";
    document.getElementById("ad-ends-at").value = ad.endsAt ? ad.endsAt.slice(0, 16) : "";
    document.getElementById("ad-restricted").checked = ad.restrictedToSites;
    document.getElementById("ad-enabled").checked = ad.enabled;
    pendingMedia = ad.mediaKey ? { mediaKey: ad.mediaKey, mediaMime: ad.mediaMime, mediaBytes: ad.mediaBytes } : null;
    if (pendingMedia && ad.type === "image") { const img = document.getElementById("ad-media-preview"); img.src = `/media/${ad.mediaKey}`; img.hidden = false; }
    if (pendingMedia && ad.type === "video") { const v = document.getElementById("ad-media-preview-video"); v.src = `/media/${ad.mediaKey}`; v.hidden = false; }
    renderRulesTable(ad.rules);
  } else {
    document.getElementById("ad-modal-title").textContent = "Neue Anzeige";
    document.getElementById("ad-type").value = "image";
    renderRulesTable([]);
  }

  updateAdFieldVisibility();
  adModal.hidden = false;
}

// -- file upload / dropzone --

const dropzone = document.getElementById("ad-dropzone");
const fileInput = document.getElementById("ad-file");
dropzone.addEventListener("click", () => fileInput.click());
["dragover", "dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.toggle("drag", evt === "dragover");
  });
});
dropzone.addEventListener("drop", (e) => { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener("change", () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

async function handleFile(file) {
  dropzone.textContent = `Lade hoch: ${file.name}…`;
  try {
    const result = await api.upload(file);
    pendingMedia = result;
    dropzone.textContent = `${file.name} (${(result.mediaBytes / 1024).toFixed(0)} KB)`;
    const isVideo = result.mediaMime.startsWith("video/");
    document.getElementById("ad-media-preview").hidden = isVideo;
    document.getElementById("ad-media-preview-video").hidden = !isVideo;
    const el = document.getElementById(isVideo ? "ad-media-preview-video" : "ad-media-preview");
    el.src = `/media/${result.mediaKey}`;
  } catch (err) {
    dropzone.textContent = "Fehler beim Upload — erneut versuchen";
    toast(err.message);
  }
}

adForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("ad-form-error");
  errorEl.hidden = true;

  const payload = {
    name: document.getElementById("ad-name").value,
    type: document.getElementById("ad-type").value,
    mediaKey: pendingMedia?.mediaKey ?? null,
    mediaMime: pendingMedia?.mediaMime ?? null,
    mediaBytes: pendingMedia?.mediaBytes ?? null,
    title: document.getElementById("ad-title").value || null,
    content: document.getElementById("ad-content").value || null,
    clickAction: document.getElementById("ad-click-action").value,
    clickUrl: document.getElementById("ad-click-url").value || null,
    postmessagePayload: parseJsonOrNull(document.getElementById("ad-postmessage-payload").value),
    durationMode: document.getElementById("ad-duration-mode").value,
    durationSeconds: Number(document.getElementById("ad-duration-seconds").value) || null,
    skipAfterSeconds: document.getElementById("ad-skip-after").value === "" ? null : Number(document.getElementById("ad-skip-after").value),
    weight: Number(document.getElementById("ad-weight").value) || 0,
    priority: Number(document.getElementById("ad-priority").value) || 0,
    frequencyCapPerDay: document.getElementById("ad-frequency-cap").value === "" ? null : Number(document.getElementById("ad-frequency-cap").value),
    restrictedToSites: document.getElementById("ad-restricted").checked,
    enabled: document.getElementById("ad-enabled").checked,
    startsAt: document.getElementById("ad-starts-at").value || null,
    endsAt: document.getElementById("ad-ends-at").value || null,
    rules: collectRules(),
  };

  try {
    if (editingAdId) await api.ads.update(editingAdId, payload);
    else await api.ads.create(payload);
    adModal.hidden = true;
    toast("Gespeichert.");
    loadAds();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});

function parseJsonOrNull(text) {
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

document.getElementById("btn-delete-ad").addEventListener("click", async () => {
  if (!editingAdId) return;
  if (!confirm("Diese Anzeige wirklich löschen?")) return;
  await api.ads.remove(editingAdId);
  adModal.hidden = true;
  toast("Gelöscht.");
  loadAds();
});

document.getElementById("btn-preview-ad").addEventListener("click", () => {
  if (editingAdId) {
    window.open(`/?preview=${editingAdId}`, "_blank");
  } else {
    toast("Bitte zuerst speichern, dann Vorschau öffnen.");
  }
});

// ---------- Sites ----------

async function loadSites() {
  sitesCache = await api.sites.list();
  const tbody = document.querySelector("#sites-table tbody");
  tbody.innerHTML = "";
  for (const site of sitesCache) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(site.name)}</td>
      <td>${escapeHtml(site.domain || "–")}</td>
      <td><span class="copy-key" data-key="${site.siteKey}" title="Klicken zum Kopieren">${site.siteKey.slice(0, 10)}…</span></td>
      <td><span class="pill ${site.enabled ? "pill-on" : "pill-off"}">${site.enabled ? "Aktiv" : "Inaktiv"}</span></td>
      <td class="row-actions">
        <button class="btn btn-sm" data-snippet="${site.siteKey}">Embed-Code</button>
        <button class="btn btn-sm" data-edit="${site.id}">Bearbeiten</button>
      </td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => openSiteModal(btn.dataset.edit)));
  tbody.querySelectorAll("[data-key]").forEach((el) => el.addEventListener("click", () => {
    navigator.clipboard.writeText(el.dataset.key);
    toast("Site-Key kopiert.");
  }));
  tbody.querySelectorAll("[data-snippet]").forEach((btn) => btn.addEventListener("click", () => {
    const snippet = `<iframe src="https://example.invalid/?site=${btn.dataset.snippet}" width="360" height="280" style="border:0;" allow="autoplay"></iframe>`;
    navigator.clipboard.writeText(snippet);
    toast("Embed-Code kopiert.");
  }));
}

const siteModal = document.getElementById("site-modal-backdrop");
const siteForm = document.getElementById("site-form");
let editingSiteId = null;

document.getElementById("btn-new-site").addEventListener("click", () => openSiteModal(null));
siteModal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => siteModal.hidden = true));

function openSiteModal(id) {
  editingSiteId = id;
  siteForm.reset();
  document.getElementById("site-form-error").hidden = true;
  document.getElementById("btn-delete-site").hidden = !id;
  document.getElementById("site-accent-color").value = "#6d5bff";

  if (id) {
    const site = sitesCache.find((s) => s.id === id);
    document.getElementById("site-modal-title").textContent = "Website bearbeiten";
    document.getElementById("site-name").value = site.name;
    document.getElementById("site-domain").value = site.domain || "";
    document.getElementById("site-button-text").value = site.buttonText || "";
    if (site.accentColor) document.getElementById("site-accent-color").value = site.accentColor;
    document.getElementById("site-enabled").checked = site.enabled;
  } else {
    document.getElementById("site-modal-title").textContent = "Neue Website";
  }
  siteModal.hidden = false;
}

siteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("site-form-error");
  errorEl.hidden = true;
  const payload = {
    name: document.getElementById("site-name").value,
    domain: document.getElementById("site-domain").value || null,
    buttonText: document.getElementById("site-button-text").value || null,
    accentColor: document.getElementById("site-accent-color").value || null,
    enabled: document.getElementById("site-enabled").checked,
  };
  try {
    if (editingSiteId) {
      await api.sites.update(editingSiteId, payload);
    } else {
      const result = await api.sites.create(payload);
      await navigator.clipboard.writeText(result.siteKey).catch(() => {});
      toast("Website erstellt — Site-Key wurde in die Zwischenablage kopiert.");
    }
    siteModal.hidden = true;
    loadSites();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});

document.getElementById("btn-delete-site").addEventListener("click", async () => {
  if (!editingSiteId) return;
  if (!confirm("Diese Website wirklich löschen? Zugehörige Website-spezifische Regeln werden ebenfalls entfernt.")) return;
  await api.sites.remove(editingSiteId);
  siteModal.hidden = true;
  toast("Gelöscht.");
  loadSites();
});

// ---------- Stats ----------

async function loadStats() {
  if (!sitesCache.length) sitesCache = await api.sites.list();
  if (!adsCache.length) adsCache = await api.ads.list();

  const siteSelect = document.getElementById("stats-site");
  if (siteSelect.options.length <= 1) {
    for (const s of sitesCache) siteSelect.append(new Option(s.name, s.id));
  }
  const adSelect = document.getElementById("stats-ad");
  if (adSelect.options.length <= 1) {
    for (const a of adsCache) adSelect.append(new Option(a.name, a.id));
  }

  await refreshStats();
}

document.getElementById("stats-range").addEventListener("change", refreshStats);
document.getElementById("stats-site").addEventListener("change", refreshStats);
document.getElementById("stats-ad").addEventListener("change", refreshStats);

let lastStats = null;

async function refreshStats() {
  const days = Number(document.getElementById("stats-range").value);
  const siteId = document.getElementById("stats-site").value;
  const adId = document.getElementById("stats-ad").value;
  const stats = await api.stats({ from: daysAgoIso(days), to: nowIso(), ...(siteId && { siteId }), ...(adId && { adId }) });
  lastStats = stats;

  renderKpis(document.getElementById("stats-kpis"), stats.totals);
  renderTimeseriesChart(document.getElementById("stats-chart"), stats.timeseries);

  const adsBody = document.querySelector("#stats-ads-table tbody");
  adsBody.innerHTML = "";
  for (const a of stats.perAd) {
    if (!a.impressions && !a.clicks && !a.completes) continue;
    adsBody.innerHTML += `<tr><td>${escapeHtml(a.name)}</td><td class="num">${fmtInt(a.impressions)}</td><td class="num">${fmtInt(a.clicks)}</td><td class="num">${fmtPct(a.clicks, a.impressions)}</td><td class="num">${fmtInt(a.completes)}</td></tr>`;
  }
  if (!adsBody.innerHTML) adsBody.innerHTML = `<tr><td colspan="5" class="field-hint">Keine Daten.</td></tr>`;

  const sitesBody = document.querySelector("#stats-sites-table tbody");
  sitesBody.innerHTML = "";
  for (const s of stats.perSite) {
    if (!s.impressions && !s.clicks && !s.completes) continue;
    sitesBody.innerHTML += `<tr><td>${escapeHtml(s.name)}</td><td class="num">${fmtInt(s.impressions)}</td><td class="num">${fmtInt(s.clicks)}</td><td class="num">${fmtInt(s.completes)}</td></tr>`;
  }
  if (!sitesBody.innerHTML) sitesBody.innerHTML = `<tr><td colspan="4" class="field-hint">Keine Daten.</td></tr>`;
}

document.getElementById("btn-export-csv").addEventListener("click", () => {
  if (!lastStats) return;
  const rows = [["Anzeige", "Impressionen", "Klicks", "Abschlüsse", "Skips"]];
  for (const a of lastStats.perAd) rows.push([a.name, a.impressions || 0, a.clicks || 0, a.completes || 0, a.skips || 0]);
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `werbung-statistik-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- Settings ----------

async function loadSettings() {
  const s = await api.settings.get();
  document.getElementById("set-button-text").value = s.button_text || "";
  document.getElementById("set-accent-color").value = s.accent_color || "#6d5bff";
  document.getElementById("set-fallback-behavior").value = s.fallback_behavior || "grant";
  document.getElementById("set-fallback-message").value = s.fallback_message || "";
}

document.getElementById("btn-save-settings").addEventListener("click", async () => {
  await api.settings.update({
    button_text: document.getElementById("set-button-text").value,
    accent_color: document.getElementById("set-accent-color").value,
    fallback_behavior: document.getElementById("set-fallback-behavior").value,
    fallback_message: document.getElementById("set-fallback-message").value,
  });
  toast("Einstellungen gespeichert.");
});

document.getElementById("btn-purge").addEventListener("click", async () => {
  const days = Number(document.getElementById("purge-days").value);
  if (!confirm(`Wirklich alle Events älter als ${days} Tage löschen?`)) return;
  const result = await api.purgeEvents(days);
  toast(`${result.deleted} Einträge gelöscht.`);
});

// ---------- Init ----------

navigate(location.hash.slice(1) || "dashboard");
