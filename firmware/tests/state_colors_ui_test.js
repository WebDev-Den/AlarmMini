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
    replaceChildren(...children) { this.children = children; }, setAttribute() {},
    setCustomValidity(message) { this.validationMessage = message; },
    checkValidity() { return !this.validationMessage; }, reportValidity() { this.reported = true; return this.checkValidity(); } };
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
  // Every stored 8-bit brightness must survive showing and re-entering RGBA.
  for (let alpha = 0; alpha < 256; alpha++) {
    assert.deepEqual(value(`parseRgba(formatRgba([0,160,255,${alpha}]))`), [0,160,255,alpha]);
  }
  assert.deepEqual(value(`parseRgba(' RGBA( 255, 160, 0, .5 ) ')`), [255,160,0,128]);
  for (const text of ['rgba(256,0,0,1)', 'rgba(-1,0,0,1)', 'rgba(1.5,0,0,1)', 'rgba(0,0,0,1.1)', 'rgba(0,0,0,-.5)', 'rgba(0,0,0,)', 'rgba(0,0,0,NaN)', 'rgba(0,0,0,1)junk', '', '#ffaa00']) {
    assert.equal(run(`parseRgba(${JSON.stringify(text)})`), null);
  }
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
  const dayRow = elements.stateColors.children[2].children[1];
  const dayRgba = dayRow.children[2];
  dayRgba.value = 'rgba(255, 160, 0, 0.5)'; dayRgba.oninput();
  assert.equal(dayRow.children[1].children[0].value, '#ffa000');
  assert.equal(dayRow.children[1].children[1].value, '128');
  dayRgba.onchange();
  assert.equal(dayRgba.value, 'rgba(255, 160, 0, 0.502)');
  const nightRow = elements.stateColors.children[2].children[2];
  const nightRgba = nightRow.children[2];
  nightRgba.value = 'rgba(10, 20, 30, 1)'; nightRgba.oninput(); nightRgba.onchange();
  const nightCap = Number(nightRow.children[1].children[1].max);
  assert.equal(value('customStateColors[2]')[7], nightCap);
  assert.match(nightRow.children[3].textContent, /Нічне обмеження/);
  // Invalid drafts cannot post a stale or partial color through either save path.
  const colorsBeforeInvalid = value('customStateColors');
  const postsBeforeInvalid = posts;
  dayRgba.value = 'rgba(300, 0, 0, 1)'; dayRgba.oninput();
  assert.deepEqual(value('customStateColors'), colorsBeforeInvalid);
  await assert.rejects(run('saveConfig()'), /Перевір RGBA/);
  await assert.rejects(run('saveCalibrationConfig()'), /Перевір RGBA/);
  assert.equal(posts, postsBeforeInvalid);
  assert.equal(dayRgba.reported, true);
  // Picker and slider also repair invalid text and keep all controls in sync.
  dayRow.children[1].children[0].value = '#00aaff'; dayRow.children[1].children[0].oninput();
  assert.equal(dayRgba.checkValidity(), true);
  assert.equal(dayRgba.value, 'rgba(0, 170, 255, 0.502)');
  dayRow.children[1].children[1].value = '0'; dayRow.children[1].children[1].oninput();
  assert.equal(dayRgba.value, 'rgba(0, 170, 255, 0)');
  await run('saveConfig()');
  assert.deepEqual(stored.c.d.c, [18,52,86,80]);
  assert.deepEqual(stored.sc['17'].slice(4,7), [171,205,239]);
  assert.deepEqual(stored.sc['2'], [0,170,255,0,10,20,30,nightCap]);
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
  console.log('PASS state palette UI: RGBA input, byte round trips, validation, night cap, picker/slider sync, 0/1 + 16 states, save/import and calibration preservation');
})().catch(error => { console.error(error); process.exitCode = 1; });
