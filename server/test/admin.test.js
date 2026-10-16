import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createHttpServer } from '../src/http.js';
import { createSettings } from '../src/settings.js';
import { createAdminAuth, isLocalRequest } from '../src/admin.js';
import { createMonitor } from '../src/monitor.js';

const keys = generateKeyPairSync('rsa', {modulusLength:2048, publicKeyEncoding:{type:'spki',format:'pem'}, privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const state = {fresh:true, states:[0,1,2,3,4,5,...Array(19).fill(0)], mqtt:'disabled', updatedAt:'2026-09-08T12:00:00Z', regions:[]};
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'alarmmini-admin-test-'));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('alarmmini-admin-test-'));
    await rm(directory, {recursive:true, force:true});
  });
  let time = 1788868800000;
  let refreshes = 0;
  let upstreamStatus = 200;
  let endpointHandler = null;
  const requests = [];
  const config = loadConfig({
    UKRAINEALARM_API_TOKEN:'upstream-secret-only', ADMIN_USERNAME:'operator', ADMIN_PASSWORD:'admin-secret-only',
    PUBLIC_STATUS_TOKEN:'state+token&test', WEBHOOK_TOKEN:'hook+token&test', SETTINGS_FILE:join(directory,'settings.json'),
  });
  const options = {now:()=>time, resolve4Impl:async () => ['8.8.8.8'], monitor:createMonitor({now:()=>time, log:{info(){}, warn(){}, error(){}}}), fetchImpl:async (url, request = {}) => {
    requests.push({url, ...request});
    const parsed = new URL(url);
    if (parsed.pathname === '/public/webhook') {
      if (endpointHandler) return endpointHandler(url, request);
      return fetch(`${base}${parsed.pathname}${parsed.search}`, request);
    }
    if (url.endsWith('/webhook-public.pem')) return new Response(keys.publicKey);
    return new Response('{}', {status:upstreamStatus});
  }};
  const settings = createSettings(config, options);
  const server = createHttpServer({status:()=>state, requestRefresh:()=>refreshes++}, config, {...options, settings});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function login() {
    const response = await fetch(`${base}/admin/api/login`, {method:'POST', headers:{'Content-Type':'application/json', Origin:base}, body:JSON.stringify({username:'operator',password:'admin-secret-only'})});
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
    const session = await response.json();
    return {Cookie:cookie.split(';')[0], 'X-CSRF-Token':session.csrf, Origin:base, 'Content-Type':'application/json'};
  }
  return {base, config, settings, requests, directory, options, login,
    setEndpoint:handler=>{endpointHandler=handler;},
    setStatus:status=>{upstreamStatus=status;}, advance:ms=>{time+=ms;}, getTime:()=>time, refreshes:()=>refreshes};
}

