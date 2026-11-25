/**
 * Browser-synthesised audio: the timer chime and the ambient "tracks". Everything is
 * generated with Web Audio, so there are no media files or external hosts to allow-list
 * (keeps the app "Runs on Atlassian" eligible).
 */
let ctx: AudioContext | null = null;

export function audioContext(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

/** Browsers block audio until a user gesture; call from a click handler. */
export async function unlockAudio(): Promise<boolean> {
  const c = audioContext();
  if (c.state === 'suspended') await c.resume().catch(() => undefined);
  return c.state === 'running';
}

export function audioUnlocked(): boolean {
  return !!ctx && ctx.state === 'running';
}

export function playChime(volume = 0.5): void {
  const c = audioContext();
  if (c.state !== 'running') return;
  const now = c.currentTime;
  [880, 1174.66, 1567.98].forEach((f, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    const t = now + i * 0.18;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume * 0.4, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 1.5);
  });
}

function noiseBuffer(c: AudioContext, kind: 'white' | 'pink' | 'brown'): AudioBuffer {
  const len = c.sampleRate * 4;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w * 0.5;
    else if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    }
  }
  return buf;
}

export interface AmbientHandle {
  setVolume(v: number): void;
  stop(): void;
}

/** Start a generative ambient track. */
export function startAmbient(trackId: string, volume: number): AmbientHandle {
  const c = audioContext();
  const master = c.createGain();
  master.gain.value = 0;
  master.connect(c.destination);
  master.gain.linearRampToValueAtTime(volume * 0.6, c.currentTime + 2);
  const stoppers: Array<() => void> = [];

  const noise = (kind: 'white' | 'pink' | 'brown', filter: BiquadFilterType, freq: number, gain: number, lfoHz = 0, lfoDepth = 0) => {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, kind);
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = gain;
    if (lfoHz) {
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = lfoHz;
      lg.gain.value = lfoDepth;
      lfo.connect(lg).connect(g.gain);
      lfo.start();
      stoppers.push(() => lfo.stop());
    }
    src.connect(f).connect(g).connect(master);
    src.start();
    stoppers.push(() => src.stop());
  };

  const pad = (freqs: number[], gain: number, type: OscillatorType = 'sine') => {
    for (const fr of freqs) {
      const o = c.createOscillator();
      const g = c.createGain();
      const lfo = c.createOscillator();
      const lg = c.createGain();
      o.type = type;
      o.frequency.value = fr;
      g.gain.value = gain;
      lfo.frequency.value = 0.05 + Math.random() * 0.1;
      lg.gain.value = gain * 0.6;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(master);
      o.start();
      lfo.start();
      stoppers.push(() => (o.stop(), lfo.stop()));
    }
  };

  let chirpTimer: number | undefined;
  switch (trackId) {
    case 'lofi-rain':
      noise('pink', 'lowpass', 2500, 0.35);
      pad([130.81, 164.81, 196.0, 246.94], 0.035, 'triangle'); // Cmaj7
      break;
    case 'cafe':
      noise('brown', 'bandpass', 600, 0.5, 0.15, 0.15);
      pad([146.83, 174.61, 220.0, 261.63], 0.025, 'triangle'); // Dm7
      break;
    case 'ocean':
      noise('pink', 'lowpass', 900, 0.4, 0.08, 0.35);
      break;
    case 'forest':
      noise('pink', 'highpass', 1500, 0.08);
      chirpTimer = window.setInterval(() => {
        if (Math.random() > 0.5) return;
        const o = c.createOscillator();
        const g = c.createGain();
        const t = c.currentTime;
        const base = 2500 + Math.random() * 1500;
        o.frequency.setValueAtTime(base, t);
        o.frequency.exponentialRampToValueAtTime(base * 1.4, t + 0.12);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.03, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g).connect(master);
        o.start(t);
        o.stop(t + 0.25);
      }, 900);
      break;
    default: // focus
      pad([110, 110.5, 164.81, 220], 0.05);
  }

  return {
    setVolume(v) {
      master.gain.linearRampToValueAtTime(v * 0.6, c.currentTime + 0.3);
    },
    stop() {
      window.clearInterval(chirpTimer);
      master.gain.linearRampToValueAtTime(0, c.currentTime + 0.8);
      window.setTimeout(() => {
        stoppers.forEach((s) => {
          try {
            s();
          } catch {
            /* already stopped */
          }
        });
        master.disconnect();
      }, 900);
    },
  };
}
