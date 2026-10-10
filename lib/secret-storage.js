'use strict';
function createSecretStorage(safeStorage, platform = process.platform) {
  const available = () => {
    try { return !!safeStorage?.isEncryptionAvailable() && !(platform === 'linux' && ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())); }
    catch { return false; }
  };
  const fail = () => new Error('Protected credential storage is unavailable or locked. Unlock the OS key store before saving or using credentials. Existing files were preserved.');
  return {
    available,
    seal(value) {
      if (!available()) throw fail();
      try { return { orbitSecretVersion: 1, ciphertext: safeStorage.encryptString(JSON.stringify(value)).toString('base64') }; }
      catch { throw fail(); }
    },
    open(value) {
      if (!available() || value?.orbitSecretVersion !== 1 || typeof value.ciphertext !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.ciphertext)) throw fail();
      try { const out = JSON.parse(safeStorage.decryptString(Buffer.from(value.ciphertext, 'base64'))); if (!out || typeof out !== 'object' || Array.isArray(out)) throw fail(); return out; }
      catch { throw fail(); }
    }
  };
}
function splitSettings(value) {
  const settings = JSON.parse(JSON.stringify(value)), secrets = { apiKey: settings.apiKey || '', workerApiKey: settings.workerApiKey || '', workerRouteCredentials: settings.workerRouteCredentials || {}, comms: {} };
  delete settings.apiKey; delete settings.workerApiKey; delete settings.workerRouteCredentials;
  const take = (source, target) => {
    for (const [key, val] of Object.entries(source || {})) {
      if (/(token|password|secret|apiKey|credential)/i.test(key)) { target[key] = val; delete source[key]; }
      else if (val && typeof val === 'object' && !Array.isArray(val)) { const nested = {}; take(val, nested); if (Object.keys(nested).length) target[key] = nested; }
    }
  };
  take(settings.comms, secrets.comms);
  const anySecret = v => v && typeof v === 'object' ? Object.values(v).some(anySecret) : v !== '' && v !== null && v !== undefined;
  return { settings, secrets, hasSecrets: anySecret(secrets) };
}
function mergeSettings(settings, secrets) {
  const out = JSON.parse(JSON.stringify(settings));
  const merge = (a, b) => { for (const [k, v] of Object.entries(b || {})) { if (['__proto__', 'constructor', 'prototype'].includes(k)) throw new Error('Invalid protected credential data.'); if (v && typeof v === 'object' && !Array.isArray(v)) { a[k] = a[k] || {}; merge(a[k], v); } else a[k] = v; } };
  merge(out, secrets); return out;
}
module.exports = { createSecretStorage, splitSettings, mergeSettings };