test('admin login, session expiry, logout and CSRF checks protect settings and upstream credentials', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.base}/admin`)).status, 200);
  assert.equal((await fetch(`${f.base}/admin/api/settings`)).status, 401);
  const request = {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:'operator',password:'wrong'})};
  assert.equal((await fetch(`${f.base}/admin/api/login`, request)).status, 401);
  assert.equal((await fetch(`${f.base}/admin/api/login`, {...request, headers:{...request.headers, Origin:'https://foreign.example'}})).status, 403);
  const headers = await f.login();
  const body = JSON.stringify({publicBaseUrl:'https://alarm.example.com'});
  assert.equal((await fetch(`${f.base}/admin/api/settings`, {method:'PUT', headers:{...headers, 'X-CSRF-Token':''}, body})).status, 403);
  assert.equal((await fetch(`${f.base}/admin/api/settings`, {method:'PUT', headers, body})).status, 200);
  const details = await (await fetch(`${f.base}/admin/api/settings`, {headers})).text();
  assert.ok(!details.includes('upstream-secret-only'));
  assert.ok(!details.includes('admin-secret-only'));
  assert.equal((await fetch(`${f.base}/admin/api/logout`, {method:'POST', headers})).status, 200);
  assert.equal((await fetch(`${f.base}/admin/api/session`, {headers})).status, 401);
  const nextHeaders = await f.login();
  f.advance(8 * 60 * 60 * 1000 + 1);
  assert.equal((await fetch(`${f.base}/admin/api/session`, {headers:nextHeaders})).status, 401);
});

test('DuckDNS is local and authenticated, requires CSRF and never returns its saved token', async t => {
  const f = await fixture(t);
  const path = `${f.base}/admin/api/duckdns`;
  assert.equal((await fetch(path)).status, 401);
  const headers = await f.login();
  const token = '00000000-0000-4000-8000-000000000001';
  const body = JSON.stringify({enabled:false, domain:'alarm-test', token, ipv4:'8.8.8.8', intervalMinutes:5});
  assert.equal((await fetch(path, {method:'PUT', headers:{...headers, 'X-CSRF-Token':''}, body})).status, 403);
  assert.equal((await fetch(path, {method:'PUT', headers:{...headers, Origin:'https://foreign.example'}, body})).status, 403);
  const saved = await fetch(path, {method:'PUT', headers, body});
  assert.equal(saved.status, 200);
  assert.ok(!(await saved.text()).includes(token));
  const checked = await fetch(`${path}/check`, {method:'POST', headers});
  assert.equal(checked.status, 200);
  assert.equal((await checked.json()).result, 'matched');
  assert.equal(f.requests.length, 0, 'manual IP check never calls the update API');
  for (const endpoint of ['', '/check', '/update']) {
    assert.equal((await fetch(path + endpoint, {method:endpoint ? 'POST' : 'GET', headers:{...headers, 'CF-Connecting-IP':'203.0.113.5'}})).status, 404);
  }
  assert.equal((await fetch(`${path}/update`, {method:'GET', headers})).status, 405);
  assert.equal((await fetch(`${path}/update`, {method:'POST', headers:{...headers, 'X-CSRF-Token':''}})).status, 403);
  assert.ok(!(await (await fetch(path, {headers})).text()).includes(token));
  assert.ok(!(await (await fetch(`${f.base}/admin/api/diagnostics`, {headers})).text()).includes(token));
});

test('clear journal requires local session, same-origin POST and CSRF; status and counters survive', async t => {
  const f = await fixture(t), endpoint = `${f.base}/admin/api/logs/clear`;
  f.options.monitor.receivedWebhook('accepted');
  assert.equal((await fetch(endpoint, {method:'POST'})).status, 401);
  const headers = await f.login();
  assert.equal((await fetch(endpoint, {method:'GET', headers})).status, 405);
  assert.equal((await fetch(endpoint, {method:'POST', headers:{...headers, 'X-CSRF-Token':''}})).status, 403);
  assert.equal((await fetch(endpoint, {method:'POST', headers:{...headers, Origin:'https://foreign.example'}})).status, 403);
  assert.equal((await fetch(endpoint, {method:'POST', headers:{...headers, 'CF-Connecting-IP':'203.0.113.8'}})).status, 404);
  assert.equal(f.options.monitor.view().events.length, 1);
  const result = await fetch(endpoint, {method:'POST', headers});
  assert.equal(result.status, 200); assert.deepEqual((await result.json()).events, []);
  const data = await (await fetch(`${f.base}/admin/api/diagnostics`, {headers})).json();
  assert.equal(data.webhook.accepted, 1); assert.deepEqual(data.state.states, state.states);
  assert.equal(data.logGeneration, 1); assert.ok(data.resources); assert.equal(f.requests.length, 0);
  for (const file of ['map.svg', 'theme.js']) {
    assert.equal((await fetch(`${f.base}/admin/${file}`)).status, 200);
    assert.equal((await fetch(`${f.base}/admin/${file}`, {headers:{...headers, 'CF-Connecting-IP':'203.0.113.8'}})).status, 404);
  }
});

test('public status accepts header OR escaped URL token, and Cloudflare cannot reach local admin routes', async t => {
  const f = await fixture(t);
  const tunnel = {Host:'alarm.example.com', 'CF-Connecting-IP':'203.0.113.5'};
  assert.equal((await fetch(`${f.base}/public/status`, {headers:tunnel})).status, 401);
  const response = await fetch(`${f.base}/public/status`, {headers:{...tunnel, Authorization:`Bearer ${f.config.publicStatusToken}`}});
  assert.deepEqual(await response.json(), state.states);
  const query = `?token=${encodeURIComponent(f.config.publicStatusToken)}`;
  assert.equal((await fetch(`${f.base}/public/status${query}`, {headers:tunnel})).status, 200);
  assert.equal((await fetch(`${f.base}/public/status${query}&token=wrong`, {headers:tunnel})).status, 401);
  assert.equal((await fetch(`${f.base}/public/status${query}`, {headers:{...tunnel, Authorization:'Bearer wrong'}})).status, 401);
  const login = await f.login();
  for (const path of ['/', '/admin', '/admin/app.js', '/admin/api/settings', '/health', '/api/status', '/public/../admin']) {
    assert.equal((await fetch(`${f.base}${path}`, {headers:{...login, ...tunnel}, redirect:'manual'})).status, 404, path);
  }
  assert.equal((await fetch(`${f.base}/admin`, {headers:{'CF-Connecting-IP':'203.0.113.5'}})).status, 404, 'even when a proxy preserves a private Host');
});

test('registration form persists settings and sends exact POST/PATCH/DELETE requests to UkraineAlarm', async t => {
  const f = await fixture(t);
  const headers = await f.login();
  const call = (path, method, data) => fetch(`${f.base}/admin/api/${path}`, {method, headers, body:JSON.stringify(data)});
  for (const value of ['http://alarm.example.com', 'https://alarm.example.com/public', 'https://user:pass@alarm.example.com', 'https://alarm.example.com?token=x']) {
    assert.equal((await call('settings','PUT',{publicBaseUrl:value})).status, 400);
  }
  const saved = await call('settings','PUT',{publicBaseUrl:'https://alarm.example.com/'});
  assert.equal((await saved.json()).publicBaseUrl, 'https://alarm.example.com');
  const registered = await call('webhook','POST',{action:'register'});
  assert.equal(registered.status, 200);
  const details = await registered.json();
  assert.equal(details.signatureReady, true);
  assert.equal(details.busy, false);
  assert.equal(details.registrationMatches, true);
  assert.equal(f.requests.length, 3, 'checks the real receiver, downloads a key, then registers');
  assert.equal(new URL(f.requests[0].url).pathname, '/public/webhook');
  assert.equal(f.requests[0].method, 'POST');
  assert.equal(f.requests[0].redirect, 'manual');
  assert.equal(f.requests[0].headers.Authorization, undefined, 'never sends the UkraineAlarm API token to the public receiver');
  assert.equal(f.requests[1].headers?.Authorization, undefined, 'does not send API token to key download');
  assert.equal(f.requests[2].url, 'https://api.ukrainealarm.com/api/v3/webhook');
  assert.equal(f.requests[2].method, 'POST');
  assert.equal(f.requests[2].headers.Authorization, 'upstream-secret-only');
  const registeredUrl = `https://alarm.example.com/public/webhook?token=${encodeURIComponent(f.config.webhookToken)}`;
  assert.deepEqual(JSON.parse(f.requests[2].body), {webHookUrl:registeredUrl});
  await call('settings','PUT',{publicBaseUrl:'https://next.example.com'});
  assert.equal(f.settings.view().registrationMatches, false);
  await call('webhook','POST',{action:'update'});
  assert.equal(f.requests.at(-1).method, 'PATCH');
  const updatedUrl = JSON.parse(f.requests.at(-1).body).webHookUrl;
  await call('settings','PUT',{publicBaseUrl:'https://third.example.com'});
  await call('webhook','POST',{action:'remove'});
  assert.equal(f.requests.at(-1).method, 'DELETE');
  assert.equal(JSON.parse(f.requests.at(-1).body).webHookUrl, updatedUrl, 'removes the registered URL even after editing the form');
  assert.equal((await call('webhook','POST',{action:'constructor'})).status, 400);
  const reloaded = createSettings(f.config, f.options);
  assert.equal(reloaded.view().publicBaseUrl, 'https://third.example.com');
  assert.equal(reloaded.view().registration.active, false);
  assert.equal(reloaded.view().signatureReady, true);
  const disk = await readFile(f.config.settingsFile, 'utf8');
  assert.ok(!disk.includes('admin-secret-only') && !disk.includes('upstream-secret-only'));
  f.setStatus(401);
  assert.equal((await call('webhook','POST',{action:'register'})).status, 502);
  assert.equal(f.settings.view().registration.active, false, 'failed upstream call must not pretend to register');
});

