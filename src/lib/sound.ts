import { useSyncExternalStore } from 'react';

// Files live in public/sound/ and are looked up as <name>.<extension>.
export const SOUND_FILES = {
  messageSent: 'message-sent',
  messageReceived: 'message-received',
  replyPing: 'reply-ping',
  alert: 'alert',
  whiteboardUndo: 'whiteboard-undo',
  whiteboardClear: 'whiteboard-clear',
  background: 'background',
} as const;

export type SoundName = keyof typeof SOUND_FILES;
export type SoundSettings = {
  volume: number;
  muted: boolean;
  backgroundEnabled: boolean;
  backgroundVolume: number;
};

const SOUND_DIR = `${import.meta.env.BASE_URL}sound/`;
const EXTENSIONS = ['mp3', 'wav', 'ogg'];
const STORAGE_KEY = 'evermore:sound-settings';
const DEFAULT_SETTINGS: SoundSettings = { volume: 0.7, muted: false, backgroundEnabled: false, backgroundVolume: 0.25 };

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
    const timer = window.setTimeout(() => resolve(false), 5000);
    audio.addEventListener('loadedmetadata', () => { window.clearTimeout(timer); resolve(true); }, { once: true });
    audio.addEventListener('error', () => { window.clearTimeout(timer); resolve(false); }, { once: true });
    audio.preload = 'metadata';
    audio.src = url;
  });
}

// A missing file is remembered until the page reloads, so pushing a file and refreshing picks it up.
const sources = new Map<SoundName, Promise<string | null>>();

function resolveSource(name: SoundName) {
  let source = sources.get(name);
  if (!source) {
    source = (async () => {
      for (const extension of EXTENSIONS) {
        const url = `${SOUND_DIR}${SOUND_FILES[name]}.${extension}`;
        if (await probe(url)) return url;
      }
      return null;
    })();
    sources.set(name, source);
  }
  return source;
}

export const getSoundUrl = resolveSource;

export async function playSound(name: SoundName) {
  if (typeof Audio === 'undefined' || settings.muted || settings.volume === 0) return;
  const url = await resolveSource(name);
  if (!url) return;
  const audio = new Audio(url);
  audio.volume = settings.volume;
  await audio.play().catch(() => undefined);
}
