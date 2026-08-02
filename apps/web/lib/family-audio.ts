// Soundtrack for "מי מהמשפחה?" — synthesized live, no audio files, no deps.
//
// The scale is Hijaz (root, ♭2, ♮3, 4, 5, ♭6, ♮7) — the mode you already hear
// at every Israeli family party. It happens to be both festive and tense, which
// is exactly what a countdown needs.
//
// Everything is driven by one number: `urgency`, 0 at the start of a round and
// 1 when the timer runs out. Tempo climbs, layers stack, the filter opens.

export type FamilyAudioMode = "off" | "lobby" | "play" | "reveal" | "final";
export type FamilySfx = "select" | "send" | "reveal" | "points" | "win" | "start";

const ROOT_MIDI = 50; // D3
const HIJAZ = [0, 1, 4, 5, 7, 8, 11];

function midiToFreq(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Degree index into Hijaz, allowing octaves above and below. */
function scaleFreq(degree: number, octave = 0) {
  const wrapped = ((degree % HIJAZ.length) + HIJAZ.length) % HIJAZ.length;
  const octaveShift = Math.floor(degree / HIJAZ.length) + octave;
  return midiToFreq(ROOT_MIDI + HIJAZ[wrapped] + octaveShift * 12);
}

const STEPS_PER_BAR = 16;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;

export class FamilyAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private ticker: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private step = 0;

  private mode: FamilyAudioMode = "off";
  private urgency = 0;
  private finalSeconds = false;
  private muted = false;

  // ── Public API ──────────────────────────────────────────────────────────

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) {
      this.stopLoop();
      if (this.master) this.master.gain.value = 0;
    } else {
      this.ensure();
      if (this.master) this.master.gain.value = 0.22;
      if (this.mode !== "off") this.startLoop();
    }
  }

  isMuted() { return this.muted; }

  setMode(mode: FamilyAudioMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.step = 0;
    if (mode === "off" || this.muted) { this.stopLoop(); return; }
    this.ensure();
    this.startLoop();
  }

  /** 0 = plenty of time, 1 = out of time. */
  setUrgency(urgency: number, finalSeconds = false) {
    this.urgency = Math.max(0, Math.min(1, urgency));
    this.finalSeconds = finalSeconds;
  }

  /** Browsers only allow audio after a gesture — call this from a real tap. */
  unlock() {
    this.ensure();
    void this.ctx?.resume();
  }

  suspend() { void this.ctx?.suspend(); }
  resume() { if (!this.muted) void this.ctx?.resume(); }

  dispose() {
    this.stopLoop();
    void this.ctx?.close();
    this.ctx = null;
  }

  // ── One-shot effects ────────────────────────────────────────────────────

  sfx(kind: FamilySfx) {
    if (this.muted) return;
    this.ensure();
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;

    switch (kind) {
      case "select":
        this.pluck(scaleFreq(4, 1), t, 0.16, 0.5);
        break;
      case "send":
        this.pluck(scaleFreq(0, 1), t, 0.14, 0.45);
        this.pluck(scaleFreq(4, 1), t + 0.09, 0.2, 0.45);
        break;
      case "reveal":
        this.pluck(scaleFreq(0, 0), t, 0.3, 0.4);
        this.pluck(scaleFreq(2, 0), t + 0.02, 0.3, 0.3);
        break;
      case "points":
        [0, 2, 4, 6].forEach((d, i) => this.pluck(scaleFreq(d, 1), t + i * 0.075, 0.24, 0.42));
        break;
      case "start":
        [0, 4, 7].forEach((d, i) => this.pluck(scaleFreq(d, 0), t + i * 0.09, 0.35, 0.4));
        break;
      case "win":
        [0, 2, 4, 6, 7].forEach((d, i) => this.pluck(scaleFreq(d, 1), t + i * 0.12, 0.5, 0.45));
        this.kick(t, 0.9);
        this.kick(t + 0.6, 0.7);
        break;
    }
  }

  // ── Engine ──────────────────────────────────────────────────────────────

  private ensure() {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200;
    filter.Q.value = 0.7;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.22;

    filter.connect(master);
    master.connect(ctx.destination);

    // one second of white noise, reused for every percussive hit
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

    this.ctx = ctx;
    this.filter = filter;
    this.master = master;
    this.noiseBuffer = buffer;
  }

  private bpm() {
    if (this.mode === "lobby") return 84;
    if (this.mode === "reveal") return 76;
    if (this.mode === "final") return 104;
    return 88 + this.urgency * 62; // 88 → 150 as the clock runs down
  }

  private startLoop() {
    this.ensure();
    const ctx = this.ctx;
    if (!ctx || this.ticker) return;
    void ctx.resume();
    this.nextStepTime = ctx.currentTime + 0.06;
    this.ticker = setInterval(() => this.schedule(), LOOKAHEAD_MS);
  }

  private stopLoop() {
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null; }
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;

    // Open the filter as the pressure rises — the loop literally gets brighter.
    if (this.filter) {
      const target = this.mode === "play" ? 900 + this.urgency * 4200 : 1400;
      this.filter.frequency.setTargetAtTime(target, ctx.currentTime, 0.2);
    }

    const stepDuration = 60 / this.bpm() / 4;
    while (this.nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
      this.playStep(this.step, this.nextStepTime);
      this.nextStepTime += stepDuration;
      this.step = (this.step + 1) % STEPS_PER_BAR;
    }
  }

  private playStep(step: number, time: number) {
    const u = this.urgency;

    if (this.mode === "lobby") {
      // Barely there: a soft pulse so the room knows the game is awake.
      if (step === 0) this.bass(scaleFreq(0, -1), time, 1.1, 0.25);
      if (step === 8) this.bass(scaleFreq(4, -1), time, 1.1, 0.18);
      if (step % 8 === 4) this.hat(time, 0.1);
      return;
    }

    if (this.mode === "reveal") {
      // Suspense: one heartbeat per beat, nothing else.
      if (step % 8 === 0) this.kick(time, 0.5);
      if (step % 8 === 3) this.kick(time, 0.22);
      return;
    }

    if (this.mode === "final") {
      if (step % 4 === 0) this.kick(time, 0.7);
      if (step % 4 === 2) this.hat(time, 0.25);
      if (step % 8 === 0) this.bass(scaleFreq(0, -1), time, 0.5, 0.3);
      if (step % 16 === 0) [0, 2, 4].forEach((d, i) => this.pluck(scaleFreq(d, 1), time + i * 0.1, 0.4, 0.3));
      return;
    }

    // ── mode === "play" ──
    // A maqsoum-ish frame: dum on 0 and 6, tek on 4 and 12.
    if (step === 0 || step === 6) this.kick(time, 0.75);
    if (u > 0.25 && (step === 4 || step === 12)) this.clap(time, 0.4 + u * 0.3);

    // Hats: eighths, doubling to sixteenths when the clock bites.
    const hatEvery = u > 0.7 ? 1 : u > 0.3 ? 2 : 4;
    if (step % hatEvery === 0) this.hat(time, 0.08 + u * 0.16);

    // Bass pulse, denser as urgency climbs.
    if (step === 0) this.bass(scaleFreq(0, -1), time, 0.4, 0.32);
    if (u > 0.35 && step === 8) this.bass(scaleFreq(3, -1), time, 0.35, 0.28);
    if (u > 0.6 && step === 14) this.bass(scaleFreq(1, -1), time, 0.2, 0.26);

    // The hook only shows up once there is real pressure.
    if (u > 0.45) {
      const arp = [0, 2, 4, 2, 6, 4, 2, 0];
      if (step % 2 === 0) {
        const degree = arp[(step / 2) % arp.length];
        this.pluck(scaleFreq(degree, 1), time, 0.18, 0.16 + u * 0.16);
      }
    }

    // Final ten seconds: a clock, right on the beat.
    if (this.finalSeconds && step % 4 === 0) this.tick(time);
  }

  // ── Voices ──────────────────────────────────────────────────────────────

  private kick(time: number, gain: number) {
    const ctx = this.ctx, dest = this.filter;
    if (!ctx || !dest) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(44, time + 0.11);
    env.gain.setValueAtTime(gain, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.24);
    osc.connect(env); env.connect(dest);
    osc.start(time); osc.stop(time + 0.26);
  }

  private hat(time: number, gain: number) {
    const ctx = this.ctx, dest = this.filter, buf = this.noiseBuffer;
    if (!ctx || !dest || !buf) return;
    const src = ctx.createBufferSource();
    const hp = ctx.createBiquadFilter();
    const env = ctx.createGain();
    src.buffer = buf;
    hp.type = "highpass";
    hp.frequency.value = 7000;
    env.gain.setValueAtTime(gain, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
    src.connect(hp); hp.connect(env); env.connect(dest);
    src.start(time); src.stop(time + 0.06);
  }

  private clap(time: number, gain: number) {
    const ctx = this.ctx, dest = this.filter, buf = this.noiseBuffer;
    if (!ctx || !dest || !buf) return;
    const src = ctx.createBufferSource();
    const bp = ctx.createBiquadFilter();
    const env = ctx.createGain();
    src.buffer = buf;
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 1.2;
    env.gain.setValueAtTime(gain, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.13);
    src.connect(bp); bp.connect(env); env.connect(dest);
    src.start(time); src.stop(time + 0.15);
  }

  private bass(freq: number, time: number, duration: number, gain: number) {
    const ctx = this.ctx, dest = this.filter;
    if (!ctx || !dest) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(gain, time + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(env); env.connect(dest);
    osc.start(time); osc.stop(time + duration + 0.05);
  }

  private pluck(freq: number, time: number, duration: number, gain: number) {
    const ctx = this.ctx, dest = this.filter;
    if (!ctx || !dest) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(gain, time + 0.012);
    env.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(env); env.connect(dest);
    osc.start(time); osc.stop(time + duration + 0.05);
  }

  private tick(time: number) {
    const ctx = this.ctx, dest = this.filter;
    if (!ctx || !dest) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 2400;
    env.gain.setValueAtTime(0.16, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.035);
    osc.connect(env); env.connect(dest);
    osc.start(time); osc.stop(time + 0.05);
  }
}

// ─── Singleton + preference ──────────────────────────────────────────────────

const MUTE_KEY = "categories-game:family-muted";

let instance: FamilyAudio | null = null;

export function getFamilyAudio(): FamilyAudio {
  if (!instance) instance = new FamilyAudio();
  return instance;
}

export function readMutePreference(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MUTE_KEY) === "1";
}

export function writeMutePreference(muted: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
}
