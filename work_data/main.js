let REGIONS = [];
let MAX_LEDS = 0;
let gLedMap = {};
let currentConfig = {};
let currentConfigSource = {};
let currentAlerts = [];
let currentSessionReady = false;
let adminLabelDownloadName = "alarmmini-admin.png";
let apLabelDownloadName = "alarmmini-ap.png";
let activeTab = "overview";
let dirtySnapshot = "";

let calTotal = 0;
let calCurrent = 0;
let calTemp = {};
let calMapSvg = null;
let calibrationActive = false;
let calibrationMobileView = "map";
let alertPollTimer = null;
let logsTimer = null;
let latestLogMask = 0;
const ADMIN_PASSWORD_STORAGE_KEY = "alarmmini.adminPassword";
const UI_LANG = window.LANG;
const ALERT_POLL_MIN_MS = 8000;
const ALERT_POLL_MAX_MS = 30000;
let alertPollIntervalMs = 10000;

const TAB_META = {
  overview: { eyebrow: UI_LANG.tabs.overview.eyebrow, title: UI_LANG.tabs.overview.title },
  label: { eyebrow: UI_LANG.tabs.label.eyebrow, title: UI_LANG.tabs.label.title },
  colors: { eyebrow: UI_LANG.tabs.colors.eyebrow, title: UI_LANG.tabs.colors.title },
  night: { eyebrow: UI_LANG.tabs.night.eyebrow, title: UI_LANG.tabs.night.title },
  buzzer: { eyebrow: UI_LANG.tabs.buzzer.eyebrow, title: UI_LANG.tabs.buzzer.title },
  regions: { eyebrow: UI_LANG.tabs.regions.eyebrow, title: UI_LANG.tabs.regions.title },
  mqtt: { eyebrow: UI_LANG.tabs.mqtt.eyebrow, title: UI_LANG.tabs.mqtt.title },
  system: { eyebrow: UI_LANG.tabs.system.eyebrow, title: UI_LANG.tabs.system.title },
  calibration: { eyebrow: UI_LANG.tabs.calibration.eyebrow, title: UI_LANG.tabs.calibration.title },
};

const SVG_ID_TO_REGION = { ...UI_LANG.regionsBySvg };

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n || 0).padStart(2, "0");
const hexToRgb = (hex) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });
const rgbToHex = (r, g, b) => "#" + [r, g, b].map((v) => Number(v || 0).toString(16).padStart(2, "0")).join("");
const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
const setValue = (id, value) => { const el = $(id); if (el) el.value = value; };
const getLangText = (path) => path.split(".").reduce((value, key) => (value && value[key] != null ? value[key] : ""), LANG);

function applyStaticLang() {
  const set = (selector, value) => {
    const el = document.querySelector(selector);
    if (el) el.textContent = value;
  };
  const setAttr = (selector, name, value) => {
    const el = document.querySelector(selector);
    if (el) el.setAttribute(name, value);
  };
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const value = getLangText(el.dataset.i18n);
    if (value !== "") el.textContent = value;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const value = getLangText(el.dataset.i18nPlaceholder);
    if (value !== "") el.setAttribute("placeholder", value);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const value = getLangText(el.dataset.i18nTitle);
    if (value !== "") el.setAttribute("title", value);
  });

  set(".loading-subtitle", UI_LANG.loading.subtitle);
  set(".auth-title", UI_LANG.auth.title);
  set(".auth-subtitle", UI_LANG.auth.subtitle);
  set("label[for='loginPassword']", UI_LANG.auth.password);
  setAttr("#loginPassword", "placeholder", UI_LANG.auth.placeholder);
  set("#loginBtn", UI_LANG.auth.login);
  set("[data-tab='overview']", UI_LANG.nav.overview);
  set("[data-tab='label']", UI_LANG.nav.label);
  set("[data-tab='colors']", UI_LANG.nav.colors);
  set("[data-tab='night']", UI_LANG.nav.night);
  set("[data-tab='buzzer']", UI_LANG.nav.buzzer);
  set("[data-tab='regions']", UI_LANG.nav.regions);
  set("[data-tab='system']", UI_LANG.nav.system);
  set("[data-tab='calibration']", UI_LANG.nav.calibration);
  set("[data-tab='logs']", UI_LANG.nav.logs);
  set(".sidebar-action[onclick='triggerImportSettings()']", UI_LANG.actions.import);
  set(".sidebar-action[onclick='exportSettings()']", UI_LANG.actions.export);
  set("#restartBtn", UI_LANG.actions.restart);
  set("#logoutBtn", UI_LANG.actions.logout);
  set("#saveBtn", UI_LANG.actions.save);
  set("#tab-overview .panel-label", UI_LANG.overview.label);
  set("#tab-overview .panel-title", UI_LANG.overview.title);
  set("#tab-overview .panel-text", UI_LANG.overview.text);
  set("#mapStatusText", UI_LANG.overview.loading);
  set("#mapPreviewWrap .map-preview-empty", UI_LANG.overview.empty);
  set("#tab-label .panel-label", UI_LANG.labels.label);
  set("#tab-label .panel-title", UI_LANG.labels.title);
  set("#tab-label .panel-text", UI_LANG.labels.text);
  set("#tab-label .label-card:first-child .label-card-title", UI_LANG.labels.adminTitle);
  set("#tab-label .label-card:last-child .label-card-title", UI_LANG.labels.apTitle);
  document.querySelectorAll("#tab-label .inline-btn").forEach((btn) => btn.textContent = UI_LANG.actions.downloadPng);
  set("#tab-colors .panel-label", UI_LANG.tabs.colors.eyebrow);
  set("#tab-colors .panel-title", UI_LANG.colors.title);
  set("#tab-colors .mode-divider:first-of-type span", UI_LANG.colors.day);
  set("#tab-colors .mode-divider:last-of-type span", UI_LANG.colors.night);
  set("#tab-colors .settings-row:nth-of-type(1) .row-label", UI_LANG.colors.alert);
  set("#tab-colors .settings-row:nth-of-type(2) .row-label", UI_LANG.colors.clear);
  set("#tab-colors .settings-row:nth-of-type(3) .row-label", UI_LANG.colors.alert);
  set("#tab-colors .settings-row:nth-of-type(4) .row-label", UI_LANG.colors.clear);
  set("#tab-night .panel-label", UI_LANG.tabs.night.eyebrow);
  set("#tab-night .panel-title", UI_LANG.nightMode.title);
  set("#tab-night .settings-row:nth-of-type(2) .row-label", UI_LANG.nightMode.active);
  set("#tab-night .settings-row:nth-of-type(3) .row-label", UI_LANG.nightMode.start);
  set("#tab-night .settings-row:nth-of-type(4) .row-label", UI_LANG.nightMode.end);
  set("#tab-buzzer .panel-label", UI_LANG.tabs.buzzer.eyebrow);
  set("#tab-buzzer .panel-title", UI_LANG.buzzer.title);
  set("#tab-buzzer .settings-row:nth-of-type(2) .row-label", UI_LANG.buzzer.active);
  set("#tab-buzzer .settings-row:nth-of-type(3) .row-label", UI_LANG.buzzer.dayVolume);
  set("#tab-buzzer .settings-row:nth-of-type(4) .row-label", UI_LANG.buzzer.nightVolume);
  document.querySelectorAll("#tab-buzzer .panel-actions .inline-btn").forEach((btn, index) => {
    btn.textContent = index === 0 ? UI_LANG.actions.testAlert : UI_LANG.actions.testClear;
  });
  set("#tab-regions .panel-label", UI_LANG.tabs.regions.eyebrow);
  set("#tab-regions .panel-title", UI_LANG.regions.title);
  const regionButtons = document.querySelectorAll("#tab-regions .panel-actions .inline-btn");
  if (regionButtons[0]) regionButtons[0].textContent = UI_LANG.actions.all;
  if (regionButtons[1]) regionButtons[1].textContent = UI_LANG.actions.none;
  if (regionButtons[2]) regionButtons[2].textContent = UI_LANG.actions.testAlert;
  set("#tab-mqtt .panel-title", UI_LANG.mqtt.title);
  set("#tab-mqtt .form-stack > div:nth-child(1) .col-12.col-md-6:nth-child(1) .field-label", UI_LANG.mqtt.broker);
  set("#tab-mqtt .form-stack > div:nth-child(1) .col-12.col-md-6:nth-child(2) .field-label", UI_LANG.mqtt.port);
  set("#tab-mqtt .form-stack > div:nth-child(2) .field-label", UI_LANG.mqtt.topic);
  set("#tab-mqtt .form-stack > div:nth-child(3) .col-12.col-md-6:nth-child(1) .field-label", UI_LANG.mqtt.login);
  setAttr("#mqttUser", "placeholder", UI_LANG.mqtt.loginPlaceholder);
  set("#tab-mqtt .form-stack > div:nth-child(3) .col-12.col-md-6:nth-child(2) .field-label", UI_LANG.mqtt.password);
  set("#tab-system .panel-label", UI_LANG.tabs.system.eyebrow);
  set("#tab-system .panel-title", UI_LANG.system.title);
  const systemLabelMap = {
    systemAdminPasswordLabel: UI_LANG.system.adminPassword,
    systemMdnsLabel: UI_LANG.system.mdns,
    systemIpLabel: UI_LANG.system.ip,
    systemLabelUrlLabel: UI_LANG.system.labelUrl,
    systemLedPinLabel: UI_LANG.system.ledPin,
    systemBuzzerPinLabel: UI_LANG.system.buzzerPin,
  };
  Object.entries(systemLabelMap).forEach(([labelId, text]) => {
    const target = document.querySelector(`[data-label-id="${labelId}"]`);
    const label = target?.closest(".settings-row")?.querySelector(".row-label");
    if (label) label.textContent = text;
  });
  set("#tab-system .form-stack .row-label", UI_LANG.system.ntpTitle);
  set("#tab-system .form-stack .row-sub", UI_LANG.system.ntpHint);
  set("#tab-calibration .panel-label", UI_LANG.tabs.calibration.eyebrow);
  set("#tab-calibration .panel-title", UI_LANG.calibration.title);
  set("#calIntro .panel-text", UI_LANG.calibration.intro);
  set("#calIntro .inline-btn", UI_LANG.actions.openCalibration);
  set("#calStartBtn", UI_LANG.actions.start);
  set("#calCancelBtn", UI_LANG.actions.cancel);
  set("#calStepHint", UI_LANG.calibration.stepHint);
  set(".cal-mode-note", UI_LANG.calibration.quickNote);
  set(".cal-mobile-tab[data-view='map']", UI_LANG.calibration.mapTab);
  set(".cal-mobile-tab[data-view='regions']", UI_LANG.calibration.regionsTab);
  set(".cal-selected-caption", UI_LANG.calibration.selected);
  set("#calSelectedRegion", UI_LANG.calibration.unassigned);
  set(".cal-mini-btn", UI_LANG.actions.clearSelection);
  set(".cal-legend .cal-legend-item:nth-child(1)", UI_LANG.calibration.selectedNow);
  set(".cal-legend .cal-legend-item:nth-child(2)", UI_LANG.calibration.assigned);
  set(".cal-legend .cal-legend-item:nth-child(3)", UI_LANG.calibration.multi);
  set("#calPrevBtn", UI_LANG.actions.back);
  set("#calNextBtn", UI_LANG.actions.next);
  set(".cal-current-choice", UI_LANG.calibration.unassigned);
  set(".cal-quick-card:nth-of-type(1) .cal-quick-title", UI_LANG.calibration.currentChoice);
  set(".cal-quick-copy", UI_LANG.calibration.currentChoiceHint);
  set(".cal-quick-card:nth-of-type(2) .cal-quick-title", UI_LANG.calibration.quickRegionTitle);
  setAttr("#calRegionSearch", "placeholder", UI_LANG.calibration.regionSearch);
  set(".cal-quick-card:nth-of-type(3) .cal-quick-title", UI_LANG.calibration.quickLedTitle);
  set(".cal-quick-card:nth-of-type(3) .row-sub", UI_LANG.calibration.quickLedHint);
  set("#calStepFinal .cal-step-num", UI_LANG.calibration.finalTitle);
  set("#calStepFinal .cal-progress-info span:last-child", UI_LANG.calibration.finalHint);
  set(".cal-save-btn", UI_LANG.actions.saveMap);
}

