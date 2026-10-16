const $ = id => document.getElementById(id);
let csrf = '';
let settings = null;
let duckDns = null;
let duckDnsDirty = false;
let timer;
let refreshing = false;
let logsPaused = false;
let logEvents = [];
let latestDiagnostics = null;
let operationBusy = false;
let logGeneration = 0;
let selectedRegion = null;
let mapLoading = null;
let messageTimer;
const sections = {overview:'Огляд', alerts:'Тривоги', resources:'Ресурси', connections:'Підключення', duckdns:'DuckDNS', logs:'Журнал'};
const stateClasses = ['clear', 'red', 'orange', 'mixed', 'partial-red', 'partial-orange'];
const stateLabels = ['Відбій тривоги', 'Червоний — уся область', 'Оранжевий — уся область', 'Червоний + оранжевий', 'Частково червона область', 'Частково оранжева область'];
const errors = {
  DUCKDNS_INVALID_SETTINGS:'Перевір налаштування DuckDNS: інтервал має бути цілим числом від 1 до 1440 хвилин.',
  DUCKDNS_INVALID_DOMAIN:'Введи одне ім’я DuckDNS або повний домен без протоколу, шляху й порту.',
  DUCKDNS_INVALID_TOKEN:'Перевір формат токена DuckDNS: латинські літери, цифри й дефіси, від 16 до 128 символів.',
  DUCKDNS_INVALID_IP:'Введи публічний IPv4 або залиш поле порожнім для автоматичного визначення.',
  DUCKDNS_NOT_CONFIGURED:'Збережи домен і токен DuckDNS. Для перевірки без змін достатньо домену.',
  DUCKDNS_BUSY:'Перевірка DuckDNS уже триває. Дочекайся результату.',
  DUCKDNS_REJECTED:'DuckDNS відхилив запит (KO). Перевір токен і чи належить домен цьому акаунту.',
  DUCKDNS_INVALID_RESPONSE:'DuckDNS повернув неочікувану відповідь. Зміну DNS не підтверджено.',
  DUCKDNS_IP_INVALID_RESPONSE:'Сервіс визначення IP не повернув коректний публічний IPv4. DNS не змінено.',
  DUCKDNS_IP_UNAVAILABLE:'Не вдалося визначити зовнішній IPv4 через ipify. Перевір інтернет або задай IP вручну.',
  DUCKDNS_DNS_UNAVAILABLE:'Не вдалося прочитати DNS-запис. Перевір DNS та інтернет сервера.',
  DUCKDNS_UPDATE_UNAVAILABLE:'DuckDNS не відповів вчасно. Результат оновлення невідомий; повтори перевірку.',
  DUCKDNS_CHECK_FAILED:'Не вдалося перевірити DuckDNS. Перевір з’єднання сервера.',
  DUCKDNS_WRITE_FAILED:'Не вдалося зберегти DuckDNS. Перевір права на каталог runtime і вільне місце.',
  DUCKDNS_STOPPED:'Сервер зупиняється. Перевірку скасовано.',
  INVALID_CREDENTIALS:'Неправильний логін або пароль.', LOGIN_RATE_LIMITED:'Забагато невдалих спроб. Спробуй через 15 хвилин.',
  ADMIN_NOT_CONFIGURED:'Задай ADMIN_USERNAME та ADMIN_PASSWORD у .env і перезапусти сервер.',
  LOGIN_REQUIRED:'Увійди знову, щоб продовжити.', INVALID_PUBLIC_URL:'Введи HTTPS-домен без шляху, наприклад https://alarm.example.com.',
  WEBHOOK_URL_NOT_CONFIGURED:'Збережи публічну адресу й задай WEBHOOK_TOKEN у .env.',
  WEBHOOK_KEY_DOWNLOAD_FAILED:'Не вдалося завантажити або зберегти ключ UkraineAlarm. Перевір підключення й доступ до runtime.',
  WEBHOOK_KEY_UNAVAILABLE:'Сервер не зміг підключитися до адреси ключа UkraineAlarm. Перевір інтернет, DNS і доступ до api.ukrainealarm.com.',
  WEBHOOK_KEY_CLOUDFLARE_CHALLENGE:'Cloudflare вимагає перевірку браузера для файлу ключа. Завантаж офіційний .pem через браузер і додай його в секції «Перевірка підпису». Це не помилка API-токена чи runtime.',
  WEBHOOK_CHECK_UNREACHABLE:'Не вдалося звернутися до публічного webhook. Перевір DNS, TLS, домен і стан Cloudflare Tunnel.',
  WEBHOOK_CHECK_REDIRECT:'Адреса webhook переспрямовує запит. Потрібен прямий маршрут POST без сторінки входу чи перенаправлень.',
  WEBHOOK_CHECK_WRONG_SERVER:'Відповідь отримано, але запит не підтверджено цим сервером. Перевір домен, порт і маршрут Cloudflare Tunnel.',
  WEBHOOK_CHECK_CLOUDFLARE_CHALLENGE:'Cloudflare показує перевірку браузера на твоєму webhook. Налаштуй доступ машинних POST-запитів до цього маршруту, зберігши токен і перевірку підпису.',
  WEBHOOK_PROBE_INVALID:'Перевірочний запит застарів або потрапив до іншого екземпляра сервера.',
  WEBHOOK_KEY_INVALID:'UkraineAlarm повернув некоректний RSA-ключ. Попередній ключ залишився чинним, якщо він був завантажений.',
  WEBHOOK_KEY_WRITE_FAILED:'Ключ отримано, але його не вдалося записати. Перевір права на runtime або WEBHOOK_PUBLIC_KEY_FILE і вільне місце.',
  SETTINGS_WRITE_FAILED:'Не вдалося записати налаштування. Перевір права на runtime та вільне місце.',
  INVALID_SIGNATURE:'Webhook відхилено: неправильний підпис або час запиту. Перевір RSA-ключ і системний час сервера.',
  UNAUTHORIZED:'Webhook відхилено: неправильний або відсутній токен у посиланні.',
  WEBHOOK_TOKEN_NOT_CONFIGURED:'У .env не задано WEBHOOK_TOKEN.',
  WEBHOOK_KEY_NOT_CONFIGURED:'Webhook не може пройти перевірку: спочатку завантаж RSA-ключ.',
  BODY_TOO_LARGE:'Webhook перевищив допустимий розмір.', INVALID_JSON:'Webhook містить некоректний JSON.',
  WEBHOOK_UPSTREAM_UNAVAILABLE:'UkraineAlarm не відповів. Результат запиту невідомий; перевір з’єднання перед повторною дією.',
  WEBHOOK_ACCEPTED_BUT_NOT_SAVED:'UkraineAlarm прийняв запит, але локальний запис не збережено. Перевір права на runtime.',
  SETTINGS_BUSY:'Попередня дія ще виконується.', CSRF_REJECTED:'Сесія змінилася. Онови сторінку й увійди знову.',
};
function explain(code) {
  const duckHttp = code?.match(/^DUCKDNS_(IP|UPDATE)_HTTP_(\d{3})$/);
  if (duckHttp) return `${duckHttp[1] === 'IP' ? 'Сервіс визначення IPv4' : 'DuckDNS'} повернув HTTP ${duckHttp[2]}. Спробуй пізніше; успішне оновлення не підтверджено.`;
  const checkHttp = code?.match(/^WEBHOOK_CHECK_HTTP_(\d+)$/);
  if (checkHttp) {
    const hint = {'401':'Перевір токен і чи тунель веде на цей сервер.', '403':'Перевір правила доступу Cloudflare.', '404':'Перевір маршрут /public/webhook у тунелі.', '405':'Одержувач не підтримує потрібний POST; перевір адресу та версію сервера.', '502':'Cloudflare не може підключитися до сервера.', '503':'Одержувач ще не готовий. Онови сервер і перевір його конфігурацію.'}[checkHttp[1]] || 'Перевір публічний маршрут і стан сервера.';
    return `Перевірка webhook: HTTP ${checkHttp[1]}. ${hint} Реєстрацію не виконано.`;
  }
  const keyHttp = code?.match(/^WEBHOOK_KEY_HTTP_(\d+)$/);
  if (keyHttp) return `Адреса ключа UkraineAlarm повернула HTTP ${keyHttp[1]}. ${keyHttp[1] === '403' ? 'Доступ до файлу ключа заборонено; це не помилка запису в runtime.' : 'Перевір доступність api.ukrainealarm.com/webhook-public.pem із сервера.'}`;
  const upstream = code?.match(/^WEBHOOK_UPSTREAM_HTTP_(\d+)$/);
  if (upstream) return `UkraineAlarm повернув HTTP ${upstream[1]}. Перевір токен API й обрану дію; для чинної підписки використай «Оновити».`;
  return errors[code] || code || 'Невідома помилка';
}
function dateTime(value) { return value ? new Date(value).toLocaleString('uk-UA') : 'Ще немає'; }
function elapsed(seconds) {
  if (seconds == null) return '—';
  const value = Math.max(0, Math.floor(seconds));
  if (value < 60) return `${value} с`;
  if (value < 3600) return `${Math.floor(value / 60)} хв ${value % 60} с`;
  return `${Math.floor(value / 3600)} год ${Math.floor(value % 3600 / 60)} хв`;
}
function message(text, error = false) {
  clearTimeout(messageTimer);
  $('message').textContent = text; $('message').className = error ? 'error' : ''; $('message').hidden = !text;
  if (text && !error && text !== 'Виконується запит…') messageTimer = setTimeout(() => { $('message').hidden = true; }, 6000);
}
async function api(path, method = 'GET', body) {
  const response = await fetch(`/admin/api/${path}`, {
    method, headers:{'Content-Type':'application/json', ...(csrf ? {'X-CSRF-Token':csrf} : {})},
    signal:AbortSignal.timeout(20000),
    ...(body !== undefined ? {body:JSON.stringify(body)} : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    const code = data.error?.code || 'REQUEST_FAILED';
    if (code === 'LOGIN_REQUIRED') showLogin();
    throw new Error(explain(code));
  }
  return data;
}
function showLogin() {
  clearInterval(timer); csrf = ''; settings = null;
  duckDns = null; duckDnsDirty = false; $('duckdns-form').reset();
  logEvents = []; latestDiagnostics = null; $('logs').replaceChildren();
  logGeneration = 0; $('navigation').hidden = true;
  $('connection-badge').textContent = 'Потрібен вхід'; $('connection-badge').className = 'pill';
  $('login').hidden = false; $('workspace').hidden = true; $('account').hidden = true;
  $('webhook-url').value = ''; $('status-url').value = '';
}
function renderDuckDns(data, preserveInput = true) {
  duckDns = data;
  if (!preserveInput || !duckDnsDirty) {
    $('duckdns-domain').value = data.domain;
    $('duckdns-ipv4').value = data.ipv4;
    $('duckdns-interval').value = data.intervalMinutes;
    $('duckdns-enabled').checked = data.enabled;
  }
  $('duckdns-token').placeholder = data.tokenConfigured ? 'Збережено · залиш порожнім, щоб не змінювати' : 'Токен з акаунта DuckDNS';
  $('duckdns-token-hint').textContent = data.tokenConfigured ? 'Токен збережено на сервері. Порожнє поле залишає його без змін.' : 'Токен ще не збережено.';
  const resultLabels = {checking:'Перевіряємо…', matched:'IPv4 збігається', different:'Потрібне оновлення', updated:'DuckDNS прийняв новий IPv4', unchanged:'DuckDNS підтвердив IPv4', error:'Помилка перевірки'};
  $('duckdns-status').textContent = data.busy ? 'Виконується запит…' : resultLabels[data.result] || (data.domain ? 'Очікуємо перевірку' : 'Ще не налаштовано');
  $('duckdns-status').className = `pill${['matched', 'updated', 'unchanged'].includes(data.result) ? ' active' : ''}`;
  $('duckdns-mode').textContent = data.enabled ? `Автоматичне оновлення ввімкнено · кожні ${data.intervalMinutes} хв.` : 'Автоматичне оновлення вимкнено. Доступні ручні дії.';
  $('duckdns-hostname').textContent = data.hostname || '—';
  $('duckdns-expected-ip').textContent = data.expectedIp || '—';
  $('duckdns-dns-ip').textContent = data.dnsIps.length ? data.dnsIps.join(', ') : data.needsUpdate === true ? 'A-запис не знайдено' : '—';
  for (const [id, field] of [['checked','checkedAt'], ['success','lastSuccessAt'], ['updated','lastUpdatedAt']]) $('duckdns-' + id).textContent = dateTime(data[field]);
  $('duckdns-next').textContent = data.nextCheckAt ? dateTime(data.nextCheckAt) : data.busy && data.enabled ? 'Після поточного запиту' : '—';
  $('duckdns-error').hidden = !data.lastError;
  $('duckdns-error').textContent = data.lastError ? explain(data.lastError) : '';
  $('duckdns-unsaved').hidden = !duckDnsDirty;
  $('duckdns-save').disabled = operationBusy || data.busy;
  $('duckdns-check').disabled = operationBusy || data.busy || duckDnsDirty || !data.domain;
  $('duckdns-update').disabled = $('duckdns-check').disabled || !data.tokenConfigured;
}
function renderSettings(data, preserveInput = false) {
  const dirty = settings && $('public-base').value.trim().replace(/\/$/, '') !== settings.publicBaseUrl;
  settings = data;
  if (!preserveInput || !dirty) $('public-base').value = data.publicBaseUrl;
  $('status-url').value = data.statusUrl;
  $('webhook-url').value = data.webhookUrl ? `${data.publicBaseUrl}/public/webhook?token=••••••••` : '';
  $('copy-status').disabled = !data.statusUrl;
  $('copy-status-token').disabled = !data.statusTokenUrl;
  $('copy-webhook').disabled = !data.webhookUrl;
  const unsaved = $('public-base').value.trim().replace(/\/$/, '') !== data.publicBaseUrl;
  const busy = operationBusy || data.busy;
  $('register').disabled = busy || !data.webhookUrl || unsaved;
  $('update').disabled = busy || !data.webhookUrl || unsaved;
  $('check-webhook').disabled = busy || !data.webhookUrl || unsaved;
  $('remove').disabled = busy || !(data.registration?.active || data.webhookUrl);
  $('update-key').disabled = busy;
  $('import-key').disabled = busy || !$('key-file').files.length;
  $('key-file').disabled = busy;
  $('preflight-status').textContent = data.preflight ? `${dateTime(data.preflight.at)} · ${data.preflight.ok ? `Адресу перевірено · HTTP ${data.preflight.httpStatus} · ${data.preflight.durationMs} мс. ${data.signatureReady ? 'Ключ підпису готовий.' : 'Для реєстрації ще потрібен ключ підпису.'}` : explain(data.preflight.code)}` : 'Перевірку ще не виконано.';
  $('preflight-status').className = `hint ${data.preflight?.ok ? 'success' : data.preflight ? 'error' : ''}`;
  $('key-status').textContent = data.signatureReady ? `RSA-ключ завантажено${data.keyUpdatedAt ? ` · ${dateTime(data.keyUpdatedAt)}` : ''}` : 'Ключ ще не завантажено';
  $('key-fingerprint').hidden = !data.keyFingerprint;
  $('key-fingerprint').textContent = data.keyFingerprint ? `SHA-256 публічного ключа (SPKI DER): ${data.keyFingerprint}` : '';
  const registration = data.registration;
  $('registration-label').className = `pill${data.registrationMatches ? ' active' : ''}`;
  $('registration-label').textContent = !registration ? 'Немає збереженої реєстрації' : !registration.active ? 'Підписку видалено' : data.registrationMatches ? 'Адресу зареєстровано' : 'Адреса змінилася — онови підписку';
  $('registration-info').textContent = registration
    ? `Остання успішна дія: ${new Date(registration.at).toLocaleString('uk-UA')} · HTTP ${registration.httpStatus}`
    : 'Тут з’явиться результат запиту до UkraineAlarm.';
  if (!data.publicStatusConfigured || !data.webhookTokenConfigured) message('Для публічних маршрутів задай PUBLIC_STATUS_TOKEN і WEBHOOK_TOKEN у .env, потім перезапусти сервер.', true);
}
function renderState(state) {
  $('freshness').textContent = state.fresh ? 'Актуальні' : 'Очікуємо свіжі дані';
  $('mqtt').textContent = {connected:'Підключений', disconnected:'Немає з’єднання', disabled:'Вимкнений'}[state.mqtt] || state.mqtt;
  $('updated').textContent = dateTime(state.updatedAt);
  $('freshness').className = state.fresh ? 'good' : 'bad';
  $('mqtt').className = state.mqtt === 'connected' ? 'good' : state.mqtt === 'disconnected' ? 'bad' : '';
  $('data-age').textContent = state.ageSeconds == null ? 'Першого успішного запиту ще не було' : `Вік даних: ${elapsed(state.ageSeconds)}`;
  $('map-empty').hidden = state.fresh;
  $('map-empty').textContent = state.states ? 'Дані застаріли. На карті останній відомий стан; це не підтвердження поточної ситуації.' : 'Очікуємо перший коректний знімок.';
  $('map-host').classList.toggle('stale', !state.fresh);
  $('map-status').textContent = state.fresh ? 'Дані актуальні' : state.states ? 'Застарілий знімок' : 'Немає даних';
  $('map-status').className = state.fresh ? 'pill active' : 'pill';
  $('connection-badge').textContent = state.fresh ? 'Свіжі дані API' : 'Потрібна увага';
  $('connection-badge').className = state.fresh ? 'pill active' : 'pill';
  const byKey = new Map((state.regions || []).map(region => [region.key, region]));
  for (const path of $('map-host').querySelectorAll('[data-region]')) {
    const region = byKey.get(path.dataset.region);
    path.setAttribute('class', `map-region ${region ? stateClasses[region.state] : 'unknown'}`);
    const text = region ? `${region.name}: ${region.state} — ${stateLabels[region.state]}${state.fresh ? '' : ' (застарілі дані)'}` : 'Немає даних';
    path.setAttribute('aria-label', text);
    path.querySelector('title').textContent = text;
  }
  if (selectedRegion) selectRegion(selectedRegion);
  $('active-count').textContent = state.states ? state.states.filter(n => n !== 0).length : '—';
  $('summary-freshness').textContent = state.fresh ? 'Поточний підтверджений знімок.' : state.states ? 'Числа з останнього відомого знімка.' : 'Числа з’являться після першого оновлення.';
  $('state-counts').replaceChildren(...stateLabels.map((label, index) => {
    const row = document.createElement('div'); row.className = 'state-count';
    const text = document.createElement('span'); text.textContent = `${index} · ${['Відбій', 'Червона вся область', 'Оранжева вся область', 'Червоний + оранжевий', 'Частково червона', 'Частково оранжева'][index]}`;
    const count = document.createElement('b'); count.textContent = state.states ? state.states.filter(n => n === index).length : '—';
    row.append(swatch(index), text, count); return row;
  }));
  $('regions').classList.toggle('stale', !state.fresh);
  const observations = new Map((latestDiagnostics?.alerts?.regions || []).map(region => [region.key, region]));
  $('regions').replaceChildren(...(state.regions || []).map(region => {
    const row = document.createElement('tr'), name = document.createElement('td'), stateCell = document.createElement('td');
    name.textContent = region.name;
    const badge = document.createElement('span'); badge.className = 'region-state';
    badge.append(swatch(region.state), `${region.state} · ${stateLabels[region.state]}${state.fresh ? '' : ' (застарілі)'}`);
    stateCell.append(badge); row.append(name, stateCell);
    const stats = observations.get(region.key);
    for (const value of [stats?.starts ?? '—', stats?.clears ?? '—', stats?.changes ?? '—', stats?.lastChangedAt ? dateTime(stats.lastChangedAt) : '—']) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    return row;
  }));
}
function swatch(state) {
  const item = document.createElement('span'); item.className = `state-swatch ${stateClasses[state] || ''}`;
  item.setAttribute('aria-hidden', 'true'); return item;
}
function selectRegion(key) {
  selectedRegion = key;
  const state = latestDiagnostics?.state;
  const region = state?.regions.find(item => item.key === key);
  $('map-selection').textContent = region ? `${region.name} · ${region.state} — ${stateLabels[region.state]}${state.fresh ? '' : ' · останній відомий стан'}` : 'Очікуємо дані для області.';
}
async function loadMap() {
  if ($('map-host').firstElementChild || mapLoading) return mapLoading;
  mapLoading = (async () => {
    try {
      const response = await fetch('/admin/map.svg', {signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error();
      const svg = new DOMParser().parseFromString(await response.text(), 'image/svg+xml').documentElement;
      if (svg.localName !== 'svg' || svg.querySelector('parsererror')) throw new Error();
      // This is a bundled, same-origin geometry asset, never provider or user HTML.
      $('map-host').replaceChildren(document.importNode(svg, true));
      for (const path of $('map-host').querySelectorAll('[data-region]')) {
        for (const event of ['pointerenter', 'focus', 'click']) path.addEventListener(event, () => selectRegion(path.dataset.region));
        path.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectRegion(path.dataset.region); } });
      }
      $('map-load-error').hidden = true;
      if (latestDiagnostics) renderState(latestDiagnostics.state);
    } catch { $('map-load-error').hidden = false; }
    finally { mapLoading = null; }
  })();
  return mapLoading;
}
function renderAlertStats(stats) {
  const rows = stats?.regions || [];
  $('stats-since').textContent = stats?.firstAt ? `Від ${dateTime(stats.firstAt)}` : 'Очікуємо перший знімок';
  $('alarm-starts').textContent = stats?.firstAt ? rows.reduce((n, r) => n + r.starts, 0) : '—';
  $('alarm-clears').textContent = stats?.firstAt ? rows.reduce((n, r) => n + r.clears, 0) : '—';
  $('alarm-changes').textContent = stats?.firstAt ? stats.changes : '—';
  $('alarm-peak').textContent = stats?.firstAt ? stats.peakActive : '—';
  $('alarm-gaps').textContent = stats?.gaps ? `Перерв у спостереженнях: ${stats.gaps}. Переходи за ці проміжки невідомі.` : 'Перерв між свіжими знімками ще не зафіксовано.';
  const events = (stats?.events || []).map(event => {
    const row = document.createElement('div'); row.className = 'alert-event';
    const time = document.createElement('time'); time.dateTime = event.at; time.textContent = dateTime(event.at);
    const name = document.createElement('strong'); name.textContent = event.name;
    const change = document.createElement('span'); change.textContent = `${event.from} → ${event.to} · ${stateLabels[event.to]}`;
    row.append(time, name, change); return row;
  });
  if (!events.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = 'Переходів ще не зафіксовано. Перший знімок не рахується як зміна.'; events.push(empty); }
  $('alert-events').replaceChildren(...events);
}
function bytes(value) { return Number.isFinite(value) ? value >= 1073741824 ? `${(value / 1073741824).toFixed(1)} GiB` : `${(value / 1048576).toFixed(1)} MiB` : '—'; }
function percent(value) { return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—'; }
function svgElement(tag, attributes, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}
function chart(id, history, field, scale = 1) {
  const points = history.filter(point => Number.isFinite(point[field]));
  const graph = $(id + '-chart'); graph.replaceChildren();
  if (!points.length) { graph.append(svgElement('text', {x:40, y:75, class:'chart-text'}, 'Очікуємо вимірювання')); return; }
  const max = Math.max(1, ...points.map(p => p[field] / scale)) * 1.15;
  const first = Date.parse(history[0].at), last = Date.parse(history.at(-1).at), span = Math.max(last - first, 10000);
  for (let i = 0; i < 3; i++) {
    const y = 15 + i * 60;
    graph.append(svgElement('line', {x1:40, x2:590, y1:y, y2:y, class:'chart-gridline'}));
    graph.append(svgElement('text', {x:0, y:y + 4, class:'chart-text'}, (max * (1 - i / 2)).toFixed(1)));
  }
  let path = '', previousAt = null;
  for (const point of points) {
    const at = Date.parse(point.at), x = 40 + (at - first) / span * 550, y = 135 - point[field] / scale / max * 120;
    path += `${previousAt === null || at - previousAt > 15000 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
    previousAt = at;
    graph.append(svgElement('circle', {cx:x, cy:y, r:2, class:'chart-dot'}));
  }
  graph.append(svgElement('path', {d:path, class:'chart-line'}));
  const time = at => new Date(at).toLocaleTimeString('uk-UA');
  $(id + '-range').textContent = `${time(first)} — ${time(last)} · ${points.length} вимірювань`;
}
function renderResources(data) {
  const latest = data.resources?.latest, system = latest?.system, upstream = data.api || {};
  $('quick-cpu').textContent = $('cpu-value').textContent = percent(latest?.cpuPercent);
  $('quick-memory').textContent = $('memory-value').textContent = bytes(latest?.rssBytes);
  $('heap-value').textContent = bytes(latest?.heapUsedBytes);
  $('heap-total').textContent = `Виділено ${bytes(latest?.heapTotalBytes)}`;
  $('loop-value').textContent = Number.isFinite(latest?.eventLoopMs) ? `${latest.eventLoopMs.toFixed(1)} мс` : '—';
  $('resource-time').textContent = latest ? `Виміряно ${dateTime(latest.at)} · кожні 10 с` : 'Очікуємо вимірювання';
  $('system-memory-label').textContent = system?.memoryScope === 'container' ? 'Пам’ять контейнера (cgroup v2)' : 'Пам’ять хоста';
  $('system-memory').textContent = system ? `${bytes(system.usedBytes)} / ${bytes(system.totalBytes)}` : '—';
  $('system-cpu').textContent = system?.cpuCores ?? '—';
  $('system-load').textContent = system?.loadAverage ? system.loadAverage.map(n => n.toFixed(2)).join(' / ') : 'Не підтримується';
  $('system-disk').textContent = system?.disk ? `${bytes(system.disk.availableBytes)} / ${bytes(system.disk.totalBytes)}` : '—';
  $('quick-api').textContent = $('api-successes').textContent = upstream.successes ?? '—';
  $('api-failures').textContent = upstream.failures ?? '—';
  $('api-duration').textContent = Number.isFinite(upstream.lastDurationMs) ? `${upstream.lastDurationMs} мс` : '—';
  $('resource-hooks').textContent = data.webhook.accepted;
  chart('cpu', data.resources?.history || [], 'cpuPercent');
  chart('memory', data.resources?.history || [], 'rssBytes', 1048576);
}
function renderLogs() {
  const level = $('log-level').value;
  const events = logEvents.filter(event => level === 'all' || event.level === level);
  $('logs-empty').hidden = Boolean(events.length);
  $('logs-empty').textContent = level === 'all' ? 'Подій поки немає.' : 'Подій цього рівня немає.';
  $('logs').replaceChildren(...events.map(event => {
    const row = document.createElement('tr');
    const time = document.createElement('td'); time.textContent = dateTime(event.lastAt);
    time.title = `Перший запис: ${dateTime(event.at)}`;
    const type = document.createElement('td');
    const badge = document.createElement('span'); badge.className = `log-level ${event.level}`;
    badge.textContent = {info:'Інформація', warn:'Увага', error:'Помилка'}[event.level] || event.level;
    const source = document.createElement('span'); source.className = 'log-source';
    source.textContent = {server:'Сервер', api:'UkraineAlarm', mqtt:'MQTT', webhook:'Вхідний webhook', settings:'Налаштування', duckdns:'DuckDNS'}[event.source] || event.source;
    type.append(badge, source);
    const text = document.createElement('td');
    const code = document.createElement('code'); code.className = 'log-code'; code.textContent = event.code;
    const description = document.createElement('span'); description.textContent = event.message;
    text.append(code, description);
    const explanation = explain(event.code);
    if (explanation !== event.code && explanation !== event.message) text.append(document.createTextNode(` ${explanation}`));
    if (event.count > 1) { const count = document.createElement('span'); count.className = 'log-repeat'; count.textContent = `×${event.count}`; text.append(count); }
    row.append(time, type, text); return row;
  }));
}
function renderDiagnostics(data) {
  latestDiagnostics = data;
  const {api:upstream = {}, mqtt = {}, webhook:hook, state} = data;
  renderState(state);
  renderAlertStats(data.alerts); renderResources(data);
  $('uptime').textContent = elapsed(data.uptimeSeconds);
  $('started-at').textContent = `Від ${dateTime(data.startedAt)}`;
  $('changed').textContent = dateTime(upstream.lastChangedAt);
  $('api-attempt').textContent = `${dateTime(upstream.lastAttemptAt)}${upstream.inFlight ? ' · запит триває' : ''}`;
  $('update-source').textContent = `Джерело: ${{startup:'запуск сервера', poll:'планове опитування', webhook:'webhook', manual:'ручне оновлення'}[upstream.lastSource] || 'очікування'} · інтервал ${upstream.pollSeconds || '—'} с`;
  $('mqtt-published').textContent = dateTime(mqtt.lastPublishedAt);
  $('mqtt-detail').textContent = mqtt.lastError?.message || (mqtt.lastConnectedAt ? `Підключення: ${dateTime(mqtt.lastConnectedAt)}` : '');
  $('hook-received').textContent = hook.lastReceivedAt ? `${dateTime(hook.lastReceivedAt)} · ${{accepted:'прийнято', rejected:'відхилено', duplicate:'повтор'}[hook.lastOutcome]}` : 'Ще не надходив';
  $('hook-accepted').textContent = hook.lastAcceptedAt ? dateTime(hook.lastAcceptedAt) : 'Ще не надходив';
  $('hook-counts').textContent = `Webhook від запуску: ${hook.received} вхідних · ${hook.accepted} прийнято · ${hook.rejected} відхилено · ${hook.duplicates} повторів.`;
  let hookLabel = 'Очікуємо перший webhook', detail = 'Реєстрація не підтверджує доставку. Відсутність подій сама по собі не означає збій.', healthy = false;
  if (!settings.signatureReady) { hookLabel = 'Немає ключа підпису'; detail = 'Завантаж ключ, щоб приймати підписані запити.'; }
  else if (hook.lastOutcome === 'rejected') { hookLabel = 'Останній запит відхилено'; detail = explain(hook.lastError); }
  else if (hook.lastAcceptedAt && (!settings.registration || Date.parse(hook.lastAcceptedAt) >= Date.parse(settings.registration.at))) {
    hookLabel = 'Доставку підтверджено'; detail = `Останній перевірений webhook: ${dateTime(hook.lastAcceptedAt)}. Це час останньої доставки, а не постійна перевірка каналу.`; healthy = true;
  } else if (!settings.registrationMatches) { hookLabel = 'Реєстрацію не підтверджено'; detail = 'Зареєструй поточну адресу або онови підписку.'; }
  $('webhook-health').textContent = hookLabel; $('webhook-health').className = healthy ? 'good' : '';
  $('webhook-health-detail').textContent = detail;
  const problems = [];
  if (upstream.lastError) problems.push(`API: ${explain(upstream.lastError)}.`);
  if (settings.lastOperation?.ok === false) problems.push(`Остання дія (${dateTime(settings.lastOperation.at)}): ${explain(settings.lastOperation.code)}`);
  $('diagnostic-problems').textContent = problems.join(' '); $('diagnostic-problems').hidden = !problems.length;
  if ((data.logGeneration || 0) >= logGeneration) {
    logGeneration = data.logGeneration || 0;
    if (!logsPaused) { logEvents = data.events; renderLogs(); }
    $('logs-cleared').hidden = !data.clearedAt;
    $('logs-cleared').textContent = data.clearedAt ? `Журнал очищено ${dateTime(data.clearedAt)}. Нові події з’являтимуться тут.` : '';
  }
  $('panel-sync').textContent = `Панель оновлено ${new Date().toLocaleTimeString('uk-UA')} · кожні 5 с${logsPaused ? ' · журнал на паузі' : ''}`;
}
async function updateState() {
  if (refreshing) return;
  refreshing = true;
  const sessionCsrf = csrf;
  try {
    const [data, currentSettings, currentDuckDns] = await Promise.all([api('diagnostics'), api('settings'), api('duckdns')]);
    if (!csrf || csrf !== sessionCsrf) return;
    renderSettings(currentSettings, true); renderDiagnostics(data);
    renderDuckDns(currentDuckDns);
    $('panel-sync-error').hidden = true;
  } catch (error) {
    $('panel-sync-error').textContent = `Немає зв’язку з панеллю. Показані дані можуть бути застарілими. ${error.message}`;
    $('panel-sync-error').hidden = false;
    $('connection-badge').textContent = 'Немає зв’язку з панеллю'; $('connection-badge').className = 'pill';
    $('map-host').classList.add('stale');
    $('map-status').textContent = 'Зв’язок втрачено'; $('map-status').className = 'pill';
    $('summary-freshness').textContent = 'Зв’язок втрачено. Показано останні отримані дані.';
    throw error;
  } finally { refreshing = false; }
}
async function enter(session) {
  csrf = session.csrf; $('username').textContent = session.username;
  $('login').hidden = true; $('workspace').hidden = false; $('account').hidden = false;
  $('navigation').hidden = false; void loadMap();
  clearInterval(timer); timer = setInterval(() => { void updateState().catch(() => {}); }, 5000);
  await updateState();
}
async function action(work, success) {
  if (operationBusy) return;
  operationBusy = true;
  const controls = [...document.querySelectorAll('button')];
  controls.forEach(button => { button.disabled = true; });
  message('Виконується запит…');
  try { await work(); message(success); }
  catch (error) { message(error.message, true); }
  finally {
    operationBusy = false;
    controls.forEach(button => { button.disabled = false; });
    if (csrf) { try { renderSettings(await api('settings'), true); await updateState(); } catch {} }
  }
}
function selectTab(name) {
  for (const tab of Object.keys(sections)) {
    $(tab + '-panel').hidden = tab !== name;
    $(tab + '-tab').setAttribute('aria-selected', String(tab === name));
    $(tab + '-tab').tabIndex = tab === name ? 0 : -1;
  }
  $('page-title').textContent = sections[name];
  if (name === 'overview') void loadMap();
}
for (const name of Object.keys(sections)) {
  $(name + '-tab').addEventListener('click', () => selectTab(name));
  $(name + '-tab').addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const names = Object.keys(sections), direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
    const next = event.key === 'Home' ? names[0] : event.key === 'End' ? names.at(-1) : names[(names.indexOf(name) + direction + names.length) % names.length];
    selectTab(next); $(next + '-tab').focus();
  });
}
for (const button of document.querySelectorAll('[data-section]')) button.addEventListener('click', () => {
  selectTab(button.dataset.section); $(button.dataset.section + '-tab').focus();
});
function renderTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('theme-toggle').textContent = dark ? 'Світла тема' : 'Темна тема';
  $('theme-toggle').setAttribute('aria-pressed', String(dark));
}
$('theme-toggle').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('alarmmini-theme', theme); } catch {}
  renderTheme();
});
renderTheme();
$('clear-logs').addEventListener('click', () => { void action(async () => {
  const result = await api('logs/clear', 'POST');
  logGeneration = result.logGeneration;
  logEvents = result.events;
  if (latestDiagnostics) { latestDiagnostics.events = result.events; latestDiagnostics.logGeneration = result.logGeneration; latestDiagnostics.clearedAt = result.clearedAt; }
  renderLogs();
  $('logs-cleared').hidden = false; $('logs-cleared').textContent = `Журнал очищено ${dateTime(result.clearedAt)}.`;
}, 'Журнал панелі очищено. Лічильники та файли PM2 збережено.'); });
$('duckdns-form').addEventListener('input', () => {
  duckDnsDirty = true;
  if (duckDns) renderDuckDns(duckDns);
});
$('duckdns-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = {domain:$('duckdns-domain').value, token:$('duckdns-token').value, ipv4:$('duckdns-ipv4').value,
    intervalMinutes:Number($('duckdns-interval').value), enabled:$('duckdns-enabled').checked, clearToken:$('duckdns-clear-token').checked};
  void action(async () => {
    const data = await api('duckdns', 'PUT', input);
    $('duckdns-token').value = ''; $('duckdns-clear-token').checked = false; duckDnsDirty = false;
    renderDuckDns(data, false);
  }, 'Налаштування DuckDNS збережено.');
});
$('duckdns-check').addEventListener('click', () => { void action(async () => {
  renderDuckDns(await api('duckdns/check', 'POST'));
}, 'Перевірку завершено. DNS-запис не змінювали.'); });
$('duckdns-update').addEventListener('click', () => { void action(async () => {
  renderDuckDns(await api('duckdns/update', 'POST'));
}, 'DuckDNS підтвердив IPv4. DNS-кеші можуть оновитися із затримкою.'); });
$('login-form').addEventListener('submit', event => {
  event.preventDefault();
  void action(async () => {
    const session = await api('login', 'POST', {username:$('login-name').value, password:$('login-password').value});
    $('login-password').value = ''; await enter(session);
  }, 'Вхід виконано.');
});
$('settings-form').addEventListener('submit', event => {
  event.preventDefault(); void action(() => api('settings', 'PUT', {publicBaseUrl:$('public-base').value}), 'Публічну адресу збережено.');
});
$('public-base').addEventListener('input', () => {
  const unsaved = $('public-base').value.trim().replace(/\/$/, '') !== settings?.publicBaseUrl;
  $('register').disabled = unsaved || !settings?.webhookUrl;
  $('update').disabled = unsaved || !settings?.webhookUrl;
  $('check-webhook').disabled = unsaved || !settings?.webhookUrl;
});
for (const [id, label] of [['register','Підписку зареєстровано.'], ['update','Підписку оновлено.'], ['remove','Підписку видалено.']]) {
  $(id).addEventListener('click', () => {
    if (id === 'remove' && !window.confirm('Видалити підписку webhook у UkraineAlarm? Планове опитування продовжиться.')) return;
    void action(() => api('webhook', 'POST', {action:id}), label);
  });
}
$('update-key').addEventListener('click', () => { void action(() => api('webhook-key', 'POST'), 'Ключ підпису оновлено.'); });
$('check-webhook').addEventListener('click', () => { void action(() => api('webhook-check', 'POST'), 'Адресу перевірено: POST із токеном дійшов до цього сервера. Підписку не змінено.'); });
$('key-file').addEventListener('change', () => { $('import-key').disabled = operationBusy || !$('key-file').files.length; });
$('import-key').addEventListener('click', () => { void action(async () => {
  const file = $('key-file').files[0];
  if (!file || file.size > 4096) throw new Error('Обери публічний PEM-файл розміром до 4 КБ.');
  await api('webhook-key', 'PUT', {pem:await file.text()});
  $('key-file').value = '';
}, 'Публічний ключ із файлу збережено.'); });
$('logout').addEventListener('click', () => { void action(async () => { await api('logout', 'POST'); showLogin(); }, 'Вихід виконано.'); });
async function copy(text) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      // Clipboard API needs HTTPS; support the requested plain HTTP LAN page too.
      const input = document.createElement('textarea'); input.value = text; document.body.append(input); input.select();
      const copied = document.execCommand('copy'); input.remove(); if (!copied) throw new Error();
    }
    message('Посилання скопійовано.');
  } catch { message('Браузер не дозволив копіювання. Перевір доступ до буфера обміну.', true); }
}
$('copy-status').addEventListener('click', () => { void copy(settings.statusUrl); });
$('copy-status-token').addEventListener('click', () => { void copy(settings.statusTokenUrl); });
$('copy-webhook').addEventListener('click', () => { void copy(settings.webhookUrl); });
$('log-level').addEventListener('change', renderLogs);
$('pause-logs').addEventListener('click', () => {
  logsPaused = !logsPaused;
  $('pause-logs').textContent = logsPaused ? 'Продовжити журнал' : 'Пауза журналу';
  $('pause-logs').setAttribute('aria-pressed', String(logsPaused));
  if (latestDiagnostics) renderDiagnostics(latestDiagnostics);
});
api('session').then(enter).catch(error => { showLogin(); if (!error.message.includes('Увійди знову')) message(error.message, true); });
