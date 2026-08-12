import { Button, Drawer, Form, Input, Select, Switch, Table, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { createAdminModel, listAdminModels } from '../../shared/api/shuihuoProduction';

const adapters = [
  { value: 'text_completion', label: '文本分析', kind: 'text' },
  { value: 'jimeng_image', label: '即梦生图', kind: 'image' },
  { value: 'vidu_image_to_video', label: 'Vidu 图生视频', kind: 'video' }
];

export function ShuihuoModelCatalogPage() {
  const [models, setModels] = useState([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const refresh = async () => {
    try {
      const result = await listAdminModels();
      setModels(result.models || []);
    } catch (error) {
      message.error(error.message || '读取模型目录失败');
    }
  };

  useEffect(() => { refresh(); }, []);

  async function submit() {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await createAdminModel({
        ...values,
        parameterSchema: values.parameterSchema || '{}',
        credentialRef: values.credentialRef || ''
      });
      setOpen(false);
      form.resetFields();
      await refresh();
      message.success('模型已保存');
    } catch (error) {
      if (!error?.errorFields) message.error(error.message || '保存模型失败');
    } finally {
      setSaving(false);
    }
  }

  return <>
    <Typography.Title level={3}>水货生产模型</Typography.Title>
    <Typography.Paragraph>管理员在此配置文本分析、即梦生图和 Vidu 图生视频。只保存密钥引用，不展示密钥或提供方内部协议。</Typography.Paragraph>
    <Button type="primary" onClick={() => setOpen(true)}>新增模型</Button>
    <Table rowKey="id" style={{ marginTop: 16 }} dataSource={models} pagination={false} columns={[
      { title: '名称', dataIndex: 'name' },
      { title: '能力', dataIndex: 'kind' },
      { title: '适配器', dataIndex: 'adapterKind' },
      { title: '状态', dataIndex: 'enabled', render: value => <Tag color={value ? 'green' : 'default'}>{value ? '已启用' : '已停用'}</Tag> },
      { title: '凭据', dataIndex: 'credentialConfigured', render: value => value ? '已配置' : '未配置' },
      { title: '提供方', dataIndex: 'providerConfigured', render: value => value ? '可用' : '待配置' }
    ]} />
    <Drawer title="新增模型" open={open} onClose={() => setOpen(false)} width={560} extra={<Button type="primary" loading={saving} onClick={submit}>保存</Button>}>
      <Form form={form} layout="vertical" initialValues={{ kind: 'image', adapterKind: 'jimeng_image', enabled: false, parameterSchema: '{}' }}>
        <Form.Item label="名称" name="name" rules={[{ required: true, message: '请填写模型名称' }]}><Input /></Form.Item>
        <Form.Item label="适配器" name="adapterKind"><Select options={adapters} onChange={adapterKind => form.setFieldValue('kind', adapters.find(item => item.value === adapterKind)?.kind)} /></Form.Item>
        <Form.Item name="kind" hidden><Input /></Form.Item>
        <Form.Item label="启用" name="enabled" valuePropName="checked"><Switch /></Form.Item>
        <Form.Item label="公开参数 Schema" name="parameterSchema"><Input.TextArea rows={3} /></Form.Item>
        <Form.Item label="密钥引用" name="credentialRef"><Input.Password placeholder="例如 IMAGE_PROVIDER_TOKEN，仅写入不回显" /></Form.Item>
      </Form>
    </Drawer>
  </>;
}