function ensureSvgViewBox(svg) {
  if (!svg) return;
  if (!svg.getAttribute("viewBox")) {
    const width = Number(svg.getAttribute("width")) || 612.47321;
    const height = Number(svg.getAttribute("height")) || 408.0199;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
}

function normalizeConfig(cfg) {
  const source = JSON.parse(JSON.stringify(cfg || {}));
  const colors = source.c || {};
  const day = colors.d || {};
  const nightColors = colors.n || {};
  const night = source.n || {};
  const buzzer = source.z || {};
  const blink = source.k || {};
  const wifi = source.w || {};
  const mqtt = source.m || {};
  const ntp = Array.isArray(source.t) ? source.t : [];

  const readColor = (compact, legacyPrefix) => {
    if (Array.isArray(compact) && compact.length >= 4) {
      return {
        r: Number(compact[0] ?? 0),
        g: Number(compact[1] ?? 0),
        b: Number(compact[2] ?? 0),
        a: Number(compact[3] ?? 0),
      };
    }
    return {
      r: Number(source[`${legacyPrefix}R`] ?? 0),
      g: Number(source[`${legacyPrefix}G`] ?? 0),
      b: Number(source[`${legacyPrefix}B`] ?? 0),
      a: Number(source[`${legacyPrefix}A`] ?? 0),
    };
  };

  const dayAlert = readColor(day.a, "dayAlert");
  const dayClear = readColor(day.c, "dayClear");
  const nightAlert = readColor(nightColors.a, "nightAlert");
  const nightClear = readColor(nightColors.c, "nightClear");
  const nightStart = Array.isArray(night.s) ? night.s : [source.nightStartH, source.nightStartM];
  const nightEnd = Array.isArray(night.x) ? night.x : [source.nightEndH, source.nightEndM];
  const nightPulse = Array.isArray(night.p) ? night.p : [source.nightPulseAlert, source.nightPulseClear];
  const buzzerVolume = Array.isArray(buzzer.v) ? buzzer.v : [source.buzzerDayVol, source.buzzerNightVol];
  const blinkIntensity = Array.isArray(blink.i) ? blink.i : [source.blinkDayInt, source.blinkNightInt];

  return {
    ...source,
    dayAlertR: dayAlert.r,
    dayAlertG: dayAlert.g,
    dayAlertB: dayAlert.b,
    dayAlertA: dayAlert.a,
    dayClearR: dayClear.r,
    dayClearG: dayClear.g,
    dayClearB: dayClear.b,
    dayClearA: dayClear.a,
    nightAlertR: nightAlert.r,
    nightAlertG: nightAlert.g,
    nightAlertB: nightAlert.b,
    nightAlertA: nightAlert.a,
    nightClearR: nightClear.r,
    nightClearG: nightClear.g,
    nightClearB: nightClear.b,
    nightClearA: nightClear.a,
    nightEnabled: night.e ?? source.nightEnabled ?? false,
    nightStartH: Number(nightStart[0] ?? 0),
    nightStartM: Number(nightStart[1] ?? 0),
    nightEndH: Number(nightEnd[0] ?? 0),
    nightEndM: Number(nightEnd[1] ?? 0),
    nightMaxBright: Number(night.b ?? source.nightMaxBright ?? 150),
    nightPulseAlert: Boolean(nightPulse[0] ?? source.nightPulseAlert ?? false),
    nightPulseClear: Boolean(nightPulse[1] ?? source.nightPulseClear ?? false),
    buzzerEnabled: buzzer.e ?? source.buzzerEnabled ?? false,
    buzzerDayVol: Number(buzzerVolume[0] ?? source.buzzerDayVol ?? 80),
    buzzerNightVol: Number(buzzerVolume[1] ?? source.buzzerNightVol ?? 30),
    blinkEnabled: blink.e ?? source.blinkEnabled ?? true,
    blinkDayInt: Number(blinkIntensity[0] ?? source.blinkDayInt ?? 75),
    blinkNightInt: Number(blinkIntensity[1] ?? source.blinkNightInt ?? 30),
    buzzerRegionIds: buzzer.r || source.buzzerRegionIds || source.buzzerRegions || [],
    ledRegionIds: source.l || source.ledRegionIds || source.leds || [],
    mqttHost: mqtt.h ?? source.mqttHost ?? "",
    mqttPort: Number(mqtt.p ?? source.mqttPort ?? 1883),
    mqttTopic: mqtt.t ?? source.mqttTopic ?? "alerts/status",
    mqttUser: mqtt.u ?? source.mqttUser ?? "",
    mqttPass: mqtt.s ?? source.mqttPass ?? "",
    wifiSsid: wifi.s ?? source.wifiSsid ?? "",
    wifiPass: wifi.p ?? source.wifiPass ?? "",
    ntpServer1: ntp[0] ?? source.ntpServer1 ?? "",
    ntpServer2: ntp[1] ?? source.ntpServer2 ?? "",
    ntpServer3: ntp[2] ?? source.ntpServer3 ?? "",
    logMask: Number(source.g ?? source.logMask ?? 0),
  };
}

function showToast(message, isError = false) {
  const toast = $("toast");
  $("toastIcon").textContent = isError ? "×" : "✓";
  $("toastMsg").textContent = message;
  toast.className = "toast show " + (isError ? "err" : "ok");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function setLoading(done) {
  document.body.classList.toggle("is-loading", !done);
  $("loadingScreen").classList.toggle("hidden", done);
}

function setAuthLocked(locked, errorMessage = "") {
  document.body.classList.toggle("auth-locked", locked);
  $("loginOverlay").classList.toggle("hidden", !locked);
  $("loginError").textContent = errorMessage;
  if (locked) {
    const remembered = getPersistedAdminPassword();
    if (remembered && !$("loginPassword").value) {
      $("loginPassword").value = remembered;
    }
    $("loginPassword").focus();
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...options });
  if (response.status === 401) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

async function postJson(url, data) {
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

async function checkSession() {
  try {
    const data = await fetchJson("/api/session");
    return Boolean(data.authenticated);
  } catch (error) {
    if (error.status === 401) return false;
    throw error;
  }
}

async function login(password) {
  await postJson("/api/login", { password });
  currentSessionReady = true;
  setAuthLocked(false);
  persistAdminPassword(password);
}

async function logout() {
  try {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  } catch (_) {
  }
  currentSessionReady = false;
  if (alertPollTimer) {
    clearTimeout(alertPollTimer);
    alertPollTimer = null;
  }
  clearPersistedAdminPassword();
  setAuthLocked(true, "");
}

function persistAdminPassword(password) {
  try {
    if (!password) return;
    window.localStorage.setItem(ADMIN_PASSWORD_STORAGE_KEY, password);
  } catch (_) {
  }
}

function getPersistedAdminPassword() {
  try {
    return window.localStorage.getItem(ADMIN_PASSWORD_STORAGE_KEY) || "";
  } catch (_) {
    return "";
  }
}

function clearPersistedAdminPassword() {
  try {
    window.localStorage.removeItem(ADMIN_PASSWORD_STORAGE_KEY);
  } catch (_) {
  }
}

function stripPasswordParamFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("p")) return;
  url.searchParams.delete("p");
  const next = `${url.pathname}${url.search ? url.search : ""}${url.hash}`;
  window.history.replaceState({}, document.title, next || "/");
}

async function tryAutoLoginFromUrl() {
  const url = new URL(window.location.href);
  const password = url.searchParams.get("p");
  if (!password) return false;

  try {
    await login(password);
    return true;
  } finally {
    stripPasswordParamFromUrl();
  }
}

async function tryAutoLoginFromStorage() {
  const password = getPersistedAdminPassword();
  if (!password) return false;

  try {
    await login(password);
    return true;
  } catch (error) {
    clearPersistedAdminPassword();
    throw error;
  }
}

function applySliderValue(id, labelId, value, formatter) {
  $(id).value = value;
  $(labelId).textContent = formatter(value);
}

function applyColor(colorId, swatchId, r, g, b) {
  if (r == null || g == null || b == null) return;
  const hex = rgbToHex(r, g, b);
  $(colorId).value = hex;
  $(swatchId).style.background = hex;
}

function setDirtyState(isDirty) {
  const saveBtn = $("saveBtn");
  if (!saveBtn) return;
  saveBtn.disabled = !isDirty;
  saveBtn.textContent = UI_LANG.actions.save;
  saveBtn.classList.toggle("hidden", !isDirty);
}

function updateDirtyState() {
  if (!currentSessionReady) return;
  setDirtyState(JSON.stringify(buildPayload()) !== dirtySnapshot);
}

function storeDirtySnapshot() {
  dirtySnapshot = JSON.stringify(buildPayload());
  setDirtyState(false);
}

function setActiveTab(tabId) {
  if (!TAB_META[tabId]) return;
  if (tabId !== "calibration" && calibrationActive) {
    if (!confirm("Калібрування ще активне. Точно вийти з вкладки?")) return;
    calClose();
  }

  activeTab = tabId;
  document.querySelectorAll(".nav-tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tabId));
  document.querySelectorAll(".content-pane").forEach((pane) => pane.classList.toggle("active", pane.id === `tab-${tabId}`));
  $("contentEyebrow").textContent = TAB_META[tabId].eyebrow;
  $("contentTitle").textContent = TAB_META[tabId].title;
  if (tabId === "calibration") updateCalibrationMobilePanels();
  if (tabId === "logs") refreshLogs();
}

function isMobileCalibrationLayout() {
  return window.innerWidth <= 640;
}

function updateCalibrationMobilePanels() {
  const mobile = isMobileCalibrationLayout();
  document.querySelectorAll(".cal-mobile-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === calibrationMobileView);
  });
  document.querySelectorAll("[data-mobile-panel]").forEach((panel) => {
    if (!mobile) {
      panel.classList.remove("mobile-hidden");
      return;
    }
    panel.classList.toggle("mobile-hidden", panel.dataset.mobilePanel !== calibrationMobileView);
  });
}

function setCalibrationMobileView(view) {
  calibrationMobileView = view || "map";
  updateCalibrationMobilePanels();
}

function getLogCategoryKeys() {
  return ["system", "wifi", "internet", "mqtt", "web", "config", "calibration", "test"];
}

function setLogMaskInputs(mask) {
  latestLogMask = Number(mask || 0);
  const categoryBits = currentConfig.logCategoryBits || {};
  getLogCategoryKeys().forEach((key) => {
    const checkbox = $(`logCat_${key}`);
    if (!checkbox) return;
    const bit = Number(categoryBits[key] || 0);
    checkbox.checked = bit ? Boolean(latestLogMask & bit) : false;
  });
}

function readLogMaskInputs() {
  const categoryBits = currentConfig.logCategoryBits || {};
  return getLogCategoryKeys().reduce((mask, key) => {
    const checkbox = $(`logCat_${key}`);
    const bit = Number(categoryBits[key] || 0);
    if (!checkbox || !bit || !checkbox.checked) return mask;
    return mask | bit;
  }, 0);
}

function hasPendingLogMaskChanges() {
  return readLogMaskInputs() !== latestLogMask;
}

function renderLogs(entries = []) {
  const feed = $("logsFeed");
  if (!feed) return;
  if (!entries.length) {
    feed.innerHTML = `<div class="logs-empty">${UI_LANG.logs.empty}</div>`;
    return;
  }
  feed.innerHTML = entries.map((entry) => `
    <article class="log-entry">
      <div class="log-entry-head">
        <div class="log-entry-meta">
          <span class="log-pill ${entry.level || "info"}">${entry.level || "info"}</span>
          <span class="log-pill">${entry.category || "other"}</span>
          <span>#${entry.seq ?? "-"}</span>
          <span>${((entry.ms || 0) / 1000).toFixed(1)}s</span>
        </div>
      </div>
      <div class="log-entry-message">${entry.message || ""}</div>
    </article>
  `).join("");
}

async function refreshLogs() {
  if (!currentSessionReady) return;
  try {
    const data = await fetchJson("/api/logs");
    if (Array.isArray(data.categories)) {
      currentConfig.logCategoryBits = {};
      data.categories.forEach((item) => {
        currentConfig.logCategoryBits[item.key] = Number(item.bit || 0);
      });
    }
    const serverMask = Number(data.mask || 0);
    const shouldSyncMask = !hasPendingLogMaskChanges();
    latestLogMask = serverMask;
    if (shouldSyncMask) {
      setLogMaskInputs(serverMask);
    }
    renderLogs(data.entries || []);
    setText("logsMeta", `${(data.entries || []).length} записів у RAM-буфері`);
  } catch (error) {
    console.error(error);
  }
}

async function clearLogs() {
  try {
    await fetchJson("/api/logs/clear", { method: "POST" });
    await refreshLogs();
    showToast("Логи очищено");
  } catch (error) {
    console.error(error);
    showToast("Не вдалося очистити логи", true);
  }
}

async function disableLogs() {
  try {
    await fetchJson("/api/logs/disable", { method: "POST" });
    latestLogMask = 0;
    setLogMaskInputs(0);
    renderLogs([]);
    setText("logsMeta", "Логування вимкнено");
    showToast("Логування вимкнено");
    updateDirtyState();
  } catch (error) {
    console.error(error);
    showToast("Не вдалося вимкнути логи", true);
  }
}

function initRegionUI() {
  const container = $("regions");
  container.innerHTML = "";
  REGIONS.forEach((name) => {
    const label = document.createElement("label");
    label.className = "region-chip";
    label.id = `chip_${name}`;
    label.innerHTML = `<input type="checkbox" id="buz_${name}" value="${name}"><span class="chip-dot"></span><span>${name}</span>`;
    label.querySelector("input").addEventListener("change", function () {
      label.classList.toggle("active", this.checked);
      updateDirtyState();
    });
    container.appendChild(label);
  });
}

function selectAll(enabled) {
  REGIONS.forEach((name) => {
    const checkbox = $(`buz_${name}`);
    const chip = $(`chip_${name}`);
    if (!checkbox || !chip) return;
    checkbox.checked = enabled;
    chip.classList.toggle("active", enabled);
  });
  updateDirtyState();
}

function findExactRegion(value) {
  if (!value) return "";
  return REGIONS.find((region) => region === value || region.includes(value)) || "";
}

function regionIndexByName(value) {
  if (!value) return -1;
  return REGIONS.findIndex((region) => region === value);
}

function regionNameFromConfigValue(value) {
  if (typeof value === "number") {
    return REGIONS[value] || "";
  }

  if (!value) return "";
  return findExactRegion(value);
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

async function createQrRenderable(text, size) {
  if (!window.QRCode) return null;

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-9999px";
  host.style.top = "0";
  document.body.appendChild(host);

  new QRCode(host, {
    text,
    width: size,
    height: size,
    colorDark: "#0b2a4f",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M,
  });

  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const canvas = host.querySelector("canvas");
      const img = host.querySelector("img");
      if (canvas) return resolve({ node: canvas, cleanup: () => host.remove() });
      if (img) {
        if (img.complete) return resolve({ node: img, cleanup: () => host.remove() });
        img.onload = () => resolve({ node: img, cleanup: () => host.remove() });
        img.onerror = () => reject(new Error("QR image load failed"));
        return;
      }
      host.remove();
      reject(new Error("QR render timeout"));
    }, 0);
  });
}

