// Tiny synthesized sound effects (Web Audio, no audio files)
let ctx = null;
let enabled = true;

export function setSoundEnabled(v) { enabled = v; }

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(freq, dur, { type = 'sine', vol = 0.18, at = 0, slide = 0 } = {}) {
  if (!enabled || !ctx) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { at = 0, vol = 0.15, freq = 1200, q = 0.8 } = {}) {
  if (!enabled || !ctx) return;
  const t = ctx.currentTime + at;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t);
}

export const sfx = {
  tap() { tone(660, 0.05, { type: 'triangle', vol: 0.08 }); },
  card() { noise(0.09, { freq: 2500, vol: 0.22 }); tone(880, 0.06, { type: 'triangle', vol: 0.06, at: 0.02 }); },
  loco() { noise(0.09, { freq: 2500, vol: 0.22 }); tone(523, 0.1, { type: 'triangle', vol: 0.1, at: 0.02 }); tone(784, 0.14, { type: 'triangle', vol: 0.1, at: 0.09 }); },
  ticket() { noise(0.25, { freq: 900, vol: 0.18, q: 0.5 }); },
  claim(len = 3) {
    for (let i = 0; i < len + 1; i++) noise(0.07, { at: i * 0.11, freq: 300, vol: 0.35, q: 1.2 });
    const w = (len + 1) * 0.11;
    tone(587, 0.45, { type: 'square', vol: 0.05, at: w });
    tone(740, 0.45, { type: 'square', vol: 0.04, at: w });
  },
  turn() { tone(784, 0.12, { vol: 0.1 }); tone(1047, 0.2, { vol: 0.1, at: 0.1 }); },
  error() { tone(200, 0.15, { type: 'sawtooth', vol: 0.06, slide: 0.7 }); },
  final() { [392, 494, 587].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.12, at: i * 0.13 })); },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.13, at: i * 0.14 }));
    tone(1047, 0.8, { type: 'triangle', vol: 0.1, at: 0.6 });
  },
};

export function haptic(ms = 10) {
  try { navigator.vibrate?.(ms); } catch { /* not supported on iOS */ }
}
