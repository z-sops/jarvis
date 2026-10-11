'use strict';
const test = require('node:test');
const assert = require('node:assert');
const BT = require('../lib/browser-tools');

test('browser_open can be told to stay in the background (research the user did not ask to watch), and only then', async () => {
  const seen = []; const m = { open: async (actor, url, o) => { seen.push({ actor, url, ...o }); return { title: 'T', url, text: 'x' }; } };
  const def = BT.TOOLS.find(t => t.name === 'browser_open'); assert.ok(def.props.background, 'the option exists'); assert.match(def.props.background.description, /Browser screen/); assert.match(def.props.background.description, /did not ask to watch/); assert.deepEqual(def.required, ['url'], 'still only the address is required');
  await BT.execute(m, 'commander', 'browser_open', { url: 'https://example.com/a', background: true }); await BT.execute(m, 'commander', 'browser_open', { url: 'https://example.com/b' }); await BT.execute(m, 'alex', 'browser_open', { url: 'https://example.com/c', new_tab: true, background: 'yes' });
  assert.deepEqual(seen.map(s => [s.url.slice(-1), s.newTab, s.background]), [['a', false, true], ['b', false, false], ['c', true, true]], 'off unless asked for');
  const g = BT.geminiDecls(); const decl = (g.browser_open || Object.values(g).find(x => x && x.parameters && x.parameters.properties && x.parameters.properties.url)); assert.ok(JSON.stringify(g).includes('background'), 'Laila sees the option too');
  assert.ok(JSON.stringify(BT.mcpTools()).includes('background'), 'and the crew');
});

test('browser context reads its session user agent without creating a hidden window before localhost permission',async()=>{
 const {BrowserManager}=require('../lib/browser'),{EventEmitter}=require('events');let windows=0,asks=0,configured;
 const ses=new EventEmitter();Object.assign(ses,{getUserAgent:()=> 'Mozilla/5.0 Orbit/0.1 Chrome/100.0 Electron/44.4.3 Safari/537.36',setUserAgent:ua=>configured=ua,setPermissionRequestHandler:()=>{},setPermissionCheckHandler:()=>{},webRequest:{onBeforeRequest:()=>{}}});
 const browser=new BrowserManager({electron:{BrowserWindow:class{constructor(){windows++;throw Error('Unexpected native window before permission');}},session:{fromPartition:()=>ses},ipcMain:new EventEmitter()},home:{p:(...a)=>a.join('/')},getCfg:()=>({}),ask:async()=>{asks++;return 'deny';}});
 await assert.rejects(browser.open('commander','http://127.0.0.1:9999/'),/did not allow/);assert.equal(windows,0);assert.equal(asks,1);assert.ok(configured.includes('Chrome/100.0'));assert.ok(!configured.includes('Electron/'));browser.dispose();
});