async function renderSingleLabel(canvasId, options) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = 14;
  const qrSize = 168;
  const textWidth = width - qrSize - padding * 3 - 6;
  const qr = await createQrRenderable(options.qrText || "", qrSize).catch(() => null);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  roundedRect(ctx, 4, 4, width - 8, height - 8, 18);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#d9e3ef";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#0b2a4f";
  ctx.font = "700 26px Manrope, sans-serif";
  ctx.fillText(options.title || "", padding, 40, textWidth);

  const qrX = width - padding - qrSize;
  const qrY = Math.round((height - qrSize) / 2);
  roundedRect(ctx, qrX - 10, qrY - 10, qrSize + 20, qrSize + 20, 18);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#d9e3ef";
  ctx.stroke();
  if (qr?.node) ctx.drawImage(qr.node, qrX, qrY, qrSize, qrSize);

  let lineY = 98;
  (options.lines || []).forEach(([label, value]) => {
    ctx.fillStyle = "#6b7f97";
    ctx.font = "700 10px JetBrains Mono, monospace";
    ctx.fillText(String(label).toUpperCase(), padding, lineY);
    lineY += 24;
    ctx.fillStyle = "#102c4b";
    ctx.font = "700 16px Manrope, sans-serif";
    ctx.fillText(String(value || "-"), padding, lineY, textWidth);
    lineY += 48;
  });

  const preview = $(`${canvasId.replace("Canvas", "Preview")}`);
  if (preview) preview.src = canvas.toDataURL("image/png");
  qr?.cleanup?.();
}

