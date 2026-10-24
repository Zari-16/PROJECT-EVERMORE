import { useEffect } from 'react';
import { playGameSound } from '../lib/gameSounds';

// Pages whose buttons already have their own sounds (or should stay silent).
const SILENT_AREAS = '.sudoku-page, .snake-page, .ludo-page, .truth-dare-page, .card-game-page, .whiteboard-page, [data-silent]';

// One soft click for every button and nav link. It follows the mute and volume settings.
export default function ButtonSounds() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest('button, a.site-nav-link, [role="button"]');
      if (!control || (control as HTMLButtonElement).disabled) return;
      if (control.closest(SILENT_AREAS)) return;
      playGameSound('click');
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return null;
}
