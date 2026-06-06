import * as React from 'react';
import { useMemo } from 'react';
import { Layout, Menu } from 'antd';
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
  AppstoreOutlined,
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
    const items = [
      {
        key: '/projects',
        icon: <FolderOutlined style={{ fontSize: 18 }} />,
        label: '作品区',
      },
    ];

    if (currentProject) {
      items.push({
        key: `/workspace/${currentProject.id}`,
        icon: <DesktopOutlined style={{ fontSize: 18 }} />,
        label: '工作台',
      });
    }

    items.push(
      {
        key: '/prompt-templates',
        icon: <FileTextOutlined style={{ fontSize: 18 }} />,
        label: '提示词库',
      },
      {
        key: '/ai-character',
        icon: <RobotOutlined style={{ fontSize: 18 }} />,
        label: 'AI角色',
      },
      {
        key: '/characters',
        icon: <UserOutlined style={{ fontSize: 18 }} />,
        label: '角色库',
      },
      {
        key: '/styles',
        icon: <FormatPainterOutlined style={{ fontSize: 18 }} />,
        label: '风格库',
      },
      {
        key: '/settings',
        icon: <SettingOutlined style={{ fontSize: 18 }} />,
        label: '设置',
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
        <Sider width={220} className={styles.sider}>
          <Menu
            mode="inline"
            selectedKeys={[getSelectedKey()]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            className={styles.menu}
          />
        </Sider>
        <Content className={styles.content}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
