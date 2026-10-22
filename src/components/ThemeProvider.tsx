import React, { createContext, useEffect, useState } from 'react';

export const ThemeContext = createContext({
  theme: 'lavender',
  mode: 'light',
  setTheme: (t: string) => {},
  setMode: (m: 'light' | 'dark') => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<string>(localStorage.getItem('evermore:theme') || 'lavender');
  const [mode, setMode] = useState<'light' | 'dark'>((localStorage.getItem('evermore:mode') as 'light'|'dark') || 'light');

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-mode', mode);
    localStorage.setItem('evermore:theme', theme);
    localStorage.setItem('evermore:mode', mode);
  }, [theme, mode]);

  return (
    <ThemeContext.Provider value={{ theme, mode, setTheme, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
};
