import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { loadConfig } from '../src/config.js';
import { createService } from '../src/service.js';

const silent = { info() {}, warn() {}, error() {} };
const config = () => ({ ...loadConfig({ UKRAINEALARM_API_TOKEN: 'test-upstream-token' }), minRefreshMs: 0 });
const tree = { states: [{ regionId:'14', regionChildIds:[] }] };
const alert = level => [{ regionId:'711', regionType:'Community', activeAlerts:[{ type:'AIR', activeAlertLevels:[{alertLevel:level}] }] }];
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {status, headers});

class FakeMqtt extends EventEmitter {
  connected = false;
  messages = [];
  publish(topic, payload, options, cb) { this.messages.push({topic, payload, ...options}); cb?.(); }
  end(force, options, cb) { this.connected = false; cb?.(); }
}

test('only accepts valid complete responses and preserves the previous snapshot on errors', async t => {
  let time = 1000000;
  let response = json(alert('Yellow'));
  const service = createService(config(), {
    now: () => time, log: silent,
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, 'test-upstream-token');
      assert.equal(options.redirect, 'error');
      return url.endsWith('/regions') ? json(tree) : response;
    },
  });
  t.after(() => service.stop());
  assert.equal(await service.refresh(), true);
  assert.equal(service.status().states[8], 5);
  const updatedAt = service.status().updatedAt;
  response = json({error:'down'}, 500);
  time += 30000;
  assert.equal(await service.refresh(), false);
  assert.equal(service.status().states[8], 5);
  assert.equal(service.status().updatedAt, updatedAt);
  response = json({unexpected:'shape'});
  time += 30000;
  assert.equal(await service.refresh(), false);
  time += 30000;
  assert.equal(service.isFresh(), false);
  response = json([]);
  assert.equal(await service.refresh(), true);
  assert.deepEqual(service.status().states, Array(25).fill(0));
});

test('serializes concurrent requests and respects Retry-After', async t => {
  let time = 1000000;
  let release;
  let calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const service = createService(config(), { now: () => time, log: silent, fetchImpl: async () => { calls++; return pending; } });
  t.after(() => service.stop());
  const first = service.refresh();
  const second = service.refresh();
  assert.equal(calls, 1);
  release(json({}, 429, {'Retry-After':'60'}));
  assert.equal(await first, false);
  assert.equal(await second, false);
  time += 59000;
  assert.equal(await service.refresh(), false);
  assert.equal(calls, 1);
  time += 1000;
  await service.refresh();
  assert.equal(calls, 2);
});

test('refreshes unknown region IDs before publishing; unresolved IDs fail the whole snapshot', async t => {
  let id = '900001';
  const service = createService(config(), { log: silent, fetchImpl: async url => {
    if (url.endsWith('/regions')) return json({states:[{regionId:'14',regionChildIds:[{regionId:'900001'}]}]});
    return json([{regionId:id,activeAlerts:[{type:'AIR',activeAlertLevels:[{alertLevel:'Yellow'}]}]}]);
  } });
  t.after(() => service.stop());
  assert.equal(await service.refresh(), true);
  assert.equal(service.status().states[8], 5);
  id = '900002';
  assert.equal(await service.refresh(), false);
  assert.equal(service.status().states[8], 5);
  assert.equal(service.status().lastError, 'UNKNOWN_REGION');
});

test('diagnostics count accepted refreshes and failures without interpreting a gap as a new alarm', async t => {
  let time = 1000000, alerts = [], fail = false;
  const service = createService(config(), {now:()=>time, log:silent, fetchImpl:async url => {
    if (url.endsWith('/regions')) return json(tree);
    return fail ? json({}, 503) : json(alerts);
  }});
  t.after(()=>service.stop());
  await service.refresh(); time += 30000; alerts = alert('Yellow'); await service.refresh();
  let data = service.diagnostics();
  assert.equal(data.api.successes, 2); assert.equal(data.api.failures, 0);
  assert.equal(data.alerts.regions[8].starts, 1);
  fail = true; time += 30000; await service.refresh();
  assert.equal(service.diagnostics().api.failures, 1);
  time += 90000; fail = false; alerts = []; await service.refresh();
  data = service.diagnostics();
  assert.equal(data.alerts.gaps, 1); assert.equal(data.alerts.regions[8].clears, 0);
  assert.equal(data.api.successes, 3); assert.equal(data.api.failures, 1);
});

test('a slow catalogue refresh does not make an older alert snapshot appear newer', async t => {
  let time = 1000000;
  const service = createService(config(), {now:()=>time, log:silent, fetchImpl:async url => {
    if (url.endsWith('/regions')) {
      time += 10000;
      return json({states:[{regionId:'14',regionChildIds:[{regionId:'900001'}]}]});
    }
    return json([{regionId:'900001',activeAlerts:[{type:'AIR',activeAlertLevels:[{alertLevel:'Yellow'}]}]}]);
  }});
  t.after(() => service.stop());
  await service.refresh();
  assert.equal(service.status().ageSeconds, 10);
});

