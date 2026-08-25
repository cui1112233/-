import { Alert, Button, Drawer, Form, Input, InputNumber, Select, Switch, Table, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { createAdminModel, listAdminModels } from '../../shared/api/shuihuoProduction';

const adapters = [
  { value: 'text_completion', label: '文本分析', kind: 'text' },
  { value: 'jimeng_image', label: '即梦生图', kind: 'image' },
  { value: 'vidu_image_to_video', label: 'Vidu 图生视频', kind: 'video' },
  { value: 'generic_http', label: '通用 HTTP 视频（Seedance 等）', kind: 'video' }
];

const genericRequestExample = JSON.stringify({
  method: 'POST',
  headers: { Authorization: 'Bearer {{credential}}' },
  body: {
    prompt: '{{prompt}}',
    duration: '{{duration}}',
    aspect_ratio: '{{aspect_ratio}}'
  }
}, null, 2);

const genericResponseExample = JSON.stringify({ providerTaskId: 'data.task_id' }, null, 2);
const genericPollingExample = JSON.stringify({
  method: 'GET',
  url: 'https://provider.example/tasks/{{provider_task_id}}',
  headers: { Authorization: 'Bearer {{credential}}' },
  statusPath: 'data.status',
  resultUrlPath: 'data.url',
  messagePath: 'data.message',
  running: ['queued', 'running'],
  succeeded: ['succeeded', 'completed'],
  failed: ['failed', 'cancelled']
}, null, 2);

export function ShuihuoModelCatalogPage() {
  const [models, setModels] = useState([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const adapterKind = Form.useWatch('adapterKind', form);
  const isGenericHTTP = adapterKind === 'generic_http';

  const refresh = async () => {
    try {
      const result = await listAdminModels();
      setModels(result.models || []);
    } catch (error) {
      message.error(error.message || '读取模型目录失败');
    }
  };

  useEffect(() => { refresh(); }, []);

  function openCreate() {
    form.setFieldsValue({
      name: '',
      modelId: '',
      kind: 'image',
      adapterKind: 'jimeng_image',
      enabled: false,
      hidden: false,
      sortOrder: 0,
      adminNote: '',
      parameterSchema: '{}',
      credentialRef: '',
      endpoint: '',
      requestTemplate: '',
      responseMapping: '',
      pollingTemplate: '',
      imageInputFormat: 'url',
      imageRequestMode: 'json',
      runtimePolicyJson: '{}'
    });
    setOpen(true);
  }

  async function submit() {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await createAdminModel({
        ...values,
        parameterSchema: values.parameterSchema || '{}',
        credentialRef: values.credentialRef || '',
        runtimePolicyJson: values.runtimePolicyJson || '{}'
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

  function handleAdapterChange(nextAdapter) {
    const definition = adapters.find(item => item.value === nextAdapter);
    form.setFieldValue('kind', definition?.kind || 'video');
    if (nextAdapter === 'generic_http') {
      if (!form.getFieldValue('requestTemplate')) form.setFieldValue('requestTemplate', genericRequestExample);
      if (!form.getFieldValue('responseMapping')) form.setFieldValue('responseMapping', genericResponseExample);
      if (!form.getFieldValue('pollingTemplate')) form.setFieldValue('pollingTemplate', genericPollingExample);
    }
  }

  return <>
    <Typography.Title level={3}>水货生产模型</Typography.Title>
    <Typography.Paragraph>
      管理文本、图片与视频模型。批量工厂会直接读取这里已启用的文生视频模型；通用 HTTP 模型可以配置 Seedance 等服务端接口，密钥只保存引用，不向普通用户返回。
    </Typography.Paragraph>
    <Button type="primary" onClick={openCreate}>新增模型</Button>
    <Table rowKey="id" style={{ marginTop: 16 }} dataSource={models} pagination={false} columns={[
      { title: '名称', dataIndex: 'name' },
      { title: '模型标识', dataIndex: 'modelId', ellipsis: true },
      { title: '能力', dataIndex: 'kind', width: 90 },
      { title: '适配器', dataIndex: 'adapterKind', width: 160 },
      {
        title: '视频输入', width: 110,
        render: (_, model) => model.kind === 'video'
          ? <Tag color={model.requiresImageInput ? 'gold' : 'blue'}>{model.requiresImageInput ? '图生视频' : '文生视频'}</Tag>
          : <Typography.Text type="secondary">—</Typography.Text>
      },
      { title: '状态', dataIndex: 'enabled', width: 90, render: value => <Tag color={value ? 'green' : 'default'}>{value ? '已启用' : '已停用'}</Tag> },
      { title: '凭据引用', dataIndex: 'credentialConfigured', width: 100, render: value => <Tag color={value ? 'green' : 'gold'}>{value ? '已登记' : '未登记'}</Tag> },
      { title: '运行配置', dataIndex: 'providerConfigured', width: 110, render: value => <Tag color={value ? 'green' : 'gold'}>{value ? '模型记录完整' : '待完善'}</Tag> }
    ]} />

    <Drawer title="新增模型" open={open} onClose={() => setOpen(false)} width={760} extra={<Button type="primary" loading={saving} onClick={submit}>保存</Button>}>
      <Form form={form} layout="vertical" initialValues={{ kind: 'image', adapterKind: 'jimeng_image', enabled: false, hidden: false, sortOrder: 0, parameterSchema: '{}', runtimePolicyJson: '{}' }}>
        <Form.Item label="名称" name="name" rules={[{ required: true, message: '请填写模型名称' }]}><Input placeholder="例如 Seedance 1.5 Pro" /></Form.Item>
        <Form.Item label="模型标识" name="modelId" rules={[{ pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, message: '仅支持小写 kebab-case，例如 seedance-1-5-pro' }]}>
          <Input placeholder="建议填写稳定标识，例如 seedance-1-5-pro" />
        </Form.Item>
        <Form.Item label="适配器" name="adapterKind" rules={[{ required: true }]}>
          <Select options={adapters} onChange={handleAdapterChange} />
        </Form.Item>
        <Form.Item name="kind" hidden><Input /></Form.Item>
        <Form.Item label="启用" name="enabled" valuePropName="checked"><Switch /></Form.Item>
        <Form.Item label="隐藏于普通用户模型列表" name="hidden" valuePropName="checked"><Switch /></Form.Item>
        <Form.Item label="排序" name="sortOrder"><InputNumber style={{ width: 180 }} /></Form.Item>
        <Form.Item label="管理员备注" name="adminNote"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item label="公开参数 Schema" name="parameterSchema"><Input.TextArea rows={3} spellCheck={false} /></Form.Item>

        {isGenericHTTP ? <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="文生 / 图生由请求模板自动识别"
            description={'请求模板包含 {{image_url}} 时视为图生视频；不包含时视为文生视频，可直接被批量工厂选择。duration 与 aspect_ratio 来自每个 VIDEO 的实际编译结果。'}
          />
          <Form.Item label="API Endpoint" name="endpoint" rules={[{ required: true, message: '通用 HTTP 模型必须配置 Endpoint' }]}>
            <Input placeholder="https://provider.example/v1/videos" />
          </Form.Item>
          <Form.Item label="密钥引用" name="credentialRef" rules={[{ required: true, message: '请填写服务器环境中的密钥引用名' }]}>
            <Input.Password placeholder="例如 SEEDANCE_API_KEY；这里只写引用名，不写实际密钥" />
          </Form.Item>
          <Form.Item label="请求模板" name="requestTemplate" rules={[{ required: true, message: '请输入请求模板 JSON' }]}>
            <Input.TextArea rows={12} spellCheck={false} />
          </Form.Item>
          <Form.Item label="提交响应映射" name="responseMapping" rules={[{ required: true, message: '请输入响应映射 JSON' }]} extra="异步接口填写 providerTaskId 路径；若接口直接返回成品 URL，也可以填写 resultUrl。">
            <Input.TextArea rows={4} spellCheck={false} />
          </Form.Item>
          <Form.Item label="轮询模板" name="pollingTemplate" extra="只有提交响应返回 providerTaskId 时需要。支持 {{provider_task_id}} 和 {{credential}}。">
            <Input.TextArea rows={12} spellCheck={false} />
          </Form.Item>
          <Form.Item label="运行策略 JSON" name="runtimePolicyJson"><Input.TextArea rows={3} spellCheck={false} /></Form.Item>
          <Form.Item name="imageInputFormat" hidden><Input /></Form.Item>
          <Form.Item name="imageRequestMode" hidden><Input /></Form.Item>
        </> : <Form.Item label="密钥引用" name="credentialRef"><Input.Password placeholder="需要时填写服务器密钥引用名" /></Form.Item>}
      </Form>
    </Drawer>
  </>;
}
