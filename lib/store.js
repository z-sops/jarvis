'use strict';
// Tiny JSON settings store. Kept free of Electron imports so it can be unit-tested.
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULTS = {
  commissioned: false,
  aiName: '',
  gender: 'female',          // 'female' | 'male'
  voice: 'Kore',
  lang: 'mix',               // 'mix' (Roman Urdu + English) | 'en' | 'ur'
  userName: '',
  userTitle: 'Commander',
  apiKey: '',
  textModel: 'gemini-3.8-flash',
  routerModel: '',           // blank = a lighter sibling of the text model is found automatically for quick decisions
  smartRoute: false,
  modelDecision: false,      // when on, a small model classifies each message that the rules cannot (can add a few seconds)         // when on, simple chat turns use the lighter model (decisions always run)
  liveModel: 'gemini-3.8-live',
  homeDir: path.join(os.homedir(), 'BridgeHome'),
  autostart: true,
  sfx: true,
  autoWake: false,           // open the voice session automatically when the app starts
  style: 'casual', emotion: 'expressive', browserApproval: 'sensitive', browserAllowLocal: false, browserIsolation: 'shared', orbitBrowserCrew: true, orbitDisableHermesBrowser: false, orbitMcpPort: 0, launchOnStart: true, launchFilmFull: false, shutdownSequence: true, classicLook: false, micDeviceId: '', micProcessing: true, micNative: false, screenHideBridge: true, idleMinutes: 10,           // close the voice session after this much silence
  // crew engine: 'builtin' (light Gemini loop), 'hermes' (Hermes Agent profiles, real coding tools)
  // or 'opencode' (OpenCode agent profiles, real coding tools, one-shot `opencode run` per job)
  engine: 'builtin',
  hermesPath: 'hermes',
  opencodePath: 'opencode',
  workerProvider: 'gemini',  // gemini | openrouter | anthropic | openai | custom
  workerModel: '',           // blank = the thinking model for Gemini
  workerApiKey: '',          // blank = reuse the Gemini key when provider is gemini
  workerBaseUrl: '',         // custom provider only
  workerContext: 128000,     // custom provider only
  safeMode: false,           // when on, even Laila's writes inside her own workspace ask for confirmation first (demo/client mode)
  hermesIdleMinutes: 10,     // stop an idle agent process after this long
  // messaging channels handled by the Hermes gateway (see lib/comms.js)
  comms: {}
};

const VOICES = {
  female: [
    { id: 'Kore', note: 'Firm and steady' },
    { id: 'Aoede', note: 'Breezy and warm' },
    { id: 'Leda', note: 'Youthful' },
    { id: 'Zephyr', note: 'Bright' }
  ],
  male: [
    { id: 'Charon', note: 'Informative, deep' },
    { id: 'Puck', note: 'Upbeat' },
    { id: 'Orus', note: 'Firm' },
    { id: 'Fenrir', note: 'Excitable' }
  ]
};

function createStore(file) {
  let data = { ...DEFAULTS };
  try {
    if (fs.existsSync(file)) data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    console.error('settings unreadable, using defaults:', e.message);
  }
  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }
  return {
    get: () => ({ ...data }),
    set(patch) {
      const next = { ...data };
      for (const k of Object.keys(patch || {})) if (k in DEFAULTS) next[k] = patch[k];
      // a voice must belong to the chosen gender
      if (!VOICES[next.gender].some(v => v.id === next.voice)) next.voice = VOICES[next.gender][0].id;
      data = next;
      persist();
      return { ...data };
    }
  };
}

module.exports = { createStore, DEFAULTS, VOICES };
