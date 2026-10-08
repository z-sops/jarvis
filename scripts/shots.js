'use strict';
// Developer-only: drives the real UI under a virtual display, saves screenshots and runs a fake-server check of the voice client.
// Usage: BRIDGE_SHOTS=/tmp/shots BRIDGE_USER_DATA=/tmp/ud xvfb-run -a npx electron --no-sandbox --disable-gpu .
const fs = require('fs'); const path = require('path');
module.exports = async (win, app, { store }) => {
  const dir = process.env.BRIDGE_SHOTS; fs.mkdirSync(dir, { recursive: true });
  win.setSize(1440, 900); win.show();
  const wc = win.webContents, js = c => wc.executeJavaScript(c), sleep = ms => new Promise(r => setTimeout(r, ms));
  wc.on('console-message', (_e, level, msg) => { if (level >= 2 || /^\[test\]/.test(msg)) console.log('[renderer]', msg); });
  const shot = async n => { const img = await wc.capturePage(); fs.writeFileSync(path.join(dir, n + '.png'), img.toPNG()); console.log('shot', n); };
  const click = sel => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const type = (id, v) => js(`(()=>{const i=document.getElementById(${JSON.stringify(id)});i.value=${JSON.stringify(v)};i.dispatchEvent(new Event('input'))})()`);
  try {
    if (store.get().commissioned) { for (let i = 0; i < 40 && !(await js(`document.body.classList.contains('revealed')`)); i++) await sleep(300); await sleep(3500); await shot('20-returning-user'); app.quit(); return; }
    await sleep(1500); await shot('01-boot');
    await sleep(3200); await shot('01b-boot-done'); await click('.ob-step .btn.primary');
    await sleep(700); await type('f-name', 'Nova'); await sleep(250); await shot('02-callsign'); await click('#ob-next');
    await sleep(700); await click('.vlist .vopt:nth-child(2)'); await sleep(200); await shot('03-voice'); await click('#ob-next');
    await sleep(700); await type('f-user', 'Zee'); await js(`[...document.querySelectorAll('.chip')].find(c=>c.textContent==='CEO').click()`); await sleep(250); await shot('04-commander'); await click('#ob-next');
    await sleep(700); await shot('05-uplink'); await click('.link.skip');
    await sleep(700); await shot('06-home'); await click('#ob-next');
    await sleep(700); await shot('07-summary'); await click('#ob-next');
    await sleep(1600); await shot('08-countdown');
    await sleep(5200); await shot('09-liftoff');
    await sleep(3500); await shot('10-ascent');
    await sleep(4500); await shot('11-space');
    for (let i = 0; i < 40 && !(await js(`document.body.classList.contains('revealed')`)); i++) await sleep(500);
    await sleep(3200); await shot('12-bridge-empty');

    // populate the crew and conversation
    await js(`(async()=>{
      await bridge.agents.create({name:'Alice',role:'Market researcher'}); await bridge.agents.create({name:'Bilal',role:'Developer'}); await bridge.agents.create({name:'Sara',role:'Designer'});
      await __ui.refreshAgents();
      __ui.town.setState('alice',{state:'working',task:'Dollar rate research'}); __ui.town.setState('bilal',{state:'working',task:'Login page'});
      __ui.addMsg('user','Nova, get Alice to check the dollar rate and tell me when she is done.');
      __ui.onTool({callId:'a1',actor:'commander',actorName:'Nova',name:'assign_task',args:{agent:'alice',task:'Check the dollar rate'},status:'start',ms:0});
      __ui.onTool({callId:'a1',actor:'commander',actorName:'Nova',name:'assign_task',args:{},status:'done',ms:420});
      __ui.addMsg('ai','Done, Zee. Alice is on it and I will tell you the moment she reports back.');
      __ui.onTool({callId:'a2',actor:'alice',actorName:'Alice',name:'web_search',args:{query:'USD to PKR today'},status:'start',ms:0});
      __ui.presence.setState('speaking'); __ui.presence.setLevel(0.6); __ui.town.setCommander({state:'speaking',level:0.6});
    })()`);
    await sleep(1500); await shot('13-bridge-crew');
    await js(`__ui.town.selected='alice'; document.querySelector('#town').dispatchEvent(new MouseEvent('click',{clientX:0,clientY:0}))`); await sleep(500);
    await js(`__ui.showPermission({id:'demo',actorName:'Nova',title:'Run a command',detail:'ipconfig /all',allowSession:false})`); await sleep(500); await shot('14-permission');
    await js(`document.querySelector('.modal-back').remove(); __ui.openSettings()`); await sleep(500); await shot('15-settings');
    await js(`document.querySelector('.modal-back').remove(); __ui.openComms()`); await sleep(900); await shot('17-comms');
    await js(`document.querySelector('.modal-back').remove()`);

    // voice client against a fake Gemini Live server
    const res = await js(`(async()=>{
      const log=[]; const sent=[];
      class FakeWS { constructor(u){ this.url=u; this.readyState=0; FakeWS.i=this; setTimeout(()=>{this.readyState=1; this.onopen&&this.onopen();},20);} 
        send(s){ const m=JSON.parse(s); sent.push(Object.keys(m)[0]); if(m.setup){ log.push('setup:'+m.setup.model+':'+m.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName+':tools='+m.setup.tools[0].functionDeclarations.length); this.emit({setupComplete:{}}); }
          if(m.realtimeInput&&m.realtimeInput.text&&!this.done){ this.done=1; setTimeout(()=>{ this.emit({serverContent:{inputTranscription:{text:'hello '}}}); this.emit({toolCall:{functionCalls:[{id:'c1',name:'get_system_info',args:{}}]}}); },30);} 
          if(m.toolResponse){ log.push('toolResponse:'+m.toolResponse.functionResponses[0].name+':ok='+m.toolResponse.functionResponses[0].response.result.ok);
            const pcm=new Int16Array(2400).map((_,i)=>Math.sin(i/10)*8000); const b=btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)));
            this.emit({serverContent:{outputTranscription:{text:'Systems are nominal.'},modelTurn:{parts:[{inlineData:{data:b,mimeType:'audio/pcm;rate=24000'}}]}}}); this.emit({serverContent:{turnComplete:true}}); } }
        emit(o){ const blob=new Blob([JSON.stringify(o)]); setTimeout(()=>this.onmessage&&this.onmessage({data:blob}),5); } close(){ this.readyState=3; this.onclose&&this.onclose({code:1000,reason:''}); } }
      const RealWS=window.WebSocket; window.WebSocket=FakeWS;
      const ac=new AudioContext(); const dest=ac.createMediaStreamDestination(); const osc=ac.createOscillator(); osc.connect(dest); osc.start();
      const realGUM=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia=async()=>dest.stream;
      await bridge.config.save({apiKey:'fake-key'});
      const c = await bridge.config.get(); 
      const states=[]; const tr=[];
      const lc=window.__live; const oldS=lc.h.onState, oldT=lc.h.onTranscript; lc.h.onState=s=>{states.push(s);oldS(s)}; lc.h.onTranscript=(r,t,f)=>{ if(f)tr.push(r+':'+t); oldT(r,t,f)};
      await lc.start({greet:'[SYSTEM] say hi'});
      await new Promise(r=>setTimeout(r,2200));
      const audioSent = sent.filter(x=>x==='realtimeInput').length;
      lc.stop(); window.WebSocket=RealWS; navigator.mediaDevices.getUserMedia=realGUM;
      return JSON.stringify({log,states,tr,realtimeMsgs:audioSent,keyTail:c.apiKey.slice(-3)});
    })()`);
    console.log('[test] LIVE-CLIENT', res);
    await js(`bridge.config.save({apiKey:''})`);
    await sleep(600); await shot('16-after-voice-test');
  } catch (e) { console.error('SHOTS ERROR', e); }
  app.quit();
};
