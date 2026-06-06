import { atom } from 'recoil';

export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'app-theme';
const LEGACY_THEME_STORAGE_KEY = 'theme';
const DEFAULT_THEME: ThemeMode = 'dark';

const isThemeMode = (value: string | null): value is ThemeMode => {
  return value === 'light' || value === 'dark';
};

export const applyThemeToDocument = (theme: ThemeMode) => {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
};

const persistTheme = (theme: ThemeMode) => {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
};

export const getNextThemeMode = (theme: ThemeMode): ThemeMode => {
  return theme === 'dark' ? 'light' : 'dark';
};

// 优先读取新键，兼容迁移旧的 theme 键，并同步到 DOM 和新存储键。
const getInitialTheme = (): ThemeMode => {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (isThemeMode(savedTheme)) {
    applyThemeToDocument(savedTheme);
    return savedTheme;
  }

  const legacyTheme = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
  if (isThemeMode(legacyTheme)) {
    persistTheme(legacyTheme);
    applyThemeToDocument(legacyTheme);
    return legacyTheme;
  }

  persistTheme(DEFAULT_THEME);
  applyThemeToDocument(DEFAULT_THEME);
  return DEFAULT_THEME;
};

export const themeState = atom<ThemeMode>({
  key: 'themeState',
  default: getInitialTheme(),
  effects: [
    ({ onSet }) => {
      onSet((newTheme) => {
        persistTheme(newTheme);
        applyThemeToDocument(newTheme);
      });
    },
  ],
});