test('downloaded verification key becomes effective immediately; webhook requires token AND signature', async t => {
  const f = await fixture(t);
  await f.settings.updateKey();
  const body = JSON.stringify({status:'DEACTIVATE', regionId:14, alarmType:'AIR', activeAlertLevels:[{alertLevel:'Yellow'}]});
  const timestamp = String(f.getTime() / 1000);
  const headers = {'Content-Type':'application/json', 'X-Webhook-Timestamp':timestamp,
    'X-Webhook-Signature':sign('RSA-SHA256', Buffer.from(`${timestamp}.${body}`), keys.privateKey).toString('base64')};
  assert.equal((await fetch(`${f.base}/public/webhook`, {method:'POST',headers,body})).status, 401);
  const target = `${f.base}/public/webhook?token=${encodeURIComponent(f.config.webhookToken)}`;
  assert.equal((await fetch(target, {method:'POST',body})).status, 401);
  assert.equal((await fetch(target, {method:'POST',headers,body})).status, 202);
  assert.equal(f.refreshes(), 1);
  assert.equal((await fetch(target, {method:'POST',headers,body})).status, 200);
  assert.equal((await fetch(`${f.base}/admin/api/diagnostics`)).status, 401);
  const adminHeaders = await f.login();
  assert.equal((await fetch(`${f.base}/admin/api/diagnostics`, {headers:{...adminHeaders, 'CF-Connecting-IP':'203.0.113.1'}})).status, 404);
  const diagnostics = await (await fetch(`${f.base}/admin/api/diagnostics`, {headers:adminHeaders})).json();
  assert.deepEqual([diagnostics.webhook.received, diagnostics.webhook.accepted, diagnostics.webhook.rejected, diagnostics.webhook.duplicates], [4,1,2,1]);
  assert.equal(diagnostics.webhook.lastAcceptedAt, new Date(f.getTime()).toISOString());
  assert.ok(diagnostics.events.some(e => e.code === 'WEBHOOK_KEY_UPDATED'));
  assert.ok(diagnostics.events.some(e => e.code === 'INVALID_SIGNATURE'));
  const serialized = JSON.stringify(diagnostics);
  for (const secret of ['upstream-secret-only', 'admin-secret-only', f.config.webhookToken, f.config.publicStatusToken, headers['X-Webhook-Signature']]) assert.ok(!serialized.includes(secret));
  assert.ok(!serialized.includes('activeAlertLevels'), 'webhook bodies never enter the journal');
});

