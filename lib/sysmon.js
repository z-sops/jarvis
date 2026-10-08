'use strict';
// What this computer is doing right now: processor, memory, graphics card, disk, and what Orbit itself uses. Read only, nothing is stored.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const GB = 1073741824;
const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0);
// nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits
function parseNvidia(text) {
  const gpus = []; for (const line of String(text || '').split(/\r?\n/)) { const p = line.split(',').map(x => x.trim()); if (p.length < 4 || !p[0]) continue; const num = v => (/^\d+(\.\d+)?$/.test(v) ? +v : null); gpus.push({ name: p[0], pct: num(p[1]), memUsedMB: num(p[2]), memTotalMB: num(p[3]), temp: num(p[4]) }); }
  if (!gpus.length) return null; gpus.sort((a, b) => (b.pct || 0) - (a.pct || 0)); return { ...gpus[0], count: gpus.length, source: 'nvidia-smi' };
}
// typeperf "\GPU Engine(*)\Utilization Percentage" -sc 1  (Windows, any brand): a CSV with one column per engine of every process
function parseTypeperf(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.startsWith('"')); if (lines.length < 2) return null;
  const split = l => l.slice(1, -1).split('","'), head = split(lines[0]), vals = split(lines[1]); const byAdapter = new Map();
  head.forEach((h, i) => { const m = /luid_(0x[0-9a-f]+_0x[0-9a-f]+).*engtype_(\w+)\)/i.exec(h); if (!m || i === 0 || !/^(3D|Compute|VideoDecode|VideoEncode|Copy)$/i.test(m[2])) return; const v = parseFloat(vals[i]); if (!isFinite(v)) return; const k = m[1] + '/' + m[2].toLowerCase(); byAdapter.set(k, (byAdapter.get(k) || 0) + v); });
  if (!byAdapter.size) return null; let best = 0; for (const [k, v] of byAdapter) if (/\/3d$|\/compute$/.test(k)) best = Math.max(best, v); return { name: null, pct: Math.min(100, Math.round(best)), memUsedMB: null, memTotalMB: null, temp: null, count: 1, source: 'windows counters' };
}

class SysMon {
  constructor({ app = null, driveOf = null, platform = process.platform, run = null, systemPath = null, statfs = null } = {}) { this.app = app; this.driveOf = driveOf; this.platform = platform; this.systemPath = systemPath; this.statfsFn = statfs; this.prev = this.cpuTimes(); this.gpuOff = 0; this.gpuFails = 0; this.run = run || ((cmd, args, ms) => new Promise(res => execFile(cmd, args, { timeout: ms, windowsHide: true }, (e, out) => res(e ? null : String(out))))); this.timer = null; }
  cpuTimes() { return os.cpus().map(c => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) })); }
  cpu() {
    const now = this.cpuTimes(); let idle = 0, total = 0; now.forEach((c, i) => { const p = this.prev[i]; if (p) { idle += c.idle - p.idle; total += c.total - p.total; } }); this.prev = now;
    return { pct: total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100))) : 0, cores: now.length, model: (os.cpus()[0] || {}).model ? os.cpus()[0].model.replace(/\s+/g, ' ').trim() : '' };
  }
  mem() { const total = os.totalmem(), free = os.freemem(), used = total - free; return { pct: pct(used, total), usedGB: +(used / GB).toFixed(1), totalGB: +(total / GB).toFixed(1) }; }
  disk() { try { const p = this.driveOf ? this.driveOf() : os.homedir(), s = fs.statfsSync(p), total = s.blocks * s.bsize, free = s.bavail * s.bsize; return { path: p, freeGB: Math.round(free / GB), totalGB: Math.round(total / GB), pct: pct(total - free, total) }; } catch { return null; } }
  // Every drive worth watching: the system drive first (that is the one that fills up), then the drive Orbit keeps its data on, if it is another one.
  disks() {
    const W = this.platform === 'win32', P = W ? path.win32 : path, sf = this.statfsFn || fs.statfsSync;
    const sys = this.systemPath || (W ? (process.env.SystemDrive || 'C:') + '\\' : os.homedir());
    let home = null; try { home = this.driveOf ? this.driveOf() : null; } catch { /* no home: only the system drive */ }
    const out = [], seen = new Set();
    for (const [p, role] of [[sys, 'system'], [home, 'orbit']]) {
      if (!p) continue;
      const root = P.parse(P.resolve(p)).root, key = W ? root.toLowerCase() : root; if (seen.has(key)) continue;
      try { const s = sf(p), total = s.blocks * s.bsize, free = s.bavail * s.bsize; seen.add(key); out.push({ path: p, label: W ? root.replace(/[\\/]+$/, '') : root, role, freeGB: Math.round(free / GB), totalGB: Math.round(total / GB), pct: pct(total - free, total) }); } catch { /* a drive that cannot be read is left out */ }
    }
    return out;
  }
  orbit() { if (!this.app || !this.app.getAppMetrics) return null; try { const m = this.app.getAppMetrics(); return { cpu: Math.round(m.reduce((s, x) => s + ((x.cpu && x.cpu.percentCPUUsage) || 0), 0) * 10) / 10, memMB: Math.round(m.reduce((s, x) => s + ((x.memory && x.memory.workingSetSize) || 0), 0) / 1024), processes: m.length }; } catch { return null; } }
  async gpu() {
    if (Date.now() < this.gpuOff) return this.lastGpu || null;
    let g = parseNvidia(await this.run('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu', '--format=csv,noheader,nounits'], 2500));
    if (!g && this.platform === 'win32') g = parseTypeperf(await this.run('typeperf', ['\\GPU Engine(*)\\Utilization Percentage', '-sc', '1'], 4000));
    if (g) { this.gpuFails = 0; this.lastGpu = g; return g; }
    this.gpuFails++; this.gpuOff = Date.now() + Math.min(300000, 30000 * this.gpuFails); this.lastGpu = null; return null;   // no graphics data: try again later, not every two seconds
  }
  async sample() {
    const cpu = this.cpu(), mem = this.mem(), disk = this.disk(), disks = this.disks(), orbit = this.orbit(), gpu = await this.gpu();
    return { t: Date.now(), cpu, mem, gpu, disk, disks, orbit, uptimeH: Math.round(os.uptime() / 360) / 10, platform: this.platform };
  }
  watch(cb, ms = 2000) { this.unwatch(); const go = async () => { try { cb(await this.sample()); } catch { /* the next sample will do */ } }; go(); this.timer = setInterval(go, ms); }
  unwatch() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

module.exports = { SysMon, parseNvidia, parseTypeperf };
