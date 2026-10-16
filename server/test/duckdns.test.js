import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { setImmediate as settle } from 'node:timers/promises';
import { createDuckDns } from '../src/duckdns.js';
import { createMonitor } from '../src/monitor.js';
import { loadConfig } from '../src/config.js';

const token = '00000000-0000-4000-8000-000000000001';
const input = {enabled:false, domain:'alarm-test', token, ipv4:'', intervalMinutes:5};
async function fixture(t, overrides = {}, dependencies = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'alarmmini-duckdns-test-'));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('alarmmini-duckdns-test-'));
    await rm(directory, {recursive:true, force:true});
  });
  const config = {...loadConfig({UKRAINEALARM_API_TOKEN:'test-api-token', SETTINGS_FILE:join(directory, 'settings.json')}), duckDns:{...input, ...overrides}};
  const monitor = createMonitor({log:{}});
  const requests = [];
  const options = {monitor, resolve4Impl:async () => ['8.8.4.4'], fetchImpl:async (url, options) => {
    requests.push({url, options});
    const parsed = new URL(url);
    if (parsed.hostname === 'api.ipify.org') return new Response('8.8.8.8\n');
    assert.equal(parsed.origin, 'https://www.duckdns.org');
    return new Response(`OK\n${parsed.searchParams.get('ip')}\n\nUPDATED\n`);
  }, ...dependencies};
  const client = createDuckDns(config, options);
  t.after(() => client.stop());
  return {client, config, options, requests, directory, monitor};
}

test('read-only check detects changed IP without submitting the token; update validates the DuckDNS response', async t => {
  const f = await fixture(t);
  const result = await f.client.run('check');
  assert.equal(result.needsUpdate, true);
  assert.deepEqual(result.dnsIps, ['8.8.4.4']);
  assert.equal(result.expectedIp, '8.8.8.8');
  assert.equal(result.lastSuccessAt, null);
  assert.equal(f.requests.length, 1);
  assert.ok(!JSON.stringify(f.requests).includes(token));
  const updated = await f.client.run('update');
  const call = f.requests.at(-1);
  assert.deepEqual(Object.fromEntries(new URL(call.url).searchParams), {domains:'alarm-test', token, ip:'8.8.8.8', verbose:'true'});
  assert.equal(call.options.redirect, 'error');
  assert.equal(call.options.headers, undefined, 'no unrelated API authorization is sent');
  assert.equal(updated.result, 'updated');
  assert.ok(updated.lastUpdatedAt);
  assert.equal(updated.needsUpdate, null, 'accepted API update is not a DNS propagation check');
  assert.deepEqual(updated.dnsIps, ['8.8.4.4']);
  assert.ok(!JSON.stringify([updated, f.monitor.view()]).includes(token));
  await f.client.save({...input, intervalMinutes:10});
  assert.equal(f.client.view().lastUpdatedAt, updated.lastUpdatedAt, 'changing the schedule preserves update history');
});

test('matching DNS is left untouched automatically; explicit update checks access and accepts NOCHANGE', async t => {
  const f = await fixture(t, {ipv4:'8.8.8.8'}, {
    resolve4Impl:async () => ['8.8.8.8'],
    fetchImpl:async () => new Response('OK\n8.8.8.8\n2001:db8::1\nNOCHANGE\n'),
  });
  assert.equal((await f.client.run('auto')).result, 'matched');
  assert.equal(f.client.view().lastSuccessAt, null);
  const result = await f.client.run('update');
  assert.equal(result.result, 'unchanged');
  assert.equal(result.lastUpdatedAt, null);
  assert.ok(result.lastSuccessAt);
});

test('settings normalize a full domain, persist privately, preserve a blank token and explicitly remove it', async t => {
  const f = await fixture(t, {token:''});
  let result = await f.client.save({...input, domain:' ALARM-TEST.duckdns.org ', ipv4:'8.8.8.8'});
  assert.equal(result.domain, 'alarm-test');
  assert.equal(result.tokenConfigured, true);
  assert.equal(Object.hasOwn(result, 'token'), false);
  const path = join(f.directory, 'duckdns.json');
  assert.equal(JSON.parse(await readFile(path, 'utf8')).token, token);
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
  await f.client.save({...input, token:'', intervalMinutes:10});
  const restarted = createDuckDns(f.config, f.options);
  t.after(() => restarted.stop());
  assert.equal(restarted.view().tokenConfigured, true);
  assert.equal(restarted.view().intervalMinutes, 10);
  await f.client.save({...input, token:'', clearToken:true});
  assert.equal(f.client.view().tokenConfigured, false);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).token, '');
});

test('validation rejects foreign domains, injected token parameters, private IPs and invalid intervals before saving', async t => {
  const f = await fixture(t);
  for (const patch of [
    {domain:'alarm.example.com'}, {domain:'https://alarm-test.duckdns.org'}, {domain:'one,two'},
    {domain:'-bad'}, {domain:'a'.repeat(64)}, {token:'secret&clear=true'}, {token:'\ninvalid'},
    {ipv4:'192.168.1.10'}, {ipv4:'127.0.0.1'}, {ipv4:'100.64.0.1'}, {ipv4:'::1'},
    {intervalMinutes:0}, {intervalMinutes:1441}, {intervalMinutes:1.5}, {enabled:'true'},
    {enabled:true, token:'', clearToken:true},
  ]) await assert.rejects(f.client.save({...input, ...patch}), error => error.status === 400);
  assert.equal(f.requests.length, 0);
  assert.equal(f.client.view().domain, input.domain);
});