test('key failures identify HTTP, invalid content and filesystem errors while keeping a working key', async t => {
  const f = await fixture(t);
  for (const [fetchImpl, expected] of [
    [async()=>new Response('Challenge', {status:403, headers:{'cf-mitigated':'challenge'}}), 'WEBHOOK_KEY_CLOUDFLARE_CHALLENGE'],
    [async()=>new Response('Forbidden', {status:403}), 'WEBHOOK_KEY_HTTP_403'],
    [async()=>new Response('<html>not a key</html>'), 'WEBHOOK_KEY_INVALID'],
    [async()=>{throw new Error('private detail token=secret');}, 'WEBHOOK_KEY_UNAVAILABLE'],
  ]) {
    const settings = createSettings(f.config, {...f.options, publicKeyPem:keys.publicKey, fetchImpl});
    await assert.rejects(settings.updateKey(), error => error.code === expected);
    assert.equal(settings.view().signatureReady, true);
    assert.equal(settings.view().lastOperation.code, expected);
  }
  const settings = createSettings({...f.config, webhookKeyFile:f.directory}, {...f.options, publicKeyPem:keys.publicKey});
  await assert.rejects(settings.updateKey(), error=>error.code === 'WEBHOOK_KEY_WRITE_FAILED');
  assert.equal(settings.view().signatureReady, true);
  assert.ok(!JSON.stringify(f.options.monitor.view()).includes('token=secret'));
});

