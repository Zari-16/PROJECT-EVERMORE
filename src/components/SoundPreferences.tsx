import { useEffect, useState } from 'react';
import { getSoundUrl, playSound, updateSoundSettings, useSoundSettings } from '../lib/sound';

export default function SoundPreferences() {
  const settings = useSoundSettings();
  const [hasBackgroundTrack, setHasBackgroundTrack] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void getSoundUrl('background').then((url) => { if (active) setHasBackgroundTrack(Boolean(url)); });
    return () => { active = false; };
  }, []);

  return (
    <section className="card sound-preferences">
      <h2>Sounds</h2>
      <label className="sound-mute">
        <input type="checkbox" checked={settings.muted} onChange={(event) => updateSoundSettings({ muted: event.target.checked })} />
        Mute all sounds
      </label>

      <label className="sound-volume">
        <span>Effects volume {Math.round(settings.volume * 100)}%</span>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(settings.volume * 100)}
          onChange={(event) => updateSoundSettings({ volume: Number(event.target.value) / 100 })}
        />
      </label>
      <button type="button" onClick={() => void playSound('messageReceived')}>Test effect</button>

      <label className="sound-mute">
        <input
          type="checkbox"
          checked={settings.backgroundEnabled}
          onChange={(event) => updateSoundSettings({ backgroundEnabled: event.target.checked })}
        />
        Play quiet background music
      </label>
      <label className="sound-volume">
        <span>Background volume {Math.round(settings.backgroundVolume * 100)}%</span>
        <input
          type="range"
          min="0"
          max="100"
          disabled={!settings.backgroundEnabled}
          value={Math.round(settings.backgroundVolume * 100)}
          onChange={(event) => updateSoundSettings({ backgroundVolume: Number(event.target.value) / 100 })}
        />
      </label>
      {settings.backgroundEnabled && hasBackgroundTrack === false && (
        <p role="status">No background track found yet. Add public/sound/background.mp3 and refresh.</p>
      )}
      <p className="sound-preferences-note">Saved on this device only.</p>
    </section>
  );
}
