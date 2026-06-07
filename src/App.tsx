import * as React from 'react';
import { useEffect } from 'react';
import { App as AntdApp, ConfigProvider, theme } from 'antd';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useRecoilValue } from 'recoil';
import { themeState } from './store/themeStore';
import MainLayout from './components/layout/MainLayout';
import { checkForUpdate } from './services/updateService';
import ProjectList from './pages/ProjectList';
import Workspace from './pages/Workspace';
import CharacterLibrary from './pages/CharacterLibrary';
import AICharacter from './pages/AICharacter';
import Settings from './pages/Settings';
import StyleLibrary from './pages/StyleLibrary';
import PromptTemplates from './pages/PromptTemplates';
import { AntdAppBridge } from './utils/antdApp';
import 'antd/dist/reset.css';

const App: React.FC = () => {
  const currentTheme = useRecoilValue(themeState);

  // 启动时静默检查更新
  useEffect(() => {
    checkForUpdate().catch(() => {
      // 静默失败，不影响用户使用
    });
  }, []);


  const isDark = currentTheme === 'dark';

  const lightThemeTokens = {
    colorPrimary: '#4f46e5',
    colorInfo: '#3b82f6',
    colorSuccess: '#10b981',
    colorWarning: '#f59e0b',
    colorError: '#ef4444',
    colorBgBase: '#f0f2f7',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBorder: '#c5cdd8',
    colorBorderSecondary: '#dce1e8',
    colorText: '#0f172a',
    colorTextSecondary: '#475569',
    colorTextTertiary: '#64748b',
    colorTextQuaternary: '#94a3b8',
    borderRadius: 8,
    borderRadiusLG: 12,
    borderRadiusSM: 6,
    boxShadow: '0 4px 8px -2px rgba(15, 23, 42, 0.12), 0 2px 4px -2px rgba(15, 23, 42, 0.08)',
    boxShadowSecondary: '0 1px 3px 0 rgba(15, 23, 42, 0.09), 0 1px 2px -1px rgba(15, 23, 42, 0.06)',
  };

  const darkThemeTokens = {
    colorPrimary: '#3a7bd5',
    colorInfo: '#00d2ff',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorBgBase: '#0d0d0d',
    colorBgContainer: '#1a1a2e',
    colorBgElevated: '#16213e',
    colorBorder: '#2a2a3e',
    colorBorderSecondary: '#222233',
    colorText: '#e5e5e5',
    colorTextSecondary: '#a0a0a0',
    borderRadius: 8,
    borderRadiusLG: 12,
    borderRadiusSM: 6,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
    boxShadowSecondary: '0 2px 8px rgba(0, 0, 0, 0.3)',
  };

  const lightComponents = {
    Layout: {
      headerBg: 'transparent',
      siderBg: 'transparent',
      bodyBg: 'transparent',
    },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemSelectedBg: 'rgba(79, 70, 229, 0.1)',
      itemHoverBg: 'rgba(79, 70, 229, 0.05)',
      itemColor: '#64748b',
      itemSelectedColor: '#4f46e5',
      itemHoverColor: '#4f46e5',
    },
    Card: {
      colorBgContainer: '#ffffff',
      colorBorderSecondary: '#c5cdd8',
    },
    Button: {
      primaryShadow: '0 4px 6px -1px rgba(79, 70, 229, 0.25), 0 2px 4px -2px rgba(79, 70, 229, 0.15)',
    },
    Input: {
      colorBgContainer: '#ffffff',
      colorBorder: '#c5cdd8',
      activeBorderColor: '#4f46e5',
      hoverBorderColor: '#6366f1',
    },
    Select: {
      colorBgContainer: '#ffffff',
      colorBorder: '#c5cdd8',
      optionSelectedBg: '#eef2ff',
    },
    Modal: {
      contentBg: '#ffffff',
      headerBg: '#ffffff',
    },
    Table: {
      colorBgContainer: '#ffffff',
      headerBg: '#f4f6f8',
    },
    Spin: {
      colorPrimary: '#4f46e5',
    },
  };

  const darkComponents = {
    Layout: {
      headerBg: 'transparent',
      siderBg: 'transparent',
      bodyBg: 'transparent',
    },
    Menu: {
      darkItemBg: 'transparent',
      darkSubMenuItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(58, 123, 213, 0.2)',
      darkItemHoverBg: 'rgba(58, 123, 213, 0.1)',
      itemColor: '#a0a0a0',
      itemSelectedColor: '#e5e5e5',
      itemHoverColor: '#e5e5e5',
    },
    Card: {
      colorBgContainer: '#1a1a2e',
      colorBorderSecondary: '#2a2a3e',
    },
    Button: {
      primaryShadow: 'none',
      defaultBorderColor: '#3a7bd5',
      defaultBg: '#1a1a2e',
    },
    Input: {
      colorBgContainer: '#141420',
      colorBorder: '#2a2a3e',
      activeBorderColor: '#3a7bd5',
      hoverBorderColor: '#3a7bd5',
    },
    Select: {
      colorBgContainer: '#141420',
      colorBorder: '#2a2a3e',
      optionSelectedBg: '#2a3a5e',
    },
    Modal: {
      contentBg: '#16213e',
      headerBg: '#16213e',
    },
    Table: {
      colorBgContainer: '#141420',
      headerBg: '#1a1a2e',
    },
    Spin: {
      colorPrimary: '#00d2ff',
    },
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: isDark ? darkThemeTokens : lightThemeTokens,
        components: isDark ? darkComponents : lightComponents,
      }}
    >
      <AntdApp>
        <AntdAppBridge />
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <Routes>
            <Route path="/" element={<MainLayout />}>
              <Route index element={<Navigate to="/projects" replace />} />
              <Route path="projects" element={<ProjectList />} />
              <Route path="ai-character" element={<AICharacter />} />
              <Route path="characters" element={<CharacterLibrary />} />
              <Route path="styles" element={<StyleLibrary />} />
              <Route path="settings" element={<Settings />} />
              <Route path="prompt-templates" element={<PromptTemplates />} />
            </Route>
            <Route path="workspace/:projectId" element={<Workspace />} />
          </Routes>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  );
};

export default App;
