import { Button, Space, Typography } from 'antd';

export function HomePage() {
  return (
    <Space direction="vertical" size={16}>
      <Typography.Title level={2}>一战晟铭</Typography.Title>
      <Typography.Text>小说转可视化剧本工作台</Typography.Text>
      <Space>
        <Button type="primary" href="/script">开始生成</Button>
        <Button href="/tts">文本配音</Button>
      </Space>
    </Space>
  );
}
