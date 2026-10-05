import * as React from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
interface ThemeCtx {
  theme: ThemeChoice;
  resolved: 'light' | 'dark';
  setTheme(t: ThemeChoice): void;
  toggle(): void;
}

const Ctx = React.createContext<ThemeCtx>({ theme: 'system', resolved: 'light', setTheme() {}, toggle() {} });
const KEY = 'ps-theme';

function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/** Light/dark theme; defaults to the operating system setting. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemeChoice>(() => {
    try {
      return (localStorage.getItem(KEY) as ThemeChoice | null) ?? 'system';
    } catch {
      return 'system';
    }
  });
  const [sysDark, setSysDark] = React.useState(systemDark);
  React.useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const on = () => setSysDark(mq.matches);
    mq?.addEventListener('change', on);
    return () => mq?.removeEventListener('change', on);
  }, []);
  const resolved: 'light' | 'dark' = theme === 'system' ? (sysDark ? 'dark' : 'light') : theme;
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);
  const setTheme = React.useCallback((t: ThemeChoice) => {
    setThemeState(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* private mode */
    }
  }, []);
  const value = React.useMemo(
    () => ({ theme, resolved, setTheme, toggle: () => setTheme(resolved === 'dark' ? 'light' : 'dark') }),
    [theme, resolved, setTheme],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  return React.useContext(Ctx);
}