test('preflight requires an admin session, verifies this receiver without a key, and is never a real webhook', async t => {
  const f = await fixture(t);
  await f.settings.save('https://alarm.example.com');
  assert.equal((await fetch(`${f.base}/admin/api/webhook-check`, {method:'POST'})).status, 401);
  const headers = await f.login();
  assert.equal((await fetch(`${f.base}/admin/api/webhook-check`, {method:'POST', headers:{...headers, 'X-CSRF-Token':''}})).status, 403);
  const response = await fetch(`${f.base}/admin/api/webhook-check`, {method:'POST', headers});
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.preflightMatches, true);
  assert.equal(result.signatureReady, false, 'endpoint test can diagnose routing independently of blocked key download');
  assert.equal(result.registration, null);
  assert.equal(f.refreshes(), 0);
  assert.equal(f.options.monitor.view().webhook.received, 0);
  assert.equal(f.requests.length, 1, 'manual preflight does not contact the registration or key API');
  const recorded = f.requests[0];
  const replay = await fetch(`${f.base}/public/webhook?token=${encodeURIComponent(f.config.webhookToken)}`, {method:'POST',headers:recorded.headers,body:recorded.body});
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).error.code, 'WEBHOOK_PROBE_INVALID');
  assert.equal(f.options.monitor.view().webhook.received, 0);
  assert.ok(!JSON.stringify(f.options.monitor.view()).includes(recorded.headers['X-AlarmMini-Probe']));
  await f.settings.save('https://next.example.com');
  assert.equal(f.settings.view().preflight, null);
});

test('registration and update stop before calling UkraineAlarm when endpoint verification fails', async t => {
  const f = await fixture(t);
  await f.settings.save('https://alarm.example.com');
  await f.settings.manageWebhook('register');
  const registration = f.settings.view().registration;
  for (const [handler, code] of [
    [async()=>new Response('', {status:302, headers:{Location:'https://different.example'}}), 'WEBHOOK_CHECK_REDIRECT'],
    [async()=>new Response('Not found', {status:404}), 'WEBHOOK_CHECK_HTTP_404'],
    [async()=>new Response('Forbidden', {status:403, headers:{'cf-mitigated':'challenge'}}), 'WEBHOOK_CHECK_CLOUDFLARE_CHALLENGE'],
    [async()=>new Response('{}'), 'WEBHOOK_CHECK_WRONG_SERVER'],
    [async(url, request)=>new Response(JSON.stringify({alarmminiProbe:request.headers['X-AlarmMini-Probe']})), 'WEBHOOK_CHECK_WRONG_SERVER'],
    [async()=>new Response('x'.repeat(5000)), 'WEBHOOK_CHECK_WRONG_SERVER'],
    [async()=>{throw new Error('secret-query-token');}, 'WEBHOOK_CHECK_UNREACHABLE'],
  ]) {
    f.setEndpoint(handler);
    for (const action of ['register','update']) {
      const before = f.requests.length;
      await assert.rejects(f.settings.manageWebhook(action), error=>error.code === code);
      assert.equal(f.requests.length, before + 1, 'only the preflight request was sent');
      assert.equal(f.settings.view().preflight.ok, false);
      assert.deepEqual(f.settings.view().registration, registration);
    }
  }
  assert.ok(!JSON.stringify(f.options.monitor.view()).includes('secret-query-token'));
  f.requests.length = 0;
  await f.settings.manageWebhook('remove');
  assert.equal(f.requests.length, 1, 'unsubscribing remains possible even when the endpoint is down');
  assert.equal(f.requests[0].method, 'DELETE');
});

