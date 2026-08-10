import { Button, Form, Input, Select, Segmented, Space, Typography } from 'antd';

export function ScriptPage() {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3}>剧本生成</Typography.Title>
      <Form layout="vertical">
        <Form.Item label="小说原文">
          <Input.TextArea rows={10} placeholder="粘贴小说原文" />
        </Form.Item>
        <Space wrap>
          <Segmented
            options={[
              { label: '连续开头', value: 'continuous' },
              { label: '爆款开头', value: 'hook' }
            ]}
            defaultValue="continuous"
          />
          <Select
            defaultValue="storyboard"
            style={{ width: 140 }}
            options={[
              { label: '画布模式', value: 'storyboard' },
              { label: '剧本模式', value: 'shortdrama' },
              { label: '剧情模式', value: 'screenplay' }
            ]}
          />
          <Segmented options={['10s', '15s']} defaultValue="10s" />
          <Button type="primary">一键生成</Button>
        </Space>
      </Form>
    </Space>
  );
}
