import os from 'node:os';
import { readFile, statfs } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';

// Missing/unsupported cgroup files are normal on Windows and non-container hosts.
export async function systemSnapshot(directory, {read = path => readFile(path, 'utf8'), disk = statfs} = {}) {
  async function diskInfo() {
    // The runtime directory may not exist until settings are first saved.
    let path = resolve(directory);
    for (;;) {
      try { return await disk(path); }
      catch (error) {
        const parent = dirname(path);
        if (error.code !== 'ENOENT' || parent === path) return null;
        path = parent;
      }
    }
  }
  const [maximum, current, quota, fs] = await Promise.all([
    read('/sys/fs/cgroup/memory.max').catch(() => ''), read('/sys/fs/cgroup/memory.current').catch(() => ''),
    read('/sys/fs/cgroup/cpu.max').catch(() => ''), diskInfo(),
  ]);
  const limit = Number(maximum), used = Number(current);
  const container = limit > 0 && Number.isFinite(limit) && current.trim() !== '' && used >= 0 && Number.isFinite(used);
  const [quotaUs, periodUs] = quota.trim().split(/\s+/).map(Number);
  return {
    memoryScope:container ? 'container' : 'host',
    totalBytes:container ? limit : os.totalmem(), usedBytes:container ? used : os.totalmem() - os.freemem(),
    cpuCores:Number.isFinite(quotaUs) && quotaUs > 0 && periodUs > 0 ? quotaUs / periodUs : os.availableParallelism(),
    loadAverage:process.platform === 'win32' ? null : os.loadavg(),
    disk:fs ? {totalBytes:fs.blocks * fs.bsize, availableBytes:fs.bavail * fs.bsize} : null,
  };
}

export function createResources(config, {
  now = Date.now, monotonic = () => performance.now(), cpu = () => process.cpuUsage(), memory = () => process.memoryUsage(),
  readSystem = () => systemSnapshot(dirname(config.settingsFile)), intervalMs = 10000, limit = 60,
} = {}) {
  const history = [];
  let latest = null, timer = null, pending = null, stopped = false;
  let previousCpu = cpu(), previousTime = monotonic();
  const lag = monitorEventLoopDelay({resolution:20});
  async function sample() {
    if (stopped) return;
    if (pending) return pending;
    pending = (async () => {
      const currentTime = monotonic(), currentCpu = cpu();
      const elapsed = currentTime - previousTime;
      const cpuPercent = elapsed >= 100 ? Math.max(0, (currentCpu.user + currentCpu.system - previousCpu.user - previousCpu.system) / (elapsed * 10)) : null;
      previousCpu = currentCpu; previousTime = currentTime;
      const mem = memory();
      // Optional diagnostics must never reject an alarm request or stop its timers.
      const system = await readSystem().catch(() => null);
      if (stopped) return;
      latest = {at:new Date(now()).toISOString(), cpuPercent, rssBytes:mem.rss, heapUsedBytes:mem.heapUsed,
        heapTotalBytes:mem.heapTotal, eventLoopMs:Number.isFinite(lag.mean) ? lag.mean / 1e6 : null, system};
      lag.reset();
      history.push({at:latest.at, cpuPercent, rssBytes:mem.rss});
      if (history.length > limit) history.shift();
    })();
    try { await pending; } finally { pending = null; }
  }
  function start() {
    if (timer || stopped) return;
    lag.enable();
    void sample().catch(() => {});
    timer = setInterval(() => { void sample().catch(() => {}); }, intervalMs);
    timer.unref();
  }
  function stop() { stopped = true; clearInterval(timer); timer = null; lag.disable(); }
  function view() { return structuredClone({latest, history, intervalSeconds:intervalMs / 1000, limit}); }
  return {start, stop, sample, view};
}
