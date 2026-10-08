'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../renderer/js/translit');

test('the real lines from the voice session come out as everyday Roman Urdu (English words the English way)', () => {
  T.setNames([]);
  const cases = [['अभी सही है।', 'abhi sahi hai.'], ['यह Wikipedia का चार्ट तुमने वहां से उठा के यहां कॉपी कर दिया है।', 'yah Wikipedia ka chart tumne vahaan se utha ke yahaan copy kar diya hai.'], ['इलाहाबाद आ रही है तुम्हें?', 'ilaahaabaad aa rahi hai tumhein?'], ['नहीं, मुझे ऐसा चार्ट नहीं चाहिए।', 'nahin, mujhe aisa chart nahin chaahie.'],
    ['वापस ब्रिज पर आ जाओ।', 'vaapas bridge par aa jaao.'], ['लेकिन देखो, मुझे ब्राउज़र उस वक्त शो किया करो', 'lekin dekho, mujhe browser us vakt show kiya karo'], ['जब मैं तुमसे ब्राउज़र में कोई चीज ओपन करने को कहूं तो', 'jab main tumse browser mein koee cheej open karne ko kahoon to']];
  for (const [dev, roman] of cases) assert.equal(T.toRoman(dev), roman, dev);
});

test('the sound rules: silent a at the end and between syllables, the everyday spellings, conjuncts', () => {
  const c = { 'कहेंगे': 'kahenge', 'समझना': 'samajhna', 'करना': 'karna', 'बहुत': 'bahut', 'सहायता': 'sahaayta', 'क्या': 'kya', 'कहाँ': 'kahaan', 'ज्ञान': 'gyaan', 'ठीक': 'theek', 'कहीं': 'kahin', 'हूँ': 'hoon', 'हैं': 'hain', 'में': 'mein', 'वापस': 'vaapas', 'तुमने': 'tumne', 'जाओ': 'jaao', 'काम': 'kaam', 'कम': 'kam' };
  for (const [d, r] of Object.entries(c)) assert.equal(T.toRoman(d), r, d);
});

test('everything else is left alone: English, Roman Urdu, numbers, punctuation, emoji, empty and odd input', () => {
  for (const s of ['Alex ko bolo folder banaye', 'Hello, Zee! 22:40', 'a\nb\tc', '😀 ok', '', 'اردو']) assert.equal(T.toRoman(s), s, JSON.stringify(s)); assert.equal(T.toRoman(null), ''); assert.equal(T.toRoman(undefined), ''); assert.equal(T.toRoman(42), '42');
  assert.equal(T.toRoman('१२३ लोग'), '123 log', 'Devanagari digits'); assert.equal(T.toRoman('हाँ। ठीक॥'), 'haan. theek.', 'the danda is a full stop'); assert.equal(T.toRoman('Wikipedia का chart'), 'Wikipedia ka chart', 'mixed lines keep their English words');
  assert.equal(T.has('abc'), false); assert.equal(T.has('क'), true); assert.equal(T.has(''), false);
});

test('it never leaves Devanagari behind, never throws, and is fast (a whole page in a blink)', () => {
  const all = []; for (let c = 0x0900; c <= 0x097F; c++) all.push(String.fromCharCode(c)); const junk = all.join('') + all.reverse().join('') + '\u094D\u094D\u093C\u0902\u0902क्\u094Dा';
  assert.doesNotThrow(() => T.toRoman(junk)); const out = T.toRoman(junk); assert.ok(!/[\u0900-\u097F]/.test(out), 'no Devanagari letters remain (' + [...out].filter(x => /[\u0900-\u097F]/.test(x)).join('') + ')');
  const page = 'मैं ठीक हूँ और तुम कैसे हो? आज मौसम बहुत अच्छा है। '.repeat(2000); const t0 = Date.now(); const r = T.toRoman(page); assert.ok(Date.now() - t0 < 500, 'took ' + (Date.now() - t0) + ' ms'); assert.ok(r.startsWith('main theek hoon aur tum kaise ho?'), r.slice(0, 60));
});

