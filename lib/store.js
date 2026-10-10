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
  workerMaxRequests: 40,     // actual builtin model POST attempts per job, including retries/fallback
  workerTimeoutSeconds: 1800, // execution deadline; no automatic replay after timeout
  nativeContinuity: true, // model transcript broker; unsupported providers fail closed
  nativeContainerImage: '', // installed immutable Linux image with Node20+ and native CLIs; never auto-pull
  workerTokenBudget: 0, workerCostBudgetUsd: 0, workerMaxOutputTokens: 4096,
  workerModelRates: {}, workerAllowedModels: [], workerRoutes: [], workerRouteCredentials: {}, // explicit USD/million input/output prices; no guessed prices
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

function createStore(file, { secretStorage = null } = {}) {
  let data = { ...DEFAULTS };
  let sealed = null, readFault = false;
  try {
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid settings file.');
      if (Object.hasOwn(saved, '_orbitSecrets') && (!saved._orbitSecrets || saved._orbitSecrets.orbitSecretVersion !== 1 || typeof saved._orbitSecrets.ciphertext !== 'string')) throw new Error('Invalid protected settings.');
      sealed = saved._orbitSecrets || null; delete saved._orbitSecrets;
      data = { ...DEFAULTS, ...saved };
    }
  } catch (e) {
    readFault = true; console.error('Settings unreadable. Existing file preserved; saving is blocked.');
  }
  const { splitSettings, mergeSettings } = require('./secret-storage');
  function current(strict = false) {
    if (sealed) {
      if (!secretStorage || !secretStorage.available()) { if (strict) throw new Error('Credential storage is locked. Existing settings were preserved.'); return { ...DEFAULTS, ...splitSettings(data).settings }; }
      try { return mergeSettings(data, secretStorage.open(sealed)); } catch (e) { if (strict) throw e; return { ...DEFAULTS, ...splitSettings(data).settings }; }
    }
    if (secretStorage && !secretStorage.available()) { if (strict && splitSettings(data).hasSecrets) throw new Error('Credential storage is unavailable. Existing settings were preserved.'); return { ...DEFAULTS, ...splitSettings(data).settings }; }
    return mergeSettings(data, {});
  }
  function persist(next) {
    if (readFault) throw new Error('Settings could not be read. Repair the existing file before saving.');
    const split = splitSettings(next);
    const protectedValue = secretStorage && split.hasSecrets ? secretStorage.seal(split.secrets) : null;
    const saved = secretStorage ? { ...split.settings, ...(protectedValue ? { _orbitSecrets: protectedValue } : {}) } : next;
    require('./job-storage').atomicWrite(file, saved);
    data = next; sealed = null;
  }
  return {
    get: () => current(),
    protect() { if (!secretStorage) return false; const next = current(true); persist(next); return true; },
    set(patch) {
      const next = current(true);
      for (const k of Object.keys(patch || {})) if (k in DEFAULTS) next[k] = patch[k];
      next.workerMaxRequests = Number(next.workerMaxRequests);
      if (typeof next.nativeContainerImage !== 'string' || next.nativeContainerImage && !/^sha256:[a-f0-9]{64}$/.test(next.nativeContainerImage)) throw new Error('Native runtime image must be an installed immutable sha256 image ID.');
      if (!Number.isSafeInteger(next.workerMaxRequests) || next.workerMaxRequests < 1 || next.workerMaxRequests > 500) throw new Error('Worker request limit must be an integer from 1 to 500.');
      next.workerTimeoutSeconds = Number(next.workerTimeoutSeconds);
      if (!Number.isSafeInteger(next.workerTimeoutSeconds) || next.workerTimeoutSeconds < 1 || next.workerTimeoutSeconds > 86400) throw new Error('Worker execution deadline must be an integer from 1 to 86400 seconds.');
      for (const k of ['workerTokenBudget','workerCostBudgetUsd','workerMaxOutputTokens']) next[k] = Number(next[k]);
      require('./job-budget').policy(next);
      require('./model-router').validate(next);
      if (!Array.isArray(next.workerAllowedModels) || next.workerAllowedModels.length > 100 || next.workerAllowedModels.some(m => typeof m !== 'string' || !/^[a-zA-Z0-9._-]{1,120}$/.test(m))) throw new Error('Worker models must be a bounded list of model IDs.');
      // a voice must belong to the chosen gender
      if (!VOICES[next.gender].some(v => v.id === next.voice)) next.voice = VOICES[next.gender][0].id;
      persist(next);
      return current();
    }
  };
}

module.exports = { createStore, DEFAULTS, VOICES };
