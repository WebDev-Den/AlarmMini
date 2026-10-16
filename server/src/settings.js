import { readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import { normalizePublicUrl } from './config.js';
import { secureEqual } from './admin.js';

export class AdminError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export async function atomicWrite(path, content) {
  await mkdir(dirname(path), {recursive:true, mode:0o700});
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, content, {mode:0o600});
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function limitedText(response, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body || []) {
    length += chunk.length;
    if (length > limit) throw new Error('Response too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createSettings(config, {fetchImpl = fetch, now = Date.now, publicKeyPem, monitor} = {}) {
  let saved = {};
  try { saved = JSON.parse(readFileSync(config.settingsFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read runtime settings'); }
  let settings = {publicBaseUrl:normalizePublicUrl(saved.publicBaseUrl ?? config.publicBaseUrl), registration:saved.registration || null};
  const keyPath = config.webhookKeyFile || join(dirname(config.settingsFile), 'webhook-public.pem');
  let publicKey = null;
  let keyUpdatedAt = null;
  let lastOperation = null;
  let preflight = null;
  let preflightUrl = '';
  let pendingProbe = null;
  function parseKey(pem) {
    if (typeof pem !== 'string' || pem.length > 32768 || !/^-----BEGIN (?:(?:RSA )?PUBLIC KEY|CERTIFICATE)-----/.test(pem.trim())) throw new Error('Expected a public PEM key');
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== 'rsa') throw new Error('Webhook key must be RSA');
    return key;
  }
  if (publicKeyPem) publicKey = parseKey(publicKeyPem);
  else {
    try { publicKey = parseKey(readFileSync(keyPath, 'utf8')); keyUpdatedAt = statSync(keyPath).mtime.toISOString(); }
    catch (error) { if (error.code !== 'ENOENT' || config.webhookKeyFile) throw error; }
  }
  let busy = false;
  function urls() {
    const base = settings.publicBaseUrl;
    return {
      statusUrl:base ? `${base}/public/status` : '',
      statusTokenUrl:base && config.publicStatusToken ? `${base}/public/status?token=${encodeURIComponent(config.publicStatusToken)}` : '',
      webhookUrl:base && config.webhookToken ? `${base}/public/webhook?token=${encodeURIComponent(config.webhookToken)}` : '',
    };
  }
  function view() {
    const links = urls();
    return {
      publicBaseUrl:settings.publicBaseUrl, ...links,
      publicStatusConfigured:Boolean(config.publicStatusToken), webhookTokenConfigured:Boolean(config.webhookToken),
      signatureReady:Boolean(publicKey), keyUpdatedAt, lastOperation, registration:settings.registration, busy,
      keyFingerprint:publicKey ? createHash('sha256').update(publicKey.export({type:'spki', format:'der'})).digest('hex') : null,
      preflight, preflightMatches:Boolean(preflight?.ok && preflightUrl === links.webhookUrl),
      registrationMatches:Boolean(settings.registration?.active && settings.registration.url === links.webhookUrl),
    };
  }
  async function locked(work) {
    if (busy) throw new AdminError(409, 'SETTINGS_BUSY');
    busy = true;
    try { const result = await work(); return {...result, busy:false}; }
    catch (error) {
      const code = error instanceof AdminError ? error.code : 'SETTINGS_WRITE_FAILED';
      lastOperation = {at:new Date(now()).toISOString(), ok:false, code};
      monitor?.record('error', 'settings', code, 'Дія з налаштуваннями або webhook завершилася помилкою.');
      throw error instanceof AdminError ? error : new AdminError(500, code);
    } finally { busy = false; }
  }
  function succeeded(code, message) {
    lastOperation = {at:new Date(now()).toISOString(), ok:true, code};
    monitor?.record('info', 'settings', code, message);
  }
  async function installKey(pem, code = 'WEBHOOK_KEY_UPDATED') {
    let nextKey;
    try { nextKey = parseKey(pem); }
    catch { throw new AdminError(400, 'WEBHOOK_KEY_INVALID'); }
    try { await atomicWrite(keyPath, nextKey.export({type:'spki', format:'pem'})); }
    catch { throw new AdminError(500, 'WEBHOOK_KEY_WRITE_FAILED'); }
    publicKey = nextKey; keyUpdatedAt = new Date(now()).toISOString();
    succeeded(code, code === 'WEBHOOK_KEY_IMPORTED' ? 'Публічний RSA-ключ із файлу перевірено й збережено.' : 'RSA-ключ перевірки webhook завантажено й збережено.');
  }
  async function downloadKey() {
    let response;
    try {
      response = await fetchImpl('https://api.ukrainealarm.com/webhook-public.pem', {
        redirect:'error', signal:AbortSignal.timeout(config.timeoutMs),
      });
    } catch { throw new AdminError(502, 'WEBHOOK_KEY_UNAVAILABLE'); }
    if (!response.ok) {
      const challenged = response.headers.get('cf-mitigated') === 'challenge';
      await response.body?.cancel();
      if (challenged) throw new AdminError(502, 'WEBHOOK_KEY_CLOUDFLARE_CHALLENGE');
      throw new AdminError(502, `WEBHOOK_KEY_HTTP_${response.status}`);
    }
    let pem;
    try {
      pem = await limitedText(response, 32768);
      parseKey(pem);
    } catch { throw new AdminError(502, 'WEBHOOK_KEY_INVALID'); }
    await installKey(pem);
  }
  async function checkEndpoint() {
    const target = urls().webhookUrl;
    if (!target) throw new AdminError(400, 'WEBHOOK_URL_NOT_CONFIGURED');
    const started = now();
    const probe = {challenge:randomBytes(32).toString('hex'), proof:randomBytes(32).toString('hex'),
      expiresAt:started + config.timeoutMs, received:false};
    pendingProbe = probe;
    let httpStatus = null;
    preflightUrl = target;
    monitor?.record('info', 'settings', 'WEBHOOK_CHECK_STARTED', 'Перевіряємо HTTPS, публічний маршрут, токен і доставку POST до цього сервера.');
    try {
      let response;
      try {
        response = await fetchImpl(target, {method:'POST', redirect:'manual', signal:AbortSignal.timeout(config.timeoutMs),
          headers:{'Content-Type':'application/json', 'X-AlarmMini-Probe':probe.challenge},
          body:JSON.stringify({alarmminiProbe:probe.challenge})});
      } catch { throw new AdminError(502, 'WEBHOOK_CHECK_UNREACHABLE'); }
      httpStatus = response.status;
      if (response.status !== 200) {
        const challenged = response.headers.get('cf-mitigated') === 'challenge';
        await response.body?.cancel();
        if (challenged) throw new AdminError(502, 'WEBHOOK_CHECK_CLOUDFLARE_CHALLENGE');
        if (response.status >= 300 && response.status < 400) throw new AdminError(502, 'WEBHOOK_CHECK_REDIRECT');
        throw new AdminError(502, `WEBHOOK_CHECK_HTTP_${response.status}`);
      }
      let reply;
      try { reply = JSON.parse(await limitedText(response, 4096)); }
      catch { throw new AdminError(502, 'WEBHOOK_CHECK_WRONG_SERVER'); }
      // A remote echo server cannot pass: our actual receiver must consume the one-time probe.
      if (!probe.received || reply?.alarmminiProbe !== probe.proof) throw new AdminError(502, 'WEBHOOK_CHECK_WRONG_SERVER');
      preflight = {at:new Date(now()).toISOString(), ok:true, code:'WEBHOOK_CHECK_OK', httpStatus, durationMs:now() - started};
      succeeded('WEBHOOK_CHECK_OK', 'Перевірочний POST із токеном дійшов через публічну HTTPS-адресу до цього сервера.');
    } catch (error) {
      preflight = {at:new Date(now()).toISOString(), ok:false, code:error.code || 'WEBHOOK_CHECK_UNREACHABLE', httpStatus, durationMs:now() - started};
      throw error;
    } finally { pendingProbe = null; }
  }
  return {
    view, getPublicKey:() => publicKey,
    acceptProbe(challenge, body) {
      const probe = pendingProbe;
      if (!probe || probe.received || now() >= probe.expiresAt || typeof challenge !== 'string' ||
          !secureEqual(challenge, probe.challenge) || !body.equals(Buffer.from(JSON.stringify({alarmminiProbe:probe.challenge})))) return null;
      probe.received = true;
      return {alarmminiProbe:probe.proof};
    },
    checkWebhook() { return locked(async () => { await checkEndpoint(); return view(); }); },
    importKey(pem) { return locked(async () => { await installKey(pem, 'WEBHOOK_KEY_IMPORTED'); return view(); }); },
    save(publicBaseUrl) {
      return locked(async () => {
        let normalized;
        try { normalized = normalizePublicUrl(publicBaseUrl); }
        catch { throw new AdminError(400, 'INVALID_PUBLIC_URL'); }
        if (!normalized) throw new AdminError(400, 'INVALID_PUBLIC_URL');
        const next = {...settings, publicBaseUrl:normalized};
        await atomicWrite(config.settingsFile, JSON.stringify(next, null, 2) + '\n');
        settings = next;
        preflight = null; preflightUrl = '';
        succeeded('SETTINGS_SAVED', 'Публічну адресу сервера збережено.');
        return view();
      });
    },
    updateKey() { return locked(async () => { await downloadKey(); return view(); }); },
    manageWebhook(action) {
      return locked(async () => {
        const method = new Map([['register','POST'], ['update','PATCH'], ['remove','DELETE']]).get(action);
        if (!method) throw new AdminError(400, 'INVALID_WEBHOOK_ACTION');
        const current = urls().webhookUrl;
        const target = action === 'remove' ? settings.registration?.url || current : current;
        if (!target) throw new AdminError(400, 'WEBHOOK_URL_NOT_CONFIGURED');
        if (action !== 'remove') {
          await checkEndpoint();
          if (!publicKey) await downloadKey();
        }
        let response;
        try {
          response = await fetchImpl(`${config.apiBaseUrl}/webhook`, {
            method, headers:{Authorization:config.apiToken, 'Content-Type':'application/json', Accept:'application/json'},
            body:JSON.stringify({webHookUrl:target}), redirect:'error', signal:AbortSignal.timeout(config.timeoutMs),
          });
        } catch { throw new AdminError(502, 'WEBHOOK_UPSTREAM_UNAVAILABLE'); }
        if (!response.ok) {
          await response.body?.cancel();
          throw new AdminError(502, `WEBHOOK_UPSTREAM_HTTP_${response.status}`);
        }
        await response.body?.cancel();
        settings = {...settings, registration:{action, url:target, active:action !== 'remove', at:new Date(now()).toISOString(), httpStatus:response.status}};
        try { await atomicWrite(config.settingsFile, JSON.stringify(settings, null, 2) + '\n'); }
        catch { throw new AdminError(500, 'WEBHOOK_ACCEPTED_BUT_NOT_SAVED'); }
        succeeded(`WEBHOOK_${action.toUpperCase()}`, `UkraineAlarm підтвердив дію «${{register:'зареєструвати', update:'оновити', remove:'відписатися'}[action]}»: HTTP ${response.status}.`);
        return view();
      });
    },
  };
}
