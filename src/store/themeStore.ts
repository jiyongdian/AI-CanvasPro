import { atom } from 'recoil';

export type ThemeMode = 'light' | 'dark';

// 从 localStorage 读取默认主题，如果没有则默认为 'dark'
const getInitialTheme = (): ThemeMode => {
  const savedTheme = localStorage.getItem('app-theme') as ThemeMode;
  if (savedTheme === 'light' || savedTheme === 'dark') {
    return savedTheme;
  }
  // 默认继续使用暗黑模式
  return 'dark';
};

export const themeState = atom<ThemeMode>({
  key: 'themeState',
  default: getInitialTheme(),
  effects: [
    ({ onSet }) => {
      onSet((newTheme) => {
        localStorage.setItem('app-theme', newTheme);
        // 同步修改 html 标签的 data-theme 属性，便于 CSS 变量生效
        document.documentElement.setAttribute('data-theme', newTheme);
      });
    },
  ],
});