test('upstream errors, oversized replies and malformed OK never claim success or reveal the token', async t => {
  for (const [respond, code] of [
    [() => new Response('KO'), 'DUCKDNS_REJECTED'],
    [() => new Response('OK'), 'DUCKDNS_INVALID_RESPONSE'],
    [() => new Response('OK\n8.8.4.4\n\nUPDATED'), 'DUCKDNS_INVALID_RESPONSE'],
    [() => new Response('OK\n8.8.8.8\n\nBROKEN'), 'DUCKDNS_INVALID_RESPONSE'],
    [() => new Response('x'.repeat(2048)), 'DUCKDNS_UPDATE_UNAVAILABLE'],
    [() => new Response(token, {status:503}), 'DUCKDNS_UPDATE_HTTP_503'],
    [() => { throw new Error(`request failed token=${token}`); }, 'DUCKDNS_UPDATE_UNAVAILABLE'],
  ]) {
    const f = await fixture(t, {ipv4:'8.8.8.8'}, {fetchImpl:async () => respond()});
    await assert.rejects(f.client.run('update'), error => error.code === code && !error.message.includes(token));
    assert.equal(f.client.view().lastSuccessAt, null);
    assert.equal(f.client.view().lastUpdatedAt, null);
    assert.equal(f.client.view().busy, false);
    assert.ok(!JSON.stringify([f.client.view(), f.monitor.view()]).includes(token));
  }
});

test('failure to determine public IP or resolve DNS does not send an update', async t => {
  const invalidIp = await fixture(t, {}, {fetchImpl:async () => new Response('192.168.1.2')});
  await assert.rejects(invalidIp.client.run('auto'), {code:'DUCKDNS_IP_INVALID_RESPONSE'});
  const unavailable = await fixture(t, {ipv4:'8.8.8.8'}, {resolve4Impl:async () => { throw Object.assign(new Error(), {code:'ETIMEOUT'}); }});
  await assert.rejects(unavailable.client.run('auto'), {code:'DUCKDNS_DNS_UNAVAILABLE'});
  assert.equal(unavailable.requests.length, 0);
  const missing = await fixture(t, {ipv4:'8.8.8.8'}, {resolve4Impl:async () => { throw Object.assign(new Error(), {code:'ENODATA'}); }});
  assert.equal((await missing.client.run('auto')).result, 'updated');
});

test('concurrent checks and settings edits are rejected while an operation is pending', async t => {
  let release;
  const f = await fixture(t, {}, {fetchImpl:() => new Promise(resolve => { release = resolve; })});
  const pending = f.client.run('check');
  assert.equal(f.client.view().busy, true);
  await assert.rejects(f.client.run('update'), {code:'DUCKDNS_BUSY'});
  await assert.rejects(f.client.save(input), {code:'DUCKDNS_BUSY'});
  release(new Response('8.8.8.8'));
  await pending;
  assert.equal(f.client.view().busy, false);
});

test('automatic checks run on startup and at the configured interval, then stop when disabled', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f = await fixture(t, {enabled:true, ipv4:'8.8.8.8'});
  f.client.start(); f.client.start();
  t.mock.timers.tick(0); await settle();
  assert.equal(f.requests.length, 1);
  assert.ok(f.client.view().nextCheckAt);
  t.mock.timers.tick(299999); await settle();
  assert.equal(f.requests.length, 1);
  t.mock.timers.tick(1); await settle();
  assert.equal(f.requests.length, 2);
  await f.client.save({...input, ipv4:'8.8.8.8', enabled:false});
  t.mock.timers.tick(600000); await settle();
  assert.equal(f.requests.length, 2);
  assert.equal(f.client.view().nextCheckAt, null);
});

test('disabled startup makes no requests; a failed write preserves prior settings', async t => {
  const f = await fixture(t);
  f.client.start(); await settle();
  assert.equal(f.requests.length, 0);
  const blocked = join(f.directory, 'blocked');
  const other = createDuckDns({...f.config, settingsFile:join(blocked, 'nested', 'settings.json')}, f.options);
  t.after(() => other.stop());
  await writeFile(blocked, 'not a directory');
  await assert.rejects(other.save({...input, domain:'new-domain'}), {code:'DUCKDNS_WRITE_FAILED'});
  assert.equal(other.view().domain, input.domain);
});

test('a request timeout is reported safely and shutdown cancels an in-flight request', async t => {
  const f = await fixture(t, {ipv4:'8.8.8.8'}, {fetchImpl:async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error(`aborted ${url}`)), {once:true});
  })});
  const pending = f.client.run('update');
  await settle(); f.client.stop();
  await assert.rejects(pending, {code:'DUCKDNS_UPDATE_UNAVAILABLE'});
  assert.equal(f.client.view().lastSuccessAt, null);
  assert.equal(f.client.view().nextCheckAt, null);
  assert.ok(!JSON.stringify(f.monitor.view()).includes(token));
  const timed = createDuckDns({...f.config, timeoutMs:10}, f.options);
  t.after(() => timed.stop());
  const timeout = assert.rejects(timed.run('update'), {code:'DUCKDNS_UPDATE_UNAVAILABLE'});
  // Keep the test alive while AbortSignal's unref'ed timeout expires.
  await new Promise(resolve => setTimeout(resolve, 30));
  await timeout;
});
