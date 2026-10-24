import { getSoundSettings } from './sound';

// Game sound effects are synthesized with ZzFX (https://github.com/KilledByAPixel/ZzFX),
// so there are no audio files to download or host. They follow the same mute/volume
// settings as the rest of the app's sounds.
// ZzFX parameter order:
// [volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide, deltaSlide,
//  pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo, filter]
type Params = Array<number | undefined>;

const SOUNDS = {
  click: [[0.35, 0, 880, 0, 0.004, 0.03, 0, 1.2]],
  place: [[0.6, 0, 330, 0.005, 0.02, 0.09, 0, 1.3]],
  wrong: [[0.7, 0, 140, 0.01, 0.06, 0.22, 3, 1.4, -4]],
  hint: [[0.6, 0, 880, 0.01, 0.04, 0.18, 0, 1.2, 0, 0, 440, 0.06]],
  snakeEat: [[0.7, 0, 1175, 0, 0.04, 0.2, 1, 1.6, 0, 0, 587, 0.05]],
  snakeTurn: [[0.15, 0, 260, 0, 0.005, 0.03, 0, 1]],
  gameOver: [[0.8, 0, 392, 0.02, 0.12, 0.3, 1, 1.4, -6], [0.8, 0, 262, 0.02, 0.2, 0.5, 1, 1.4, -6]],
  start: [[0.6, 0, 523, 0.01, 0.05, 0.15], [0.6, 0, 784, 0.01, 0.08, 0.25]],
  tokenMove: [[0.6, 0, 440, 0.005, 0.03, 0.1, 0, 1.2, 6]],
  cardPlay: [[0.5, 0.1, 700, 0.01, 0.03, 0.09, 4, 1.2, 0, 0, 0, 0, 0, 0.4]],
  cardDraw: [[0.5, 0.1, 600, 0.01, 0.03, 0.08, 4, 1.2, 0, 0, 0, 0, 0, 0.4], [0.5, 0.1, 760, 0.01, 0.03, 0.08, 4, 1.2, 0, 0, 0, 0, 0, 0.4]],
  reveal: [[0.6, 0, 659, 0.01, 0.06, 0.25, 0, 1.2], [0.6, 0, 988, 0.01, 0.06, 0.3, 0, 1.2]],
  success: [[0.6, 0, 523, 0.01, 0.06, 0.16], [0.6, 0, 659, 0.01, 0.06, 0.16], [0.6, 0, 784, 0.01, 0.08, 0.3]],
  win: [[0.7, 0, 523, 0.01, 0.08, 0.2], [0.7, 0, 659, 0.01, 0.08, 0.2], [0.7, 0, 784, 0.01, 0.08, 0.2], [0.7, 0, 1047, 0.01, 0.2, 0.5]],
} satisfies Record<string, Params[]>;

// Rattling dice and a slowing bottle spin are timed bursts of short ticks.
const SEQUENCES = {
  diceRoll: { tick: [0.35, 0.3, 240, 0, 0.005, 0.04, 4, 1, 0, 0, 0, 0, 0, 1] as Params, delays: [0, 70, 140, 215, 300, 395, 500], end: [0.6, 0, 330, 0.005, 0.03, 0.12, 0, 1.3] as Params },
  bottleSpin: { tick: [0.3, 0.2, 420, 0, 0.004, 0.03, 4, 1, 0, 0, 0, 0, 0, 0.6] as Params, delays: [0, 60, 120, 190, 270, 360, 470, 600, 760, 950, 1180, 1420], end: [0.6, 0, 523, 0.01, 0.05, 0.2, 0, 1.2] as Params },
};

export type GameSoundName = keyof typeof SOUNDS | keyof typeof SEQUENCES;

type ZzfxModule = typeof import('zzfx');
let zzfxModule: Promise<ZzfxModule | null> | null = null;

// Loaded on first use so the audio context is only created after a user action.
const loadZzfx = () => {
  zzfxModule ??= import('zzfx').catch(() => null);
  return zzfxModule;
};

export function playGameSound(name: GameSoundName) {
  const settings = getSoundSettings();
  if (settings.muted || settings.volume === 0 || typeof AudioContext === 'undefined') return;

  void loadZzfx().then((mod) => {
    if (!mod) return;
    const { ZZFX } = mod;
    ZZFX.volume = 0.3 * settings.volume;
    if (ZZFX.audioContext.state === 'suspended') void ZZFX.audioContext.resume();

    const play = (params: Params) => {
      try { ZZFX.play(...params); } catch { /* audio is best-effort */ }
    };

    if (name in SEQUENCES) {
      const sequence = SEQUENCES[name as keyof typeof SEQUENCES];
      sequence.delays.forEach((delay) => window.setTimeout(() => play(sequence.tick), delay));
      window.setTimeout(() => play(sequence.end), sequence.delays[sequence.delays.length - 1] + 140);
      return;
    }

    (SOUNDS[name as keyof typeof SOUNDS] as Params[]).forEach((params, index) => {
      window.setTimeout(() => play(params), index * 120);
    });
  });
}
