import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('mospi_theme') || 'light';
  });

  const [language, setLanguage] = useState(() => {
    return localStorage.getItem('mospi_lang') || 'en';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mospi_theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-lang', language);
    localStorage.setItem('mospi_lang', language);
  }, [language]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  const setLang = (lang) => {
    setLanguage(lang);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, language, setLang }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
