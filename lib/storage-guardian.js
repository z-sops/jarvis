'use strict';
// Metadata only. Never open database contents, remove WAL or infer safe deletion from age.
const fs = require('fs');
const path = require('path');
const CATEGORIES = ['db','wal','shm','events','jobs','checkpoints','knowledge','vector','memory','workspace','other'];
function category(rel) {
  const s = rel.toLowerCase();
  if (/-(wal|shm)$/.test(s)) return s.endsWith('-wal') ? 'wal' : 'shm';
  if (/\.(db|sqlite|sqlite3)$/.test(s)) return 'db';
  if (/(^|\/)(vectors?|embeddings?)(\/|\.)|\.(faiss|hnsw)$/.test(s)) return 'vector';
  if (/^(native-candidates|checkpoints|resume|backups)\//.test(s)) return 'checkpoints';
  if (/^(logs|events)\/|\.jsonl$/.test(s) && !s.startsWith('library/')) return 'events';
  if (/(^|\/)jobs\/.*\.json$/.test(s)) return 'jobs';
  if (s.startsWith('library/')) return 'knowledge';
  if (/(^|\/)(memory|memories|topics)\//.test(s)) return 'memory';
  if (s.startsWith('workspace/')) return 'workspace';
  return 'other';
}
function measure(root, {maxEntries = 100000, maxMilliseconds = 5000} = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 1000000 || !Number.isInteger(maxMilliseconds) || maxMilliseconds < 1 || maxMilliseconds > 60000) throw Error('Invalid storage measurement bounds.');
  root = path.resolve(root);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error('Storage root must be a real directory.');
  const totals = Object.fromEntries(CATEGORIES.map(c => [c,{bytes:0,files:0}])), workers = {};
  const stack = [[root,'',0]], started = Date.now();
  let entries = 0, skippedLinks = 0, errors = 0, bounded = false, allocatedBytes = 0, allocatedKnown = true;
  const seen = new Set();
  while (stack.length && !bounded) {
    const [dir,prefix,depth] = stack.pop();
    let names;
    try { names = fs.readdirSync(dir); } catch { errors++; continue; }
    for (const name of names) {
      if (++entries > maxEntries || Date.now()-started > maxMilliseconds) { bounded = true; break; }
      const full = path.join(dir,name), rel = prefix+name;
      let st; try { st = fs.lstatSync(full); } catch { errors++; continue; }
      if (st.isSymbolicLink()) { skippedLinks++; continue; }
      if (st.isDirectory()) { if (depth >= 64) { errors++; continue; } stack.push([full,rel+'/',depth+1]); continue; }
      if (!st.isFile() || !Number.isSafeInteger(st.size)) { errors++; continue; }
      // Hard links cannot be attributed reliably to one worker. Refuse rather than double-count.
      if (st.nlink !== 1) { skippedLinks++; continue; }
      const identity = st.ino ? st.dev+':'+st.ino : full;
      if (seen.has(identity)) { skippedLinks++; continue; } seen.add(identity);
      const c = category(rel); totals[c].bytes += st.size; totals[c].files++;
      if (Number.isSafeInteger(st.blocks) && st.blocks >= 0) allocatedBytes += st.blocks*512; else allocatedKnown = false;
      const m = /^(?:agents\/([a-z0-9][a-z0-9-]{0,40})\/|workspace\/([a-z0-9][a-z0-9-]{0,40})\/)/.exec(rel);
      if (m) { const id=m[1]||m[2]; workers[id] ||= {bytes:0,files:0}; workers[id].bytes+=st.size; workers[id].files++; }
    }
  }
  let freeBytes = null; try { const s=fs.statfsSync(root); freeBytes=s.bavail*s.bsize; } catch { errors++; }
  const logicalBytes=Object.values(totals).reduce((n,c)=>n+c.bytes,0);
  return {version:1,at:new Date().toISOString(),logicalBytes,allocatedBytes:allocatedKnown?allocatedBytes:null,freeBytes,totals,workers,coverage:{complete:!bounded&&!errors&&!skippedLinks,bounded,errors,skippedLinks,entries},
    scope:'Non-atomic metadata sample; no contents, payloads, keys or file paths. Docker and external native homes excluded unless measured separately.',
    memoryIndex:'Orbit Library uses in-memory BM25, not a persisted vector index. Filename-classified vector bytes are observational, not proof no embedded vectors exist.'};
}
function growth(before, after) {
  if (before?.version!==1 || after?.version!==1) throw Error('Unsupported storage samples.');
  return {logicalBytes:after.logicalBytes-before.logicalBytes,categories:Object.fromEntries(CATEGORIES.map(c=>[c,after.totals[c].bytes-before.totals[c].bytes])),complete:before.coverage.complete&&after.coverage.complete};
}
module.exports={measure,growth,category};
