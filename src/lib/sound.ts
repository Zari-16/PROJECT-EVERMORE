import { useSyncExternalStore } from 'react';

// Values are asset filename stems in public/sound/ (the extension is probed below).
export const SOUND_FILES = {
  messageSent: 'emand_edroff-fairy-dust-magical-chime-576279',
  messageReceived: 'juliush-little-secrets-fairy-tale-sound-8395',
  replyPing: 'emand_edroff-fairy-dust-magical-chime-576279',
  alert: 'alert',
} as const;

export const BACKGROUND_TRACKS = {
  fantasy: {
    label: 'Enchanted fantasy (30 sec)',
    file: 'sonican-enchanted-magical-fantasy-30-seconds-615098',
  },
  classical: {
    label: 'Enchanted classical (30 sec)',
    file: 'sonican-enchanted-fantasy-30-sec-classical-music-535322',
  },
} as const;

export type BackgroundTrack = keyof typeof BACKGROUND_TRACKS;
export type SoundName = keyof typeof SOUND_FILES;

export function isBackgroundTrack(track: string): track is BackgroundTrack {
  return Object.prototype.hasOwnProperty.call(BACKGROUND_TRACKS, track);
}

export type SoundSettings = {
  volume: number;
  muted: boolean;
  backgroundEnabled: boolean;
  backgroundVolume: number;
  backgroundTrack: BackgroundTrack;
};

const SOUND_DIR = `${import.meta.env.BASE_URL}sound/`;
const EXTENSIONS = ['mp3', 'wav', 'ogg'];
const STORAGE_KEY = 'evermore:sound-settings';
const DEFAULT_SETTINGS: SoundSettings = {
  volume: 0.7,
  muted: false,
  backgroundEnabled: false,
  backgroundVolume: 0.25,
  backgroundTrack: 'fantasy',
};

const clampVolume = (value: unknown, fallback: number) =>
  typeof value === 'number' ? Math.min(1, Math.max(0, value)) : fallback;

function readSettings(): SoundSettings {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<SoundSettings> | null;
    return {
      volume: clampVolume(stored?.volume, DEFAULT_SETTINGS.volume),
      muted: stored?.muted === true,
      backgroundEnabled: stored?.backgroundEnabled === true,
      backgroundVolume: clampVolume(stored?.backgroundVolume, DEFAULT_SETTINGS.backgroundVolume),
      backgroundTrack: typeof stored?.backgroundTrack === 'string'
        && isBackgroundTrack(stored.backgroundTrack)
        ? stored.backgroundTrack
        : DEFAULT_SETTINGS.backgroundTrack,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let settings = readSettings();
const listeners = new Set<() => void>();

export const getSoundSettings = () => settings;

export function updateSoundSettings(next: Partial<SoundSettings>) {
  settings = { ...settings, ...next };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Settings still apply for this session when storage is blocked.
  }
  listeners.forEach((listener) => listener());
}

export function useSoundSettings() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    () => settings,
  );
}

function probe(url: string) {
  return new Promise<boolean>((resolve) => {
    const audio = new Audio();
    const finish = (available: boolean) => {
      window.clearTimeout(timer);
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('error', onError);
      audio.removeAttribute('src');
      audio.load();
      resolve(available);
    };
    const onLoaded = () => finish(true);
    const onError = () => finish(false);
    const timer = window.setTimeout(() => finish(false), 5000);
    audio.addEventListener('loadedmetadata', onLoaded, { once: true });
    audio.addEventListener('error', onError, { once: true });
    audio.preload = 'metadata';
    audio.src = url;
    audio.load();
  });
}

// A missing file is remembered until the page reloads, so pushing a file and refreshing picks it up.
const sources = new Map<string, Promise<string | null>>();

function resolveAsset(file: string) {
  let source = sources.get(file);
  if (!source) {
    source = (async () => {
      for (const extension of EXTENSIONS) {
        const url = `${SOUND_DIR}${file}.${extension}`;
        if (await probe(url)) return url;
      }
      return null;
    })();
    sources.set(file, source);
  }
  return source;
}

function resolveSource(name: SoundName) {
  return resolveAsset(SOUND_FILES[name]);
}

export const getBackgroundTrackUrl = (track: BackgroundTrack) =>
  resolveAsset(BACKGROUND_TRACKS[track].file);

export async function playSound(name: SoundName) {
  if (typeof Audio === 'undefined' || settings.muted || settings.volume === 0) return;
  const url = await resolveSource(name);
  if (!url) return;
  const audio = new Audio(url);
  audio.volume = settings.volume;
  await audio.play().catch(() => undefined);
}
