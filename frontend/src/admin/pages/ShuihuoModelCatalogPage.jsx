import { Button, Drawer, Form, Input, InputNumber, Select, Switch, Table, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { createAdminModel, listAdminModels } from '../../shared/api/shuihuoProduction';

const adapters = [
  { value: 'text_completion', label: '文本分析', kind: 'text' },
  { value: 'jimeng_image', label: '即梦生图', kind: 'image' },
  { value: 'vidu_image_to_video', label: 'Vidu 图生视频', kind: 'video' },
  { value: 'generic_http', label: '通用 HTTP（含豆包异步视频）' }
];

const kinds = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' }
];

export function ShuihuoModelCatalogPage() {
  const [models, setModels] = useState([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adapterKind, setAdapterKind] = useState('jimeng_image');
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

  function openCreate() {
    form.resetFields();
    form.setFieldsValue({ kind: 'image', adapterKind: 'jimeng_image', enabled: false, hidden: false, sortOrder: 0, parameterSchema: '{}' });
    setAdapterKind('jimeng_image');
    setOpen(true);
  }

  function changeAdapter(nextAdapterKind) {
    setAdapterKind(nextAdapterKind);
    const adapter = adapters.find(item => item.value === nextAdapterKind);
    if (adapter?.kind) form.setFieldValue('kind', adapter.kind);
  }

  async function submit() {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await createAdminModel({
        ...values,
        parameterSchema: values.parameterSchema || '{}',
        credentialRef: values.credentialRef || '',
        endpoint: values.endpoint || '',
        baseDomain: values.baseDomain || '',
        basePath: values.basePath || '',
        requestTemplate: values.requestTemplate || '',
        responseMapping: values.responseMapping || '',
        pollingTemplate: values.pollingTemplate || '',
        imageInputFormat: values.imageInputFormat || '',
        imageRequestMode: values.imageRequestMode || '',
        runtimePolicyJson: values.runtimePolicyJson || ''
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
    <Typography.Paragraph>管理员在此配置模型能力与执行协议。密钥只保存服务端凭据引用；异步视频通过通用 HTTP 的轮询模板回收生成结果。</Typography.Paragraph>
    <Button type="primary" onClick={openCreate}>新增模型</Button>
    <Table rowKey="id" style={{ marginTop: 16 }} dataSource={models} pagination={false} columns={[
      { title: '名称', dataIndex: 'name' },
      { title: 'modelId', dataIndex: 'modelId' },
      { title: '能力', dataIndex: 'kind' },
      { title: '适配器', dataIndex: 'adapterKind' },
      { title: '状态', dataIndex: 'enabled', render: value => <Tag color={value ? 'green' : 'default'}>{value ? '已启用' : '已停用'}</Tag> },
      { title: '凭据引用', dataIndex: 'credentialConfigured', render: value => <Tag color={value ? 'green' : 'gold'}>{value ? '已登记' : '未登记'}</Tag> },
      { title: '运行配置', dataIndex: 'providerConfigured', render: value => <Tag color={value ? 'green' : 'gold'}>{value ? '模型记录完整' : '待完善'}</Tag> }
    ]} />
    <Drawer title="新增模型" open={open} onClose={() => setOpen(false)} width={720} extra={<Button type="primary" loading={saving} onClick={submit}>保存</Button>}>
      <Form form={form} layout="vertical" initialValues={{ kind: 'image', adapterKind: 'jimeng_image', enabled: false, hidden: false, sortOrder: 0, parameterSchema: '{}' }}>
        <Form.Item label="名称" name="name" rules={[{ required: true, message: '请填写模型名称' }]}><Input /></Form.Item>
        <Form.Item label="modelId" name="modelId" rules={[{ required: true, message: '请填写稳定 modelId' }, { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, message: '使用小写 kebab-case，例如 doubao-video-v1' }]}><Input placeholder="例如 doubao-video-v1" /></Form.Item>
        <Form.Item label="适配器" name="adapterKind" rules={[{ required: true }]}><Select options={adapters} onChange={changeAdapter} /></Form.Item>
        <Form.Item label="能力类型" name="kind" rules={[{ required: true }]}><Select options={kinds} disabled={adapterKind !== 'generic_http'} /></Form.Item>
        <div style={{ display: 'flex', gap: 24 }}>
          <Form.Item label="启用" name="enabled" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item label="隐藏" name="hidden" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item label="排序" name="sortOrder"><InputNumber /></Form.Item>
        </div>
        <Form.Item label="公开参数 Schema" name="parameterSchema"><Input.TextArea rows={4} placeholder='例如 {"duration":{"enum":["5","10"]},"aspectRatio":{"enum":["16:9","9:16"]}}' /></Form.Item>
        <Form.Item label="凭据引用" name="credentialRef"><Input placeholder="服务端登记的凭据引用，不是 API Key 明文" /></Form.Item>

        {adapterKind === 'generic_http' ? <>
          <Typography.Title level={5}>通用 HTTP 执行协议</Typography.Title>
          <Form.Item label="Base Domain" name="baseDomain"><Input placeholder="https://provider.example.com" /></Form.Item>
          <Form.Item label="Base Path" name="basePath"><Input placeholder="/api/v1/video/tasks" /></Form.Item>
          <Form.Item label="Legacy Endpoint" name="endpoint"><Input placeholder="仅兼容旧模型；配置 Base Domain 后优先使用新地址" /></Form.Item>
          <Form.Item label="请求模板" name="requestTemplate"><Input.TextArea rows={8} placeholder='{"method":"POST","headers":{"Authorization":"Bearer {{credential}}"},"body":{"prompt":"{{prompt}}","duration":"{{duration}}","ratio":"{{aspect_ratio}}","resolution":"{{resolution}}"}}' /></Form.Item>
          <Form.Item label="提交返回映射" name="responseMapping"><Input.TextArea rows={3} placeholder='异步示例：{"providerTaskId":"data.task_id"}' /></Form.Item>
          <Form.Item label="轮询模板" name="pollingTemplate"><Input.TextArea rows={8} placeholder='{"method":"GET","endpoint":"https://provider.example.com/tasks/{{provider_task_id}}","statusPath":"status","resultUrl":"data.videos[0].url"}' /></Form.Item>
          <div style={{ display: 'flex', gap: 16 }}>
            <Form.Item label="图片输入格式" name="imageInputFormat" style={{ flex: 1 }}><Select allowClear options={[{ value: 'url', label: 'URL' }, { value: 'base64', label: 'Base64' }, { value: 'multipart', label: 'Multipart' }]} placeholder="文生视频留空" /></Form.Item>
            <Form.Item label="图片请求模式" name="imageRequestMode" style={{ flex: 1 }}><Select allowClear options={[{ value: 'json', label: 'JSON' }, { value: 'multipart', label: 'Multipart' }]} placeholder="文生视频留空" /></Form.Item>
          </div>
          <Form.Item label="运行策略 JSON" name="runtimePolicyJson"><Input.TextArea rows={3} placeholder='例如 {"pollIntervalSeconds":10,"timeoutSeconds":900}' /></Form.Item>
        </> : null}
      </Form>
    </Drawer>
  </>;
}
