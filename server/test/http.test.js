import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createService } from '../src/service.js';
import { createHttpServer } from '../src/http.js';

const silent = { info() {}, warn() {}, error() {} };
const config = () => ({...loadConfig({UKRAINEALARM_API_TOKEN:'test-upstream-token', WEBHOOK_TOKEN:'test-webhook-token'}), minRefreshMs:0});
const keys = generateKeyPairSync('rsa', {modulusLength:2048, publicKeyEncoding:{type:'spki',format:'pem'}, privateKeyEncoding:{type:'pkcs8',format:'pem'}});
async function listen(t, server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('HTTP fallback reads independently of MQTT, enforces auth and never returns stale arrays as 200', async t => {
  let time = 1000000;
  const cfg = {...config(), httpToken:'device-token'};
  const service = createService(cfg, {now:()=>time, log:silent, fetchImpl:async url => new Response(JSON.stringify(
    url.endsWith('/regions') ? {states:[{regionId:'14'}]} : [{regionId:'711',activeAlerts:[{type:'AIR',activeAlertLevels:[{alertLevel:'Yellow'}]}]}]
  ))});
  t.after(() => service.stop());
  const base = await listen(t, createHttpServer(service, cfg));
  const headers = {Authorization:'Bearer device-token'};
  assert.equal((await fetch(`${base}/alerts`)).status, 401);
  assert.equal((await fetch(`${base}/alerts`, {headers})).status, 503);
  await service.refresh();
  const response = await fetch(`${base}/alerts`, {headers});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-encoding'), null);
  const text = await response.text();
  assert.ok(Buffer.byteLength(text) <= 256);
  const states = JSON.parse(text);
  assert.equal(states.length, 25);
  assert.equal(states[8], 5);
  assert.ok(states.every(n => Number.isInteger(n) && n >= 0 && n <= 5));
  const detail = await (await fetch(`${base}/api/status`, {headers})).text();
  assert.ok(!detail.includes('test-upstream-token'));
  assert.equal((await fetch(`${base}/health`)).status, 200);
  time += cfg.staleMs;
  assert.equal((await fetch(`${base}/alerts`, {headers})).status, 503);
  assert.equal((await fetch(`${base}/health`)).status, 503);
  const status = await (await fetch(`${base}/api/status`, {headers})).json();
  assert.equal(status.fresh, false);
  assert.equal(status.states[8], 5);
  assert.equal((await fetch(`${base}/missing`)).status, 404);
  assert.equal((await fetch(`${base}/alerts`, {method:'POST', headers})).status, 405);
});

test('webhook verifies original bytes and timestamp, deduplicates, and requests a full refresh', async t => {
  const time = 1788850000000;
  let refreshes = 0;
  const service = { requestRefresh:()=>refreshes++ };
  const base = await listen(t, createHttpServer(service, config(), {publicKeyPem:keys.publicKey, now:()=>time}));
  const event = '{ "status": "DEACTIVATE", "regionId": 14, "alarmType": "AIR", "activeAlertLevels": [{"alertLevel":"Yellow"}] }';
  function headersFor(body, timestamp = String(time / 1000)) {
    return {
      'Content-Type':'application/json', 'X-Webhook-Timestamp':timestamp,
      'X-Webhook-Signature-Alg':'rsa-sha256',
      'X-Webhook-Signature':sign('RSA-SHA256', Buffer.from(`${timestamp}.${body}`), keys.privateKey).toString('base64'),
    };
  }
  const headers = headersFor(event);
  const post = (body, requestHeaders = headers) => fetch(`${base}/public/webhook/?token=test-webhook-token`, {method:'POST', body, headers:requestHeaders});
  assert.equal((await post(event)).status, 202);
  assert.equal(refreshes, 1);
  const duplicate = await post(event);
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(refreshes, 1);
  assert.equal((await post(event.replace('Yellow', 'Red'))).status, 401);
  assert.equal((await post(event, headersFor(event, String(time / 1000 - 301)))).status, 401);
  assert.equal((await post(event, headersFor(event, String(time / 1000 + 301)))).status, 401);
  assert.equal((await post(event, {...headers, 'X-Webhook-Signature-Alg':'hmac-sha256'})).status, 401);
  assert.equal((await post('invalid json', headersFor('invalid json'))).status, 400);
  assert.equal((await post('x'.repeat(65537), headersFor('x'.repeat(65537)))).status, 413);
  assert.equal(refreshes, 1);
});

test('webhook is disabled until a public verification key is configured', async t => {
  const base = await listen(t, createHttpServer({}, config()));
  assert.equal((await fetch(`${base}/public/webhook?token=test-webhook-token`, {method:'POST', body:'{}'})).status, 503);
});
