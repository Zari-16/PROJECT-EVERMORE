import React, { useContext } from 'react';
import { ThemeContext } from '../components/ThemeProvider';

export default function Home() {
  const { theme, mode, setTheme, setMode } = useContext(ThemeContext);

  return (
    <div style={{maxWidth:980, margin:'32px auto'}}>
      <div className="card">
        <header style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <h1>Project Evermore</h1>
          <div>
            <label>
              Theme:
              <select value={theme} onChange={(e)=>setTheme(e.target.value)}>
                <option value="lavender">Lavender</option>
                <option value="rose">Roseblood</option>
                <option value="celestial">Celestial Blue</option>
                <option value="blush-beige">Blush & Beige</option>
                <option value="verdant">Verdant</option>
              </select>
            </label>
            <label style={{marginLeft:8}}>
              Mode:
              <select value={mode} onChange={(e)=>setMode(e.target.value as 'light'|'dark')}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </div>
        </header>
        <p>Welcome to your private enchanted garden. This Phase 1 build implements the core authentication and theme system. Continue building to enable pairing, whiteboard, chat, and more.</p>
      </div>
    </div>
  );
}