test('English words the microphone wrote in Devanagari are written the English way again (this is Zee\'s own sentence)', () => {
  T.setNames(['Laila', 'Zee', 'Alex', 'Bob', 'Bilal', 'Sara']);
  assert.equal(T.toRoman('मेमोरी में लिखा है कि मुझे सिर्फ जी बुलाना है, चीफ का तो नाम ही नहीं लिखा मेमोरी में, दोबारा देखो।'), 'memory mein likha hai ki mujhe sirf Zee bulaana hai, chief ka to naam hi nahin likha memory mein, dobaara dekho.', 'memory and chief are English again, sirf has its f, and "ji bulaana" is the name');
  assert.equal(T.toRoman('हाँ जी, ठीक है जी'), 'haan ji, theek hai ji', 'an everyday "ji" stays ji');
  for (const [d, e] of [['ब्राउज़र', 'browser'], ['ब्राउजर', 'browser'], ['फोल्डर', 'folder'], ['टेस्टिंग', 'testing'], ['ओके', 'okay'], ['ऑफिस', 'office'], ['चार्ट', 'chart'], ['कंप्यूटर', 'computer'], ['सिर्फ', 'sirf'], ['साफ', 'saaf'], ['माफ', 'maaf'], ['फिर', 'phir'], ['फोन', 'phone']]) assert.equal(T.toRoman(d), e, d);
});

test('the names you use are written the way they are spelled, and only when they sound the same', () => {
  T.setNames(['Laila', 'Zee', 'Alex', 'Bob', 'Bilal', 'Sara']);
  assert.equal(T.toRoman('लैला एलेक्स अलेक्स बॉब बिलाल सारा'), 'Laila Alex Alex Bob Bilal Sara'); assert.equal(T.toRoman('बाबा लाला'), 'baaba laala', 'other words are not turned into names');
  T.setNames([]); assert.equal(T.toRoman('लैला बॉब'), 'laila bob', 'no names known: spelled by sound'); assert.equal(T.toRoman('जी बुलाना'), 'ji bulaana', 'and no name rule');
  T.setNames(['Ab', 'x1', '', null, 'Zee']); assert.equal(T.toRoman('जी'), 'ji'); assert.doesNotThrow(() => T.setNames(undefined)); T.setNames(['Laila']);
});

test('your own list: "the microphone writes this, I said that", whole words only, any case, and a bad entry does not break the rest', () => {
  T.setNames([]); T.setGlossary([{ heard: 'ji', meant: 'Zee' }, { heard: 'Tin Tin', meant: 'Tin Tin' }, { heard: 'smart c m e', meant: 'smartcme' }, { heard: 'a.b', meant: 'dot' }, { heard: '', meant: 'x' }, { heard: 'x', meant: '' }, null, { heard: '(', meant: 'paren' }]);
  assert.equal(T.applyGlossary('mujhe sirf ji bulana, JI bolo, ji.'), 'mujhe sirf Zee bulana, Zee bolo, Zee.'); assert.equal(T.applyGlossary('jinn jiji ajit'), 'jinn jiji ajit', 'a part of another word is left alone'); assert.equal(T.applyGlossary('open Smart C M E page'), 'open smartcme page'); assert.equal(T.applyGlossary('a.b and axb'), 'dot and axb', 'characters that mean something in a pattern are taken literally'); assert.equal(T.applyGlossary('a ( b'), 'a paren b'); assert.equal(T.applyGlossary(''), ''); assert.equal(T.applyGlossary(null), '');
  T.setGlossary(undefined); assert.equal(T.applyGlossary('ji'), 'ji', 'no list: nothing changes'); T.setGlossary(Array.from({ length: 300 }, (_, i) => ({ heard: 'w' + i, meant: 'm' + i }))); assert.equal(T.applyGlossary('w299 w0'), 'm299 m0'); T.setGlossary([]);
});
