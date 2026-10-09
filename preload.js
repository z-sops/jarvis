'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
// One listener for the whole page; every screen subscribes to it (many listeners on ipcRenderer made Electron warn about a leak).
const busSubs = new Set(); ipcRenderer.on('bus', (_e, m) => { for (const cb of [...busSubs]) { try { cb(m); } catch (err) { console.error('bus listener failed:', err); } } });
contextBridge.exposeInMainWorld('bridge', {
  platform: process.platform,
  config: { get: () => inv('config:get'), save: p => inv('config:save', p), commission: c => inv('config:commission', c), reset: () => inv('config:reset') },
  pickDir: () => inv('dialog:pickDir'),
  testKey: k => inv('key:test', k),
  openExternal: u => inv('shell:openExternal', u),
  showInFolder: p => inv('shell:showInFolder', p),
  chat: { send: t => inv('chat:send', t), reset: () => inv('chat:reset'), pickFile: () => inv('chat:pickFile') },
  live: { context: () => inv('live:context'), tool: (n, a) => inv('tool:exec', n, a) },
  agents: { list: () => inv('agents:list'), inspect: id => inv('agents:inspect', id), create: a => inv('agents:create', a), update: (id, patch) => inv('agents:update', id, patch) },
  jobs: { dispatch: (actor, task, expectedOutputs, options) => inv('jobs:dispatch', actor, task, expectedOutputs, options), retry: id => inv('jobs:retry', id), review: (id, decision) => inv('jobs:review', id, decision) },
  comms: { get: () => inv('comms:get'), save: c => inv('comms:save', c), status: () => inv('comms:status'), stop: () => inv('comms:stop'), pair: () => inv('comms:pair') },
  screen: { look: q => inv('screen:look', q), frame: o => inv('screen:frame', o) },
  hermes: { check: o => inv('hermes:check', o) },
  opencode: { check: o => inv('opencode:check', o) },
  shutdown: { step: s => inv('shutdown:step', s), ack: () => inv('shutdown:ack') },
  connectors: { list: () => inv('connectors:list'), add: s => inv('connectors:add', s), test: id => inv('connectors:test', id), update: (id, p) => inv('connectors:update', id, p), roots: (id, r) => inv('connectors:roots', id, r), pickFolder: () => inv('connectors:pickFolder'), level: (id, t, l) => inv('connectors:level', id, t, l), native: (t, l) => inv('connectors:native', t, l), token: (id, t) => inv('connectors:token', id, t), remove: id => inv('connectors:remove', id) },
  memory: { get: () => inv('memory:get'), noteAdd: (t, p) => inv('memory:note:add', t, p), noteUpdate: (i, p) => inv('memory:note:update', i, p), noteRemove: i => inv('memory:note:remove', i), skillGet: s => inv('memory:skill:get', s), skillSave: s => inv('memory:skill:save', s), skillRemove: s => inv('memory:skill:remove', s), profile: p => inv('memory:profile', p), open: () => inv('memory:open'), glossaryGet: () => inv('memory:glossary:get'), glossarySet: l => inv('memory:glossary:set', l) },
  sys: { watch: on => inv('sys:watch', on), once: () => inv('sys:once') },
  startup: { mark: n => inv('startup:mark', n) },
  leads: { list: o => inv('leads:list', o), search: (q, limit) => inv('leads:search', q, limit), get: id => inv('leads:get', id), add: o => inv('leads:add', o), update: (id, patch) => inv('leads:update', id, patch), note: (id, text) => inv('leads:note', id, text), remove: id => inv('leads:remove', id) },
  library: { get: () => inv('library:get'), skillGet: n => inv('library:skill:get', n), skillSave: s => inv('library:skill:save', s), skillRemove: n => inv('library:skill:remove', n), packCreate: p => inv('library:pack:create', p), packRemove: n => inv('library:pack:remove', n), sources: n => inv('library:sources', n), sourceText: o => inv('library:source:text', o), sourceUrl: o => inv('library:source:url', o), sourceFile: o => inv('library:source:file', o), sourceRemove: (p, s) => inv('library:source:remove', p, s), sourceTrust: (p, s, t) => inv('library:source:trust', p, s, t), sourceReviewed: (p, s) => inv('library:source:reviewed', p, s), search: (p, q, t) => inv('library:search', p, q, t), assign: (id, a) => inv('library:assign', id, a) },
  quota: { limits: () => inv('quota:limits'), setLimits: l => inv('quota:setLimits', l), resetLimits: () => inv('quota:resetLimits'), models: () => inv('quota:models'), setText: id => inv('quota:setText', id) },
  sandbox: { get: id => inv('sandbox:get', id), set: (id, p) => inv('sandbox:set', id, p), test: id => inv('sandbox:test', id), pick: () => inv('sandbox:pick') },
  topics: { state: () => inv('topics:state'), switchTo: id => inv('topics:switch', id), create: t => inv('topics:create', t), rename: (id, t) => inv('topics:rename', id, t), remove: id => inv('topics:remove', id), append: (r, t, m) => inv('topics:append', r, t, m) },
  browser: { state: () => inv('browser:state'), watch: c => inv('browser:watch', c), nav: (c, u) => inv('browser:nav', c, u), tab: (c, a, id) => inv('browser:tab', c, a, id), takeover: (c, on) => inv('browser:takeover', c, on), resume: (c, d) => inv('browser:resume', c, d), input: (c, e) => inv('browser:input', c, e), clear: c => inv('browser:clear', c), settings: p => inv('browser:settings', p), crewCheck: () => inv('browser:crewCheck') },
  workspace: { tree: () => inv('ws:tree'), read: r => inv('ws:read', r), write: (r, t) => inv('ws:write', r, t), reveal: r => inv('ws:reveal', r), openRoot: () => inv('ws:openRoot'), watch: on => inv('ws:watch', on) },
  usage: { get: () => inv('usage:get') },
  logs: { tail: n => inv('logs:tail', n), reveal: () => inv('logs:reveal') },
  stop: { all: () => inv('stop:all'), busy: () => inv('busy:get'), agent: id => inv('stop:agent', id) },
  permission: { answer: (id, d) => inv('permission:answer', id, d) },
  win: { minimize: () => inv('win:minimize'), maximize: () => inv('win:maximize'), hide: () => inv('win:hide'), fullscreen: () => inv('win:fullscreen'), quit: () => inv('win:quit') },
  onBus: cb => { busSubs.add(cb); return () => busSubs.delete(cb); }
});
