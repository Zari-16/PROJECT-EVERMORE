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
          <div className="game-library-mark game-card-mark" aria-hidden="true">♥</div>
          <div className="game-library-copy">
            <p className="games-eyebrow">Two players · Realtime</p>
            <h2>Heart &amp; Hollow</h2>
            <p>An original color-and-number card game. Hidden hands stay private.</p>
          </div>
          <Link className="game-launch" to="/games/heart-and-hollow">Play together</Link>
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
      </section>
    </main>
  );
}
