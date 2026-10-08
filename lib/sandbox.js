'use strict';
// A crew member's code sandbox: its shell and file tools run inside a Docker container that only sees the folders you chose.
// Also the clean environment Hermes is started with, so it does not inherit secrets from the Windows environment.
const path = require('path');
const { checkRoots, isInside } = require('./fsmcp');

const IMAGE = 'nikolaik/python-nodejs:python3.11-nodejs20';
const MEM_CHOICES = [2048, 3072, 4096, 6144];
let lastDockerMB = 0;   // how much memory Docker has, from the last check (so a limit can never be more than Docker owns)

const defaults = () => ({ enabled: false, folders: [], network: true, memoryMB: 3072, cpu: 2 });
const yamlStr = s => JSON.stringify(String(s));   // a JSON string is a valid YAML double-quoted string (backslashes are escaped)

/* ---------- the settings ---------- */
function normalize(input, prev) {
  const p = { ...defaults(), ...(prev || {}) }, i = input || {};
  return {
    enabled: i.enabled === undefined ? !!p.enabled : !!i.enabled,
    folders: Array.isArray(i.folders) ? i.folders.map(String) : p.folders,
    network: i.network === undefined ? p.network !== false : i.network !== false,
    memoryMB: MEM_CHOICES.includes(+i.memoryMB) ? +i.memoryMB : (MEM_CHOICES.includes(+p.memoryMB) ? +p.memoryMB : 3072),
    cpu: [1, 2, 3, 4].includes(+i.cpu) ? +i.cpu : (p.cpu || 2)
  };
}
// Never more than Docker has, minus room for Docker itself.
const clampMemory = (mb, dockerMB) => (dockerMB > 0 ? Math.max(1024, Math.min(mb, dockerMB - 1536)) : mb);

// The folders a sandboxed member may work in: the same rules as the Files connector, and also never Orbit's own program folder
// (a changed Orbit would run with all your rights the next time you start it).
function checkFolders(list, opts = {}) {
  const P = opts.P || path, r = checkRoots(list, opts); if (!r.ok) return r; const appDir = opts.appDir;
  if (appDir) for (const f of r.roots) {
    if (isInside(appDir, f, P)) return { ok: false, error: `"${f}" contains Orbit's own program (${appDir}). A sandbox that can change Orbit's code could plant something that runs with all your rights the next time Orbit starts. Choose the project folder itself, not a folder above Orbit.` };
    if (isInside(f, appDir, P)) return { ok: false, error: `"${f}" is inside Orbit's own program folder. Choose a project folder instead.` };
  }
  return r;
}

/* ---------- what goes into the Hermes profile ---------- */
function volumeNames(folders) { const used = new Set(['output']), out = []; for (const f of folders) { let n = (String(f).split(/[\\/]/).filter(Boolean).pop() || 'folder').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'folder'; let k = n, i = 2; while (used.has(k)) k = `${n}-${i++}`; used.add(k); out.push([f, k]); } return out; }
function volumes(sb, ws) { return [...volumeNames(sb.folders).map(([f, n]) => `${f}:/workspace/${n}`), ...(ws ? [`${ws}:/output`] : [])]; }
// Lines that go under "terminal:" in the member's config.yaml ('' = normal, on your computer).
function terminalLines(agent, { ws, dockerMemMB = lastDockerMB } = {}) {
  const sb = agent && agent.sandbox; if (!sb || !sb.enabled) return '';
  const s = normalize(sb), mem = clampMemory(s.memoryMB, dockerMemMB);
  return ['  backend: docker', `  docker_image: ${yamlStr(IMAGE)}`, '  docker_mount_cwd_to_workspace: false', '  docker_forward_env: []', `  docker_network: ${s.network ? 'true' : 'false'}`,
    `  container_cpu: ${s.cpu}`, `  container_memory: ${mem}`, '  container_persistent: true', '  docker_volumes:', ...volumes(s, ws).map(v => `    - ${yamlStr(v)}`)].join('\n') + '\n';
}

/* ---------- a clean environment for Hermes ---------- */
const SECRETISH = /(^|_)(API_?KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD_?HASH|CREDENTIALS?|PRIVATE_?KEY|ACCESS_?KEY|SESSION_?KEY|BEARER)(_|$)/i;
function scrubEnv(env) { const out = {}; for (const [k, v] of Object.entries(env || {})) if (!SECRETISH.test(k)) out[k] = v; return out; }

