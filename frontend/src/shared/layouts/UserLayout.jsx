import { Button, Form, Input, message } from 'antd';
import { useEffect, useState } from 'react';
import { Link } from '../components/Link';
import { getCurrentUsername, login, logout } from '../api/auth';

const navItems = [
  { href: '/', icon: '🏠', label: '首页' },
  { href: '/script', icon: '📝', label: '剧本生成' },
  { href: '/novel-panel', icon: '📖', label: '小说面板' },
  { href: '/agent', icon: '🤖', label: 'Agent 工作区' },
  { href: '/history', icon: '🗂', label: '历史' },
  { href: '/tts', icon: '🎙', label: '配音' },
  { href: '/settings', icon: '⚙', label: '设置' }
];

const THEME_STORAGE_KEY = 'yizhan-theme';

function initialTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

function pageTitle(pathname) {
  const item = navItems.find(nav => nav.href === pathname);
  return item ? item.label : '一战晟铭';
}

export function UserLayout({ children }) {
  const [username, setUsername] = useState(getCurrentUsername());
  const [loading, setLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState(initialTheme);
  const pathname = window.location.pathname;
  const isLoggedIn = Boolean(username);
  const isHome = pathname === '/';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  async function handleLogin(values) {
    setLoading(true);
    try {
      const data = await login(values.username, values.password);
      setUsername(data.username);
      message.success('登录成功');
    } catch (error) {
      message.error(error.message || '登录失败');
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    logout();
    setUsername('');
    message.success('已退出');
  }

  function toggleSidebar() {
    setSidebarCollapsed(collapsed => !collapsed);
  }

  function toggleTheme() {
    setTheme(current => current === 'dark' ? 'light' : 'dark');
  }

  const loginOverlay = !isLoggedIn ? (
    <div className="legacy-login-overlay">
      <div className="login-modal legacy-panel-card">
        <div className="login-title">🔐 登录</div>
        <Form layout="vertical" onFinish={handleLogin}>
          <Form.Item label="账号" name="username" rules={[{ required: true, message: '请输入账号' }]}>
            <Input placeholder="请输入账号" autoComplete="username" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder="请输入密码" autoComplete="current-password" />
          </Form.Item>
          <Button block type="primary" htmlType="submit" loading={loading}>登 录</Button>
        </Form>
        <p className="login-hint">提示：请联系管理员获取账号</p>
      </div>
    </div>
  ) : null;

  if (isHome) {
    return (
      <div className="home-shell">
        {children}
        {loginOverlay}
      </div>
    );
  }

  return (
    <div className="legacy-shell">
      <aside className={`legacy-sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
        <div className="legacy-brand">
          <button
            className="legacy-sidebar-toggle"
            type="button"
            aria-label={sidebarCollapsed ? '展开导航' : '收起导航'}
            aria-expanded={!sidebarCollapsed}
            onClick={toggleSidebar}
          >
            ☰
          </button>
          <span className="legacy-brand-title">一战晟铭</span>
        </div>
        <nav className="legacy-nav">
          {navItems.map(item => item.href === '/agent' ? (
            <a key={item.href} href={item.href} className={pathname === item.href ? 'active' : ''}>
              <span className="legacy-nav-icon">{item.icon}</span>
              <span className="legacy-nav-label">{item.label}</span>
            </a>
          ) : (
            <Link key={item.href} href={item.href} className={pathname === item.href ? 'active' : ''}>
              <span className="legacy-nav-icon">{item.icon}</span>
              <span className="legacy-nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <main className="legacy-main">
        <header className="legacy-topbar">
          <span className="legacy-page-title">{pageTitle(pathname)}</span>
          <div className="legacy-userbar">
            <button
              className="legacy-theme-toggle"
              type="button"
              aria-label={theme === 'dark' ? '切换至浅色主题' : '切换至深色主题'}
              title={theme === 'dark' ? '切换至浅色主题' : '切换至深色主题'}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            {isLoggedIn ? (
              <>
                <span className="legacy-muted">{username}</span>
                <Button size="small" onClick={handleLogout}>退出</Button>
              </>
            ) : null}
          </div>
        </header>
        <section className="legacy-content">{children}</section>
      </main>
      {loginOverlay}
    </div>
  );
}
