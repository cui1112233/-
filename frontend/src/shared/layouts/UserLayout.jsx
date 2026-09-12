import { Avatar, Button, Checkbox, ConfigProvider, Form, Input, message, Modal } from 'antd';
import { AudioLines, BookOpen, Bot, Bug, ChartNoAxesCombined, ChevronDown, Clapperboard, Crown, FilePenLine, Fingerprint, FolderClock, Home, KeyRound, LogOut, Moon, NotebookTabs, PanelLeftClose, PanelLeftOpen, Settings2, ShieldCheck, Sun, UserRound, UsersRound, X } from 'lucide-react';
import { cloneElement, Fragment, isValidElement, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BrandLogo } from '../components/BrandLogo';
import { Link } from '../components/Link';
import { getCurrentAccount, getCurrentUsername, login, loginWithPasskey, logout } from '../api/auth';
import { getToken } from '../api/client';
import { getConfig } from '../api/config';
import { avatarDisplay } from '../avatars';
import { CmPenguinCompanion } from '../pet/CmPenguinCompanion';
import { dispatchPetContext } from '../pet/stacky';
import { GLOBAL_TASK_NOTIFICATION_EVENT, normalizeGlobalTaskNotification } from '../notifications/globalTaskCenter.js';
import { createAntTheme } from '../styles/theme';
import { getRouteAccessState, shouldPromptLoginForApiFailure } from './routeAccess.js';

// 动态 Logo 包含 WebGL shader，不能阻塞任何已登录业务页的首屏，按真正使用时再下载。
const SuperOpcLiquidMetalLogo = lazy(() => import('../components/SuperOpcLiquidMetalLogo'));

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

const ACCOUNT_CENTER_ROUTES = ['/member', '/profile', '/security', '/advanced-team-admin', '/api-config', '/usage', '/team', '/accounts'];

const THEME_STORAGE_KEY = 'yizhan-theme';

function initialTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

function pageTitle(pathname) {
  if (['/member', '/profile', '/security', '/advanced-team-admin', '/api-config', '/usage', '/team', '/accounts'].includes(pathname)) return '个人中心';
  const item = navItems.find(nav => nav.href === pathname);
  return item ? item.label : '一战晟铭';
}

function canAccessAdmin(account) {
  // The admin console is a developer workspace. Team members receive API
  // scopes and usage visibility in the account center, never the console.
  return account?.role === 'dev';
}

function normalizeAccountCenterReturnPath(value) {
  if (!value) return '/';
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || ACCOUNT_CENTER_ROUTES.includes(url.pathname)) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

