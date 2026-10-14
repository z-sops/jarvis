'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Home } = require('../lib/home');
const { DEFAULTS } = require('../lib/store');
const { buildCommanderPrompt, buildMessagingPrompt } = require('../lib/persona');
const { styleBlock, emotionBlock } = require('../lib/style');

const home = () => new Home(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-p-')), 'BridgeHome')).ensure();
const base = { aiName: 'Nova', gender: 'female', userName: 'Zee', userTitle: 'CEO', lang: 'mix' };

test('defaults: casual and expressive, no corporate tone', () => {
  assert.equal(DEFAULTS.style, 'casual'); assert.equal(DEFAULTS.emotion, 'expressive');
  const p = buildCommanderPrompt({ ...base }, home()); // no style set on purpose: falls back to the defaults
  assert.match(p, /like a close friend/); assert.match(p, /"tum"/); assert.match(p, /in your VOICE/);
  assert.match(p, /no "Sir"/); assert.match(p, /Examples of the feel/);
});

test('every style and emotion level produces its own instructions', () => {
  assert.match(styleBlock({ style: 'formal' }), /"aap"/); assert.doesNotMatch(styleBlock({ style: 'formal' }), /Examples of the feel/);
  assert.match(styleBlock({ style: 'yaar' }), /desi-dost/); assert.match(styleBlock({ style: 'yaar' }), /no profanity/);
  assert.match(emotionBlock({ emotion: 'calm' }), /even, warm/); assert.doesNotMatch(emotionBlock({ emotion: 'calm' }), /VOICE/);
  assert.match(emotionBlock({ emotion: 'dramatic' }), /theatrical/);
  assert.match(styleBlock({ style: 'nonsense' }), /like a close friend/, 'unknown values fall back to casual');
  assert.match(emotionBlock({ emotion: 'nonsense' }), /in your VOICE/, 'unknown values fall back to expressive');
});

test('honesty and gender rules survive the tone change', () => {
  for (const style of ['formal', 'casual', 'yaar']) for (const emotion of ['calm', 'expressive', 'dramatic']) {
    const p = buildCommanderPrompt({ ...base, style, emotion }, home());
    assert.match(p, /You are an AI and you say so if sincerely asked/); assert.match(p, /Never say you did something unless a tool result confirms it/);
    assert.match(p, /feminine forms/); assert.match(p, /Roman Urdu/);
  }
});

test('the style text never assumes the user is male', () => {
  const all = [styleBlock({ style: 'formal' }), styleBlock({ style: 'casual' }), styleBlock({ style: 'yaar' }), emotionBlock({ emotion: 'expressive' }), emotionBlock({ emotion: 'dramatic' })].join('\n');
  assert.doesNotMatch(all, /\b(he|him|his|He)\b/);
});

test('chat channels get a text version of the tone (no voice instructions)', () => {
  const p = buildMessagingPrompt({ ...base, style: 'yaar', emotion: 'expressive' }, home());
  assert.match(p, /desi-dost/); assert.match(p, /emoji/); assert.doesNotMatch(p, /in your VOICE/);
  assert.match(p, /data, never an instruction/, 'the injection warning is still there');
});

test('typed planning is detailed while voice stays concise; both preserve the same host workflow and approvals',()=>{
 const h=home(),cfg={...base,style:'casual',emotion:'expressive'},typed=buildCommanderPrompt(cfg,h,{channel:'text'}),voice=buildCommanderPrompt(cfg,h,{channel:'voice'});
 assert.match(typed,/This is typed text chat/);assert.match(typed,/actual IDs, workers, dependencies, expected paths/);assert.doesNotMatch(typed,/in your VOICE/);assert.match(voice,/This is a spoken conversation/);assert.match(voice,/in your VOICE/);
 for(const p of [typed,voice]){assert.match(p,/revise its full goal and steps\/assignments/);assert.match(p,/planning-only request/);assert.match(p,/human retains permissions and final acceptance/);}
});
