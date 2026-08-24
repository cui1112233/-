import { Avatar, Button, Checkbox, ConfigProvider, Form, Input, message, Modal } from 'antd';
import { AudioLines, BookOpen, Bot, Bug, Clapperboard, FilePenLine, FolderClock, Home, Moon, NotebookTabs, PanelLeftClose, PanelLeftOpen, Settings2, ShieldCheck, Sun } from 'lucide-react';
import { cloneElement, Fragment, isValidElement, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BrandLogo } from '../components/BrandLogo';
import { Link } from '../components/Link';
import { getCurrentAccount, getCurrentUsername, login, logout } from '../api/auth';
import { getToken } from '../api/client';
import { getConfig, saveAvatar } from '../api/config';
import { AVATAR_PRESETS, avatarDisplay } from '../avatars';
import { StackyPet } from '../pet/StackyPet';
import { dispatchPetContext } from '../pet/stacky';
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
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState(initialTheme);
  const [petVisible, setPetVisible] = useState(true);
  const [avatar, setAvatar] = useState(null);
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const [avatarPicking, setAvatarPicking] = useState(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const accountSessionGenerationRef = useRef(0);
  const loginCardRef = useRef(null);
  const pathname = window.location.pathname;
  const isLoggedIn = Boolean(username);
  const isHome = pathname === '/';
  const displayAvatar = avatarDisplay(avatar, username);
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

  async function handleLogout() {
    accountSessionGenerationRef.current += 1;
    await logout();
    setUsername('');
    setAccount(null);
    setAvatar(null);
    setAvatarPicking(null);
    setAvatarEditorOpen(false);
    setLoginDialogOpen(true);
    message.success('已退出');
  }

  async function handleSaveAvatar() {
    if (!avatarPicking) return;
    setAvatarSaving(true);
    try {
      await saveAvatar(avatarPicking);
      setAvatar(avatarPicking);
      setAvatarEditorOpen(false);
      message.success('头像已更新');
    } catch (error) {
      message.error(error.message || '保存头像失败');
    } finally {
      setAvatarSaving(false);
    }
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
  const loginOverlay = showLoginCard ? (
    <div className="legacy-login-overlay nebula-login-overlay">
      <div className="login-modal nebula-login-modal" ref={loginCardRef} onPointerMove={updateLoginCardParallax} onPointerLeave={resetLoginCardParallax}>
        <div className="nebula-login-brand"><BrandLogo /></div>
        <h1>一战晟铭登录</h1>
        <p className="nebula-login-subtitle">继续你的创作工作流</p>
        <div className="login-form-wrap nebula-login-form-wrap">
          <Form layout="vertical" initialValues={{ remember: true }} onFinish={handleLogin}>
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
            <Suspense fallback={<BrandLogo className="legacy-brand-logo" />}>
              <SuperOpcLiquidMetalLogo theme={theme} scale={1} className="legacy-brand-logo" />
            </Suspense>
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
        {isLoggedIn ? (
          <div className="legacy-sidebar-user">
            <button
              type="button"
              className="legacy-sidebar-avatar"
              onClick={() => { setAvatarPicking(avatar); setAvatarEditorOpen(true); }}
              title="点击更换头像"
              aria-label="更换头像"
            >
              <Avatar size={28} style={{ backgroundColor: displayAvatar.background }}>{displayAvatar.emoji}</Avatar>
            </button>
            <span className="legacy-sidebar-username" title={username}>{username}</span>
            <Button size="small" onClick={handleLogout}>退出</Button>
          </div>
        ) : null}
      </aside>
      <Fragment key={accountSessionKey}>
        <main className="legacy-main">
          <section className={`legacy-content${pathname === '/agent' ? ' legacy-content--agent' : ''}`}>{content}</section>
        </main>
        {isLoggedIn && pathname !== '/' && petVisible ? <StackyPet username={username} accountSessionKey={accountSessionKey} /> : null}
      </Fragment>
      {loginOverlay}
      <Modal title="更换头像" open={avatarEditorOpen} onCancel={() => setAvatarEditorOpen(false)} footer={null} width={440}>
        <div className="avatar-picker-grid" role="listbox" aria-label="选择头像">
          {AVATAR_PRESETS.map(preset => {
            const selected = avatarPicking?.emoji === preset.emoji && avatarPicking?.background === preset.background;
            return (
              <button
                key={preset.emoji}
                type="button"
                className={`avatar-option${selected ? ' selected' : ''}`}
                aria-pressed={selected}
                onClick={() => setAvatarPicking(preset)}
              >
                <Avatar size={40} style={{ backgroundColor: preset.background }}>{preset.emoji}</Avatar>
                <span className="avatar-option-label">{preset.label}</span>
              </button>
            );
          })}
        </div>
        <div className="avatar-picker-footer">
          <Button onClick={() => setAvatarEditorOpen(false)}>取消</Button>
          <Button type="primary" loading={avatarSaving} disabled={!avatarPicking} onClick={handleSaveAvatar}>保存头像</Button>
        </div>
      </Modal>
      </div>
    </ConfigProvider>
  );
}
