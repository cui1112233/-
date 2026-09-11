import { Button, Form, Input, InputNumber, Modal, Select, Skeleton, Space, Switch, Table, Tag, message } from 'antd';
import { KeyRound, Plus, ShieldCheck, Trash2, Video } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { canManageModelCatalog, getConfig } from '../../shared/api/config';
import { createCustomModelId, createManagedModel, deleteManagedModel, listManagedModels, refreshLocalDoubaoPairingStatus, updateManagedModel } from '../../shared/api/modelCatalog';
import { getMemberCenter } from '../../shared/api/member';
import { PageHeader, Panel, RoleBadge } from './accountCenterShared';

const MODEL_KINDS = [
  { key: 'text', title: '文本模型', eyebrow: 'TEXT MODELS' },
  { key: 'video', title: '视频模型', eyebrow: 'VIDEO MODELS' },
  { key: 'image', title: '图片模型', eyebrow: 'IMAGE MODELS' }
];

const PLATFORM_PRESETS = [
  { id: 'yd2-mini-video', displayName: 'YD2.0 Mini（图生）', description: '平台已维护视频适配器；只需填写 API Key。', credentialMode: 'apiKey' },
  { id: 'minimax-h3-video', displayName: 'MiniMax H3 多图生视频', description: '支持剧本分镜参考图；只需填写 API Key。', credentialMode: 'apiKey' },
  { id: 'local-doubao-executor-video', displayName: '本地豆包执行器', description: '无需 API Key，完成本地执行器配对后才能启用。', credentialMode: 'executorPairing' }
];

function customModels(models, kind) {
  return models.filter(model => model.kind === kind && !PLATFORM_PRESETS.some(preset => preset.id === model.id));
}

function CatalogTable({ models, onEdit, onDelete, onToggle }) {
  return <Table size="small" rowKey="id" pagination={false} dataSource={models} locale={{ emptyText: '尚未添加可用模型' }} columns={[
    { title: '模型', dataIndex: 'displayName', render: (name, model) => <Space direction="vertical" size={0}><b>{name}</b><span className="ac-muted-copy">{model.modelId || model.adapterKind || '平台预设模型'}</span></Space> },
    { title: '服务商', dataIndex: 'providerType', render: value => value === 'platform_preset' ? '平台预设' : '自定义' },
    { title: '状态', render: (_, model) => <Switch checked={model.enabled} onChange={checked => onToggle(model, checked)} /> },
    { title: '操作', render: (_, model) => <Space><Button type="link" onClick={() => onEdit(model)}>编辑</Button><Button danger type="link" icon={<Trash2 size={14} />} onClick={() => onDelete(model)}>删除</Button></Space> }
  ]} />;
}

