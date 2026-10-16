import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAlertStats } from '../src/alert-stats.js';
import { createResources, systemSnapshot } from '../src/resources.js';
import { REGIONS } from '../src/state.js';

test('alarm observations count starts, clears and level changes, but not startup or stale gaps', () => {
  const stats = createAlertStats(90000, 2), states = Array(25).fill(0);
  states[0] = 1; stats.observe(states, 0);
  assert.equal(stats.view().regions[0].starts, 0);
  states[0] = 3; states[1] = 5; stats.observe(states, 30000);
  states[1] = 0; stats.observe(states, 60000);
  let view = stats.view();
  assert.equal(view.regions[0].changes, 1);
  assert.equal(view.regions[1].starts, 1);
  assert.equal(view.regions[1].clears, 1);
  assert.equal(view.changes, 2); assert.equal(view.peakActive, 2);
  assert.equal(view.events.length, 2);
  states[0] = 0; states[1] = 1; stats.observe(states, 150000);
  view = stats.view();
  assert.equal(view.gaps, 1); assert.equal(view.changes, 2);
  assert.equal(view.regions[0].clears, 0); assert.equal(view.regions[1].starts, 1);
  view.regions[1].starts = 900; view.events[0].to = 900;
  assert.equal(stats.view().regions[1].starts, 1); assert.notEqual(stats.view().events[0].to, 900);
});

test('resource samples use interval CPU, bounded history, copies and optional system metrics', async t => {
  let time = 0, usage = 0;
  const resources = createResources({}, {now:()=>time, monotonic:()=>time, cpu:()=>({user:usage, system:0}),
    memory:()=>({rss:50000000,heapUsed:10000000,heapTotal:20000000}), readSystem:async()=>{throw new Error('unavailable');}, limit:2});
  t.after(resources.stop);
  await resources.sample(); assert.equal(resources.view().latest.cpuPercent, null);
  time += 10000; usage += 2500000; await resources.sample();
  assert.equal(resources.view().latest.cpuPercent, 25);
  time += 10000; usage += 5000000; await resources.sample();
  const view = resources.view();
  assert.equal(view.latest.cpuPercent, 50); assert.equal(view.latest.system, null);
  assert.equal(view.history.length, 2);
  view.history[0].rssBytes = 1;
  assert.equal(resources.view().history[0].rssBytes, 50000000);
  resources.stop(); time += 10000; await resources.sample();
  assert.equal(resources.view().latest.at, new Date(20000).toISOString());
});

test('resource collection coalesces callers and discards completion after shutdown', async () => {
  let release, reads = 0;
  const resources = createResources({}, {readSystem:()=>{ reads++; return new Promise(resolve => {release=resolve;}); }});
  const first = resources.sample(), second = resources.sample();
  assert.equal(reads, 1); resources.stop(); release({});
  await Promise.all([first, second]); assert.equal(resources.view().latest, null);
});

test('Linux cgroup v2 memory and CPU quota take precedence; unavailable metrics have explicit fallbacks', async () => {
  const files = {'/sys/fs/cgroup/memory.max':'536870912\n','/sys/fs/cgroup/memory.current':'100000000\n','/sys/fs/cgroup/cpu.max':'50000 100000\n'};
  let data = await systemSnapshot('/tmp', {read:async path=>files[path], disk:async()=>({blocks:100,bavail:40,bsize:4096})});
  assert.equal(data.memoryScope, 'container'); assert.equal(data.totalBytes, 536870912);
  assert.equal(data.usedBytes, 100000000); assert.equal(data.cpuCores, .5);
  assert.equal(data.disk.availableBytes, 40 * 4096);
  files['/sys/fs/cgroup/memory.max'] = 'max'; files['/sys/fs/cgroup/cpu.max'] = 'max 100000';
  data = await systemSnapshot('/tmp', {read:async path=>files[path], disk:async()=>{throw new Error();}});
  assert.equal(data.memoryScope, 'host'); assert.equal(data.disk, null); assert.ok(data.cpuCores > 0);
  data = await systemSnapshot('/tmp', {read:async()=>{throw new Error();}, disk:async()=>{throw new Error();}});
  assert.equal(data.memoryScope, 'host'); assert.ok(data.totalBytes > 0);
});

test('disk metrics find the parent filesystem before runtime exists', async () => {
  const paths = [];
  const data = await systemSnapshot('/alarmmini/runtime/missing', {read:async()=>'', disk:async path=>{
    paths.push(path);
    if (paths.length < 3) throw Object.assign(new Error('missing'), {code:'ENOENT'});
    return {blocks:100, bavail:30, bsize:4096};
  }});
  assert.equal(paths.length, 3); assert.equal(data.disk.availableBytes, 122880);
});

test('map covers all 25 API keys explicitly, merges city slots, and contains no fixture states or executable assets', async () => {
  const svg = await readFile(new URL('../public/map.svg', import.meta.url), 'utf8');
  const keys = [...svg.matchAll(/data-region="([a-z_]+)"/g)].map(m=>m[1]);
  assert.deepEqual([...new Set(keys)].sort(), REGIONS.map(r=>r.key).sort());
  assert.equal(keys.length, 27);
  assert.equal(keys.filter(k=>k==='kyiv').length, 2); assert.equal(keys.filter(k=>k==='crimea').length, 2);
  assert.doesNotMatch(svg, /<script|<style|\son[a-z]+=|href=|class="alarm"|class="safe"/i);
  assert.equal((svg.match(/class="map-region unknown"/g)||[]).length, 27);
});
