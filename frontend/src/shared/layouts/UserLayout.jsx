import { Button, Form, Input, message } from 'antd';
import { useState } from 'react';
import { Link } from '../components/Link';
import { getCurrentUsername, login, logout } from '../api/auth';

const navItems = [
  { href: '/', icon: '🏠', label: '首页' },
  { href: '/script', icon: '📝', label: '剧本生成' },
  { href: '/history', icon: '🗂', label: '历史' },
  { href: '/tts', icon: '🎙', label: '配音' },
  { href: '/settings', icon: '⚙', label: '设置' }
];

function pageTitle(pathname) {
  const item = navItems.find(nav => nav.href === pathname);
  return item ? item.label : '一战晟铭';
}

export function UserLayout({ children }) {
  const [username, setUsername] = useState(getCurrentUsername());
  const [loading, setLoading] = useState(false);
  const pathname = window.location.pathname;

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

  return (
    <div className="legacy-shell">
      <aside className="legacy-sidebar">
        <div className="legacy-brand">
          <span className="legacy-nav-icon">☰</span>
          <span>一战晟铭</span>
        </div>
        <nav className="legacy-nav">
          {navItems.map(item => (
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
            {username ? (
              <>
                <span className="legacy-muted">{username}</span>
                <Button size="small" onClick={handleLogout}>退出</Button>
              </>
            ) : (
              <Form className="legacy-login-form" onFinish={handleLogin}>
                <Form.Item name="username" rules={[{ required: true, message: '请输入账号' }]} style={{ margin: 0 }}>
                  <Input size="small" placeholder="账号" style={{ width: 130 }} />
                </Form.Item>
                <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]} style={{ margin: 0 }}>
                  <Input.Password size="small" placeholder="密码" style={{ width: 130 }} />
                </Form.Item>
                <Button size="small" type="primary" htmlType="submit" loading={loading}>登录</Button>
              </Form>
            )}
          </div>
        </header>
        <section className="legacy-content">{children}</section>
      </main>
    </div>
  );
}
