import { useEffect, useRef } from 'react';
import { getBackgroundTrackUrl, getSoundSettings, useSoundSettings } from '../lib/sound';

export default function BackgroundMusic() {
  const settings = useSoundSettings();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const shouldPlay = settings.backgroundEnabled && !settings.muted;

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = settings.backgroundVolume;
  }, [settings.backgroundVolume]);

  useEffect(() => {
    if (!shouldPlay) return;

    let cancelled = false;
    let audio: HTMLAudioElement | null = null;

    const retry = () => {
      document.removeEventListener('pointerdown', retry);
      document.removeEventListener('keydown', retry);
      if (audio) void play();
    };

    const play = async () => {
      if (!audio) return;
      try {
        await audio.play();
      } catch {
        // Browsers block audio until the first click or key press.
        if (!cancelled) {
          document.addEventListener('pointerdown', retry, { once: true });
          document.addEventListener('keydown', retry, { once: true });
        }
      }
    };

    async function start() {
      const url = await getBackgroundTrackUrl(settings.backgroundTrack);
      if (!url || cancelled) return;
      audio = new Audio(url);
      audio.loop = true;
      audio.volume = getSoundSettings().backgroundVolume;
      audioRef.current = audio;
      await play();
    }

    void start();
    return () => {
      cancelled = true;
      audio?.pause();
      if (audioRef.current === audio) audioRef.current = null;
      document.removeEventListener('pointerdown', retry);
      document.removeEventListener('keydown', retry);
    };
  }, [settings.backgroundTrack, shouldPlay]);

  return null;
}