function downloadCanvas(canvasId, filename) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadAdminLabel() {
  downloadCanvas("adminLabelCanvas", adminLabelDownloadName);
}

function downloadApLabel() {
  downloadCanvas("apLabelCanvas", apLabelDownloadName);
}

function applyDeviceInfo(info) {
  const hostname = info.hostname || "";
  const ip = info.ip || "-";
  const adminPassword = info.adminPassword || "-";
  const firmwareVersion = info.firmwareVersion || "-";
  const apSsid = info.apSsid || "AlarmMap-Setup";
  const apPassword = info.apPassword || "12345678";
  const ledPin = info.ledPin ?? "-";
  const buzzerPin = info.buzzerPin ?? "-";
  const mdnsHost = hostname ? `${hostname}.local` : "";
  const mdnsUrl = mdnsHost ? `http://${mdnsHost}` : `http://${ip}`;
  const adminQrUrl = `${mdnsUrl.replace(/\/$/, "")}/index.html?p=${encodeURIComponent(adminPassword)}`;
  adminLabelDownloadName = `${mdnsHost || hostname || "alarmmini"}-admin.png`;
  apLabelDownloadName = `${mdnsHost || hostname || "alarmmini"}-ap.png`;

  setText("deviceName", mdnsHost || "device");
  setText("deviceIp", ip);
  setText("labelMdns", mdnsUrl);
  setText("labelMdnsMirror", mdnsUrl);
  setText("labelIp", ip);
  setText("labelAdminPassword", adminPassword);
  setText("labelApSsid", apSsid);
  setText("labelApPassword", apPassword);
  setText("ledPinValue", String(ledPin));
  setText("buzzerPinValue", String(buzzerPin));
  setValue("adminPassword", adminPassword);

  const deviceBadge = $("deviceBadge");
  const deviceDot = $("deviceDot");
  const deviceInfoRow = $("deviceInfoRow");
  const mdnsLink = $("mdnsLink");

  if (hostname) {
    if (deviceBadge) deviceBadge.href = mdnsUrl;
    if (deviceDot) deviceDot.classList.add("online");
    if (deviceInfoRow) deviceInfoRow.style.display = "";
    if (mdnsLink) {
      mdnsLink.textContent = mdnsHost;
      mdnsLink.href = mdnsUrl;
    }
  } else {
    if (deviceDot) deviceDot.classList.remove("online");
    if (deviceInfoRow) deviceInfoRow.style.display = "none";
  }

  renderSingleLabel("adminLabelCanvas", {
    badge: "admin",
    title: "Web panel",
    qrText: adminQrUrl,
    lines: [["URL", mdnsUrl], ["Password", adminPassword]],
  }).catch((error) => console.error("[label-admin]", error));

  renderSingleLabel("apLabelCanvas", {
    badge: "ap",
    title: "Access point",
    qrText: `WIFI:T:WPA;S:${apSsid};P:${apPassword};;`,
    lines: [["SSID", apSsid], ["Password", apPassword]],
  }).catch((error) => console.error("[label-ap]", error));
}

