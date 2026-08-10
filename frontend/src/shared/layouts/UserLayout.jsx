import { Button, Form, Input, Layout, Menu, Space, Typography, message } from 'antd';
import { useState } from 'react';
import { Link } from '../components/Link';
import { getCurrentUsername, login, logout } from '../api/auth';

const { Header, Content } = Layout;

export function UserLayout({ children }) {
  const [username, setUsername] = useState(getCurrentUsername());
  const [loading, setLoading] = useState(false);

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
    <Layout className="page-shell">
      <Header style={{ display: 'flex', alignItems: 'center' }}>
        <Typography.Text style={{ color: '#fff', marginRight: 24, whiteSpace: 'nowrap' }}>
          一战晟铭
        </Typography.Text>
        <Menu
          theme="dark"
          mode="horizontal"
          selectable={false}
          style={{ flex: 1 }}
          items={[
            { key: '/', label: <Link href="/">首页</Link> },
            { key: '/script', label: <Link href="/script">剧本生成</Link> },
            { key: '/history', label: <Link href="/history">历史</Link> },
            { key: '/tts', label: <Link href="/tts">配音</Link> },
            { key: '/settings', label: <Link href="/settings">设置</Link> }
          ]}
        />
        {username ? (
          <Space>
            <Typography.Text style={{ color: '#fff' }}>{username}</Typography.Text>
            <Button size="small" onClick={handleLogout}>退出</Button>
          </Space>
        ) : (
          <Form layout="inline" onFinish={handleLogin} style={{ flexShrink: 0 }}>
            <Form.Item name="username" rules={[{ required: true, message: '请输入账号' }]}>
              <Input size="small" placeholder="账号" style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password size="small" placeholder="密码" style={{ width: 130 }} />
            </Form.Item>
            <Button size="small" type="primary" htmlType="submit" loading={loading}>登录</Button>
          </Form>
        )}
      </Header>
      <Content style={{ padding: 24 }}>{children}</Content>
    </Layout>
  );
}
