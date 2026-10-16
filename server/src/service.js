import { connect } from 'mqtt';
import { createMonitor, mqttError } from './monitor.js';
import { createAlertStats } from './alert-stats.js';
import { aggregateAlerts, buildRegionIndex, legacyStates, REGIONS, STATE_LEVELS, UnknownRegionError } from './state.js';

export function createService(config, { fetchImpl = fetch, connectMqtt = connect, now = Date.now, log = console, monitor = createMonitor({now, log}) } = {}) {
  let regionIndex = buildRegionIndex();
  let regionsUpdatedAt = null;
  let snapshot = null;
  let lastError = null;
  let inFlight = null;
  let running = false;
  let client = null;
  let pollTimer, freshnessTimer, webhookTimer;
  let webhookPending = false;
  let nextRequestAt = 0;
  let retainedCleared = false;
  const apiDetails = {lastAttemptAt:null, lastSuccessAt:null, lastChangedAt:null, lastFailureAt:null, lastSource:null, lastError:null,
    successes:0, failures:0, lastDurationMs:null};
  const alertStats = createAlertStats(config.staleMs);
  const mqttDetails = {lastConnectedAt:null, lastDisconnectedAt:null, lastPublishedAt:null, lastErrorAt:null, lastError:null};
  const shutdown = new AbortController();

  function isFresh() {
    return snapshot !== null && now() - snapshot.updatedAt < config.staleMs;
  }

  function publish(topic, payload) {
    if (client?.connected) client.publish(topic, payload, { qos: 0, retain: true }, error => {
      if (error) {
        mqttDetails.lastError = {code:'MQTT_PUBLISH_FAILED', message:'Не вдалося надіслати дані в MQTT.'};
        mqttDetails.lastErrorAt = new Date(now()).toISOString();
        monitor.record('error', 'mqtt', mqttDetails.lastError.code, mqttDetails.lastError.message);
      } else if (topic === config.topics.v2 && payload) {
        mqttDetails.lastPublishedAt = new Date(now()).toISOString();
        if (mqttDetails.lastError?.code === 'MQTT_PUBLISH_FAILED') mqttDetails.lastError = null;
      }
    });
  }

  function publishCurrent() {
    if (!client?.connected) return;
    if (!isFresh()) {
      if (!retainedCleared) {
        // Empty retained messages remove expired broker copies, not set all-clear.
        publish(config.topics.legacy, '');
        publish(config.topics.v2, '');
        publish(config.topics.status, snapshot ? 'stale' : 'starting');
        retainedCleared = true;
      }
      return;
    }
    retainedCleared = false;
    publish(config.topics.legacy, JSON.stringify(legacyStates(snapshot.states)));
    publish(config.topics.v2, JSON.stringify(snapshot.states));
    publish(config.topics.status, 'online');
  }

  async function getJson(path) {
    const response = await fetchImpl(`${config.apiBaseUrl}/${path}`, {
      headers: { Authorization: config.apiToken, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(config.timeoutMs)]),
    });
    if (!response.ok) {
      const error = new Error(`UkraineAlarm HTTP ${response.status}`);
      error.code = `UPSTREAM_HTTP_${response.status}`;
      if (response.status === 429 || response.status === 503) {
        const retry = response.headers.get('retry-after');
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : null;
        const delay = seconds !== null ? seconds * 1000 : Date.parse(retry || '') - now();
        if (Number.isFinite(delay) && delay > 0) nextRequestAt = Math.max(nextRequestAt, now() + delay);
      }
      throw error;
    }
    return response.json();
  }

  async function updateRegions() {
    const nextIndex = buildRegionIndex(await getJson('regions'));
    regionIndex = nextIndex;
    regionsUpdatedAt = now();
  }

  function refresh(source = 'manual') {
    if (inFlight) return inFlight;
    if (shutdown.signal.aborted || now() < nextRequestAt) return Promise.resolve(false);
    nextRequestAt = now() + config.minRefreshMs;
    apiDetails.lastAttemptAt = new Date(now()).toISOString();
    const origin = ['startup', 'poll', 'webhook', 'manual'].includes(source) ? source : 'manual';
    inFlight = (async () => {
      try {
        const payload = await getJson('alerts');
        const receivedAt = now();
        let states;
        try {
          states = aggregateAlerts(payload, regionIndex);
        } catch (error) {
          if (!(error instanceof UnknownRegionError)) throw error;
          await updateRegions();
          states = aggregateAlerts(payload, regionIndex);
        }
        const changed = JSON.stringify(snapshot?.states) !== JSON.stringify(states);
        alertStats.observe(states, receivedAt);
        apiDetails.successes++;
        apiDetails.lastDurationMs = Math.max(0, now() - Date.parse(apiDetails.lastAttemptAt));
        snapshot = { states, updatedAt: receivedAt };
        lastError = null;
        apiDetails.lastSuccessAt = new Date(receivedAt).toISOString();
        apiDetails.lastSource = origin; apiDetails.lastError = null;
        if (changed) apiDetails.lastChangedAt = apiDetails.lastSuccessAt;
        // Every successful poll is also a heartbeat expected by the firmware.
        publishCurrent();
        monitor.record('info', 'api', changed ? 'MAP_CHANGED' : 'API_REFRESHED',
          `${{startup:'Запуск', poll:'Планова перевірка', webhook:'Після webhook', manual:'Оновлення'}[origin]}: ${changed ? 'стани карти змінилися.' : 'дані актуальні, стани без змін.'}`);
        // The seed allows startup even if the regions endpoint is unavailable.
        if (regionsUpdatedAt === null || now() - regionsUpdatedAt >= config.regionsRefreshMs) {
          try { await updateRegions(); }
          catch { monitor.record('warn', 'api', 'REGIONS_REFRESH_FAILED', 'Не вдалося оновити довідник областей. Використовується попередній.'); }
        }
        return true;
      } catch (error) {
        if (shutdown.signal.aborted) return false;
        apiDetails.failures++;
        apiDetails.lastDurationMs = Math.max(0, now() - Date.parse(apiDetails.lastAttemptAt));
        lastError = /^(UPSTREAM_HTTP_\d{3}|UNKNOWN_REGION)$/.test(error.code) ? error.code : 'UPSTREAM_INVALID_OR_UNAVAILABLE';
        apiDetails.lastError = lastError; apiDetails.lastFailureAt = new Date(now()).toISOString();
        monitor.record('error', 'api', lastError, 'Не вдалося оновити дані UkraineAlarm. Попередній знімок збережено.');
        publishIfStale();
        return false;
      } finally {
        inFlight = null;
        if (webhookPending && running) {
          webhookPending = false;
          requestRefresh();
        }
      }
    })();
    return inFlight;
  }

  function publishIfStale() {
    if (!isFresh()) publishCurrent();
  }

  function requestRefresh() {
    if (!running) return;
    if (inFlight) { webhookPending = true; return; }
    if (webhookTimer) return;
    webhookTimer = setTimeout(() => {
      webhookTimer = null;
      // A periodic request may have extended Retry-After while this timer waited.
      if (now() < nextRequestAt) { requestRefresh(); return; }
      void refresh('webhook');
    }, Math.max(0, nextRequestAt - now()));
  }

  function status() {
    return {
      fresh: isFresh(),
      updatedAt: snapshot ? new Date(snapshot.updatedAt).toISOString() : null,
      ageSeconds: snapshot ? Math.floor((now() - snapshot.updatedAt) / 1000) : null,
      mqtt: config.mqttUrl ? (client?.connected ? 'connected' : 'disconnected') : 'disabled',
      lastError,
      states: snapshot?.states ?? null,
      regions: snapshot ? REGIONS.map((region, i) => ({
        key: region.key, name: region.name, state: snapshot.states[i],
        level: STATE_LEVELS[snapshot.states[i]],
      })) : [],
    };
  }

  function start() {
    if (running) return;
    running = true;
    monitor.record('info', 'server', 'SERVER_STARTED', 'Сервер запущено. Очікуємо свіжі дані UkraineAlarm.');
    if (config.mqttUrl) {
      client = connectMqtt(config.mqttUrl, {
        clientId: config.mqttClientId, username: config.mqttUsername, password: config.mqttPassword,
        reconnectPeriod: 5000, connectTimeout: 10000, clean: true, queueQoSZero: false,
        will: { topic: config.topics.status, payload: 'offline', qos: 0, retain: true },
      });
      client.on('connect', () => {
        mqttDetails.lastConnectedAt = new Date(now()).toISOString(); mqttDetails.lastError = null;
        monitor.record('info', 'mqtt', 'MQTT_CONNECTED', 'З’єднання з MQTT-брокером встановлено.');
        retainedCleared = false; publishCurrent();
      });
      client.on('close', () => {
        mqttDetails.lastDisconnectedAt = new Date(now()).toISOString();
        monitor.record('warn', 'mqtt', 'MQTT_DISCONNECTED', 'З’єднання з MQTT відсутнє. Сервер спробує підключитися знову.');
      });
      client.on('error', error => {
        mqttDetails.lastError = mqttError(error.code); mqttDetails.lastErrorAt = new Date(now()).toISOString();
        monitor.record('error', 'mqtt', mqttDetails.lastError.code, mqttDetails.lastError.message);
      });
    }
    void refresh('startup');
    pollTimer = setInterval(() => { void refresh('poll'); }, config.pollMs);
    freshnessTimer = setInterval(publishIfStale, 1000);
  }

  async function stop() {
    running = false;
    clearInterval(pollTimer);
    clearInterval(freshnessTimer);
    clearTimeout(webhookTimer);
    shutdown.abort();
    await inFlight;
    if (client) {
      // On a graceful stop, remove retained map copies as well as marking offline.
      publish(config.topics.legacy, '');
      publish(config.topics.v2, '');
      publish(config.topics.status, 'offline');
      await new Promise(resolve => {
        const timer = setTimeout(() => { client.end(true); resolve(); }, 2000);
        client.end(false, {}, () => { clearTimeout(timer); resolve(); });
      });
    }
  }

  function diagnostics() {
    return {api:{...apiDetails, inFlight:Boolean(inFlight), pollSeconds:config.pollMs / 1000}, mqtt:{...mqttDetails}, alerts:alertStats.view()};
  }
  return { start, stop, refresh, requestRefresh, status, isFresh, monitor, diagnostics };
}
