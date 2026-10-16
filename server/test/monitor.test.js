import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonitor, mqttError } from '../src/monitor.js';

const log = {info() {}, warn() {}, error() {}};
test('clearing journal preserves webhook diagnostics, uptime and monotonic event IDs', () => {
  let time = 1000;
  const monitor = createMonitor({now:()=>time, log});
  monitor.receivedWebhook('accepted');
  const first = monitor.view();
  time += 5000;
  const cleared = monitor.clear();
  assert.equal(cleared.events.length, 0); assert.equal(cleared.logGeneration, 1);
  assert.deepEqual(cleared.webhook, first.webhook); assert.equal(cleared.startedAt, first.startedAt);
  assert.equal(cleared.uptimeSeconds, 5); assert.equal(cleared.clearedAt, new Date(time).toISOString());
  monitor.record('info','api','UPDATED','Updated');
  assert.ok(monitor.view().events[0].id > first.events[0].id);
  assert.equal(monitor.clear().logGeneration, 2);
});
test('journal stays bounded, combines consecutive repeats, keeps timestamps and returns independent copies', () => {
  let time = 1000;
  const monitor = createMonitor({now:()=>time, log, limit:2});
  monitor.record('error', 'mqtt', 'MQTT_4', 'Login rejected');
  time += 5000;
  monitor.record('error', 'mqtt', 'MQTT_4', 'Login rejected');
  let view = monitor.view();
  assert.equal(view.events[0].count, 2);
  assert.equal(view.events[0].at, new Date(1000).toISOString());
  assert.equal(view.events[0].lastAt, new Date(6000).toISOString());
  view.events[0].message = 'Mutated';
  assert.equal(monitor.view().events[0].message, 'Login rejected');
  monitor.record('info', 'mqtt', 'CONNECTED', 'Connected');
  monitor.record('info', 'api', 'UPDATED', 'Updated');
  view = monitor.view();
  assert.equal(view.events.length, 2);
  assert.deepEqual(view.events.map(e => e.code), ['UPDATED','CONNECTED']);
  assert.equal(view.uptimeSeconds, 5);
});

test('rejections and duplicates cannot claim a new successful delivery', () => {
  let time = 1000;
  const monitor = createMonitor({now:()=>time, log});
  monitor.receivedWebhook('rejected', 'INVALID_SIGNATURE');
  assert.equal(monitor.view().webhook.lastAcceptedAt, null);
  time += 1000; monitor.receivedWebhook('accepted');
  const acceptedAt = monitor.view().webhook.lastAcceptedAt;
  time += 1000; monitor.receivedWebhook('duplicate');
  time += 1000; monitor.receivedWebhook('rejected', 'UNAUTHORIZED');
  const hook = monitor.view().webhook;
  assert.equal(hook.lastAcceptedAt, acceptedAt);
  assert.deepEqual([hook.received, hook.accepted, hook.rejected, hook.duplicates], [4,1,2,1]);
  assert.equal(hook.lastOutcome, 'rejected');
  assert.equal(hook.lastError, 'UNAUTHORIZED');
});

test('MQTT errors explain common codes without copying credentials or arbitrary upstream error text', () => {
  assert.match(mqttError(4).message, /MQTT_PASSWORD/);
  assert.equal(mqttError('ECONNREFUSED').code, 'MQTT_ECONNREFUSED');
  const unsafe = 'mqtt://secret-user:secret-pass@broker?token=secret';
  assert.ok(!JSON.stringify(mqttError(unsafe)).includes('secret'));
});
