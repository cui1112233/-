import { Avatar, Badge, Button, Checkbox, ConfigProvider, Form, Input, message, Modal, Popover } from 'antd';
import { AudioLines, Bell, BookOpen, Bot, Bug, CheckCircle2, Clapperboard, FilePenLine, Fingerprint, FolderClock, Home, Moon, NotebookTabs, PanelLeftClose, PanelLeftOpen, Settings2, ShieldCheck, Sun, XCircle } from 'lucide-react';
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


const THEME_STORAGE_KEY = 'yizhan-theme';
const TASK_NOTIFICATION_STORAGE_KEY_PREFIX = 'qiantie:task-center:';
const MAX_TASK_NOTIFICATIONS = 20;

function initialTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

function pageTitle(pathname) {
  if (pathname === '/member') return '个人中心';
  const item = navItems.find(nav => nav.href === pathname);
  return item ? item.label : '一战晟铭';
}

function taskNotificationStorageKey(username) {
  return username ? `${TASK_NOTIFICATION_STORAGE_KEY_PREFIX}${username}` : '';
}

function readTaskNotifications(username) {
  const key = taskNotificationStorageKey(username);
  if (!key) return [];
  try {
    const rows = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(rows) ? rows.map(normalizeGlobalTaskNotification).slice(0, MAX_TASK_NOTIFICATIONS) : [];
  } catch {
    return [];
  }
}