/* ---------- Docker checks ---------- */
function friendly(r) {
  const t = `${r.stderr || ''} ${r.error || ''}`;
  if (r.notFound || /ENOENT|not recognized|not found/i.test(t)) return 'Docker is not installed (or not on the PATH).';
  if (/cannot find the file specified|dockerDesktopLinuxEngine|failed to connect to the docker API|Cannot connect to the Docker daemon|Is the docker daemon running|daemon is not running/i.test(t)) return 'Docker Desktop is not running. Open it and wait until it says the engine is running.';
  return (t.trim().split('\n')[0] || 'Docker did not answer').slice(0, 200);
}
async function probeDocker(run) {
  const r = await run('docker', ['info', '--format', '{{.OSType}}|{{.ServerVersion}}|{{.MemTotal}}'], 15000);
  if (r.code !== 0) return { ok: false, error: friendly(r) };
  const [os, version, mem] = String(r.stdout).trim().split('|'), memMB = Math.round((+mem || 0) / 1048576);
  if (os !== 'linux') return { ok: false, error: `Docker is in ${os || 'unknown'} container mode. Switch it to Linux containers (Docker Desktop menu).`, os };
  lastDockerMB = memMB; return { ok: true, os, version, memMB };
}
// A real test with real containers: it must start, see the chosen folders, and see nothing else of this computer.
async function testSandbox(run, agent, { ws } = {}) {
  const steps = [], add = (name, ok, detail) => { steps.push({ name, ok, detail: detail || '' }); return ok; }, s = normalize(agent && agent.sandbox);
  const d = await probeDocker(run); if (!add('Docker is running (Linux)', d.ok, d.ok ? `Docker ${d.version}, ${d.memMB} MB of memory` : d.error)) return { ok: false, steps };
  const have = await run('docker', ['image', 'inspect', IMAGE, '--format', '{{.Id}}'], 20000);
  if (have.code !== 0) { const p = await run('docker', ['pull', IMAGE], 900000); if (!add('The sandbox image', p.code === 0, p.code === 0 ? 'downloaded now' : friendly(p))) return { ok: false, steps }; } else add('The sandbox image', true, 'already downloaded');
  const names = volumeNames(s.folders), mem = clampMemory(s.memoryMB, d.memMB);
  const args = ['run', '--rm', '--memory', `${mem}m`, '--network', 'none', ...names.flatMap(([f, n]) => ['-v', `${f}:/workspace/${n}:ro`]), IMAGE, 'sh', '-c',
    'for d in /workspace/*; do [ -d "$d" ] && echo "DIR:$d:$(ls -A "$d" 2>&1 | head -200 | wc -l)"; done; echo "SECRETS:$(find /workspace -maxdepth 4 \\( -name secrets.json -o -name .token -o -name .env \\) 2>/dev/null | head -3 | tr \'\\n\' \' \')"; echo "MNT:$(ls /mnt 2>&1 | head -1)"; echo "USER:$(id -u)"'];
  const m = await run('docker', args, 120000);
  if (!add('A container starts with your folders', m.code === 0, m.code === 0 ? `${names.length} folder${names.length === 1 ? '' : 's'} mounted` : friendly(m))) return { ok: false, steps };
  const out = String(m.stdout), dirs = [...out.matchAll(/^DIR:\/workspace\/([^:]+):(\d+)$/gm)];
  for (const [f, n] of names) { const hit = dirs.find(x => x[1] === n); add(`Folder ${n}`, !!hit, hit ? `${hit[2]} item${hit[2] === '1' ? '' : 's'} visible (read-only in this test)` : `not visible inside the container (${f})`); }
  const secrets = (/^SECRETS:(.*)$/m.exec(out) || [, ''])[1].trim(); add('No key files inside the shared folders', !secrets, secrets ? `Found: ${secrets}. They are in a folder you shared, so the sandbox can read them. Move them out or share a smaller folder.` : 'none found');
  const iso = await run('docker', ['run', '--rm', '--network', 'none', IMAGE, 'sh', '-c', 'ls /workspace 2>/dev/null | wc -l; ls /output 2>/dev/null | wc -l; ls /mnt 2>/dev/null | wc -l; ls /host_mnt /run/desktop 2>/dev/null | wc -l'], 60000);
  const nums = String(iso.stdout).trim().split(/\s+/).map(Number); add('Without a mount it sees nothing of your computer', iso.code === 0 && nums.length >= 3 && nums.every(n => n === 0), iso.code === 0 ? (nums.every(n => n === 0) ? 'empty, as it should be' : `it saw ${nums.join('/')} items`) : friendly(iso));
  return { ok: steps.every(x => x.ok), steps };
}

module.exports = { IMAGE, MEM_CHOICES, defaults, normalize, clampMemory, checkFolders, volumeNames, volumes, terminalLines, scrubEnv, probeDocker, testSandbox, friendly, SECRETISH, get lastDockerMB() { return lastDockerMB; } };
