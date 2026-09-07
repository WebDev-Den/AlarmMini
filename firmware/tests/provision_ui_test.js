// Exercise the actual embedded script with HTTP/DOM substitutes; no board needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/startup.h'), 'utf8');
const script = source.match(/R"portaljs\(<script>([\s\S]*?)<\/script>\)portaljs"/)[1];
const drain = () => new Promise(resolve => setImmediate(resolve));

function fixture(withScan = false) {
  const elements = Object.fromEntries(['s', 'f', 'ssid', 'password', 'scan', 'manual'].map(id =>
    [id, { className: '', textContent: '', value: '', focus() {} }]));
  if (withScan) elements.nets = { textContent: '', innerHTML: '', children: [], querySelectorAll: () => [] };
  const state = { ok: true, wifiConnected: false, connecting: false, apSsid: 'Setup', apIp: '192.168.4.1', error: '' };
  const calls = [];
  const scanResponses = [{ ok: true, scanning: true }, { ok: true, scanning: false, networks: [] }];
  let failStatus = false;
  const context = vm.createContext({
    document: { getElementById: id => elements[id] || null }, AbortController,
    setTimeout: (fn, ms) => { if (ms === 700 || ms === 1500) queueMicrotask(fn); return 1; },
    clearTimeout() {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/status') && failStatus) throw new Error('AP no longer available');
      const data = url.endsWith('/networks') ? scanResponses.shift() :
        url.endsWith('/wifi') ? { ok: true, saved: false, connecting: true } : { ...state };
      return { ok: true, status: url.endsWith('/wifi') ? 202 : 200, json: async () => data };
    }
  });
  vm.runInContext(script, context);
  return { context, elements, state, calls, fail: () => { failStatus = true; } };
}

(async () => {
  const f = fixture();
  await drain();
  f.elements.ssid.value = ' Home network ';
  f.elements.password.value = 'password123';
  await f.elements.f.onsubmit({ preventDefault() {} });
  const submitted = JSON.parse(f.calls.find(c => c.url.endsWith('/wifi')).options.body);
  assert.equal(submitted.ssid, ' Home network ', 'SSID whitespace is significant');
  assert.equal(f.elements.s.className, 'status busy', 'HTTP 202 must not claim saved/connected');
  f.state.connecting = true;
  await f.context.poll();
  assert.equal(f.elements.s.className, 'status busy');
  f.state.connecting = false;
  f.state.error = 'connect_timeout_or_bad_password';
  await f.context.poll();
  assert.equal(f.elements.s.className, 'status err');
  assert.match(f.elements.s.textContent, /SSID/);
  f.state.error = 'config_save_failed';
  await f.context.poll();
  assert.match(f.elements.s.textContent, /Попередні дані/);
  Object.assign(f.state, { error: '', wifiConnected: true, saved: true, ip: '192.168.1.42' });
  await f.context.poll();
  assert.equal(f.elements.s.className, 'status ok');
  assert.match(f.elements.s.textContent, /http:\/\/192\.168\.1\.42\//);
  const successText = f.elements.s.textContent;
  f.fail();
  await f.context.poll();
  assert.equal(f.elements.s.textContent, successText, 'Keep the LAN address after the AP closes');

  const scanning = fixture(true);
  await drain();
  assert.equal(scanning.calls.filter(c => c.url.endsWith('/networks')).length, 2);
  assert.equal(scanning.elements.scan.disabled, false);
  assert.match(scanning.elements.nets.textContent, /Мережі не знайдено/);
  console.log('PASS: embedded portal async submit/status/failure/SSID/AP-close/scan flows');
})().catch(error => { console.error(error); process.exitCode = 1; });