test('MQTT publishes both formats and heartbeats, reconnects to latest state, and clears stale retained copies', async t => {
  let time = 1000000;
  let fail = false;
  const client = new FakeMqtt();
  const cfg = {...config(), mqttUrl:'mqtt://unused.test'};
  const service = createService(cfg, {
    now: () => time, log: silent,
    connectMqtt: (url, options) => { assert.equal(options.queueQoSZero, false); return client; },
    fetchImpl: async url => url.endsWith('/regions') ? json(tree) : fail ? json({}, 500) : json(alert('Yellow')),
  });
  t.after(() => service.stop());
  service.start();
  await service.refresh();
  assert.equal(client.messages.length, 0);
  client.connected = true;
  client.emit('connect');
  assert.equal(JSON.parse(client.messages.find(m => m.topic === cfg.topics.v2).payload)[8], 5);
  assert.equal(JSON.parse(client.messages.find(m => m.topic === cfg.topics.legacy).payload)[8], 1);
  assert.ok(client.messages.every(m => m.retain && m.qos === 0));
  client.messages = [];
  await service.refresh();
  assert.equal(client.messages.filter(m => m.topic === cfg.topics.v2).length, 1, 'unchanged snapshot is a heartbeat');
  time += cfg.staleMs;
  fail = true;
  client.messages = [];
  await service.refresh();
  assert.deepEqual(client.messages.map(m => m.payload), ['', '', 'stale']);
  client.messages = [];
  client.emit('connect');
  assert.deepEqual(client.messages.map(m => m.payload), ['', '', 'stale']);
  fail = false;
  await service.refresh();
  assert.equal(client.messages.at(-1).payload, 'online');
});

test('a webhook received during a fetch queues a new full snapshot', async t => {
  const cfg = {...config(), pollMs:60000};
  let resolveFirst;
  let count = 0;
  let resolveSecond;
  const firstResponse = new Promise(resolve => { resolveFirst = resolve; });
  const secondStarted = new Promise(resolve => { resolveSecond = resolve; });
  const service = createService(cfg, {log:silent, fetchImpl: async url => {
    if (url.endsWith('/regions')) return json(tree);
    count++;
    if (count === 1) return firstResponse;
    resolveSecond();
    return json(alert('Yellow'));
  }});
  t.after(() => service.stop());
  service.start();
  service.requestRefresh();
  service.requestRefresh();
  resolveFirst(json(alert('Red')));
  await service.refresh();
  await secondStarted;
  await service.refresh();
  assert.equal(count, 2);
  assert.equal(service.status().states[8], 5);
  assert.equal(service.diagnostics().api.lastSource, 'webhook');
});

test('diagnostics distinguish successful unchanged polls, map changes, failed requests and MQTT recovery', async t => {
  let time = 1000000;
  let payload = alert('Yellow');
  let fail = false;
  const client = new FakeMqtt();
  const service = createService({...config(), mqttUrl:'mqtt://unused.test'}, {
    now:()=>time, log:silent, connectMqtt:()=>client,
    fetchImpl:async url=>url.endsWith('/regions') ? json(tree) : fail ? json({}, 503) : json(payload),
  });
  t.after(()=>service.stop());
  service.start(); await service.refresh();
  const changed = service.diagnostics().api.lastChangedAt;
  time += 30000; await service.refresh('poll');
  assert.equal(service.diagnostics().api.lastChangedAt, changed);
  assert.equal(service.diagnostics().api.lastSuccessAt, new Date(time).toISOString());
  time += 30000; payload = alert('Red'); await service.refresh('poll');
  assert.equal(service.diagnostics().api.lastChangedAt, new Date(time).toISOString());
  const successfulAt = service.diagnostics().api.lastSuccessAt;
  fail = true; time += 30000; await service.refresh('poll');
  assert.equal(service.diagnostics().api.lastSuccessAt, successfulAt);
  assert.equal(service.diagnostics().api.lastFailureAt, new Date(time).toISOString());
  client.emit('error', {code:4, message:'mqtt://private:password@broker'});
  client.emit('close');
  assert.equal(service.diagnostics().mqtt.lastError.code, 'MQTT_4');
  assert.ok(!JSON.stringify(service.monitor.view()).includes('password@broker'));
  time += 1000; client.connected = true; client.emit('connect');
  assert.equal(service.diagnostics().mqtt.lastError, null);
  assert.equal(service.diagnostics().mqtt.lastConnectedAt, new Date(time).toISOString());
  assert.equal(service.diagnostics().mqtt.lastPublishedAt, new Date(time).toISOString());
});

test('configuration rejects colliding topics and freshness windows shorter than a poll', () => {
  assert.throws(() => loadConfig({}));
  assert.throws(() => loadConfig({UKRAINEALARM_API_TOKEN:'test', STALE_AFTER_MS:'30000'}));
  assert.throws(() => loadConfig({UKRAINEALARM_API_TOKEN:'test', MQTT_TOPIC_V2:'ukraine/alarm/map/full'}));
  assert.throws(() => loadConfig({UKRAINEALARM_API_TOKEN:'test', MQTT_TOPIC_V2:'ukraine/#'}));
});
