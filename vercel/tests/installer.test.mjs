import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../app/installer.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { writeFirmware } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const port = {}, manifest = { name: 'AlarmMini', version: 'test', builds: [] };

test('waits for actual writing and final completion on the selected port', async () => {
  let finish;
  let resolved = false;
  const states = [];
  const operation = writeFirmware(port, manifest, 'https://example.test/', false, event => states.push(event.state), async (emit, actualPort, url, actualManifest, erase) => {
    assert.equal(actualPort, port);
    assert.equal(actualManifest, manifest);
    assert.equal(erase, false);
    emit({ state: 'writing', details: { percentage: 100 } });
    await new Promise(resolve => { finish = resolve; });
    emit({ state: 'finished' });
  }).then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false, '100% writing alone is not completion');
  finish();
  await operation;
  assert.deepEqual(states, ['writing', 'finished']);
});

for (const error of ['not_supported', 'failed_initialize', 'failed_firmware_download', 'write_failed']) {
  test(`resolved library error ${error} must not trigger restore`, async () => {
    await assert.rejects(writeFirmware(port, manifest, '', false, () => {}, async emit => {
      emit({ state: 'error', details: { error } });
    }));
  });
}

test('missing terminal event and rejected transport both fail', async () => {
  await assert.rejects(writeFirmware(port, manifest, '', false, () => {}, async () => {}), /Запис не підтверджено/);
  await assert.rejects(writeFirmware(port, manifest, '', false, () => {}, async () => { throw new Error('USB disconnected'); }), /USB disconnected/);
});

test('explicit first installation passes erase through', async () => {
  await writeFirmware(port, manifest, '', true, () => {}, async (emit, _port, _url, _manifest, erase) => {
    assert.equal(erase, true);
    emit({ state: 'finished' });
  });
});
