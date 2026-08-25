import { Avatar, Button, Checkbox, ConfigProvider, Form, Input, message, Modal } from 'antd';
import { AudioLines, BarChart3, Bot, Bug, Check, Clapperboard, FilePenLine, Fingerprint, FolderClock, Gem, Home, KeyRound, Moon, NotebookTabs, PanelLeftClose, PanelLeftOpen, Settings2, ShieldCheck, Sun, UserRound, UsersRound } from 'lucide-react';
import { cloneElement, Fragment, isValidElement, useEffect, useRef, useState } from 'react';
import { BrandLogo } from '../components/BrandLogo';
import { Link } from '../components/Link';
import { getCurrentAccount, getCurrentUsername, login, loginWithPasskey, logout } from '../api/auth';
import { getToken } from '../api/client';
import { StackyPet } from '../pet/StackyPet';
import { dispatchPetContext } from '../pet/stacky';
import { createAntTheme } from '../styles/theme';

const workspaceNavItems = [
  { href: '/', icon: Home, label: '首页' },
  { href: '/script', icon: FilePenLine, label: '剧本生成' },
  { href: '/novel-panel', icon: NotebookTabs, label: '小说面板' },
  { href: '/shuihuo-production', icon: Clapperboard, label: '水货生产' },
  { href: '/agent', icon: Bot, label: 'Agent 工作区' },
  { href: '/history', icon: FolderClock, label: '历史' },
  { href: '/issues', icon: Bug, label: '问题日志' },
  { href: '/tts', icon: AudioLines, label: '配音' }
];

const accountNavItems = [
  { href: '/member', icon: Gem, label: '会员中心' },
  { href: '/team', icon: UsersRound, label: '团队管理', roles: ['dev', 'manager'] },
  { href: '/advanced-team-admin', icon: ShieldCheck, label: '联合治理', roles: ['dev', 'manager'] },
  { href: '/api-config', icon: KeyRound, label: 'API 配置' },
  { href: '/usage', icon: BarChart3, label: '用量统计' },
  { href: '/profile', icon: UserRound, label: '个人资料' },
  { href: '/security', icon: ShieldCheck, label: '账号安全' }
];

const ACCOUNT_CENTER_PATHS = new Set(accountNavItems.map(item => item.href));
const THEME_STORAGE_KEY = 'yizhan-theme';
const LOGIN_SUCCESS_ANIMATION_MS = 760;

function initialTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