function applyConfig(cfg) {
  const previousLogCategoryBits = currentConfig.logCategoryBits || {};
  currentConfigSource = JSON.parse(JSON.stringify(cfg || {}));
  currentConfig = normalizeConfig(cfg);
  currentConfig.logCategoryBits = previousLogCategoryBits;

  applyColor("dayAlertColor", "dayAlertSwatch", currentConfig.dayAlertR, currentConfig.dayAlertG, currentConfig.dayAlertB);
  applyColor("dayClearColor", "dayClearSwatch", currentConfig.dayClearR, currentConfig.dayClearG, currentConfig.dayClearB);
  applyColor("nightAlertColor", "nightAlertSwatch", currentConfig.nightAlertR, currentConfig.nightAlertG, currentConfig.nightAlertB);
  applyColor("nightClearColor", "nightClearSwatch", currentConfig.nightClearR, currentConfig.nightClearG, currentConfig.nightClearB);
  applySliderValue("dayAlertBright", "dayAlertBrightVal", currentConfig.dayAlertA, (v) => `${Math.round(v / 2.55)}%`);
  applySliderValue("dayClearBright", "dayClearBrightVal", currentConfig.dayClearA, (v) => `${Math.round(v / 2.55)}%`);
  applySliderValue("nightAlertBright", "nightAlertBrightVal", currentConfig.nightAlertA, (v) => `${Math.round(v / 2.55)}%`);
  applySliderValue("nightClearBright", "nightClearBrightVal", currentConfig.nightClearA, (v) => `${Math.round(v / 2.55)}%`);
  applySliderValue("dayVol", "dayVolVal", currentConfig.buzzerDayVol, (v) => `${v}%`);
  applySliderValue("nightVol", "nightVolVal", currentConfig.buzzerNightVol, (v) => `${v}%`);

  $("nightEnabled").checked = Boolean(currentConfig.nightEnabled);
  $("buzzerEnabled").checked = Boolean(currentConfig.buzzerEnabled);
  $("nightStart").value = `${pad(currentConfig.nightStartH)}:${pad(currentConfig.nightStartM)}`;
  $("nightEnd").value = `${pad(currentConfig.nightEndH)}:${pad(currentConfig.nightEndM)}`;
  $("ntpServer1").value = currentConfig.ntpServer1 || "";
  $("ntpServer2").value = currentConfig.ntpServer2 || "";
  $("ntpServer3").value = currentConfig.ntpServer3 || "";
  latestLogMask = Number(currentConfig.logMask || latestLogMask || 0);

  REGIONS.forEach((name) => {
    const checkbox = $(`buz_${name}`);
    const chip = $(`chip_${name}`);
    if (!checkbox || !chip) return;
    checkbox.checked = false;
    chip.classList.remove("active");
  });

  const buzzerRegions = currentConfig.buzzerRegionIds || [];
  buzzerRegions.forEach((regionRoot) => {
    const exact = regionNameFromConfigValue(regionRoot);
    if (!exact) return;
    const checkbox = $(`buz_${exact}`);
    const chip = $(`chip_${exact}`);
    if (checkbox && chip) {
      checkbox.checked = true;
      chip.classList.add("active");
    }
  });

  gLedMap = {};
  const ledAssignments = currentConfig.ledRegionIds || [];
  ledAssignments.forEach((regionRoot, index) => {
    if (index >= MAX_LEDS || regionRoot == null || regionRoot === "" || regionRoot === -1) return;
    const exact = regionNameFromConfigValue(regionRoot);
    if (exact) gLedMap[index] = exact;
  });

  refreshMapPreview();
  setLogMaskInputs(latestLogMask);
}

function buildPayload() {
  const payload = JSON.parse(JSON.stringify(currentConfigSource || {}));
  const [nightStartH, nightStartM] = $("nightStart").value.split(":").map(Number);
  const [nightEndH, nightEndM] = $("nightEnd").value.split(":").map(Number);
  const dayAlert = hexToRgb($("dayAlertColor").value);
  const dayClear = hexToRgb($("dayClearColor").value);
  const nightAlert = hexToRgb($("nightAlertColor").value);
  const nightClear = hexToRgb($("nightClearColor").value);
  const buzzerRegionIds = REGIONS.reduce((acc, name, index) => {
    if ($(`buz_${name}`)?.checked) acc.push(index);
    return acc;
  }, []);
  const ledRegionIds = Array.from({ length: MAX_LEDS }, (_, index) => regionIndexByName(gLedMap[index] || ""));

  payload.c = {
    d: {
      a: [dayAlert.r, dayAlert.g, dayAlert.b, Number($("dayAlertBright").value)],
      c: [dayClear.r, dayClear.g, dayClear.b, Number($("dayClearBright").value)],
    },
    n: {
      a: [nightAlert.r, nightAlert.g, nightAlert.b, Number($("nightAlertBright").value)],
      c: [nightClear.r, nightClear.g, nightClear.b, Number($("nightClearBright").value)],
    },
  };
  payload.n = {
    e: $("nightEnabled").checked,
    s: [nightStartH, nightStartM],
    x: [nightEndH, nightEndM],
    b: currentConfig.nightMaxBright ?? 150,
    p: [currentConfig.nightPulseAlert ?? false, currentConfig.nightPulseClear ?? false],
  };
  payload.z = {
    e: $("buzzerEnabled").checked,
    v: [Number($("dayVol").value), Number($("nightVol").value)],
    r: buzzerRegionIds,
  };
  payload.k = {
    e: currentConfig.blinkEnabled ?? true,
    i: [currentConfig.blinkDayInt ?? 75, currentConfig.blinkNightInt ?? 30],
  };
  if (MAX_LEDS > 0) {
    payload.l = ledRegionIds;
  } else if (!Array.isArray(payload.l)) {
    payload.l = [];
  }
  payload.m = {
    h: $("mqttHost").value.trim(),
    p: parseInt($("mqttPort").value, 10) || 1883,
    t: $("mqttTopic").value.trim() || "alerts/status",
    u: $("mqttUser").value.trim(),
    s: $("mqttPass").value.trim(),
  };
  payload.w = {
    s: currentConfig.wifiSsid || payload.w?.s || "",
    p: currentConfig.wifiPass || payload.w?.p || "",
  };
  payload.t = [
    $("ntpServer1").value.trim(),
    $("ntpServer2").value.trim(),
    $("ntpServer3").value.trim(),
  ];
  payload.g = readLogMaskInputs();
  return payload;
}

