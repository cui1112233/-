import { Button, Form, Input, Select, Space, Typography } from 'antd';

export function TtsPage() {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3}>文本配音</Typography.Title>
      <Form layout="vertical">
        <Form.Item label="配音文本">
          <Input.TextArea rows={8} placeholder="输入需要配音的文本" />
        </Form.Item>
        <Form.Item label="音色">
          <Select
            defaultValue="zh-CN-XiaoxiaoNeural"
            options={[{ label: '晓晓', value: 'zh-CN-XiaoxiaoNeural' }]}
          />
        </Form.Item>
        <Button type="primary">生成音频</Button>
      </Form>
    </Space>
  );
}
