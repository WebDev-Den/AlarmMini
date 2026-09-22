import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import zones from '../../firmware/work_data/timezone-utils.js';

const catalog = JSON.parse(readFileSync(new URL('../../firmware/work_data/timezones.json', import.meta.url), 'utf8'));
test('full IANA catalog, searchable country labels and fractional zones are shared with the board', () => {
  assert.equal(zones.options('en').length, catalog.zones.length);
  assert.ok(catalog.zones.length > 500);
  for (const id of ['Europe/Kyiv','America/New_York','America/Los_Angeles','Asia/Kathmandu','Australia/Lord_Howe','Pacific/Chatham','Africa/Casablanca']) assert.ok(zones.isValid(id));
  for (const id of ['', null, 180, 'Unknown/Place', 'Europe/Kyiv\n']) assert.equal(zones.isValid(id), false);
  assert.ok(zones.options('ua','Україна').some(zone => zone.id === 'Europe/Kyiv'));
  assert.ok(zones.options('en','new york').some(zone => zone.id === 'America/New_York'));
  execFileSync('python', ['../firmware/scripts/prepare_timezones.py', '--check']);
});
test('timezone support starts with 2.1.5, including future versions', () => {
  for (const version of ['','unknown','2.1.4','1.9.9']) assert.equal(zones.supportsTimeZone(version), false);
  for (const version of ['2.1.5','v2.1.5','2.1.6','2.2.0','3.0.0']) assert.equal(zones.supportsTimeZone(version), true);
});

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const saveFunctions = ts.transpileModule(page.slice(page.indexOf('  async function saveTimeZone('), page.indexOf('  async function cmdSetMqtt(')), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function saveFixture({ version = '2.1.5', mismatch = false } = {}) {
  const commands = [];
  let shownConfig;
  const context = vm.createContext({
    isTimeZone: zones.isValid, supportsTimeZone: zones.supportsTimeZone,
    timeZone: 'America/Los_Angeles', timeZoneSaving: false,
    ensureConnected: async () => {}, setTimeZoneSaving() {}, setStatus() {},
    applyConfigToUi: value => { shownConfig = value; },
    sendAndWait: async (command, accepts) => {
      commands.push(command);
      const response = command === 'get:info' ? { event: 'device_info', fw: version }
        : command === 'get:config' ? { event: 'config', config: { tz: mismatch ? 'Europe/Kyiv' : 'America/Los_Angeles', m: { h: 'preserved.example' } } }
        : { status: 'ACK', cmd: 'timezone_set' };
      assert.ok(accepts(response));
      return response;
    },
  });
  vm.runInContext(saveFunctions, context);
  return { context, commands, get shownConfig() { return shownConfig; } };
}
test('USB timezone save uses a dedicated command and checks readback without full configuration writes', async () => {
  const fixture = saveFixture();
  await fixture.context.cmdSetTimeZone();
  assert.deepEqual(fixture.commands, ['get:info', JSON.stringify({cmd:'timezone_set',id:'America/Los_Angeles'}), 'get:config']);
  assert.equal(fixture.shownConfig.m.h, 'preserved.example');
});
test('USB timezone save rejects old firmware and failed readback', async () => {
  const old = saveFixture({version:'2.1.4'});
  await assert.rejects(old.context.cmdSetTimeZone(), /2.1.5/);
  assert.deepEqual(old.commands, ['get:info']);
  const wrong = saveFixture({mismatch:true});
  await assert.rejects(wrong.context.cmdSetTimeZone(), /підтвердити/);
  assert.equal(wrong.shownConfig, undefined);
});
