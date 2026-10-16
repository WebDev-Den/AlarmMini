import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isIP } from 'node:net';
import { Resolver } from 'node:dns/promises';
import { AdminError, atomicWrite, limitedText } from './settings.js';

function publicIpv4(value) {
  if (isIP(value) !== 4) return false;
  const [a, b] = value.split('.').map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a < 224 &&
    !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168);
}

function normalize(input) {
  if (!input || typeof input !== 'object' || typeof input.enabled !== 'boolean' ||
      !Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 1 || input.intervalMinutes > 1440) {
    throw new AdminError(400, 'DUCKDNS_INVALID_SETTINGS');
  }
  if (typeof input.domain !== 'string' || typeof input.ipv4 !== 'string' || typeof input.token !== 'string') {
    throw new AdminError(400, 'DUCKDNS_INVALID_SETTINGS');
  }
  const domain = input.domain.trim().toLowerCase().replace(/\.duckdns\.org\.?$/, '');
  const token = input.token.trim();
  const ipv4 = input.ipv4.trim();
  if (domain && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) throw new AdminError(400, 'DUCKDNS_INVALID_DOMAIN');
  if (token && !/^[a-z0-9-]{16,128}$/i.test(token)) throw new AdminError(400, 'DUCKDNS_INVALID_TOKEN');
  if (ipv4 && !publicIpv4(ipv4)) throw new AdminError(400, 'DUCKDNS_INVALID_IP');
  if (input.enabled && (!domain || !token)) throw new AdminError(400, 'DUCKDNS_NOT_CONFIGURED');
  return {enabled:input.enabled, domain, token, ipv4, intervalMinutes:input.intervalMinutes};
}

