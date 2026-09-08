import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
// Test the installer functions unchanged, without loading browser serial/React.
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const functions = page.slice(page.indexOf('function buildConfigValidationErrors'), page.indexOf('export default function Page'));
const {outputText} = ts.transpileModule(functions + '\nexport {buildConfigValidationErrors, collectDiffPaths};', {compilerOptions:{module:ts.ModuleKind.ESNext}});
const {buildConfigValidationErrors, collectDiffPaths} = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const base = JSON.parse(readFileSync(new URL('../../firmware/work_data/config.example.json', import.meta.url), 'utf8'));
const sc = Object.fromEntries(Array.from({length:16}, (_,i) => [String(240+i),[255,i,1,255,3,4,i,24]]));
test('installer validates new and legacy backups and the complete palette', () => {
  assert.deepEqual(buildConfigValidationErrors(base), []);
  assert.deepEqual(buildConfigValidationErrors({...base,z:{e:true,v:[80,30],r:[20]},sc}), []);
  for (const invalid of [null,[],{...sc,2:[0,0,0,0,0,0,0,0]},...['0','1','02','256','x'].map(k=>({[k]:sc[240]})),...[-1,256,1.2,true,'3'].map(v=>({'2':[v,0,0,0,0,0,0,0]}))]) {
    assert.ok(buildConfigValidationErrors({...base,sc:invalid}).length);
  }
});
test('restore verification detects missing, changed and stale extra state colors', () => {
  const expected = {...base,sc};
  assert.deepEqual(collectDiffPaths(expected, {...expected,deviceId:'service-field'}), []);
  assert.ok(collectDiffPaths(expected, base).length);
  assert.ok(collectDiffPaths(base, expected).includes('$.sc'));
  assert.ok(collectDiffPaths({...base,sc:{240:sc[240]}}, expected).includes('$.sc'));
  assert.ok(collectDiffPaths(expected, {...expected,sc:{...sc,240:[1,2,3,4,5,6,7,8]}}).length);
});