export function UserLayout({ children }) {
  const [username, setUsername] = useState(getCurrentUsername());
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [accountCenterOpen, setAccountCenterOpen] = useState(false);
  const [accountProfileOpen, setAccountProfileOpen] = useState(true);
  const [loginForm] = Form.useForm();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState(initialTheme);
  const [petVisible, setPetVisible] = useState(true);
  const [avatar, setAvatar] = useState(null);
  const accountSessionGenerationRef = useRef(0);
  const loginCardRef = useRef(null);
  const accountCenterReturnPathRef = useRef(null);
  const pathname = window.location.pathname;
  const isAccountCenterRoute = ACCOUNT_CENTER_ROUTES.includes(pathname);
  const isLoggedIn = Boolean(username);
  const isHome = pathname === '/';
  const routeAccess = getRouteAccessState({ pathname, isLoggedIn });
  const displayAvatar = avatarDisplay(avatar, username);
  const accountSessionKey = username || 'anonymous';
  const visibleNavItems = navItems;
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
    // 个人中心是一个完整工作区：账号页保持抽屉展开，普通业务页则记住返回位置。
    if (isAccountCenterRoute) {
      setAccountCenterOpen(true);
      return;
    }
    // 主导航切到普通功能页时，个人中心抽屉必须随路由一起退出。
    setAccountCenterOpen(false);
    const currentPath = `${window.location.pathname}${window.location.search}`;
    accountCenterReturnPathRef.current = currentPath;
    sessionStorage.setItem('qiantie:account-center-return-path', currentPath);
  }, [isAccountCenterRoute]);

  function closeAccountCenter() {
    setAccountCenterOpen(false);
    if (!isAccountCenterRoute) return;
    const returnPath = normalizeAccountCenterReturnPath(
      accountCenterReturnPathRef.current
        || sessionStorage.getItem('qiantie:account-center-return-path')
    );
    window.location.assign(returnPath);
  }

  useEffect(() => {
    if (!isLoggedIn) return undefined;
    const appendTaskNotification = event => {
      const notification = normalizeGlobalTaskNotification(event.detail || {});
      if (notification.status === 'working') return;
      const kind = notification.status === 'error' ? 'error' : 'success';
      const targetPath = notification.pagePath && notification.pagePath !== window.location.pathname ? notification.pagePath : '';
      message.open({
        key: `task-${notification.id}`,
        type: kind,
        content: <div className="global-task-toast" role={targetPath ? 'link' : undefined} tabIndex={targetPath ? 0 : undefined} onClick={() => targetPath && window.location.assign(targetPath)} onKeyDown={event => { if (targetPath && (event.key === 'Enter' || event.key === ' ')) window.location.assign(targetPath); }}><span><strong>{notification.title}</strong>{notification.detail ? `：${notification.detail}` : ''}</span>{targetPath ? <Button type="link" size="small" onClick={event => { event.stopPropagation(); window.location.assign(targetPath); }}>返回查看</Button> : null}</div>,
        duration: notification.status === 'error' ? 6 : 4,
        style: { marginTop: 12 },
        onClick: () => targetPath && window.location.assign(targetPath)
      });
    };
    const receiveEmbeddedTaskNotification = event => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'qiantie:task-notification') return;
      appendTaskNotification({ detail: event.data });
    };
    window.addEventListener(GLOBAL_TASK_NOTIFICATION_EVENT, appendTaskNotification);
    window.addEventListener('message', receiveEmbeddedTaskNotification);
    return () => {
      window.removeEventListener(GLOBAL_TASK_NOTIFICATION_EVENT, appendTaskNotification);
      window.removeEventListener('message', receiveEmbeddedTaskNotification);
    };
  }, [isLoggedIn, username]);

  useEffect(() => {
    document.body.classList.add('user-theme-active');
    return () => document.body.classList.remove('user-theme-active');
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return undefined;
    const refreshProfile = () => {
      getCurrentAccount().then(currentAccount => {
        setUsername(currentAccount.username);
        setAccount(currentAccount);
      }).catch(() => {});
    };
    window.addEventListener('qiantie:profile-updated', refreshProfile);
    return () => window.removeEventListener('qiantie:profile-updated', refreshProfile);
  }, [isLoggedIn]);

  useEffect(() => {
    function updatePetVisibility(event) {
      setPetVisible(event.detail?.petVisible !== false);
    }
    window.addEventListener('qiantie:notifications-updated', updatePetVisibility);
    if (isLoggedIn) {
      getConfig().then(config => {
        setPetVisible(config.notifications?.petVisible !== false);
        setAvatar(config.avatar || null);
      }).catch(() => {});
    }
    return () => window.removeEventListener('qiantie:notifications-updated', updatePetVisibility);
  }, [isLoggedIn]);

  useEffect(() => {
    let dialogOpen = false;
    function showApiFailure(event) {
      if (dialogOpen) return;
      dialogOpen = true;
      const { source, method, status, message: detail, sessionAuthFailure } = event.detail || {};
      if (shouldPromptLoginForApiFailure({ status, sessionAuthFailure })) {
        setUsername('');
        setAccount(null);
        setLoginDialogOpen(true);
        Modal.warning({
          className: 'auth-expired-modal',
          title: '登录已失效',
          content: '当前登录状态已失效，请重新登录后继续使用。登录后将返回当前页面。',
          okText: '重新登录',
          onOk: () => { setLoginDialogOpen(true); dialogOpen = false; },
          afterClose: () => { dialogOpen = false; }
        });
        return;
      }
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
    if (routeAccess.shouldPromptLogin) setLoginDialogOpen(true);
  }, [routeAccess.shouldPromptLogin]);

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

  async function handlePasskeyLogin() {
    const values = loginForm.getFieldsValue(['username', 'remember']);
    if (!values.username) return message.warning('请先填写账号，再使用 Passkey 登录');
    accountSessionGenerationRef.current += 1;
    setPasskeyLoading(true);
    try {
      const data = await loginWithPasskey(values.username, values.remember !== false);
      setUsername(data.username);
      setAccount(data);
      setLoginDialogOpen(false);
      message.success('Passkey 登录成功');
    } catch (error) {
      message.error(error.message || 'Passkey 登录失败');
    } finally {
      setPasskeyLoading(false);
    }
  }

  async function handleLogout() {
    accountSessionGenerationRef.current += 1;
    await logout();
    setUsername('');
    setAccount(null);
    setAvatar(null);
    setLoginDialogOpen(true);
    message.success('已退出');
  }

  function openLoginDialog() {
    setLoginDialogOpen(true);
  }

  function updateLoginCardParallax(event) {
    const card = loginCardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    card.style.setProperty('--login-card-rotate-x', `${-y * 5}deg`);
    card.style.setProperty('--login-card-rotate-y', `${x * 5}deg`);
  }

  function resetLoginCardParallax() {
    const card = loginCardRef.current;
    if (!card) return;
    card.style.removeProperty('--login-card-rotate-x');
    card.style.removeProperty('--login-card-rotate-y');
  }

  function toggleSidebar() {
    setSidebarCollapsed(collapsed => !collapsed);
  }

  function toggleTheme() {
    setTheme(current => current === 'dark' ? 'light' : 'dark');
  }

  const showLoginCard = !isLoggedIn && (isHome || loginDialogOpen);
  const pageContent = routeAccess.canRenderPage ? content : null;
  const loginOverlay = showLoginCard ? (
    <div className="legacy-login-overlay nebula-login-overlay">
      <div className="login-modal nebula-login-modal" ref={loginCardRef} onPointerMove={updateLoginCardParallax} onPointerLeave={resetLoginCardParallax}>
        <div className="nebula-login-brand"><BrandLogo /></div>
        <h1>一战晟铭登录</h1>
        <p className="nebula-login-subtitle">继续你的创作工作流</p>
        <div className="login-form-wrap nebula-login-form-wrap">
          <Form form={loginForm} layout="vertical" initialValues={{ remember: true }} onFinish={handleLogin}>
            <Form.Item label="账号" name="username" rules={[{ required: true, message: '请输入账号' }]}>
              <Input placeholder="请输入账号" autoComplete="username" />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password
                placeholder="请输入密码"
                autoComplete="current-password"
                styles={{ input: { backgroundColor: '#727786', color: '#fff', boxShadow: 'none' } }}
              />
            </Form.Item>
            <Form.Item name="remember" valuePropName="checked">
              <Checkbox>30 天保持登录</Checkbox>
            </Form.Item>
            <Button block type="primary" htmlType="submit" loading={loading}>登录并进入工作台</Button>
            <Button block icon={<Fingerprint size={17} />} loading={passkeyLoading} onClick={handlePasskeyLogin}>使用 Passkey 登录</Button>
          </Form>
          <p className="login-hint"><a href="/recover">忘记密码？</a>　提示：请联系管理员获取账号</p>
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
      <div className={`legacy-shell${isAccountCenterRoute ? ' account-center-shell' : ''}${accountCenterOpen ? ' account-center-drawer-open' : ''}`}>
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
            <Suspense fallback={<BrandLogo className="legacy-brand-logo" />}>
              <SuperOpcLiquidMetalLogo theme={theme} scale={1} className="legacy-brand-logo" />
            </Suspense>
            <span className="legacy-brand-title">一战晟铭</span>
          </Link>
        </div>
        <nav className="legacy-nav">
          {visibleNavItems.map(item => {
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
        </div>
        {isLoggedIn ? (
          <div className="legacy-sidebar-user">
            <button
              type="button"
              className="legacy-sidebar-avatar"
              title="打开个人中心"
              aria-label="进入个人中心"
              onClick={() => {
                setAccountCenterOpen(true);
                // 个人中心作为完整工作区打开：记住业务页，关闭时回到这里。
                if (!isAccountCenterRoute) {
                  const currentPath = `${window.location.pathname}${window.location.search}`;
                  accountCenterReturnPathRef.current = currentPath;
                  sessionStorage.setItem('qiantie:account-center-return-path', currentPath);
                  window.location.assign('/profile');
                }
              }}
            >
              <Avatar size={28} src={account?.avatarUrl} style={{ backgroundColor: displayAvatar.background }}>{displayAvatar.emoji}</Avatar>
            </button>
            <span className="legacy-sidebar-username" title={account?.displayName || username}>{account?.displayName || username}</span>
            <Button size="small" onClick={handleLogout}>退出</Button>
          </div>
        ) : null}
      </aside>
      {isLoggedIn && accountCenterOpen ? <aside className="account-center-popover" role="dialog" aria-label="个人中心">
        <div className="account-center-popover-head"><strong>个人中心</strong><button type="button" aria-label="关闭个人中心" onClick={closeAccountCenter}><X size={19} /></button></div>
        <div className="account-center-popover-profile"><Avatar size={54} src={account?.avatarUrl}>{displayAvatar.emoji}</Avatar><div><strong>{account?.displayName || username}</strong><small>@{username}</small><em>{account?.role === 'dev' ? 'DEV' : account?.role === 'manager' ? 'MANAGER' : 'MEMBER'}</em></div></div>
        <div className="account-center-popover-group"><div className="account-center-popover-parent"><Link href="/profile" className={pathname === '/profile' ? 'active' : ''}><UserRound size={18} />个人资料</Link><button type="button" aria-label={accountProfileOpen ? '收起个人资料菜单' : '展开个人资料菜单'} onClick={() => setAccountProfileOpen(value => !value)}><ChevronDown size={17} className={accountProfileOpen ? 'expanded' : ''} /></button></div>
          {accountProfileOpen ? <div className="account-center-popover-submenu"><Link href="/member" className={pathname === '/member' ? 'active' : ''}><Crown size={17} />会员中心</Link><Link href="/security" className={pathname === '/security' ? 'active' : ''}><ShieldCheck size={17} />账号安全</Link>{['dev', 'manager'].includes(account?.role) ? <Link href="/advanced-team-admin" className={pathname === '/advanced-team-admin' ? 'active' : ''}><UsersRound size={17} />联合治理</Link> : null}</div> : null}
        </div>
        <div className="account-center-popover-links"><Link href="/api-config" className={pathname === '/api-config' ? 'active' : ''}><KeyRound size={17} />API 配置</Link><Link href="/usage" className={pathname === '/usage' ? 'active' : ''}><ChartNoAxesCombined size={17} />用量与制作</Link>{['dev', 'manager'].includes(account?.role) ? <Link href="/team" className={pathname === '/team' ? 'active' : ''}><UsersRound size={17} />组员管理</Link> : null}</div>
        {canAccessAdmin(account) ? <div className="account-center-popover-links account-center-popover-developer-links"><span className="account-center-popover-section-label">开发者工具</span><Link href="/accounts"><UsersRound size={17} />账号与角色</Link><Link href="/admin/presets" reload><ShieldCheck size={17} />管理后台</Link></div> : null}
        <button type="button" className="account-center-popover-logout" onClick={handleLogout}><LogOut size={17} />退出登录</button>
      </aside> : null}
      <Fragment key={accountSessionKey}>
        <main className="legacy-main">
          <header className="legacy-topbar">
            <span className="legacy-page-title">{pageTitle(pathname)}</span>
            <div className="legacy-userbar" aria-hidden="true" />
          </header>
          <section className={`legacy-content${pathname === '/agent' ? ' legacy-content--agent' : ''}`}>{pageContent}</section>
        </main>
        {isLoggedIn && pathname !== '/' && petVisible ? <CmPenguinCompanion username={username} accountSessionKey={accountSessionKey} /> : null}
      </Fragment>
      {loginOverlay}
      </div>
    </ConfigProvider>
  );
}