export function createDuckDns(config, {
  fetchImpl = fetch, now = Date.now, monitor,
  resolver = new Resolver({timeout:config.timeoutMs, tries:1}),
  resolve4Impl = host => resolver.resolve4(host),
} = {}) {
  const path = join(dirname(config.settingsFile), 'duckdns.json');
  let saved = {};
  try { saved = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read DuckDNS settings'); }
  let settings = normalize({enabled:false, domain:'', token:'', ipv4:'', intervalMinutes:5, ...config.duckDns, ...saved});
  let busy = false, running = false, timer, controller;
  const state = {checkedAt:null, lastSuccessAt:null, lastUpdatedAt:null, nextCheckAt:null,
    expectedIp:null, dnsIps:[], needsUpdate:null, result:null, lastError:null};

  function view() {
    const {token, ...safeSettings} = settings;
    return {...safeSettings, tokenConfigured:Boolean(token), hostname:settings.domain ? `${settings.domain}.duckdns.org` : '',
      ...state, dnsIps:[...state.dnsIps], busy};
  }
  function record(level, code, message) { monitor?.record(level, 'duckdns', code, message); }
  function schedule(delay = settings.intervalMinutes * 60000) {
    clearTimeout(timer); state.nextCheckAt = null;
    if (!running || !settings.enabled || busy) return;
    state.nextCheckAt = new Date(now() + delay).toISOString();
    timer = setTimeout(() => { void run('auto').catch(() => {}); }, delay);
    timer.unref?.();
  }
  async function requestText(url, prefix) {
    try {
      const response = await fetchImpl(url, {redirect:'error', signal:AbortSignal.any([
        controller.signal, AbortSignal.timeout(config.timeoutMs),
      ])});
      if (!response.ok) {
        await response.body?.cancel();
        throw new AdminError(502, `${prefix}_HTTP_${response.status}`);
      }
      return await limitedText(response, 1024);
    } catch (error) {
      if (error instanceof AdminError) throw error;
      // Network errors can contain the full request URL, including its token.
      throw new AdminError(502, `${prefix}_UNAVAILABLE`);
    }
  }
  async function inspect() {
    state.expectedIp = null; state.dnsIps = []; state.needsUpdate = null;
    const ip = settings.ipv4 || (await requestText('https://api.ipify.org', 'DUCKDNS_IP')).trim();
    if (!publicIpv4(ip)) throw new AdminError(502, 'DUCKDNS_IP_INVALID_RESPONSE');
    state.expectedIp = ip;
    try {
      state.dnsIps = await resolve4Impl(`${settings.domain}.duckdns.org`);
    } catch (error) {
      if (!['ENODATA', 'ENOTFOUND'].includes(error.code)) throw new AdminError(502, 'DUCKDNS_DNS_UNAVAILABLE');
      state.dnsIps = [];
    }
    state.needsUpdate = state.dnsIps.length !== 1 || state.dnsIps[0] !== ip;
    state.result = state.needsUpdate ? 'different' : 'matched';
    return ip;
  }
  async function update(ip) {
    if (controller.signal.aborted) throw new AdminError(503, 'DUCKDNS_STOPPED');
    const url = new URL('https://www.duckdns.org/update');
    url.search = new URLSearchParams({domains:settings.domain, token:settings.token, ip, verbose:'true'}).toString();
    const lines = (await requestText(url.toString(), 'DUCKDNS_UPDATE')).trim().split(/\r?\n/);
    if (lines[0] === 'KO') throw new AdminError(502, 'DUCKDNS_REJECTED');
    if (lines.length !== 4 || lines[0] !== 'OK' || lines[1] !== ip ||
        (lines[2] && isIP(lines[2]) !== 6) || !['UPDATED', 'NOCHANGE'].includes(lines[3])) {
      throw new AdminError(502, 'DUCKDNS_INVALID_RESPONSE');
    }
    state.lastSuccessAt = new Date(now()).toISOString();
    if (lines[3] === 'UPDATED') state.lastUpdatedAt = state.lastSuccessAt;
    state.result = lines[3] === 'UPDATED' ? 'updated' : 'unchanged';
    // An API acknowledgement does not prove that recursive DNS caches have refreshed.
    state.needsUpdate = null;
    record('info', `DUCKDNS_${lines[3]}`, lines[3] === 'UPDATED'
      ? 'DuckDNS прийняв новий IPv4. DNS-кеші можуть оновитися із затримкою.'
      : 'DuckDNS підтвердив IPv4: запис уже мав потрібне значення.');
  }
  async function run(action = 'check') {
    if (!['check', 'update', 'auto'].includes(action)) throw new AdminError(400, 'DUCKDNS_INVALID_ACTION');
    if (busy) throw new AdminError(409, 'DUCKDNS_BUSY');
    if (!settings.domain || (action !== 'check' && !settings.token)) throw new AdminError(400, 'DUCKDNS_NOT_CONFIGURED');
    busy = true; clearTimeout(timer); state.nextCheckAt = null;
    controller = new AbortController();
    state.lastError = null; state.result = 'checking';
    try {
      const ip = await inspect();
      if (action === 'update' || (action === 'auto' && state.needsUpdate)) await update(ip);
      else record(state.needsUpdate ? 'warn' : 'info', state.needsUpdate ? 'DUCKDNS_DIFFERENT' : 'DUCKDNS_MATCHED',
        state.needsUpdate ? 'DNS-запис відрізняється від потрібного IPv4. Перевірка не змінювала запис.' : 'DNS-запис відповідає потрібному IPv4. Оновлення не потрібне.');
    } catch (error) {
      const safe = error instanceof AdminError ? error : new AdminError(502, 'DUCKDNS_CHECK_FAILED');
      state.result = 'error'; state.lastError = safe.code;
      record('error', safe.code, 'Перевірка або оновлення DuckDNS завершилися помилкою.');
      throw safe;
    } finally {
      state.checkedAt = new Date(now()).toISOString();
      busy = false; controller = null; schedule();
    }
    return view();
  }
  return {
    view, run,
    async save(input) {
      if (busy) throw new AdminError(409, 'DUCKDNS_BUSY');
      // Blank passwords from the UI preserve the saved secret; deletion is explicit.
      const next = normalize({...input, token:input.clearToken === true ? '' : input.token === '' || input.token === undefined ? settings.token : input.token});
      busy = true;
      try {
        await atomicWrite(path, JSON.stringify(next, null, 2) + '\n');
        if (next.domain !== settings.domain || next.ipv4 !== settings.ipv4 || next.token !== settings.token) {
          Object.assign(state, {checkedAt:null, lastSuccessAt:null, lastUpdatedAt:null, expectedIp:null,
            dnsIps:[], needsUpdate:null, result:null, lastError:null});
        }
        settings = next;
        record('info', 'DUCKDNS_SAVED', 'Налаштування DuckDNS збережено.');
      } catch {
        record('error', 'DUCKDNS_WRITE_FAILED', 'Не вдалося зберегти налаштування DuckDNS.');
        throw new AdminError(500, 'DUCKDNS_WRITE_FAILED');
      } finally { busy = false; schedule(0); }
      return view();
    },
    start() { if (!running) { running = true; schedule(0); } },
    stop() { running = false; clearTimeout(timer); state.nextCheckAt = null; controller?.abort(); resolver.cancel(); },
  };
}
