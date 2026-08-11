import { Button, Form, Input, Select, Space, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { getConfig, saveConfig } from '../../shared/api/config';

const providers = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Claude', value: 'claude' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: '通义千问', value: 'qwen' },
  { label: '自定义', value: 'custom' }
];

export function SettingsPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getConfig()
      .then(config => {
        if (!alive) return;
        form.setFieldsValue({
          provider: config.provider || 'openai',
          baseUrl: config.baseUrl || 'https://api.openai.com/v1',
          model: config.model || 'gpt-4o-mini',
          apiKey: ''
        });
      })
      .catch(error => message.error(error.message || '读取设置失败'))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [form]);

  async function handleSave(values) {
    setSaving(true);
    try {
      await saveConfig(values);
      form.setFieldValue('apiKey', '');
      message.success('设置已保存');
    } catch (error) {
      message.error(error.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Space className="utility-page settings-page" direction="vertical" size={16} style={{ width: '100%', maxWidth: 720 }}>
      <Typography.Title level={3}>API 设置</Typography.Title>
      <Form
        form={form}
        layout="vertical"
        disabled={loading}
        initialValues={{ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }}
        onFinish={handleSave}
      >
        <Form.Item label="API 提供商" name="provider">
          <Select options={providers} />
        </Form.Item>
        <Form.Item label="Base URL" name="baseUrl" rules={[{ required: true, message: '请输入 Base URL' }]}>
          <Input placeholder="https://api.openai.com/v1" />
        </Form.Item>
        <Form.Item label="模型名称" name="model" rules={[{ required: true, message: '请输入模型名称' }]}>
          <Input placeholder="gpt-4o-mini" />
        </Form.Item>
        <Form.Item label="API Key" name="apiKey">
          <Input.Password placeholder="留空表示不修改已保存的 Key" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={saving}>保存设置</Button>
      </Form>
    </Space>
  );
}