test('a consumed but expired probe and a wrong response proof cannot pass preflight', async t => {
  const f = await fixture(t);
  await f.settings.save('https://alarm.example.com');
  f.setEndpoint(async(url, request) => {
    f.advance(f.config.timeoutMs + 1);
    const proof = f.settings.acceptProbe(request.headers['X-AlarmMini-Probe'], Buffer.from(request.body));
    assert.equal(proof, null);
    return new Response('{}');
  });
  await assert.rejects(f.settings.checkWebhook(), error=>error.code === 'WEBHOOK_CHECK_WRONG_SERVER');
  f.setEndpoint(async(url, request) => {
    const proof = f.settings.acceptProbe(request.headers['X-AlarmMini-Probe'], Buffer.from(request.body));
    assert.ok(proof);
    assert.equal(f.settings.acceptProbe(request.headers['X-AlarmMini-Probe'], Buffer.from(request.body)), null);
    return new Response(JSON.stringify({alarmminiProbe:'incorrect-proof'}));
  });
  await assert.rejects(f.settings.checkWebhook(), error=>error.code === 'WEBHOOK_CHECK_WRONG_SERVER');
});

test('public key import is authenticated, rejects private keys and HTML, and avoids blocked downloads', async t => {
  const f = await fixture(t);
  const body = JSON.stringify({pem:keys.publicKey});
  assert.equal((await fetch(`${f.base}/admin/api/webhook-key`, {method:'PUT',headers:{'Content-Type':'application/json'},body})).status, 401);
  const headers = await f.login();
  const call = pem=>fetch(`${f.base}/admin/api/webhook-key`, {method:'PUT',headers,body:JSON.stringify({pem})});
  assert.equal((await call(keys.privateKey)).status, 400);
  assert.equal((await call('<html>Cloudflare</html>')).status, 400);
  assert.equal(f.settings.view().signatureReady, false);
  const imported = await call(keys.publicKey);
  assert.equal(imported.status, 200);
  const info = await imported.json();
  assert.equal(info.signatureReady, true);
  assert.match(info.keyFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(f.requests.length, 0);
  const currentKey = f.settings.getPublicKey();
  assert.equal((await call('invalid')).status, 400);
  assert.equal(f.settings.getPublicKey(), currentKey);
  await f.settings.save('https://alarm.example.com');
  await f.settings.manageWebhook('register');
  assert.deepEqual(f.requests.map(r=>new URL(r.url).pathname), ['/public/webhook','/api/v3/webhook']);
  assert.equal(createSettings(f.config, f.options).view().keyFingerprint, info.keyFingerprint);
});

test('local access checks use both socket and Host, and login attempts are limited', () => {
  const req = {socket:{remoteAddress:'192.168.2.20'}, headers:{host:'192.168.2.10:3000'}};
  assert.equal(isLocalRequest(req), true);
  assert.equal(isLocalRequest({...req, socket:{remoteAddress:'203.0.113.1'}}), false);
  assert.equal(isLocalRequest({...req, headers:{host:'evil.example'}}), false);
  assert.equal(isLocalRequest({...req, headers:{host:'alarmmini.local:3000'}}, ['alarmmini.local']), true);
  let time = 0;
  const auth = createAdminAuth({adminUser:'operator',adminPassword:'local-test-password'}, () => time);
  for (let i = 0; i < 10; i++) assert.equal(auth.login(req,'operator','bad').code, 401);
  assert.equal(auth.login(req,'operator','local-test-password').code, 429);
  time += 900001;
  assert.equal(auth.login(req,'operator','local-test-password').code, 200);
});

test('missing public token fails closed; configuration does not embed a specific LAN address', async t => {
  const f = await fixture(t);
  const config = {...f.config, publicStatusToken:'', httpToken:'', webhookToken:''};
  const server = createHttpServer({status:()=>state}, config, {settings:f.settings});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/public/status`)).status, 503);
  assert.equal((await fetch(`${base}/public/webhook`, {method:'POST'})).status, 503);
  assert.equal(f.config.host, '0.0.0.0');
  assert.throws(() => loadConfig({UKRAINEALARM_API_TOKEN:'test', ADMIN_USERNAME:'operator'}));
});
