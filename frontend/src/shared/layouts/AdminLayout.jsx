import { Layout, Menu, Typography } from 'antd';
import { Link } from '../components/Link';

const { Sider, Content } = Layout;

export function AdminLayout({ children }) {
  return (
    <Layout className="page-shell">
      <Sider width={220}>
        <Typography.Title level={5} style={{ color: '#fff', padding: 16, margin: 0 }}>
          管理端
        </Typography.Title>
        <Menu
          theme="dark"
          mode="inline"
          selectable={false}
          items={[
            { key: '/admin', label: <Link href="/admin">仪表盘</Link> },
            { key: '/admin/prompts', label: <Link href="/admin/prompts">Prompt 策略</Link> }
          ]}
        />
      </Sider>
      <Content style={{ padding: 24 }}>{children}</Content>
    </Layout>
  );
}