export default function ApiConfigPage() {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(null);
  const [center, setCenter] = useState(null);
  const [models, setModels] = useState([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [customForm] = Form.useForm();
  const [presetKeys, setPresetKeys] = useState({});
  const canManageApi = canManageModelCatalog(config);
  const member = center?.member;

  const refreshModels = useCallback(async () => {
    if (!canManageApi) return;
    const nextModels = await listManagedModels();
    const doubao = nextModels.find(model => model.id === 'local-doubao-executor-video');
    if (doubao) {
      const pairing = await refreshLocalDoubaoPairingStatus();
      doubao.executorPaired = pairing.executorPaired === true;
    }
    setModels(nextModels);
  }, [canManageApi]);

  useEffect(() => {
    let alive = true;
    Promise.all([getConfig(), getMemberCenter()]).then(async ([nextConfig, nextCenter]) => {
      if (!alive) return;
      setConfig(nextConfig);
      setCenter(nextCenter);
      if (canManageModelCatalog(nextConfig)) {
        const nextModels = await listManagedModels();
        const doubao = nextModels.find(model => model.id === 'local-doubao-executor-video');
        if (doubao) {
          const pairing = await refreshLocalDoubaoPairingStatus();
          doubao.executorPaired = pairing.executorPaired === true;
        }
        setModels(nextModels);
      }
    }).catch(error => message.error(error.message || 'API 配置加载失败'))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const modelById = useMemo(() => new Map(models.map(model => [model.id, model])), [models]);

  function openCreate() {
    setEditing(null);
    customForm.setFieldsValue({
      kind: 'text',
      providerType: 'openai_compatible',
      enabled: true,
      displayName: '',
      baseUrl: '',
      modelId: '',
      credential: '',
      capabilities: { supportsReferenceImages: false, requiresImageInput: false, maxVideoDuration: undefined }
    });
    setCustomOpen(true);
  }

  function openEdit(model) {
    setEditing(model);
    customForm.setFieldsValue({ ...model, credential: '' });
    setCustomOpen(true);
  }

  async function submitCustom() {
    try {
      const values = await customForm.validateFields();
      const payload = {
        ...values,
        ...(editing ? {} : { id: createCustomModelId(values, models.map(model => model.id)) }),
        capabilities: {
          supportsReferenceImages: values.capabilities?.supportsReferenceImages === true,
          requiresImageInput: values.capabilities?.requiresImageInput === true,
          ...(Number.isInteger(values.capabilities?.maxVideoDuration) ? { maxVideoDuration: values.capabilities.maxVideoDuration } : {})
        }
      };
      if (!payload.credential) delete payload.credential;
      if (payload.enabled && (!payload.baseUrl || !payload.modelId || !payload.credential && !editing?.hasCredential)) {
        customForm.setFields([{ name: 'credential', errors: ['启用模型前必须填写 API Key'] }]);
        return;
      }
      setSaving(true);
      if (editing) await updateManagedModel(editing.id, payload);
      else await createManagedModel(payload);
      message.success(editing ? '模型已更新' : '模型已添加');
      setCustomOpen(false);
      await refreshModels();
    } catch (error) {
      if (!error?.errorFields) message.error(error.message || '模型保存失败');
    } finally { setSaving(false); }
  }

  async function deleteModel(model) {
    try { await deleteManagedModel(model.id); message.success('模型已删除'); await refreshModels(); }
    catch (error) { message.error(error.message || '模型删除失败'); }
  }

  async function toggleModel(model, enabled) {
    try { await updateManagedModel(model.id, { enabled }); message.success(enabled ? '模型已启用' : '模型已停用'); await refreshModels(); }
    catch (error) { message.error(error.message || '模型状态更新失败'); }
  }

  function isPresetReady(preset, model) {
    if (preset.credentialMode === 'executorPairing') return model?.executorPaired === true;
    return model?.hasCredential === true || Boolean(String(presetKeys[preset.id] || '').trim());
  }

  async function savePreset(preset, enabled) {
    const existing = modelById.get(preset.id);
    const key = String(presetKeys[preset.id] || '').trim();
    if (preset.credentialMode === 'apiKey' && enabled && !existing?.hasCredential && !key) return message.warning('请先填写 API Key，再启用该模型');
    if (preset.credentialMode === 'executorPairing' && enabled && !existing?.executorPaired) return message.warning('请先完成本地豆包执行器配对');
    const payload = { id: preset.id, kind: 'video', displayName: preset.displayName, enabled };
    if (key) payload.credential = key;
    try {
      if (existing) await updateManagedModel(preset.id, payload);
      else await createManagedModel(payload);
      setPresetKeys(current => ({ ...current, [preset.id]: '' }));
      message.success(enabled ? `${preset.displayName} 已启用` : `${preset.displayName} 已保存为停用`);
      await refreshModels();
    } catch (error) { message.error(error.message || '预设模型保存失败'); }
  }

  if (loading) return <div className="account-center-page"><Skeleton active paragraph={{ rows: 9 }} /></div>;

  return <div className="account-center-page api-config-page">
    <PageHeader title="API 配置" subtitle="模型只在此处配置一次；业务页面按文本、视频、图片类型读取已启用模型。" />
    {!canManageApi ? <div className="ac-managed-api-card">
      <span><ShieldCheck size={28} /></span>
      <div><div><h2>模型服务由团队托管</h2>{member ? <RoleBadge role={member.role} /> : null}</div><p>你可在获授权的业务下拉框中选择管理员已启用的模型；不会显示 API Key。</p></div>
      <Tag color={config?.managedBy ? 'green' : 'gold'}>{config?.managedBy ? `托管账号 @${config.managedBy}` : '等待绑定 MANAGER'}</Tag>
    </div> : <>
      <Panel title="平台预设模型" eyebrow="PLATFORM PRESETS" className="ac-form-panel">
        <p className="ac-muted-copy">只有完成所需配置并启用后，才会出现在业务的视频模型下拉框。</p>
        {PLATFORM_PRESETS.map(preset => {
          const model = modelById.get(preset.id);
          return <div className="ac-api-status-line" key={preset.id}>
            <span className="ac-security-card-icon violet"><Video size={20} /></span>
            <div style={{ flex: 1 }}><strong>{preset.displayName}</strong><small>{preset.description}</small>{preset.credentialMode === 'executorPairing' ? <small>{model?.executorPaired ? '执行器已配对' : '尚未完成执行器配对'}</small> : <Input.Password value={presetKeys[preset.id] || ''} onChange={event => setPresetKeys(current => ({ ...current, [preset.id]: event.target.value }))} prefix={<KeyRound size={15} />} placeholder={model?.hasCredential ? '留空表示不修改已保存的 Key' : '填写 API Key'} />}</div>
            <Switch checked={model?.enabled === true} disabled={!model?.enabled && !isPresetReady(preset, model)} onChange={enabled => savePreset(preset, enabled)} />
          </div>;
        })}
      </Panel>
      {MODEL_KINDS.map(group => <Panel key={group.key} title={group.title} eyebrow={group.eyebrow} className="ac-form-panel" action={<Button icon={<Plus size={15} />} onClick={openCreate}>添加自定义模型</Button>}>
        <CatalogTable models={customModels(models, group.key)} onEdit={openEdit} onDelete={deleteModel} onToggle={toggleModel} />
      </Panel>)}
    </>}
    <Modal title={editing ? '编辑自定义模型' : '添加自定义模型'} open={customOpen} onCancel={() => setCustomOpen(false)} onOk={submitCustom} okText={editing ? '保存修改' : '添加模型'} confirmLoading={saving}>
      <Form form={customForm} layout="vertical">
        <Form.Item name="kind" label="模型类型" rules={[{ required: true }]}><Select disabled={Boolean(editing)} options={MODEL_KINDS.map(group => ({ label: group.title, value: group.key }))} /></Form.Item>
        <Form.Item name="providerType" label="API 格式" rules={[{ required: true }]}><Select options={[{ label: 'OpenAI Chat Completions 格式', value: 'openai_compatible' }, { label: '自定义 API 格式', value: 'custom' }]} /></Form.Item>
        <Form.Item name="baseUrl" label="自定义请求地址" rules={[{ required: true, message: '请输入 Base URL' }]}><Input placeholder="例如 https://api.openai.com/v1" /></Form.Item>
        <Form.Item name="modelId" label="模型 ID" rules={[{ required: true, message: '请输入模型 ID' }]}><Input placeholder="例如 gpt-5.4" /></Form.Item>
        <Form.Item name="displayName" label="模型显示名称" rules={[{ required: true, message: '请输入显示名称' }]}><Input maxLength={80} /></Form.Item>
        <Form.Item name="credential" label="API 密钥" rules={[({ getFieldValue }) => ({ validator(_, value) {
          if (!getFieldValue('enabled') || String(value || '').trim() || editing?.hasCredential) return Promise.resolve();
          return Promise.reject(new Error('启用模型前必须填写 API Key'));
        } })]}><Input.Password prefix={<KeyRound size={15} />} placeholder={editing?.hasCredential ? '留空表示不修改已保存的 Key' : '请输入 API Key'} /></Form.Item>
        <Form.Item label="适用能力" extra="仅保存模型运行时可识别的能力；留空的时长不限制。">
          <Space direction="vertical">
            <Form.Item name={['capabilities', 'supportsReferenceImages']} valuePropName="checked" noStyle><Switch checkedChildren="支持参考图" unCheckedChildren="不支持参考图" /></Form.Item>
            <Form.Item name={['capabilities', 'requiresImageInput']} valuePropName="checked" noStyle><Switch checkedChildren="需要图片输入" unCheckedChildren="不需要图片输入" /></Form.Item>
            <Form.Item name={['capabilities', 'maxVideoDuration']} noStyle><InputNumber min={1} max={60} precision={0} placeholder="最大视频时长（1–60 秒）" /></Form.Item>
          </Space>
        </Form.Item>
        <Form.Item name="enabled" label="立即启用" valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
