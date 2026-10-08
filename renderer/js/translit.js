/* Devanagari (Hindi script) to Roman letters, for the words the microphone writes down. Urdu and Hindi sound the same, so the voice
   service often writes an Urdu speaker's words in Devanagari; this shows them the way people type Roman Urdu. Everything else is left alone. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Translit = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const IND = { '\u0905': 'a', '\u0906': 'aa', '\u0907': 'i', '\u0908': 'ee', '\u0909': 'u', '\u090A': 'oo', '\u090B': 'ri', '\u090F': 'e', '\u0910': 'ai', '\u0913': 'o', '\u0914': 'au', '\u0911': 'o', '\u090D': 'e', '\u0900': 'n', '\u0904': 'a', '\u090C': 'lri', '\u090E': 'e', '\u0912': 'o', '\u0950': 'om' };
  const MAT = { '\u093E': 'a', '\u093F': 'i', '\u0940': 'ee', '\u0941': 'u', '\u0942': 'oo', '\u0943': 'ri', '\u0947': 'e', '\u0948': 'ai', '\u094B': 'o', '\u094C': 'au', '\u0949': 'o', '\u0945': 'e' };
  const CON = { '\u0915': 'k', '\u0916': 'kh', '\u0917': 'g', '\u0918': 'gh', '\u0919': 'ng', '\u091A': 'ch', '\u091B': 'chh', '\u091C': 'j', '\u091D': 'jh', '\u091E': 'ny', '\u091F': 't', '\u0920': 'th', '\u0921': 'd', '\u0922': 'dh', '\u0923': 'n', '\u0924': 't', '\u0925': 'th', '\u0926': 'd', '\u0927': 'dh', '\u0928': 'n', '\u092A': 'p', '\u092B': 'ph', '\u092C': 'b', '\u092D': 'bh', '\u092E': 'm', '\u092F': 'y', '\u0930': 'r', '\u0932': 'l', '\u0933': 'l', '\u0935': 'v', '\u0936': 'sh', '\u0937': 'sh', '\u0938': 's', '\u0939': 'h', '\u0929': 'n', '\u0931': 'r', '\u0934': 'l', '\u0958': 'q', '\u0959': 'kh', '\u095A': 'gh', '\u095B': 'z', '\u095C': 'r', '\u095D': 'rh', '\u095E': 'f', '\u095F': 'y' };
  const NUKTA = { '\u0915': 'q', '\u0916': 'kh', '\u0917': 'gh', '\u091C': 'z', '\u0921': 'r', '\u0922': 'rh', '\u092B': 'f' };
  const DIG = { '\u0966': '0', '\u0967': '1', '\u0968': '2', '\u0969': '3', '\u096A': '4', '\u096B': '5', '\u096C': '6', '\u096D': '7', '\u096E': '8', '\u096F': '9' };
  const VIRAMA = '\u094D', NUKTA_MARK = '\u093C', ANUSVARA = '\u0902', CANDRA = '\u0901', VISARGA = '\u0903', DANDA = '\u0964', DDANDA = '\u0965';
  const isDev = ch => ch >= '\u0900' && ch <= '\u097F';
  const has = s => /[\u0900-\u097F]/.test(String(s || ''));


  // English words that the service writes in Devanagari go back to their English spelling (memory, chief, folder), instead of being spelled by their sound.
  const LOAN_SRC = 'मेमोरी memory|चीफ chief|फोल्डर folder|फाइल file|फाइलें files|कंप्यूटर computer|कम्प्यूटर computer|लैपटॉप laptop|मोबाइल mobile|फोन phone|ऐप app|एप app|अपडेट update|सेटिंग settings|सेटिंग्स settings|डाउनलोड download|अपलोड upload|सर्च search|गूगल google|यूट्यूब youtube|व्हाट्सएप whatsapp|व्हाट्सऐप whatsapp|मैसेज message|ईमेल email|टास्क task|जॉब job|क्रू crew|एजेंट agent|प्रोजेक्ट project|कोड code|टेस्ट test|टेस्टिंग testing|बग bug|एरर error|सर्वर server|डेटाबेस database|वेबसाइट website|पेज page|लिंक link|ओपन open|क्लोज close|स्टार्ट start|स्टॉप stop|ओके okay|हेलो hello|हैलो hello|सॉरी sorry|थैंक्स thanks|प्लीज please|प्रॉब्लम problem|सॉल्यूशन solution|परफॉर्मेंस performance|रिपोर्ट report|सिस्टम system|मॉनिटरिंग monitoring|मोड mode|रेस्ट rest|होल्ड hold|वॉइस voice|वॉयस voice|माइक mic|माइक्रोफोन microphone|स्पीकर speaker|वॉल्यूम volume|साउंड sound|कैमरा camera|वीडियो video|ऑडियो audio|चैट chat|टेक्स्ट text|टाइम time|डेट date|गुड good|ग्रेट great|नाइस nice|फाइन fine|कूल cool|डन done|रेडी ready|वेट wait|चेक check|शो show|क्लिक click|टाइप type|सेव save|डिलीट delete|कॉपी copy|पेस्ट paste|चार्ट chart|ग्राफ graph|पॉपुलेशन population|स्क्रीन screen|ब्राउज़र browser|ब्राउजर browser|विंडो window|टैब tab|बटन button|मेनू menu|आइकन icon|डेस्कटॉप desktop|डेस्कटाप desktop|लॉगिन login|पासवर्ड password|अकाउंट account|ट्रांसक्रिप्शन transcription|ट्रांसक्रिप्ट transcript|रिकॉर्डिंग recording|रिकॉर्ड record|लाइव live|ऑनलाइन online|ऑफलाइन offline|इंटरनेट internet|वाईफाई wifi|नेटवर्क network|बैटरी battery|चार्जर charger|चार्जिंग charging|डॉक्टर doctor|ऑफिस office|मीटिंग meeting|कॉल call|बॉस boss|सर sir|मैम madam|कस्टमर customer|क्लाइंट client|ऑर्डर order|पेमेंट payment|बिल bill|इनवॉइस invoice|डैशबोर्ड dashboard|एडमिन admin|यूज़र user|यूजर user|डेवलपर developer|डिज़ाइन design|डिजाइन design|डिजाइनर designer|फीचर feature|वर्जन version|इंस्टॉल install|रन run|रनिंग running|स्टेटस status|लॉग log|लॉग्स logs|कमांड command|शेल shell|टर्मिनल terminal|पायथन python|जावास्क्रिप्ट javascript|गिटहब github|डॉकर docker|फ्लटर flutter|रिएक्ट react|ऑर्बिट orbit|ब्रिज bridge|क्लॉड claude|जेमिनी gemini|चैटजीपीटी chatgpt|एआई ai|एपीआई api|यस yes|नो no|हाई hi|बाय bye|नाइट night|मॉर्निंग morning|ईवनिंग evening|सुपर super|फिक्स fix|फिक्स्ड fixed|इश्यू issue|बैकअप backup|रीस्टार्ट restart|रिफ्रेश refresh|कनेक्ट connect|कनेक्टर connector|कनेक्शन connection|पर्मिशन permission|अलर्ट alert|नोटिफिकेशन notification|शेड्यूल schedule|कैलेंडर calendar|नोट note|नोट्स notes|लिस्ट list|टेबल table|प्लान plan|आइडिया idea|पॉइंट point|लेवल level|स्पीड speed|फास्ट fast|स्लो slow|क्विक quick|सिंपल simple|इज़ी easy|इजी easy|हार्ड hard|पावर power|ऑन on|ऑफ off';
  const KEY = w => String(w).replace(/[\u093C\u200C\u200D]/g, '').replace(/\u0901/g, '\u0902');
  const LOAN = Object.create(null); for (const pair of LOAN_SRC.split('|')) { const i = pair.lastIndexOf(' '); LOAN[KEY(pair.slice(0, i))] = pair.slice(i + 1); }

  // Names you use (yours, hers, the crew) are matched by sound and written the way they are spelled: लैला to Laila, एलेक्स to Alex.
  let NAMES = new Map(), CALLME = null;
  const nn = x => String(x).toLowerCase().replace(/aa/g, 'a').replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/ph/g, 'f').replace(/z/g, 'j').replace(/w/g, 'v').replace(/x/g, 'ks').replace(/(.)\1+/g, '$1');
  const skel = x => nn(x).replace(/[aeiouyh]/g, '').replace(/(.)\1+/g, '$1');
  const first = x => (/^[aeiou]/i.test(x) ? 'v' : String(x)[0].toLowerCase());
  function setNames(list) {
    NAMES = new Map(); CALLME = null; for (const n of list || []) { const name = String(n || '').trim(); if (/^[A-Za-z]{2,20}$/.test(name) && nn(name) === 'ji') CALLME = name;   // a name that sounds like the everyday word ji (Zee): only matched in "call me ..." phrases
      if (!/^[A-Za-z]{3,20}$/.test(name)) continue; const k = nn(name); if (k.length >= 3) NAMES.set('n:' + k, name); const sk = skel(name); if (sk.length >= 3) NAMES.set('s:' + sk + ':' + first(name), name); }   // a short name like Zee is too easily an ordinary word (ji), so it is not matched
  }
  function nameFor(roman) { if (!NAMES.size || roman.length < 3) return null; return NAMES.get('n:' + nn(roman)) || (skel(roman).length >= 3 ? NAMES.get('s:' + skel(roman) + ':' + first(roman)) : null) || null; }

  // One word (a run of Devanagari letters) to Roman. Syllables first, then the schwa rules of spoken Hindi:
  // the inherent "a" is silent at the end of a word (kar, not kara) and between two vowel-bearing syllables (tumne, not tumane).
  function word(w) {
    const sy = []; const cs = [...w];
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (IND[c] !== undefined) { sy.push({ c: '', v: IND[c], exp: true }); continue; }
      if (CON[c] !== undefined) {
        let cons = CON[c], j = i + 1; if (cs[j] === NUKTA_MARK) { cons = NUKTA[c] || cons; j++; }
        // a conjunct (क्ष, ज्ञ, र्ट ...): consonants joined by the virama share one syllable
        while (cs[j] === VIRAMA && CON[cs[j + 1]] !== undefined) { let nx = CON[cs[j + 1]], k = j + 2; if (cs[k] === NUKTA_MARK) { nx = NUKTA[cs[j + 1]] || nx; k++; } cons += nx; j = k; }
        if (cons === 'kSh' || false) cons = 'ksh';
        let v = null, exp = false;
        if (cs[j] === VIRAMA) { v = ''; exp = true; j++; }                 // a trailing virama: the consonant stands alone
        else if (MAT[cs[j]] !== undefined) { v = MAT[cs[j]]; exp = true; j++; }
        else v = 'a';                                                     // the inherent vowel
        sy.push({ c: cons, v, exp, inh: v === 'a' && !exp }); i = j - 1; continue;
      }
      if (c === ANUSVARA || c === CANDRA) { sy.push({ c: '', v: 'n', exp: true, mark: true }); continue; }
      if (c === VISARGA) { sy.push({ c: '', v: 'h', exp: true, mark: true }); continue; }
      if (DIG[c] !== undefined) { sy.push({ c: '', v: DIG[c], exp: true, lit: true }); continue; }
      if (c === NUKTA_MARK || c === VIRAMA) continue;
      if (c >= '\u0900' && c <= '\u097F') continue;                    // any other mark of the script (accents, rare signs) is left out, not left in
      sy.push({ c: '', v: c, exp: true, lit: true });
    }
    { const last = sy[sy.length - 1]; if (last && last.c && /ph$/.test(last.c) && !last.lit) last.c = last.c.replace(/ph$/, 'f'); }   // sirf, saaf, maaf, barf (not sirph)
    // final inherent "a" is silent
    for (let i = sy.length - 1; i >= 0; i--) { if (sy[i].mark || sy[i].lit) continue; if (sy[i].inh && sy[i].c) sy[i].v = ''; break; }
    // an inherent "a" between a syllable before it and a vowel-bearing syllable after it is silent (right to left, never two in a row)
    let last = false;
    for (let i = sy.length - 2; i >= 1; i--) {
      const s = sy[i], nx = sy[i + 1], pv = sy[i - 1];
      if (s.inh && s.c && s.v === 'a' && !last && pv && pv.c !== undefined && !pv.lit && nx.c && nx.v && (nx.exp || nx.inh) && !nx.mark) { s.v = ''; last = true; } else last = false;   // (the next syllable must be one that is really said)
    }
    // long vowels: "aa" inside a word, a single "a" at the end (utha, kya) so it reads the way people type it
    const lastIdx = sy.length - 1, endsN = i => sy[i + 1] && sy[i + 1].mark && sy[i + 1].v === 'n' && i + 1 === lastIdx;
    return sy.map((s, i) => {
      let v = s.v, c = s.c === 'jny' ? 'gy' : s.c;
      if (v === 'a' && s.exp && !s.lit && c && i === lastIdx) v = 'a'; else if (v === 'a' && s.exp && c) v = 'aa';
      else if (v === 'ee' && c && (i === lastIdx || endsN(i))) v = 'i';                       // abhi, sahi, nahin (not abhee, sahee, naheen)
      else if (v === 'e' && c && endsN(i) && s.exp) v = 'ei';                                 // mein, tumhein (kahenge keeps its "e")
      return c + v;
    }).join('').replace(/aaa+/g, 'aa');
  }

  function toRoman(text) {
    if (!has(text)) return String(text == null ? '' : text);
    let out = '', run = '';
    const flush = () => { if (run) { const eng = LOAN[KEY(run)]; if (eng) out += eng; else { const r = word(run); out += nameFor(r) || r; } run = ''; } };
    for (const ch of String(text)) {
      if (isDev(ch) && ch !== DANDA && ch !== DDANDA) run += ch;
      else { flush(); out += ch === DANDA ? '.' : ch === DDANDA ? '.' : ch; }
    }
    flush(); if (CALLME) out = out.replace(/\bji(?=\s+(?:bula|kaho|kehna|kahna|bolo|pukaar)[a-z]*)/gi, CALLME);   // "mujhe sirf ji bulaana" is "...sirf Zee bulaana"; "haan ji" stays
    return out;
  }
  // Your own list of "the microphone writes this, I said that" (for example ji = Zee). Whole words only, not case sensitive.
  let GLOSS = [];
  function setGlossary(list) { GLOSS = []; for (const g of Array.isArray(list) ? list : []) { const from = String(g && g.heard || '').trim(), to = String(g && g.meant || '').trim(); if (!from || !to || from.length > 40 || to.length > 60) continue; try { GLOSS.push([new RegExp('(?<![\\p{L}\\p{N}])' + from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'giu'), to]); } catch { /* an odd entry is skipped */ } } }
  const applyGlossary = text => { let t = String(text == null ? '' : text); for (const [re, to] of GLOSS) t = t.replace(re, () => to); return t; };
  return { toRoman, has, word, setNames, setGlossary, applyGlossary };
});