function pageTitle(pathname) {
  const accountItem = accountNavItems.find(nav => nav.href === pathname);
  if (accountItem) return accountItem.label;
  const item = workspaceNavItems.find(nav => nav.href === pathname);
  if (item) return item.label;
  if (pathname === '/settings') return '工作台设置';
  return '一战晟铭';
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

function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function roleLabel(role) {
  if (role === 'dev') return 'DEV';
  if (role === 'manager') return 'MANAGER';
  return 'MEMBER';
}

function avatarFallback(account, username) {
  return String(account?.displayName || username || '?').trim().slice(0, 1).toUpperCase();
}

export function UserLayout({ children }) {
  const [username, setUsername] = useState(getCurrentUsername());
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [loginExpanded, setLoginExpanded] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginSucceeded, setLoginSucceeded] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState(initialTheme);
  const [loginForm] = Form.useForm();
  const accountSessionGenerationRef = useRef(0);
  const loginModalRef = useRef(null);
  const pathname = window.location.pathname;
  const isLoggedIn = Boolean(username);
  const isHome = pathname === '/';
  const isAccountCenter = ACCOUNT_CENTER_PATHS.has(pathname);
  const currentRole = account?.role || (account?.isOwner ? 'dev' : 'member');
  const currentNavItems = isAccountCenter
    ? accountNavItems.filter(item => !item.roles || item.roles.includes(currentRole))
    : workspaceNavItems;
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
    dispatchPetContext({ page: pageTitle(pathname), pagePath: pathname, workspace: 'qiantie' });
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
      if (expiredToken) {
        if (!currentToken || expiredToken !== currentToken) return;
      } else if (!sessionToken || currentToken || cancelled || accountSessionGenerationRef.current !== sessionGeneration) {
        return;
      }
      accountSessionGenerationRef.current += 1;
      clearSession();
      setLoginSucceeded(false);
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
    if (!isLoggedIn) return undefined;
    let alive = true;
    async function refreshProfile() {
      try {
        const current = await getCurrentAccount();
        if (!alive) return;
        setUsername(current.username);
        setAccount(current);
      } catch {
        // The normal auth-expired flow owns session failures.
      }
    }
    window.addEventListener('qiantie:profile-updated', refreshProfile);
    return () => {
      alive = false;
      window.removeEventListener('qiantie:profile-updated', refreshProfile);
    };
  }, [isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn || pathname === '/') return;
    window.history.replaceState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [isLoggedIn, pathname]);

  function resetLoginParallax() {
    const modal = loginModalRef.current;
    if (!modal) return;
    modal.style.setProperty('--login-rx', '0deg');
    modal.style.setProperty('--login-ry', '0deg');
    modal.style.setProperty('--login-mx', '50%');
    modal.style.setProperty('--login-my', '50%');
  }

  function handleLoginPointerMove(event) {
    if (loginSucceeded || event.pointerType === 'touch') return;
    const modal = loginModalRef.current;
    if (!modal) return;
    const rect = modal.getBoundingClientRect();
    const x = Math.min(1, Math.max(-1, ((event.clientX - rect.left) / rect.width - 0.5) * 2));
    const y = Math.min(1, Math.max(-1, ((event.clientY - rect.top) / rect.height - 0.5) * 2));
    modal.style.setProperty('--login-rx', `${(-y * 2.6).toFixed(2)}deg`);
    modal.style.setProperty('--login-ry', `${(x * 3.4).toFixed(2)}deg`);
    modal.style.setProperty('--login-mx', `${((x + 1) * 50).toFixed(1)}%`);
    modal.style.setProperty('--login-my', `${((y + 1) * 50).toFixed(1)}%`);
  }

  async function completeLogin(data, successMessage = '登录成功') {
    setUsername(data.username);
    setAccount(data);
    setLoginSucceeded(true);
    resetLoginParallax();
    message.success(successMessage);
    await wait(LOGIN_SUCCESS_ANIMATION_MS);
    setLoginDialogOpen(false);
    setLoginSucceeded(false);
  }

  async function handleLogin(values) {
    accountSessionGenerationRef.current += 1;
    setLoginSucceeded(false);
    setLoading(true);
    try {
      const data = await login(values.username, values.password, values.remember, values.mfaCode || '');
      await completeLogin(data, data.mfaRecoveryUsed ? '登录成功，已使用一个恢复码' : '登录成功');
    } catch (error) {
      setLoginSucceeded(false);
      if (error.status === 428) message.warning('此账号已开启 MFA，请填写动态验证码或恢复码');
      else message.error(error.message || '登录失败');
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskeyLogin() {
    const values = loginForm.getFieldsValue(['username', 'remember']);
    if (!values.username) {
      message.warning('请先输入账号，再使用 Passkey 登录');
      return;
    }
    accountSessionGenerationRef.current += 1;
    setPasskeyLoading(true);
    try {
      const data = await loginWithPasskey(values.username, values.remember !== false);
      await completeLogin(data, 'Passkey 登录成功');
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
    setLoginSucceeded(false);
    setLoginExpanded(true);
    setLoginDialogOpen(true);
    message.success('已退出');
  }

  function openLoginDialog() {
    setLoginSucceeded(false);
    setLoginExpanded(true);
    setLoginDialogOpen(true);
  }

  function toggleSidebar() {
    setSidebarCollapsed(collapsed => !collapsed);
  }

  function toggleTheme() {
    setTheme(current => current === 'dark' ? 'light' : 'dark');
  }

  const showLoginOverlay = loginDialogOpen && (!isLoggedIn || loginSucceeded);
  const loginOverlay = showLoginOverlay ? (
    <div className={`legacy-login-overlay${loginSucceeded ? ' is-success' : ''}`}>
      <div
        ref={loginModalRef}
        className={`login-modal${loginExpanded ? ' is-expanded' : ''}${loginSucceeded ? ' is-success' : ''}`}
        onPointerMove={handleLoginPointerMove}
        onPointerLeave={resetLoginParallax}
      >
        <div className="login-concrete-texture" aria-hidden="true" />
        <div className="login-background-logo login-background-logo--one" aria-hidden="true"><BrandLogo /></div>
        <div className="login-background-logo login-background-logo--two" aria-hidden="true"><BrandLogo /></div>
        <div className="login-background-logo login-background-logo--three" aria-hidden="true"><BrandLogo /></div>
        <button className="login-title" type="button" aria-expanded={loginExpanded} onClick={() => setLoginExpanded(value => !value)}>
          一战晟铭登录
        </button>
        <div className="login-form-wrap">
          <Form form={loginForm} layout="vertical" initialValues={{ remember: true }} onFinish={handleLogin}>
            <Form.Item label="账号" name="username" rules={[{ required: true, message: '请输入账号' }]}>
              <Input placeholder="请输入账号" autoComplete="username" />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>
            <Form.Item label="MFA 动态码 / 恢复码" name="mfaCode">
              <Input placeholder="未开启 MFA 可留空" inputMode="numeric" autoComplete="one-time-code" />
            </Form.Item>
            <Form.Item name="remember" valuePropName="checked">
              <Checkbox>30 天保持登录</Checkbox>
            </Form.Item>
            <Button block type="primary" htmlType="submit" loading={loading}>登 录</Button>
            <Button block icon={<Fingerprint size={17} />} loading={passkeyLoading} onClick={handlePasskeyLogin}>使用 Passkey 登录</Button>
          </Form>
          <div className="login-recovery-links"><a href="/recover">忘记密码？</a><span>Passkey 登录只需要先填写账号</span></div>
        </div>
        <div className="login-success-state" aria-hidden={!loginSucceeded}>
          <span className="login-success-icon"><Check size={38} strokeWidth={2.2} /></span>
          <strong>登录成功</strong>
          <span>正在进入工作台</span>
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
      <div className={`legacy-shell${isAccountCenter ? ' account-center-shell' : ''}`}>
      <aside className={`legacy-sidebar${sidebarCollapsed ? ' collapsed' : ''}${isAccountCenter ? ' account-center-sidebar' : ''}`}>
        <div className="legacy-brand">
          <button className="legacy-sidebar-toggle" type="button" aria-label={sidebarCollapsed ? '展开导航' : '收起导航'} aria-expanded={!sidebarCollapsed} onClick={toggleSidebar}>
            {sidebarCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
          <Link href="/" className="legacy-brand-link">
            <BrandLogo className="legacy-brand-logo" />
            <span className="legacy-brand-title">一战晟铭</span>
          </Link>
        </div>
        <nav className="legacy-nav">
          {currentNavItems.map(item => {
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
          {isAccountCenter ? <Link href="/" className="legacy-sidebar-tool" title="返回工作台">
            <span className="legacy-nav-icon"><Home size={18} strokeWidth={1.8} aria-hidden="true" /></span>
            <span className="legacy-nav-label">返回工作台</span>
          </Link> : null}
          <button className="legacy-sidebar-tool legacy-theme-toggle" type="button" aria-label={theme === 'dark' ? '切换至浅色主题' : '切换至深色主题'} title={theme === 'dark' ? '切换至浅色主题' : '切换至深色主题'} onClick={toggleTheme}>
            <span className="legacy-nav-icon">{theme === 'dark' ? <Sun size={18} strokeWidth={1.8} aria-hidden="true" /> : <Moon size={18} strokeWidth={1.8} aria-hidden="true" />}</span>
            <span className="legacy-nav-label">主题</span>
          </button>
          {!isAccountCenter ? <Link href="/settings" className="legacy-sidebar-tool" title="设置">
            <span className="legacy-nav-icon"><Settings2 size={18} strokeWidth={1.8} aria-hidden="true" /></span>
            <span className="legacy-nav-label">设置</span>
          </Link> : null}
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
                  <Link href="/member" className="legacy-profile-link" title="会员中心">
                    <Avatar size={28} src={account?.avatarUrl}>{avatarFallback(account, username)}</Avatar>
                    <span className="legacy-profile-name">{account?.displayName || username}</span>
                    <span className={`member-role-badge role-${currentRole} compact`}>{roleLabel(currentRole)}</span>
                  </Link>
                  <Button size="small" onClick={handleLogout}>退出</Button>
                </>
              ) : null}
            </div>
          </header>
          <section className="legacy-content">{content}</section>
        </main>
        {!isAccountCenter ? <StackyPet username={username} accountSessionKey={accountSessionKey} /> : null}
      </Fragment>
      {loginOverlay}
      </div>
    </ConfigProvider>
  );
}
