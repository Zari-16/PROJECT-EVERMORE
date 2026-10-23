import { useEffect, useRef } from 'react';
import { getSoundSettings, getSoundUrl, useSoundSettings } from '../lib/sound';

export default function BackgroundMusic() {
  const settings = useSoundSettings();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const shouldPlay = settings.backgroundEnabled && !settings.muted;

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = settings.backgroundVolume;
  }, [settings.backgroundVolume]);

  useEffect(() => {
    if (!shouldPlay) {
      audioRef.current?.pause();
      return;
    }

    let cancelled = false;
    const retry = () => { void start(); };

    async function start() {
      const url = await getSoundUrl('background');
      if (!url || cancelled) return;
      const audio = audioRef.current ?? new Audio(url);
      audio.loop = true;
      audio.volume = getSoundSettings().backgroundVolume;
      audioRef.current = audio;
      try {
        await audio.play();
      } catch {
        // Browsers block audio until the first click or key press.
        document.addEventListener('pointerdown', retry, { once: true });
        document.addEventListener('keydown', retry, { once: true });
      }
    }

    void start();
    return () => {
      cancelled = true;
      document.removeEventListener('pointerdown', retry);
      document.removeEventListener('keydown', retry);
    };
  }, [shouldPlay]);

  return null;
}