function writeTaskNotifications(username, notifications) {
  const key = taskNotificationStorageKey(username);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(notifications.slice(0, MAX_TASK_NOTIFICATIONS)));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function formatNotificationTime(timestamp) {
  try {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
  } catch {
    return '';
  }
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
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [accountCenterOpen, setAccountCenterOpen] = useState(false);
  const [accountProfileOpen, setAccountProfileOpen] = useState(true);
  const [loginForm] = Form.useForm();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState(initialTheme);
  const [petVisible, setPetVisible] = useState(true);
  const [avatar, setAvatar] = useState(null);
  const [taskNotifications, setTaskNotifications] = useState(() => readTaskNotifications(getCurrentUsername()));
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);
  const accountSessionGenerationRef = useRef(0);
  const loginCardRef = useRef(null);
  const pathname = window.location.pathname;
  const isLoggedIn = Boolean(username);
  const isHome = pathname === '/';
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
    setTaskNotifications(readTaskNotifications(username));
  }, [username]);

  useEffect(() => {
    if (!isLoggedIn) return undefined;
    const appendTaskNotification = event => {
      const notification = normalizeGlobalTaskNotification(event.detail || {});
      if (notification.status === 'working') return;
      setTaskNotifications(current => {
        const next = [notification, ...current.filter(item => item.id !== notification.id)].slice(0, MAX_TASK_NOTIFICATIONS);
        writeTaskNotifications(username, next);
        return next;
      });
      const kind = notification.status === 'error' ? 'error' : 'success';
      message.open({
        key: `task-${notification.id}`,
        type: kind,
        content: `${notification.title}${notification.detail ? `：${notification.detail}` : ''}`,
        duration: notification.status === 'error' ? 6 : 4,
        style: { marginTop: 12 }
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
      const { source, method, status, message: detail } = event.detail || {};
      if (status === 401) {
        setUsername('');
        setAccount(null);
        setLoginDialogOpen(true);
        Modal.warning({
          className: 'auth-expired-modal',
          title: '登录已失效',
          content: '当前登录状态已过期，已切换到登录页面。请重新登录后继续使用。',
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

  function clearTaskNotifications() {
    setTaskNotifications([]);
    writeTaskNotifications(username, []);
  }

  const taskCenterContent = (
    <section className="global-task-center" aria-label="任务通知">
      <div className="global-task-center-heading">
        <div><strong>任务通知</strong><span>跨页面保留最近 {MAX_TASK_NOTIFICATIONS} 条</span></div>
        {taskNotifications.length ? <Button type="link" size="small" onClick={clearTaskNotifications}>清空</Button> : null}
      </div>
      {taskNotifications.length ? <div className="global-task-center-list">
        {taskNotifications.map(item => (
          <Link key={item.id} href={item.pagePath || window.location.pathname} className={`global-task-center-item ${item.status}`} onClick={() => setTaskCenterOpen(false)}>
            {item.status === 'error' ? <XCircle size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
            <span className="global-task-center-copy"><strong>{item.title}</strong>{item.detail ? <small>{item.detail}</small> : null}</span>
            <time>{formatNotificationTime(item.createdAt)}</time>
          </Link>
        ))}
      </div> : <p className="global-task-center-empty">暂时没有已完成的任务。生成结束后，无论你在哪个功能页面，结果都会显示在这里。</p>}
    </section>
  );

  const showLoginCard = !isLoggedIn && (isHome || loginDialogOpen);
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
          {canAccessAdmin(account) ? (
            <Link href="/admin/presets" reload className="legacy-sidebar-tool" title="管理后台">
              <span className="legacy-nav-icon"><ShieldCheck size={18} strokeWidth={1.8} aria-hidden="true" /></span>
              <span className="legacy-nav-label">管理后台</span>
            </Link>
          ) : null}
        </div>
        {isLoggedIn ? (
          <div className="legacy-sidebar-user">
            <button
              type="button"
              className="legacy-sidebar-avatar"
              title="打开个人中心"
              aria-label="进入个人中心"
              onClick={() => setAccountCenterOpen(true)}
            >
              <Avatar size={28} src={account?.avatarUrl} style={{ backgroundColor: displayAvatar.background }}>{displayAvatar.emoji}</Avatar>
            </button>
            <span className="legacy-sidebar-username" title={account?.displayName || username}>{account?.displayName || username}</span>
            <Button size="small" onClick={handleLogout}>退出</Button>
          </div>
        ) : null}
      </aside>
      {isLoggedIn && accountCenterOpen ? <div className="account-center-popover" role="dialog" aria-label="个人中心">
        <div className="account-center-popover-head"><strong>个人中心</strong><button type="button" onClick={() => setAccountCenterOpen(false)}>×</button></div>
        <div className="account-center-popover-profile"><Avatar size={48} src={account?.avatarUrl}>{displayAvatar.emoji}</Avatar><div><strong>{account?.displayName || username}</strong><small>@{username}</small><em>{account?.role === 'dev' ? 'DEV' : account?.role === 'manager' ? 'MANAGER' : 'MEMBER'}</em></div></div>
        <div className="account-center-popover-group"><button type="button" className="account-center-popover-parent" onClick={() => setAccountProfileOpen(value => !value)}>个人资料 <span>{accountProfileOpen ? '⌃' : '⌄'}</span></button>
          {accountProfileOpen ? <div className="account-center-popover-submenu"><Link href="/profile" onClick={() => setAccountCenterOpen(false)}>个人资料</Link><Link href="/member" onClick={() => setAccountCenterOpen(false)}>会员中心</Link><Link href="/security" onClick={() => setAccountCenterOpen(false)}>账号安全</Link>{['dev', 'manager'].includes(account?.role) ? <Link href="/advanced-team-admin" onClick={() => setAccountCenterOpen(false)}>联合治理</Link> : null}</div> : null}
        </div>
        <div className="account-center-popover-links"><Link href="/api-config" onClick={() => setAccountCenterOpen(false)}>API 配置</Link><Link href="/usage" onClick={() => setAccountCenterOpen(false)}>用量统计</Link>{['dev', 'manager'].includes(account?.role) ? <Link href="/team" onClick={() => setAccountCenterOpen(false)}>团队管理</Link> : null}</div>
        <button type="button" className="account-center-popover-logout" onClick={handleLogout}>退出登录</button>
      </div> : null}
      <Fragment key={accountSessionKey}>
        <main className="legacy-main">
          <header className="legacy-topbar">
            <span className="legacy-page-title">{pageTitle(pathname)}</span>
            <div className="legacy-userbar">
              <Popover content={taskCenterContent} trigger="click" open={taskCenterOpen} onOpenChange={setTaskCenterOpen} placement="bottomRight" overlayClassName="global-task-center-popover">
                <Button className="legacy-task-center-button" type="text" aria-label="打开任务通知" title="任务通知">
                  <Badge count={taskNotifications.length} size="small" overflowCount={9} offset={[-1, 2]}><Bell size={19} aria-hidden="true" /></Badge>
                  <span>任务</span>
                </Button>
              </Popover>
            </div>
          </header>
          <section className={`legacy-content${pathname === '/agent' ? ' legacy-content--agent' : ''}`}>{content}</section>
        </main>
        {isLoggedIn && pathname !== '/' && petVisible ? <CmPenguinCompanion username={username} accountSessionKey={accountSessionKey} /> : null}
      </Fragment>
      {loginOverlay}
      </div>
    </ConfigProvider>
  );
}
