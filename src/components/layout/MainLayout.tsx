import * as React from 'react';
import { useMemo, Suspense } from 'react';
import { Layout, Menu, Spin } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useRecoilValue, useRecoilState } from 'recoil';
import { currentProjectState } from '../../store/projectStore';
import { themeState, getNextThemeMode } from '../../store/themeStore';
import {
  FolderOutlined,
  UserOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  RobotOutlined,
  DesktopOutlined,
  FormatPainterOutlined,
  SunOutlined,
  MoonOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import styles from './MainLayout.module.css';

const { Header, Sider, Content } = Layout;

const MainLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentProject = useRecoilValue(currentProjectState);
  const [theme, setTheme] = useRecoilState(themeState);

  const toggleTheme = () => {
    setTheme((prev) => getNextThemeMode(prev));
  };

  const menuItems = useMemo(() => {
    const createMenuIcon = (icon: React.ReactNode) => (
      <span className={styles.menuIcon}>{icon}</span>
    );

    const createMenuLabel = (label: string) => (
      <span className={styles.menuLabel}>{label}</span>
    );

    const items = [
      {
        key: '/projects',
        icon: createMenuIcon(<FolderOutlined />),
        label: createMenuLabel('作品区'),
      },
    ];

    if (currentProject) {
      items.push({
        key: `/workspace/${currentProject.id}`,
        icon: createMenuIcon(<DesktopOutlined />),
        label: createMenuLabel('工作台'),
      });
    }

    items.push(
      {
        key: '/prompt-templates',
        icon: createMenuIcon(<FileTextOutlined />),
        label: createMenuLabel('提示词库'),
      },
      {
        key: '/ai-character',
        icon: createMenuIcon(<RobotOutlined />),
        label: createMenuLabel('AI角色'),
      },
      {
        key: '/characters',
        icon: createMenuIcon(<UserOutlined />),
        label: createMenuLabel('角色库'),
      },
      {
        key: '/styles',
        icon: createMenuIcon(<FormatPainterOutlined />),
        label: createMenuLabel('风格库'),
      },
      {
        key: '/settings',
        icon: createMenuIcon(<SettingOutlined />),
        label: createMenuLabel('设置'),
      }
    );

    return items;
  }, [currentProject]);

  const getSelectedKey = () => {
    if (location.pathname.startsWith('/workspace') && currentProject) {
      return `/workspace/${currentProject.id}`;
    }
    return location.pathname;
  };

  return (
    <Layout className={styles.layout}>
      <Header className={styles.header}>
        <div className={styles.logo}>
          <div className={styles.logoIconWrapper}>
            <ThunderboltOutlined className={styles.logoIcon} />
          </div>
          <span className={styles.logoText}>源极AI漫剧</span>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.themeToggleBtn} onClick={toggleTheme} title="切换主题">
            {theme === 'dark' ? <SunOutlined style={{ fontSize: 18 }} /> : <MoonOutlined style={{ fontSize: 18 }} />}
          </div>
        </div>
      </Header>
      <Layout>
        <Sider width={236} className={styles.sider}>
          <div className={styles.navShell}>
            <Menu
              mode="inline"
              selectedKeys={[getSelectedKey()]}
              items={menuItems}
              onClick={({ key }) => navigate(key)}
              className={styles.menu}
            />
          </div>
        </Sider>
        <Content className={styles.content}>
          <Suspense
            fallback={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', minHeight: 240 }}>
                <Spin size="large" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
