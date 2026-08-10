import { Layout, Menu, Typography } from 'antd';
import { Link } from '../components/Link';

const { Header, Content } = Layout;

export function UserLayout({ children }) {
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
            { key: '/tts', label: <Link href="/tts">配音</Link> }
          ]}
        />
      </Header>
      <Content style={{ padding: 24 }}>{children}</Content>
    </Layout>
  );
}
