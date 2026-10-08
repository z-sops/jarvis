// Collects microphone samples and hands them to the page in 50 ms blocks of 16 kHz mono sound.
// If the audio engine runs at another rate (44.1 or 48 kHz, which is what most Windows drivers use), the sound is converted here.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.buf = new Float32Array(800); this.n = 0;
    this.ratio = sampleRate / 16000; this.pos = 0; this.last = 0;   // pos: where the next 16 kHz sample falls, counted in input samples from the start of the current block
  }
  push(v) { this.buf[this.n++] = v; if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; } }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || !ch.length) return true;
    if (this.ratio === 1) { for (let i = 0; i < ch.length; i++) this.push(ch[i]); return true; }
    // average over one output step (a simple low-pass), then pick the point between two neighbours
    for (;;) {
      const i = Math.floor(this.pos);
      if (i + 1 >= ch.length) break;
      const a = i < 0 ? this.last : ch[i], b = ch[i + 1];
      this.push(a + (b - a) * (this.pos - i));
      this.pos += this.ratio;
    }
    this.pos -= ch.length; this.last = ch[ch.length - 1];
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
