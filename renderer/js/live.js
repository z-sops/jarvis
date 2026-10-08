/* Two-way voice with the Gemini Live API: microphone in, speech out, barge-in, and tool calls executed by the main process. */
(function () {
  'use strict';
  const WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
  const b64ToBytes = b64 => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  function bytesToB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  // Level for the on-screen meter: dBFS mapped so quiet speech (-45 dB) fills about a third and loud speech (-15 dB) nearly all of the bar.
  const dbLevel = rms => (rms <= 1e-5 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 50)));
  // The AI must follow the user's own clock, not guess the time of day.
  function timeNote(now = new Date()) {
    const h = now.getHours(), part = h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
    const t = now.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }), day = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return `[Local time on the user's computer: ${t}, ${day}. It is ${part}. Greet with the right time of day; never say "good morning" unless it is morning.]`;
  }
  const f32ToPcm16 = f => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } return o; };

  class LiveClient {
    constructor(h) {
      this.h = h; this.ws = null; this.state = 'offline'; this.ready = false; this.want = false; this.muted = false; this.retries = 0;
      this.cur = { user: '', ai: '' }; this.playing = 0; this.tools = 0; this.next = 0; this.sources = new Set(); this.q = Promise.resolve(); this.lastActivity = Date.now();
      this.micInfo = {}; this.lastMicEmit = 0; this.quietSince = 0; this.warned = false; this.micBlocks = 0; this.testing = false;
    }
    setState(s) { if (this.state === s) return; this.state = s; this.h.onState && this.h.onState(s); }
    get connected() { return this.ready; }

    async start({ greet } = {}) {
      if (this.ws || this.starting) return; this.endMicTest(); this.starting = true; this.want = true; this.greet = greet;
      try {
        this.ctxInfo = await bridge.live.context();
        if (!this.ctxInfo.apiKey) { this.want = false; this.h.onError('Voice needs your Gemini key. Add it in Settings.'); return; }
        this.setState('connecting');
        try { await this.openMic(); } catch (e) { this.h.onError(`Microphone unavailable (${e.message}). I can still talk to you; typing works too.`); }
        this.initPlayback(); this.openSocket();
      } finally { this.starting = false; }
    }
    async openMic() {
      const cfg = await bridge.config.get().catch(() => ({}));
      const processing = cfg.micProcessing !== false;             // echo cancellation, noise suppression and automatic gain; some drivers turn these into silence
      const audio = { channelCount: 1, echoCancellation: processing, noiseSuppression: processing, autoGainControl: processing };
      if (cfg.micDeviceId) audio.deviceId = { exact: cfg.micDeviceId };
      try { this.stream = await navigator.mediaDevices.getUserMedia({ audio }); }
      catch (e) { if (!audio.deviceId) throw e; this.h.onNotice && this.h.onNotice('The microphone you picked is not available, so I am using the Windows default.'); delete audio.deviceId; this.stream = await navigator.mediaDevices.getUserMedia({ audio }); }
      const track = this.stream.getAudioTracks()[0];
      this.micInfo = { label: (track && track.label) || 'default microphone' };
      const onBlock = f32 => {
        let sum = 0; for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
        const rms = Math.sqrt(sum / f32.length); this.micLevel = Math.min(1, rms * 6); this.micRms = rms; this.micDisplay = dbLevel(rms); this.micBlocks++;
        this.h.onLevel && this.h.onLevel({ mic: this.muted ? 0 : this.micLevel }); this.emitMic();
        if (this.micLevel > 0.12 && !this.muted) this.lastActivity = Date.now();
        if (this.ready && !this.muted && this.ws && this.ws.readyState === 1) this.send({ realtimeInput: { audio: { data: bytesToB64(new Uint8Array(f32ToPcm16(f32).buffer)), mimeType: 'audio/pcm;rate=16000' } } });
      };
      // The audio engine normally runs at the sound card's rate (48 kHz); the worklet converts to 16 kHz. cfg.micNative false asks the engine for 16 kHz itself (older behaviour).
      const build = async (rate16) => {
        const ctx = new AudioContext(rate16 ? { sampleRate: 16000 } : {}); if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const src = ctx.createMediaStreamSource(this.stream), mute = ctx.createGain(); mute.gain.value = 0; mute.connect(ctx.destination);
        const boost = ctx.createGain(); boost.gain.value = processing ? 1 : 3;   // without automatic gain the sound is quiet: lift it a little
        src.connect(boost); this.micCtx = ctx;
        try {
          await ctx.audioWorklet.addModule('mic-worklet.js');
          const node = new AudioWorkletNode(ctx, 'pcm-capture'); node.port.onmessage = e => onBlock(e.data); boost.connect(node); node.connect(mute); this.micNode = node;
        } catch (e) { // no AudioWorklet from file://: the older ScriptProcessor, which needs a 16 kHz engine
          if (!rate16) { try { await ctx.close(); } catch {} return build(true); }
          const sp = ctx.createScriptProcessor(1024, 1, 1); sp.onaudioprocess = ev => onBlock(new Float32Array(ev.inputBuffer.getChannelData(0))); boost.connect(sp); sp.connect(mute); this.micNode = sp;
        }
      };
      await build(!cfg.micNative);
      this.lastBlocks = this.micBlocks; this.quietSince = 0; this.warned = false; clearInterval(this.micWatch); this.micWatch = setInterval(() => this.watchMic(), 1000); this.emitMic(true);
    }
    // How loud is one microphone? Opens it for a moment and reports the loudest instant in dBFS. Used by "Find my mic".
    async measureMic(deviceId, { processing = true, rate16 = false } = {}, ms = 1500) {
      const audio = { channelCount: 1, echoCancellation: !!processing, noiseSuppression: !!processing, autoGainControl: !!processing }; if (deviceId) audio.deviceId = { exact: deviceId };
      let stream = null, ctx = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio }); const track = stream.getAudioTracks()[0];
        ctx = new AudioContext(rate16 ? { sampleRate: 16000 } : {}); if (ctx.state === 'suspended') await ctx.resume();
        const an = ctx.createAnalyser(); an.fftSize = 2048; ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(an.fftSize); let peak = 0; const t0 = performance.now();
        await new Promise(res => { const iv = setInterval(() => { an.getFloatTimeDomainData(buf); let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]; peak = Math.max(peak, Math.sqrt(sum / buf.length)); if (performance.now() - t0 >= ms) { clearInterval(iv); res(); } }, 40); });
        return { peakDb: peak > 0 ? Math.round(20 * Math.log10(peak)) : -120, muted: !!track.muted, state: ctx.state, rate: ctx.sampleRate };
      } finally { try { stream && stream.getTracks().forEach(t => t.stop()); } catch {} try { ctx && ctx.close(); } catch {} }
    }
    // Tries every microphone twice (with and without Windows' voice processing). onStep({ i, n, label }) reports progress.
    async probeMics(onStep, ms = 1500) {
      let devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
      if (devs.length && !devs[0].label) { try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop()); devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch { /* the labels stay empty */ } }
      const out = [];
      for (let i = 0; i < devs.length; i++) {
        const d = devs[i], r = { id: d.deviceId, label: d.label || `Microphone ${i + 1}` }; if (onStep) onStep({ i, n: devs.length, label: r.label });
        for (const [k, processing] of [['raw', false], ['processed', true]]) { try { r[k] = await this.measureMic(d.deviceId, { processing }, ms); } catch (e) { r[k] = { error: `${e.name || 'Error'}: ${e.message || e}` }; } }
        out.push(r);
      }
      return out;
    }
    // Numbers for the on-screen meter (window.__mic and a "bridge:mic" event), about ten times a second.
    emitMic(force) {
      const now = Date.now(); if (!force && now - this.lastMicEmit < 90) return; this.lastMicEmit = now;
      const rms = this.micRms || 0, quiet = rms < 0.0001; // below about -80 dB: a quiet room with noise suppression sits near -70 dB and is fine if (!quiet) this.quietSince = 0; else if (!this.quietSince) this.quietSince = now;
      const tr = this.stream && this.stream.getAudioTracks()[0], level = this.muted ? 0 : (this.micDisplay || 0);
      const detail = { level, muted: this.muted, live: this.ready, connecting: !!this.want && !this.ready, testing: this.testing, device: this.micInfo.label || '', ctx: this.micCtx ? this.micCtx.state : 'none',
        track: tr ? tr.readyState + (tr.muted ? ', muted by the system' : '') : 'none', silentFor: this.quietSince ? (now - this.quietSince) / 1000 : 0, hearing: !this.muted && level > 0.3, db: rms ? Math.round(20 * Math.log10(rms)) : -100 };
      window.__mic = detail; window.dispatchEvent(new CustomEvent('bridge:mic', { detail }));
    }
    // Once a second: wake a sleeping audio context and say so if the microphone gives nothing.
    watchMic() {
      if (this.micCtx && this.micCtx.state === 'suspended') this.micCtx.resume().catch(() => {});
      const stalled = this.micBlocks === this.lastBlocks; this.lastBlocks = this.micBlocks;
      const tr = this.stream && this.stream.getAudioTracks()[0], dead = !!tr && (tr.readyState === 'ended' || tr.muted);
      if (stalled) this.emitMic(true);
      // Being quiet is normal and only shows on the meter. A chat message appears only when the microphone itself is broken.
      if ((stalled || dead) && !this.muted && (this.ready || this.testing) && !this.warned) {
        this.warned = true; this.h.onNotice && this.h.onNotice(stalled ? 'The microphone stopped sending sound. Click the MIC meter to pick your microphone again.' : 'Windows says the microphone is muted or unplugged. Check it, or click the MIC meter to pick another one.');
      } else if (!stalled && !dead) this.warned = false;
    }
    // Opens the microphone alone (no Google, no key) so the meter can prove the microphone works.
    async micTest(seconds = 15) {
      if (this.want) return 'live'; if (this.testing) return 'testing';
      this.testing = true; try { await this.openMic(); } catch (e) { this.testing = false; throw e; }
      clearTimeout(this.testTimer); this.testTimer = setTimeout(() => this.endMicTest(), seconds * 1000); return 'started';
    }
    endMicTest() { if (!this.testing) return; this.testing = false; clearTimeout(this.testTimer); this.closeMic(); }
    async restartMic() { if (!this.stream && !this.testing) return; const t = this.testing; this.closeMic(); this.testing = t; await this.openMic(); }
    closeMic() {
      clearInterval(this.micWatch); try { this.micNode && this.micNode.disconnect(); } catch {}
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      try { this.micCtx && this.micCtx.close(); } catch {}
      this.stream = this.micCtx = this.micNode = null; this.micRms = 0; this.micDisplay = 0; this.quietSince = 0; this.emitMic(true);
    }
    initPlayback() {
      this.outCtx = new AudioContext({ sampleRate: 24000 }); this.analyser = this.outCtx.createAnalyser(); this.analyser.fftSize = 512; this.analyser.connect(this.outCtx.destination);
      const buf = new Uint8Array(this.analyser.fftSize);
      this.meter = setInterval(() => { this.analyser.getByteTimeDomainData(buf); let s = 0; for (const v of buf) { const d = (v - 128) / 128; s += d * d; } this.h.onLevel && this.h.onLevel({ out: Math.min(1, Math.sqrt(s / buf.length) * 4) }); }, 50);
      this.idleTimer = setInterval(() => {
        const m = this.ctxInfo.idleMinutes; if (m > 0 && Date.now() - this.lastActivity > m * 60000 && !this.tools) { this.h.onNotice && this.h.onNotice(`Voice link closed after ${m} minutes of quiet. Press Ctrl+Alt+J or the mic to wake me.`); this.stop(); }
      }, 20000);
    }
    openSocket() {
      const c = this.ctxInfo, ws = new WebSocket(`${WS}?key=${encodeURIComponent(c.apiKey)}`); this.ws = ws; let opened = false;
      ws.onopen = () => {
        opened = true;
        this.send({ setup: {
          model: `models/${c.model}`,
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: c.voice } } } },
          systemInstruction: { parts: [{ text: c.systemPrompt }] },
          tools: [{ functionDeclarations: c.tools }],
          inputAudioTranscription: {}, outputAudioTranscription: {},
          contextWindowCompression: { slidingWindow: {} }
        } });
      };
      ws.onmessage = ev => { this.q = this.q.then(async () => { let raw = ev.data; if (raw instanceof Blob) raw = await raw.text(); let m; try { m = JSON.parse(raw); } catch { return; } await this.handle(m); }).catch(e => console.error(e)); };
      ws.onerror = () => { if (!opened) this.h.onError('Could not reach the voice service. Check your internet connection.'); };
      ws.onclose = ev => {
        const wasReady = this.ready; this.ready = false; this.ws = null; this.stopPlayback();
        if (this.want && wasReady && this.retries < 3) { this.retries++; this.setState('connecting'); setTimeout(() => this.want && !this.ws && this.openSocket(), 1200 * this.retries); return; }
        if (this.want && !wasReady) this.h.onError(`Voice link refused${ev.reason ? ': ' + ev.reason : ` (code ${ev.code})`}. Check the API key and the live model name in Settings.`);
        this.want = false; this.teardown(); this.setState('offline'); // give up cleanly: otherwise the mic button would only mute/unmute a dead link
      };
    }
    send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
    sendText(text) { this.lastActivity = Date.now(); this.send({ realtimeInput: { text } }); }
    setMuted(m) { this.muted = m; if (this.stream) this.stream.getAudioTracks().forEach(t => (t.enabled = !m)); this.h.onLevel && this.h.onLevel({ mic: 0 }); this.emitMic(true); }

    async handle(m) {
      if (m.setupComplete) {
        this.ready = true; this.retries = 0; this.lastActivity = Date.now(); this.setState('listening');
        if (this.greet) { this.sendText(this.greet + ' ' + timeNote()); this.greet = null; }
        return;
      }
      if (m.goAway) { this.h.onNotice && this.h.onNotice('Voice service is rotating the connection…'); return; }
      const sc = m.serverContent;
      if (sc) {
        if (sc.interrupted) { this.stopPlayback(); this.finishAi(); }
        if (sc.inputTranscription && sc.inputTranscription.text) { this.lastActivity = Date.now(); this.cur.user += sc.inputTranscription.text; this.h.onTranscript('user', this.cur.user, false); }
        if (sc.outputTranscription && sc.outputTranscription.text) { this.finishUser(); this.cur.ai += sc.outputTranscription.text; this.h.onTranscript('ai', this.cur.ai, false); }
        for (const p of (sc.modelTurn && sc.modelTurn.parts) || []) if (p.inlineData && p.inlineData.data) { this.finishUser(); this.enqueue(p.inlineData.data); }
        if (sc.turnComplete) { this.finishUser(); this.finishAi(); }
      }
      if (m.toolCall && m.toolCall.functionCalls) this.runTools(m.toolCall.functionCalls);
    }
    finishUser() { if (this.cur.user.trim()) this.h.onTranscript('user', this.cur.user.trim(), true); this.cur.user = ''; }
    finishAi() { if (this.cur.ai.trim()) this.h.onTranscript('ai', this.cur.ai.trim(), true); this.cur.ai = ''; }
    async runTools(calls) {
      this.tools++; this.setState('working'); const responses = [];
      for (const fc of calls) { let out; try { out = await Promise.race([bridge.live.tool(fc.name, fc.args || {}), new Promise(r => setTimeout(() => r({ ok: false, error: 'The tool did not answer within 90 seconds, so I stopped waiting for it (it may still be running).' }), 90000))]); } catch (e) { out = { ok: false, error: e.message }; } responses.push({ id: fc.id, name: fc.name, response: { result: out } }); }
      this.send({ toolResponse: { functionResponses: responses } }); this.tools--; this.lastActivity = Date.now();
      if (!this.tools && !this.playing) this.setState('listening');
    }
    enqueue(b64) {
      const bytes = b64ToBytes(b64), n = bytes.length >> 1, pcm = new Int16Array(bytes.buffer, bytes.byteOffset, n), f = new Float32Array(n);
      for (let i = 0; i < n; i++) f[i] = pcm[i] / 32768;
      const ab = this.outCtx.createBuffer(1, n, 24000); ab.copyToChannel(f, 0);
      const src = this.outCtx.createBufferSource(); src.buffer = ab; src.connect(this.analyser);
      const t = Math.max(this.next, this.outCtx.currentTime + 0.03); src.start(t); this.next = t + ab.duration;
      this.sources.add(src); this.playing++; this.setState('speaking'); this.lastActivity = Date.now();
      src.onended = () => { this.sources.delete(src); if (--this.playing <= 0) { this.playing = 0; if (!this.tools && this.ready) this.setState('listening'); } };
    }
    stopPlayback() { for (const s of this.sources) { try { s.onended = null; s.stop(); } catch {} } this.sources.clear(); this.playing = 0; this.next = 0; if (this.ready && !this.tools) this.setState('listening'); }
    teardown() {
      clearInterval(this.meter); clearInterval(this.idleTimer); this.closeMic();
      try { this.outCtx && this.outCtx.close(); } catch {}
      this.outCtx = null; this.h.onLevel && this.h.onLevel({ mic: 0, out: 0 });
    }
    stop() { this.want = false; this.ready = false; const ws = this.ws; this.ws = null; if (ws) try { ws.close(1000); } catch {} this.finishUser(); this.finishAi(); this.stopPlayback(); this.teardown(); this.setState('offline'); }
  }
  LiveClient.timeNote = timeNote; LiveClient.dbLevel = dbLevel;
  window.LiveClient = LiveClient;
})();
