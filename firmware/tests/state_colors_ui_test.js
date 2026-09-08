// Run the real board UI save/import code with a small DOM and HTTP fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const web = path.join(__dirname, '../work_data');
const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
const base = JSON.parse(fs.readFileSync(path.join(web, 'config.example.json'), 'utf8'));
base.fu = 'https://reserve.example/states'; base.ft = 'test-token';
base.z = { e: true, v: [80,30], r: [20] }; // Legacy fields survive without enabling sound.
const clone = value => JSON.parse(JSON.stringify(value));
const elements = {};
function element() {
  return { value: '', children: [], disabled: false, classList: { add() {}, remove() {}, toggle() {} },
    append(...children) { this.children.push(...children); }, appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; }, setAttribute() {} };
}
let stored = clone(base), posts = 0, reloads = 0;
const errors = [];
const context = vm.createContext({ console: {...console, error: error => errors.push(error)}, window: {}, setTimeout: () => 0, clearTimeout() {},
  document: { getElementById: id => elements[id] ??= element(), createElement: element },
  fetch: async (url, options) => { assert.equal(url, '/api/saveSettings'); stored = JSON.parse(options.body); posts++; return {ok:true}; },
  loadConfig: async () => clone(stored), didReload: () => reloads++, base: clone(base), assert,
});
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
vm.runInContext(fs.readFileSync(path.join(web, 'main.js'), 'utf8').replace(/\bboot\(\);\s*$/, ''), context);
vm.runInContext(`
  refreshMapPreview = () => {}; updateDirtyState = () => {}; storeDirtySnapshot = () => {};
  setLogMaskInputs = () => {}; readLogMaskInputs = () => currentConfigSource.g;
  fetchJson = loadConfig;
  bootAuthenticated = async () => { didReload(); applyConfig(await loadConfig()); };
  applyConfig(base);
  for (const [id, value] of Object.entries({mqttHost:base.m.h,mqttTopic:base.m.t,mqttUser:base.m.u,mqttPass:base.m.s,mqttPort:1883,fallbackUrl:base.fu,fallbackToken:base.ft})) $(id).value=String(value);
`, context);
const run = code => vm.runInContext(code, context);
const value = code => clone(run(code));
(async () => {
  assert.equal(elements.stateColors.children.length, 2);
  assert.equal(elements.stateColors.children[0].children[0].children.length, 1); // 0 cannot be removed.
  for (let i = 2; i < 18; i++) run(`$('newStateCode').value='${i}'; addStateColor()`);
  assert.equal(elements.stateColors.children.length, 18);
  assert.equal(elements.addStateColor.disabled, true);
  run(`$('newStateCode').value='255'; addStateColor()`);
  assert.equal(value('Object.keys(customStateColors)').length, 18);
  const firstDay = elements.stateColors.children[0].children[1].children[1].children[0];
  firstDay.value = '#123456'; firstDay.oninput();
  const lastNight = elements.stateColors.children[17].children[2].children[1].children[0];
  lastNight.value = '#abcdef'; lastNight.oninput();
  await run('saveConfig()');
  assert.deepEqual(stored.c.d.c, [18,52,86,80]);
  assert.deepEqual(stored.sc['17'].slice(4,7), [171,205,239]);
  for (const key of ['l','m','w','t','z','fu','ft','g']) assert.deepEqual(stored[key], base[key], key);
  const exported = value('getExportConfig(currentConfigSource)');
  assert.deepEqual(exported.sc, stored.sc);
  run(`$('newStateCode').value='2'; applyConfig(currentConfigSource)`);
  assert.equal(elements.newStateCode.value, '18'); // Reopening skips already configured codes.
  await run('saveCalibrationConfig()');
  assert.deepEqual(stored.sc, exported.sc);
  // Removing an override must survive saving and importing a smaller backup.
  elements.stateColors.children[17].children[0].children[1].onclick();
  await run('saveConfig()'); assert.equal(stored.sc['17'], undefined);
  context.backup = {...clone(exported), sc: {'255': [1,2,3,4,5,6,7,8]}};
  await run('importSettings({text: async () => JSON.stringify(backup)})');
  assert.deepEqual(stored.sc, context.backup.sc); assert.equal(reloads, 1);
  assert.equal(elements.stateColors.children.length, 3);
  assert.equal(run(`customStateColors[$('newStateCode').value]`), undefined);
  // Full legacy backup clears extras and refreshes the UI, so later saves cannot resurrect them.
  await run('importSettings({text: async () => JSON.stringify(base)})');
  assert.equal(stored.sc, undefined); assert.equal(reloads, 2);
  await run('saveConfig()'); assert.equal(stored.sc, undefined);
  const beforeInvalid = posts;
  context.backup.sc = {'02': [1,2,3,4,5,6,7,8]};
  await run('importSettings({text: async () => JSON.stringify(backup)})');
  assert.equal(posts, beforeInvalid);
  assert.equal(errors.length, 1); // The invalid import was rejected intentionally.
  assert.ok(!/testBuzzer|testSubscribedAlert|buzzerEnabled/.test(html));
  console.log('PASS state palette UI: 0/1 + 16 states, edit, limits, delete, save, export, import, legacy restore, calibration preservation');
})().catch(error => { console.error(error); process.exitCode = 1; });
