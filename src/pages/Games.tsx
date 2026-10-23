import { Link } from 'react-router-dom';

export default function Games() {
  return (
    <main className="games-page">
      <header className="games-header">
        <p className="games-eyebrow">A little pause in your day</p>
        <h1>Games Library</h1>
        <p>Choose a game and pick up where you left off.</p>
      </header>
      <section className="game-library-list" aria-label="Available games">
        <article className="game-library-item">
          <div className="game-library-mark truth-dare-library-mark" aria-hidden="true">✦</div>
          <div className="game-library-copy">
            <p className="games-eyebrow">Two players · Realtime</p>
            <h2>Truth or Dare, with a twist</h2>
            <p>The bottle picks the player, then a gentle random prompt.</p>
          </div>
          <Link className="game-launch" to="/games/truth-or-dare">Play together</Link>
        </article>
        <article className="game-library-item">
          <div className="game-library-mark" aria-hidden="true">9</div>
          <div className="game-library-copy">
            <p className="games-eyebrow">Solo · Saved progress</p>
            <h2>Sudoku</h2>
            <p>Four difficulty levels, pencil notes, hints, and saved games.</p>
          </div>
          <Link className="game-launch" to="/games/sudoku">Play Sudoku</Link>
        </article>
        <article className="game-library-item">
          <div className="game-library-mark game-card-mark" aria-hidden="true">♥</div>
          <div className="game-library-copy">
            <p className="games-eyebrow">Two players · Realtime</p>
            <h2>Heart &amp; Hollow</h2>
            <p>An original color-and-number card game. Hidden hands stay private.</p>
          </div>
          <Link className="game-launch" to="/games/heart-and-hollow">Play together</Link>
        </article>
        <article className="game-library-item">
          <div className="game-library-mark" aria-hidden="true">4</div>
          <div className="game-library-copy">
            <p className="games-eyebrow">Two players · Realtime</p>
            <h2>Ludo</h2>
            <p>Race four tokens home with validated dice rolls, safe spaces, and captures.</p>
          </div>
          <Link className="game-launch" to="/games/ludo">Play together</Link>
        </article>
      </section>
    </main>
  );
}