async function saveConfig(options = {}) {
  const { silentSuccess = false } = options;
  const response = await fetch("/api/saveSettings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(buildPayload()),
  });

  if (response.status === 401) {
    setAuthLocked(true, "Сесію завершено. Увійди ще раз.");
    throw new Error("Unauthorized");
  }
  if (!response.ok) throw new Error(`save failed: ${response.status}`);
  currentConfigSource = JSON.parse(JSON.stringify(buildPayload()));
  storeDirtySnapshot();
  if (!silentSuccess) showToast("Збережено, налаштування застосовано");
}

async function saveCalibrationConfig() {
  const fullPayload = buildPayload();
  const response = await fetch("/api/saveSettings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(fullPayload),
  });

  if (response.status === 401) {
    setAuthLocked(true, "Сесію завершено. Увійди ще раз.");
    throw new Error("Unauthorized");
  }
  if (!response.ok) throw new Error(`save calibration failed: ${response.status}`);

  currentConfigSource = JSON.parse(JSON.stringify(fullPayload));
  currentConfig = normalizeConfig(currentConfigSource);
  storeDirtySnapshot();
}

function sanitizeImportedConfig(rawConfig) {
  const imported = JSON.parse(JSON.stringify(rawConfig || {}));
  delete imported.adminPassword;
  return imported;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeConfigForSave(baseConfig, overrideConfig) {
  if (!isPlainObject(baseConfig)) return JSON.parse(JSON.stringify(overrideConfig || {}));
  const result = JSON.parse(JSON.stringify(baseConfig));
  const overrides = overrideConfig || {};

  Object.keys(overrides).forEach((key) => {
    const nextValue = overrides[key];
    if (nextValue === undefined) return;
    if (isPlainObject(nextValue) && isPlainObject(result[key])) {
      result[key] = mergeConfigForSave(result[key], nextValue);
      return;
    }
    result[key] = nextValue;
  });

  return result;
}

function hasConfigData(config) {
  return Boolean(config && typeof config === "object" && Object.keys(config).length);
}

function getExportConfig(apiConfig) {
  const sanitizedApiConfig = sanitizeImportedConfig(apiConfig);
  if (hasConfigData(sanitizedApiConfig)) return sanitizedApiConfig;

  const sanitizedCurrentSource = sanitizeImportedConfig(currentConfigSource);
  if (hasConfigData(sanitizedCurrentSource)) return sanitizedCurrentSource;

  const payload = buildPayload();
  if (hasConfigData(payload)) return sanitizeImportedConfig(payload);

  throw new Error("empty export config");
}

async function exportSettings() {
  try {
    const cfg = await fetchJson("/api/config");
    const exported = getExportConfig(cfg);
    const hostname = $("deviceName")?.textContent?.trim() || "alarmmini";
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${hostname}-settings-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Налаштування експортовано");
  } catch (error) {
    console.error(error);
    showToast("Не вдалося експортувати налаштування", true);
  }
}

function triggerImportSettings() {
  $("importSettingsInput").click();
}

async function importSettings(file) {
  if (!file) return;
  try {
    const importedConfig = sanitizeImportedConfig(JSON.parse(await file.text()));
    const currentFullConfig = sanitizeImportedConfig(await fetchJson("/api/config"));
    const payload = mergeConfigForSave(currentFullConfig, importedConfig);
    const response = await fetch("/api/saveSettings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    if (response.status === 401) {
      setAuthLocked(true, "Сесію завершено. Увійди ще раз.");
      throw new Error("Unauthorized");
    }
    if (!response.ok) throw new Error(`import failed: ${response.status}`);
    showToast("Імпорт завершено, налаштування застосовано");
  } catch (error) {
    console.error(error);
    showToast("Не вдалося імпортувати налаштування", true);
  } finally {
    $("importSettingsInput").value = "";
  }
}

async function ensureMapLoaded() {
  const store = $("svgSourceStore");
  if (store.querySelector("svg")) {
    refreshMapPreview();
    return;
  }

  $("mapStatusText").textContent = UI_LANG.overview.loading;
  const response = await fetch("/map.svg", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error(`map.svg -> ${response.status}`);
  const doc = new DOMParser().parseFromString(await response.text(), "image/svg+xml");
  const svg = doc.documentElement;
  svg.id = "ukraine-map";
  ensureSvgViewBox(svg);
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  store.replaceChildren(svg);
  refreshMapPreview();
  $("mapStatusText").textContent = UI_LANG.overview.ready;
}

function getAssignmentStats(sourceMap = gLedMap, total = MAX_LEDS) {
  const counts = {};
  for (let index = 0; index < total; index += 1) {
    const region = sourceMap[index];
    if (region) counts[region] = (counts[region] || 0) + 1;
  }
  return counts;
}

function applyPreviewClasses(svg) {
  const alertRegions = new Set(currentAlerts.map((isAlert, index) => (isAlert ? REGIONS[index] : "")).filter(Boolean));
  svg.querySelectorAll("path[id]").forEach((path) => {
    const regionName = SVG_ID_TO_REGION[path.id];
    path.className.baseVal = "";
    if (!regionName) {
      path.classList.add("safe");
      return;
    }
    path.classList.add(alertRegions.has(regionName) ? "map-region-alert" : "map-region-clear");
  });
}

function refreshMapPreview() {
  const sourceSvg = $("svgSourceStore").querySelector("svg");
  if (!sourceSvg) return;
  const svg = sourceSvg.cloneNode(true);
  svg.removeAttribute("id");
  applyPreviewClasses(svg);
  $("mapPreviewWrap").replaceChildren(svg);
}

function scheduleAlertsPolling(delayMs = alertPollIntervalMs) {
  if (alertPollTimer) clearTimeout(alertPollTimer);
  if (!currentSessionReady) return;
  alertPollTimer = setTimeout(() => {
    void updateAlertsOnWeb();
  }, delayMs);
}

async function updateAlertsOnWeb() {
  if (!REGIONS.length || !currentSessionReady) return;
  try {
    const response = await fetch("/api/alerts", { cache: "no-store", credentials: "same-origin" });
    if (response.status === 401) throw Object.assign(new Error("Unauthorized"), { status: 401 });
    const alerts = await response.json();
    currentAlerts = Array.isArray(alerts) ? alerts : [];
    currentAlerts.forEach((isAlert, index) => {
      const chip = $(`chip_${REGIONS[index]}`);
      if (chip) chip.classList.toggle("is-alert", Boolean(isAlert));
    });
    refreshMapPreview();
    alertPollIntervalMs = ALERT_POLL_MIN_MS;
  } catch (error) {
    alertPollIntervalMs = Math.min(ALERT_POLL_MAX_MS, alertPollIntervalMs + 4000);
    if (error.status === 401) setAuthLocked(true, "Сесію завершено. Увійди ще раз.");
  } finally {
    scheduleAlertsPolling();
  }
}

function updateCalibrationLedButtons(ensureVisible = false) {
  document.querySelectorAll(".cal-led-grid-btn").forEach((button) => {
    const index = Number(button.dataset.index);
    const region = calTemp[index] || "";
    const isActive = index === calCurrent;
    const label = button.querySelector(".cal-led-grid-label");
    const meta = button.querySelector(".cal-led-grid-meta");
    const dot = button.querySelector(".cal-led-grid-dot");

    button.classList.toggle("active", isActive);
    button.classList.toggle("assigned", Boolean(region));
    button.classList.toggle("empty", !region);

    if (label) label.textContent = `LED ${index + 1}`;
    if (meta) meta.textContent = region || UI_LANG.calibration.unassigned;
    if (dot) dot.classList.toggle("assigned", Boolean(region));

    if (ensureVisible && isActive) {
      button.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
}

function updateSelectedLabel(ensureLedVisible = false) {
  const value = calTemp[calCurrent] || "";
  $("calSelectedRegion").textContent = value || UI_LANG.calibration.unassigned;
  $("calCurrentChoice").textContent = value || UI_LANG.calibration.unassigned;
  document.querySelectorAll(".cal-region-item").forEach((button) => button.classList.toggle("active", button.dataset.region === value));
  updateCalibrationLedButtons(ensureLedVisible);
}

function renderCalibrationLedList() {
  const grid = $("calLedGrid");
  grid.innerHTML = "";
  for (let index = 0; index < calTotal; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cal-led-grid-btn";
    button.dataset.index = String(index);
    button.innerHTML = `
      <span class="cal-led-grid-head">
        <span class="cal-led-grid-dot"></span>
        <span class="cal-led-grid-label">LED ${index + 1}</span>
      </span>
      <span class="cal-led-grid-meta">${UI_LANG.calibration.unassigned}</span>
    `;
    button.addEventListener("click", () => {
      calCurrent = index;
      calShowStep(true);
      if (isMobileCalibrationLayout()) setCalibrationMobileView("map");
    });
    grid.appendChild(button);
  }
  updateCalibrationLedButtons(false);
}

function renderCalibrationRegionList() {
  const list = $("calRegionList");
  const assigned = new Set(Object.keys(calTemp).map((key) => Number(key)).filter((key) => key !== calCurrent).map((key) => calTemp[key]).filter(Boolean));
  list.innerHTML = "";

  REGIONS.forEach((region) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cal-region-item";
    button.dataset.region = region;
    button.textContent = region;
    if (assigned.has(region)) button.classList.add("assigned");
    button.addEventListener("click", () => {
      calTemp[calCurrent] = calTemp[calCurrent] === region ? "" : region;
      updateCalibrationMap();
      updateSelectedLabel();
      if (isMobileCalibrationLayout()) setCalibrationMobileView("map");
    });
    list.appendChild(button);
  });

  filterCalibrationRegionList();
  updateSelectedLabel();
}

function filterCalibrationRegionList() {
  const query = $("calRegionSearch").value.trim().toLowerCase();
  document.querySelectorAll(".cal-region-item").forEach((button) => {
    const visible = !query || button.dataset.region.toLowerCase().includes(query);
    button.classList.toggle("hidden", !visible);
  });
}

function updateCalibrationMap() {
  if (!calMapSvg) return;
  const regionCount = getAssignmentStats(calTemp, calTotal);
  calMapSvg.querySelectorAll("path[id]").forEach((path) => {
    const regionName = SVG_ID_TO_REGION[path.id];
    path.className.baseVal = "";
    if (!regionName) {
      path.classList.add("safe");
      return;
    }

    const isCurrent = calTemp[calCurrent] === regionName;
    const assignedTo = regionCount[regionName] || 0;
    if (isCurrent) path.classList.add("cal-selected");
    else if (assignedTo > 1) path.classList.add("cal-multi");
    else if (assignedTo === 1) path.classList.add("cal-assigned");
    else path.classList.add("safe");
  });
}

function bindCalibrationMap(svg) {
  const tooltip = $("calTooltip");
  svg.querySelectorAll("path[id]").forEach((path) => {
    const regionName = SVG_ID_TO_REGION[path.id];
    if (!regionName) return;
    path.addEventListener("click", () => {
      calTemp[calCurrent] = calTemp[calCurrent] === regionName ? "" : regionName;
      updateCalibrationMap();
      updateSelectedLabel();
    });
    path.addEventListener("mouseenter", () => {
      tooltip.textContent = regionName;
      tooltip.classList.add("show");
    });
    path.addEventListener("mouseleave", () => tooltip.classList.remove("show"));
  });
}

function mountCalibrationMap() {
  const sourceSvg = $("svgSourceStore").querySelector("svg");
  if (!sourceSvg) return;
  const wrap = $("calMapWrap");
  calMapSvg = sourceSvg.cloneNode(true);
  calMapSvg.removeAttribute("id");
  ensureSvgViewBox(calMapSvg);
  calMapSvg.style.cssText = "width:100%;height:auto;display:block;";
  calMapSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  bindCalibrationMap(calMapSvg);
  wrap.querySelector("svg")?.remove();
  wrap.insertBefore(calMapSvg, $("calTooltip"));
}

function calShowStep(ensureLedVisible = false) {
  $("calStepMain").classList.remove("hidden");
  $("calStepFinal").classList.add("hidden");
  $("calProgressFill").style.width = `${((calCurrent + 1) / calTotal) * 100}%`;
  $("calStepLabel").textContent = `LED ${calCurrent + 1} / ${calTotal}`;
  $("calLedName").textContent = `Світлодіод №${calCurrent + 1}`;
  $("calPrevBtn").disabled = calCurrent === 0;
  $("calNextBtn").textContent = calCurrent === calTotal - 1 ? UI_LANG.actions.finish : UI_LANG.actions.next;
  renderCalibrationRegionList();
  updateCalibrationMap();
  updateSelectedLabel(ensureLedVisible);
  fetch(`/api/calibrate/led?index=${calCurrent}`, { credentials: "same-origin" }).catch(() => {});
}

function calOpen() {
  if (!MAX_LEDS) return showToast("LED ще не ініціалізовано", true);
  if (!$("svgSourceStore").querySelector("svg")) return showToast("Мапа ще не завантажена", true);
  setActiveTab("calibration");
  calTotal = MAX_LEDS;
  calCurrent = 0;
  calTemp = { ...gLedMap };
  calibrationActive = true;
  calibrationMobileView = "map";
  $("calIntro").classList.add("hidden");
  $("calWorkspace").classList.remove("hidden");
  mountCalibrationMap();
  renderCalibrationLedList();
  calShowStep();
  updateCalibrationMobilePanels();
}

function calClose() {
  calibrationActive = false;
  calibrationMobileView = "map";
  $("calWorkspace").classList.add("hidden");
  $("calIntro").classList.remove("hidden");
  $("calRegionSearch").value = "";
  fetch("/api/calibrate/done", { credentials: "same-origin" }).catch(() => {});
  updateCalibrationMobilePanels();
}

function calClearCurrent() {
  calTemp[calCurrent] = "";
  updateCalibrationMap();
  updateSelectedLabel();
}

function calPrev() {
  if (calCurrent <= 0) return;
  calCurrent -= 1;
  calShowStep();
}

function calShowFinal() {
  fetch("/api/calibrate/done", { credentials: "same-origin" }).catch(() => {});
  $("calStepMain").classList.add("hidden");
  $("calStepFinal").classList.remove("hidden");
  const summary = $("calSummary");
  summary.innerHTML = "";
  for (let index = 0; index < calTotal; index += 1) {
    const value = calTemp[index] || "";
    const item = document.createElement("div");
    item.className = "cal-summary-item";
    item.innerHTML = `<span class="cal-summary-num">LED ${index + 1}</span><span class="${value ? "cal-summary-region" : "cal-summary-empty"}">${value || UI_LANG.calibration.unassigned}</span>`;
    summary.appendChild(item);
  }
}

function calNext() {
  calCurrent += 1;
  if (calCurrent >= calTotal) calShowFinal();
  else calShowStep();
}

async function calSave() {
  gLedMap = {};
  for (let index = 0; index < calTotal; index += 1) {
    if (calTemp[index]) gLedMap[index] = calTemp[index];
  }
  refreshMapPreview();
  try {
    await saveCalibrationConfig();
    calClose();
    setActiveTab("overview");
    showToast("Мапу збережено. Налаштування застосовано, можеш перевірити результат у вкладці огляду.");
  } catch (error) {
    console.error(error);
    showToast("Не вдалося зберегти калібрування", true);
  }
}

function setRestartBusy(isBusy) {
  document.querySelectorAll(".restart-trigger").forEach((button) => {
    button.disabled = isBusy;
    button.textContent = isBusy ? "Перезавантаження..." : UI_LANG.actions.restart;
  });
}

function restartDevice() {
  if (!confirm("Перезавантажити пристрій?")) return;
  setRestartBusy(true);
  $("deviceDot").classList.remove("online");
  fetch("/api/restart", { credentials: "same-origin" }).catch(() => {});

  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    fetch("/api/info", { cache: "no-store", credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error("offline");
        return response.json();
      })
      .then((info) => {
        clearInterval(timer);
        setRestartBusy(false);
        $("deviceDot").classList.add("online");
        applyDeviceInfo(info);
        showToast("Пристрій знову онлайн");
      })
      .catch(() => {
        if (tries > 20) {
          clearInterval(timer);
          setRestartBusy(false);
          showToast("Пристрій не відповів після перезапуску", true);
        }
      });
  }, 1000);
}

function testSubscribedAlert() {
  fetch("/api/testRegionAlert", { credentials: "same-origin" })
    .then((response) => {
      if (response.status === 401) {
        setAuthLocked(true, "Сесію завершено. Увійди ще раз.");
        throw new Error("Unauthorized");
      }
      if (!response.ok) throw new Error("No subscribed regions");
      showToast("Запущено тест: 30с тривога + 30с відбій");
    })
    .catch((error) => {
      console.error(error);
      showToast("Обери хоча б один регіон у 'Регіони сповіщень'", true);
    });
}

function bindTabs() {
  document.querySelectorAll(".nav-tab").forEach((button) => button.addEventListener("click", () => setActiveTab(button.dataset.tab)));
}

function bindDirtyTracking() {
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === "loginPassword" || target.id === "calRegionSearch") return;
    updateDirtyState();
  });
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === "loginPassword" || target.id === "calRegionSearch") return;
    updateDirtyState();
  });
}

