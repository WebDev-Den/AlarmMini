import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const preset = JSON.parse(readFileSync(new URL('../public/profiles/ukrainealarm-air-6-states.json', import.meta.url), 'utf8'));
const palette = JSON.parse(readFileSync(new URL('../../firmware/profiles/ukrainealarm-air-6-states.json', import.meta.url), 'utf8'));
const compile = source => ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const helpers = compile(page.slice(page.indexOf('function buildConfigValidationErrors'), page.indexOf('export default function Page')));
const flow = compile(page.slice(page.indexOf('  async function runFlashFlow('), page.indexOf('  async function runRecoveryWizard(')));
const fallback = await import(`data:text/javascript;base64,${Buffer.from(compile(readFileSync(new URL('../app/fallback-settings.ts', import.meta.url), 'utf8'))).toString('base64')}`);
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(options = {}) {
  const calls = [];
  const backup = {...clone(preset), w:{s:'Existing WiFi',p:'existing-only'}, m:{h:'existing.example',p:1883,t:'custom/states',u:'existing-user',s:'existing-only'}};
  let deviceConfig = clone(backup);
  const context = vm.createContext({
    ...fallback, structuredClone, airPreset:clone(preset), useAirPreset:options.enabled ?? true,
    selectedRelease:{tag_name:options.version ?? 'v2.1.2'}, serialSupported:true, canFlash:true,
    manifest:{builds:[]}, freshInstallConfirmed:true, rememberedPortRef:{current:{}},
    installFallbackUrl:options.reserveUrl ?? '', installFallbackToken:'',
    backupHostnameRef:{current:''}, window:{location:{href:'https://installer.example/'}},
    setFlashBusy(){}, setIsFlashingFlow(){}, setFlashProgress(){}, resetPipeline(){}, setPipelineStep(){},
    setFlashStatus:message=>calls.push(['status',message]), setFlashOutcome:outcome=>calls.push(['outcome',outcome]),
    ensureConnected:async()=>{}, disconnectPort:async()=>calls.push(['disconnect']),
    reconnectAfterFlash:async()=>calls.push(['reconnect']), waitDeviceInfoAfterReconnect:async()=>{},
    cmdGetInfo:async()=>{}, persistBackupConfig(){}, isSafeBackupConfig:()=>true,
    applyConfigToUi:cfg=>calls.push(['ui',clone(cfg)]),
    verifyFallbackEndpoint:async url=>{calls.push(['probe',url]);return url;},
    saveFallbackUrl:async(url,token)=>{calls.push(['reserve',url]);deviceConfig.fu=url;deviceConfig.ft=token;},
    restoreBackupConfigWithRetry:async cfg=>{calls.push(['restore',clone(cfg)]);deviceConfig=clone(cfg);},
    writeFirmware:async()=>{calls.push(['flash']);if(options.flashError)throw new Error('flash failed');deviceConfig={};},
    sendConfigChunked:async(cfg,label)=>{
      calls.push(['preset',clone(cfg),label]);
      if(options.writeError)throw new Error('USB write failed');
      deviceConfig=clone(cfg);
      delete deviceConfig.fu; delete deviceConfig.ft; // Real firmware omits empty reserve fields.
      if(options.missingState)delete deviceConfig.sc['5'];
      if(options.leakedNetwork)deviceConfig.m.h='stale.example';
      if(options.leakedFallback)deviceConfig.fu='https://stale.example/status';
    },
    sendAndWait:async command=>command==='get:info'
      ? {event:'device_info',hostname:'alarm-test',fw:'2.1.2'}
      : {event:'config',config:clone(deviceConfig)},
  });
  vm.runInContext(helpers+flow,context);
  return {calls,backup,run:restore=>context.runFlashFlow(restore),context};
}

test('public preset includes all six colors and contains no personal connection settings', () => {
  const {context}=fixture();
  assert.equal(context.buildConfigValidationErrors(preset).length,0);
  assert.deepEqual(preset.c,palette.c); assert.deepEqual(preset.sc,palette.sc);
  assert.deepEqual(Object.keys(preset).sort(),['cv','c','sc','n','k','o','l','m','w','t','g','fu','ft'].sort());
  assert.deepEqual(preset.w,{s:'',p:''});
  assert.deepEqual(preset.m,{h:'',p:1883,t:'ukraine/alarm/map/full_v2',u:'',s:''});
  assert.equal(preset.fu,'');assert.equal(preset.ft,'');assert.deepEqual(preset.t,['','','']);
  assert.deepEqual(preset.n.s,[22,0]);assert.deepEqual(preset.n.x,[7,0]);
  assert.equal(preset.l.length,27);assert.equal(new Set(preset.l).size,25);
});

test('first installation writes preset after flashing and checks actual firmware readback', async () => {
  const {run,calls}=fixture();await run(false);
  assert.deepEqual(calls.filter(c=>['flash','reconnect','preset','outcome'].includes(c[0])&&c[1]!=='idle').map(c=>c[0]),['flash','reconnect','preset','outcome']);
  assert.deepEqual(calls.find(c=>c[0]==='preset')[1],preset);
  assert.deepEqual(calls.at(-2),['outcome','success']);
});

test('update preserves existing credentials and configuration even with preset checkbox selected', async () => {
  const {run,calls,backup}=fixture();await run(true);
  assert.equal(calls.some(c=>c[0]==='preset'),false);
  assert.deepEqual(calls.find(c=>c[0]==='restore')[1],backup);
});

test('older release stops before erase; disabling preset keeps the original first-install flow', async () => {
  const old=fixture({version:'v2.0.9'});
  await assert.rejects(old.run(false),/2.1.0/);assert.equal(old.calls.length,0);
  const disabled=fixture({version:'v2.0.9',enabled:false});await disabled.run(false);
  assert.equal(disabled.calls.some(c=>c[0]==='preset'),false);
  assert.ok(disabled.calls.some(c=>c[0]==='outcome'&&c[1]==='success'));
});

for (const option of ['flashError','writeError','missingState','leakedNetwork','leakedFallback']) {
  test(`${option} never reports a successful installation`,async()=>{
    const {run,calls}=fixture({[option]:true});await assert.rejects(run(false));
    assert.equal(calls.some(c=>c[0]==='outcome'&&c[1]==='success'),false);
    if(option==='flashError')assert.equal(calls.some(c=>c[0]==='preset'),false);
  });
}

test('an explicitly supplied reserve URL is verified then saved after the blank preset',async()=>{
  const {run,calls}=fixture({reserveUrl:'https://custom.example/status'});await run(false);
  const actions=calls.map(c=>c[0]);
  assert.ok(actions.indexOf('probe')<actions.indexOf('flash'));
  assert.ok(actions.indexOf('preset')<actions.indexOf('reserve'));
  assert.ok(actions.indexOf('reserve')<actions.lastIndexOf('outcome'));
});
