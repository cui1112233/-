import { Button, Checkbox, ConfigProvider, Form, Input, message } from 'antd';
import { cloneElement, Fragment, isValidElement, useEffect, useState } from 'react';
import { BrandLogo } from '../components/BrandLogo';
import { Link } from '../components/Link';
import { getCurrentAccount, getCurrentUsername, login, logout } from '../api/auth';
import { getToken } from '../api/client';
import { StackyPet } from '../pet/StackyPet';
import { createAntTheme } from '../styles/theme';

const navItems = [
  { href: '/', icon: '🏠', label: '首页' },
  { href: '/script', icon: '📝', label: '剧本生成' },
  { href: '/novel-panel', icon: '📖', label: '小说面板' },
  { href: '/shuihuo-production', icon: '🎞', label: '水货生产' },
  { href: '/agent', icon: '🤖', label: 'Agent 工作区' },
  { href: '/history', icon: '🗂', label: '历史' },
  { href: '/tts', icon: '🎙', label: '配音' }
];

const THEME_STORAGE_KEY = 'yizhan-theme';

function initialTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

function pageTitle(pathname) {
  const item = navItems.find(nav => nav.href === pathname);
  return item ? item.label : '一战晟铭';
}

function canAccessAdmin(account) {
  if (!account) return false;
  if (account.isOwner) return true;
  return (account.effectivePermissions || []).some(({ capability }) => (
    capability === 'account:review'
    || capability === 'preset:draft'
    || capability === 'preset:publish'
  ));
}

export function UserLayout({ children }) {
  const [username, setUsername] = useState(getCurrentUsername());
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loginExpanded, setLoginExpanded] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState(initialTheme);
  const pathname = window.location.pathname;
  const isLoggedIn = Boolean(username);
  const isHome = pathname === '/';
  const content = isValidElement(children) ? cloneElement(children, { theme }) : children;

  const accountSessionKey = username || 'anonymous';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.body.classList.add('user-theme-active');
    return () => document.body.classList.remove('user-theme-active');
  }, []);

  useEffect(() => {
    function showLogin() {
      setUsername('');
      setAccount(null);
    }

    window.addEventListener('qiantie:auth-expired', showLogin);
    if (!getToken()) {
      showLogin();
    } else {
      getCurrentAccount().then(currentAccount => {
        setUsername(currentAccount.username);
        setAccount(currentAccount);
      }).catch(error => {
        if (String(error.message).includes('登录已失效')) showLogin();
        else setAccount(null);
      });
    }
    return () => window.removeEventListener('qiantie:auth-expired', showLogin);
  }, []);

  useEffect(() => {
    if (isLoggedIn || pathname === '/') return;
    window.history.replaceState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [isLoggedIn, pathname]);

  async function handleLogin(values) {
    setLoading(true);
    try {
      const data = await login(values.username, values.password, values.remember);
      setUsername(data.username);
      setAccount(data);
      setLoginDialogOpen(false);
      message.success('登录成功');
    } catch (error) {
      message.error(error.message || '登录失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await logout();
    setUsername('');
    setAccount(null);
    message.success('已退出');
  }

  function toggleSidebar() {
    setSidebarCollapsed(collapsed => !collapsed);
  }

  function toggleTheme() {
    setTheme(current => current === 'dark' ? 'light' : 'dark');
  }

  const showLoginOverlay = !isLoggedIn && isHome && loginDialogOpen;
  const loginOverlay = showLoginOverlay ? (
    <div className="legacy-login-overlay">
      <div className={`login-modal${loginExpanded ? ' is-expanded' : ''}`}>
        <div className="login-concrete-texture" aria-hidden="true" />
        <div className="login-background-logo login-background-logo--one" aria-hidden="true"><BrandLogo /></div>
        <div className="login-background-logo login-background-logo--two" aria-hidden="true"><BrandLogo /></div>
        <div className="login-background-logo login-background-logo--three" aria-hidden="true"><BrandLogo /></div>
        <button
          className="login-title"
          type="button"
          aria-expanded={loginExpanded}
          onClick={() => setLoginExpanded(value => !value)}
        >
          一战晟铭登录
        </button>
        <div className="login-form-wrap">
          <Form layout="vertical" initialValues={{ remember: true }} onFinish={handleLogin}>
            <Form.Item label="账号" name="username" rules={[{ required: true, message: '请输入账号' }]}>
              <Input placeholder="请输入账号" autoComplete="username" />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>
            <Form.Item name="remember" valuePropName="checked">
              <Checkbox>30 天保持登录</Checkbox>
            </Form.Item>
            <Button block type="primary" htmlType="submit" loading={loading}>登 录</Button>
          </Form>
          <p className="login-hint">提示：请联系管理员获取账号</p>
        </div>
      </div>
    </div>
  ) : null;

  if (isHome) {
    return (
      <ConfigProvider theme={createAntTheme(theme)}>
        <div className="home-shell">
          {isValidElement(children) ? cloneElement(children, { theme, isLoggedIn, onOpenLogin: () => setLoginDialogOpen(true) }) : content}
          {loginOverlay}
        </div>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider theme={createAntTheme(theme)}>
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
          <BrandLogo className="legacy-brand-logo" />
          <span className="legacy-brand-title">一战晟铭</span>
        </div>
        <nav className="legacy-nav">
          {navItems.map(item => (
            <Link key={item.href} href={item.href} className={pathname === item.href ? 'active' : ''}>
              <span className="legacy-nav-icon">{item.icon}</span>
              <span className="legacy-nav-label">{item.label}</span>
              <span className="legacy-nav-tooltip" aria-hidden="true">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="legacy-sidebar-tools">
          <button
            className="legacy-sidebar-tool legacy-theme-toggle"
            type="button"
            aria-label={theme === 'dark' ? '切换至浅色主题' : '切换至深色主题'}
            title={theme === 'dark' ? '切换至浅色主题' : '切换至深色主题'}
            onClick={toggleTheme}
          >
            <span className="legacy-nav-icon">{theme === 'dark' ? '☀' : '☾'}</span>
            <span className="legacy-nav-label">主题</span>
          </button>
          <Link href="/settings" className="legacy-sidebar-tool" title="设置">
            <span className="legacy-nav-icon">⚙</span>
            <span className="legacy-nav-label">设置</span>
          </Link>
          {canAccessAdmin(account) ? (
            <Link href="/admin/presets" reload className="legacy-sidebar-tool" title="管理后台">
              <span className="legacy-nav-icon">🛡</span>
              <span className="legacy-nav-label">管理后台</span>
            </Link>
          ) : null}
        </div>
      </aside>
      <Fragment key={accountSessionKey}>
        <main className="legacy-main">
          <header className="legacy-topbar">
            <span className="legacy-page-title">{pageTitle(pathname)}</span>
            <div className="legacy-userbar">
              {isLoggedIn ? (
                <>
                  <span className="legacy-muted">{username}</span>
                  <Button size="small" onClick={handleLogout}>退出</Button>
                </>
              ) : null}
            </div>
          </header>
          <section className="legacy-content">{content}</section>
        </main>
        <StackyPet />
      </Fragment>
      {loginOverlay}
      </div>
    </ConfigProvider>
  );
}
