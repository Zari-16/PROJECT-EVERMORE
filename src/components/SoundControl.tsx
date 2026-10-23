import { useState } from 'react';
import { playSound, updateSoundSettings, useSoundSettings } from '../lib/sound';

export default function SoundControl() {
  const settings = useSoundSettings();
  const [open, setOpen] = useState(false);

  return (
    <div className="sound-control">
      <button
        className="sound-trigger"
        type="button"
        aria-expanded={open}
        aria-controls="sound-panel"
        onClick={() => setOpen((current) => !current)}
      >
        {settings.muted ? 'Sound off' : 'Sound'}
      </button>
      {open && (
        <section className="sound-panel" id="sound-panel" aria-label="Sound settings">
          <label className="sound-mute">
            <input type="checkbox" checked={settings.muted} onChange={(event) => updateSoundSettings({ muted: event.target.checked })} />
            Mute all sounds
          </label>
          <label className="sound-volume">
            <span>Volume {Math.round(settings.volume * 100)}%</span>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(settings.volume * 100)}
              onChange={(event) => updateSoundSettings({ volume: Number(event.target.value) / 100 })}
            />
          </label>
          <button type="button" onClick={() => void playSound('messageReceived')}>Test sound</button>
        </section>
      )}
    </div>
  );
}
