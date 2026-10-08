'use strict';
// A fake `hermes` for the supervisor tests. It needs no Hermes install and no network.
// FAKE_HERMES_MODE picks the gateway behaviour: alive (default) | fatal | crash.
// HERMES_HOME is inherited from the environment that HermesEngine sets. Never override it in a launcher.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const mode = process.env.FAKE_HERMES_MODE || 'alive';
const home = process.env.HERMES_HOME || '';

if (args[0] === '--version') { console.log('Hermes Agent v9.9.9 (fake)'); process.exit(0); }

if (args[0] === 'profile' && args[1] === 'create') {
  fs.mkdirSync(path.join(home, 'profiles', args[2]), { recursive: true });
  console.log('created profile ' + args[2]);
  process.exit(0);
}

const pi = args.indexOf('-p');
const id = pi >= 0 ? args[pi + 1] : 'default';
if (args.includes('gateway') && args.includes('run')) {
  const dir = path.join(home, 'profiles', id);
  fs.mkdirSync(dir, { recursive: true });
  const write = o => fs.writeFileSync(path.join(dir, 'gateway_state.json'), JSON.stringify({ pid: process.pid, kind: 'hermes-gateway', updated_at: new Date().toISOString(), ...o }));
  if (mode === 'fatal') { // what Hermes v0.21.3 does with a rejected Telegram token
    write({ gateway_state: 'startup_failed', exit_reason: 'telegram: Telegram bot token rejected (fake).', platforms: { telegram: { state: 'fatal', error_code: 'telegram_auth_error', error_message: 'Telegram bot token rejected (fake).' } } });
    process.exit(78);
  }
  if (mode === 'crash') process.exit(1); // dies at once, leaves no state file
  write({ gateway_state: 'running', platforms: { telegram: { state: 'connected' } } });
  setInterval(() => {}, 1000); // stay alive until killed
} else {
  console.error('fake hermes: unsupported arguments: ' + args.join(' '));
  process.exit(2);
}