async function bootAuthenticated() {
  const info = await fetchJson("/api/info");
  REGIONS = info.regions || [];
  MAX_LEDS = info.maxLeds || 0;
  currentSessionReady = true;
  currentConfig.logCategoryBits = info.logCategoryBits || {};
  $("mqttHost").value = info.mqttHost || "";
  $("mqttPort").value = info.mqttPort || 1883;
  $("mqttTopic").value = info.mqttTopic || "alerts/status";
  $("mqttUser").value = info.mqttUser || "";
  $("mqttPass").value = info.mqttPass || "";
  applyDeviceInfo(info);
  initRegionUI();
  const cfg = await fetchJson("/api/config");
  applyConfig(cfg);
  applyDeviceInfo(info);
  await ensureMapLoaded();
  storeDirtySnapshot();
  alertPollIntervalMs = 10000;
  if (alertPollTimer) {
    clearTimeout(alertPollTimer);
    alertPollTimer = null;
  }
  void updateAlertsOnWeb();
  setTimeout(() => {
    if (currentSessionReady) void updateAlertsOnWeb();
  }, 1200);
  clearInterval(logsTimer);
  logsTimer = null;
}

function bindAuthUi() {
  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = $("loginPassword").value.trim();
    $("loginError").textContent = "";
    try {
      await login(password);
      await bootAuthenticated();
    } catch (error) {
      console.error(error);
      $("loginError").textContent = "Невірний пароль або помилка авторизації";
    } finally {
      setLoading(true);
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    await logout();
  });

  $("importSettingsInput").addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    await importSettings(file);
  });

  $("calRegionSearch").addEventListener("input", filterCalibrationRegionList);
  $("calMobileNav")?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (!target.dataset.view) return;
    setCalibrationMobileView(target.dataset.view);
  });
  window.addEventListener("resize", updateCalibrationMobilePanels);
}

