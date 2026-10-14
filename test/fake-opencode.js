'use strict';
// A fake `opencode` for opencode.test.js. It needs no OpenCode install and no network.
// `opencode run <task> --dir <ws>` reads <ws>/opencode.json (written by OpenCodeEngine) so the test
// can prove the right model/provider was actually handed to OpenCode, then writes proof.txt into
// <ws> (never into the fake's own cwd) so the test can prove --dir really scopes the job.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

if (args[0] === '--version') { console.log('OpenCode 1.99.9 (fake)'); process.exit(0); }

if (args[0] === 'run') {
  const task = args[1] || '';
  const di = args.indexOf('--dir');
  const dir = di >= 0 ? args[di + 1] : process.cwd();
  let model = '(no config)';
  try { model = JSON.parse(fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8')).model; } catch {}
  if (/fail/i.test(task)) { console.error('fake opencode: task asked to fail'); process.exit(1); }
  fs.writeFileSync(path.join(dir, 'proof.txt'), 'hello-from-opencode-crew\n');
  console.log(`Done: ${task} (model ${model})`);
  process.exit(0);
}

console.error('fake opencode: unsupported arguments: ' + args.join(' '));
process.exit(2);
