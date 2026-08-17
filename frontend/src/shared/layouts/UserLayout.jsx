import { Button, Checkbox, ConfigProvider, Form, Input, message, Modal } from 'antd';
import { AudioLines, BookOpen, Bot, Bug, Clapperboard, FilePenLine, FolderClock, Home, Moon, NotebookTabs, PanelLeftClose, PanelLeftOpen, Settings2, ShieldCheck, Sun } from 'lucide-react';
import { cloneElement, Fragment, isValidElement, useEffect, useRef, useState } from 'react';
import { BrandLogo } from '../components/BrandLogo';
import { Link } from '../components/Link';
import { getCurrentAccount, getCurrentUsername, login, logout } from '../api/auth';
import { getToken } from '../api/client';
import { getConfig } from '../api/config';
import { StackyPet } from '../pet/StackyPet';
import { dispatchPetContext } from '../pet/stacky';
import { createAntTheme } from '../styles/theme';

const navItems = [
  { href: '/', icon: Home, label: '首页' },
  { href: '/script', icon: FilePenLine, label: '剧本生成' },
  { href: '/novel-fetch', icon: BookOpen, label: '小说获取' },
  { href: '/novel-panel', icon: NotebookTabs, label: '小说面板' },
  { href: '/shuihuo-production', icon: Clapperboard, label: '水货生产' },
  { href: '/agent', icon: Bot, label: 'Agent 工作区' },
  { href: '/history', icon: FolderClock, label: '历史' },
  { href: '/issues', icon: Bug, label: '问题日志' },
  { href: '/tts', icon: AudioLines, label: '配音' }
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
  const [petVisible, setPetVisible] = useState(true);
  const accountSessionGenerationRef = useRef(0);
  const pathname = window.location.pathname;
  const isLoggedIn = Boolean(username);
  const isHome = pathname === '/';
  const accountSessionKey = username || 'anonymous';
  const content = isValidElement(children)
    ? cloneElement(
      children,
      { theme },
      isValidElement(children.props.children) ? cloneElement(children.props.children, { theme }) : children.props.children
    )
    : children;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.body.classList.add('user-theme-active');
    return () => document.body.classList.remove('user-theme-active');
  }, []);

  useEffect(() => {
    function updatePetVisibility(event) {
      setPetVisible(event.detail?.petVisible !== false);
    }
    window.addEventListener('qiantie:notifications-updated', updatePetVisibility);
    if (isLoggedIn) {
      getConfig().then(config => setPetVisible(config.notifications?.petVisible !== false)).catch(() => {});
    }
    return () => window.removeEventListener('qiantie:notifications-updated', updatePetVisibility);
  }, [isLoggedIn]);

  useEffect(() => {
    let dialogOpen = false;
    function showApiFailure(event) {
      if (dialogOpen) return;
      dialogOpen = true;
      const { source, method, status, message: detail } = event.detail || {};
      const sourceLabel = source ? `${method || 'GET'} ${source}` : '服务请求';
      const statusLabel = status ? `（${status}）` : '';
      Modal.error({
        title: `${sourceLabel} 请求失败${statusLabel}`,
        content: detail || '请求失败，请稍后重试。',
        okText: '确定',
        onOk: () => { dialogOpen = false; },
        afterClose: () => { dialogOpen = false; }
      });
    }
    window.addEventListener('qiantie:api-error', showApiFailure);
    return () => window.removeEventListener('qiantie:api-error', showApiFailure);
  }, []);

  useEffect(() => {
    dispatchPetContext({
      page: pageTitle(pathname),
      pagePath: pathname,
      workspace: 'qiantie'
    });
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    const sessionGeneration = ++accountSessionGenerationRef.current;
    const sessionToken = getToken();

    function isCurrentSession() {
      return !cancelled
        && accountSessionGenerationRef.current === sessionGeneration
        && getToken() === sessionToken;
    }

    function clearSession() {
      setUsername('');
      setAccount(null);
    }

    function showLogin(event) {
      const expiredToken = event?.detail?.token;
      const currentToken = getToken();
      // Modern clients dispatch the token used by the failed request. Accept
      // only an event for the currently active session. Legacy clients do not
      // carry a token and can only be accepted after they cleared this effect's
      // still-current session.
      if (expiredToken) {
        if (!currentToken || expiredToken !== currentToken) return;
      } else if (!sessionToken || currentToken || cancelled || accountSessionGenerationRef.current !== sessionGeneration) {
        return;
      }
      accountSessionGenerationRef.current += 1;
      clearSession();
      setLoginExpanded(true);
      setLoginDialogOpen(true);
    }

    window.addEventListener('qiantie:auth-expired', showLogin);
    if (!sessionToken) {
      clearSession();
    } else {
      getCurrentAccount().then(currentAccount => {
        if (!isCurrentSession()) return;
        setUsername(currentAccount.username);
        setAccount(currentAccount);
      }).catch(error => {
        if (!isCurrentSession()) return;
        if (String(error.message).includes('登录已失效')) showLogin();
        else setAccount(null);
      });
    }
    return () => {
      cancelled = true;
      accountSessionGenerationRef.current += 1;
      window.removeEventListener('qiantie:auth-expired', showLogin);
    };
  }, []);

  useEffect(() => {
    if (isLoggedIn || pathname === '/') return;
    window.history.replaceState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [isLoggedIn, pathname]);

  async function handleLogin(values) {
    accountSessionGenerationRef.current += 1;
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
    accountSessionGenerationRef.current += 1;
    await logout();
    setUsername('');
    setAccount(null);
    setLoginExpanded(true);
    setLoginDialogOpen(true);
    message.success('已退出');
  }

  function openLoginDialog() {
    setLoginExpanded(true);
    setLoginDialogOpen(true);
  }

  function toggleSidebar() {
    setSidebarCollapsed(collapsed => !collapsed);
  }

  function toggleTheme() {
    setTheme(current => current === 'dark' ? 'light' : 'dark');
  }

  const showLoginOverlay = !isLoggedIn && loginDialogOpen;
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
          {isValidElement(children) ? cloneElement(children, { theme, isLoggedIn, onOpenLogin: openLoginDialog }) : content}
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
            {sidebarCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
          <Link href="/" className="legacy-brand-link">
            <BrandLogo className="legacy-brand-logo" />
            <span className="legacy-brand-title">一战晟铭</span>
          </Link>
        </div>
        <nav className="legacy-nav">
          {navItems.map(item => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={pathname === item.href ? 'active' : ''}>
                <span className="legacy-nav-icon"><Icon size={18} strokeWidth={1.8} aria-hidden="true" /></span>
                <span className="legacy-nav-label">{item.label}</span>
                <span className="legacy-nav-tooltip" aria-hidden="true">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="legacy-sidebar-tools">
          <button
            className="legacy-sidebar-tool legacy-theme-toggle"
            type="button"
            aria-label={theme === 'dark' ? '切换至浅色主题' : '切换至深色主题'}
            title={theme === 'dark' ? '切换至浅色主题' : '切换至深色主题'}
            onClick={toggleTheme}
          >
            <span className="legacy-nav-icon">{theme === 'dark' ? <Sun size={18} strokeWidth={1.8} aria-hidden="true" /> : <Moon size={18} strokeWidth={1.8} aria-hidden="true" />}</span>
            <span className="legacy-nav-label">主题</span>
          </button>
          <Link href="/settings" className="legacy-sidebar-tool" title="设置">
            <span className="legacy-nav-icon"><Settings2 size={18} strokeWidth={1.8} aria-hidden="true" /></span>
            <span className="legacy-nav-label">设置</span>
          </Link>
          {canAccessAdmin(account) ? (
            <Link href="/admin/presets" reload className="legacy-sidebar-tool" title="管理后台">
              <span className="legacy-nav-icon"><ShieldCheck size={18} strokeWidth={1.8} aria-hidden="true" /></span>
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
        {isLoggedIn && pathname !== '/' && petVisible ? <StackyPet username={username} accountSessionKey={accountSessionKey} /> : null}
      </Fragment>
      {loginOverlay}
      </div>
    </ConfigProvider>
  );
}