async function boot() {
  applyStaticLang();
  bindAuthUi();
  bindTabs();
  bindDirtyTracking();
  updateCalibrationMobilePanels();
  try {
    const hasPasswordParam = new URL(window.location.href).searchParams.has("p");
    const autoLoggedIn = hasPasswordParam
      ? await tryAutoLoginFromUrl().catch((error) => {
        console.error("[auto-login]", error);
        return false;
      })
      : false;
    if (autoLoggedIn) {
      setAuthLocked(false);
      await bootAuthenticated();
      setActiveTab("overview");
      return;
    }

    const authenticated = await checkSession();
    if (authenticated) {
      setAuthLocked(false);
      await bootAuthenticated();
      setActiveTab("overview");
      return;
    }

    const storageAutoLoggedIn = await tryAutoLoginFromStorage().catch((error) => {
      console.error("[storage-auto-login]", error);
      return false;
    });
    if (storageAutoLoggedIn) {
      setAuthLocked(false);
      await bootAuthenticated();
      setActiveTab("overview");
      return;
    }

    setAuthLocked(true);
    setActiveTab("overview");
  } catch (error) {
    console.error("[boot]", error);
    setAuthLocked(true, "Не вдалося підключитися до пристрою");
    $("mapStatusText").textContent = "Помилка підключення";
  } finally {
    setLoading(true);
  }
}

window.calClearCurrent = calClearCurrent;
window.calClose = calClose;
window.calNext = calNext;
window.calOpen = calOpen;
window.calPrev = calPrev;
window.calSave = calSave;
window.restartDevice = restartDevice;
window.selectAll = selectAll;
window.exportSettings = exportSettings;
window.triggerImportSettings = triggerImportSettings;
window.downloadAdminLabel = downloadAdminLabel;
window.downloadApLabel = downloadApLabel;
window.testSubscribedAlert = testSubscribedAlert;
window.testBuzzer = (isAlert) => {
  fetch(`/api/testBuzzer?alert=${isAlert ? 1 : 0}`, { credentials: "same-origin" }).catch(() => {});
  showToast(isAlert ? "Тест тривоги" : "Тест відбою");
};
window.save = async () => {
  try {
    await saveConfig();
  } catch (error) {
    console.error(error);
    showToast("Сталася помилка", true);
  }
};

boot();
