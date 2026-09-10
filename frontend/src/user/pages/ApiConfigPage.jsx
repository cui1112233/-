import { AutoComplete, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Skeleton, Switch, Tag, message } from 'antd';
import { Cable, CheckCircle2, Coins, Image, KeyRound, Pencil, Plus, Save, Server, ShieldCheck, Trash2, Video } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getConfig, saveConfig, testImageConfig, testTextConfig } from '../../shared/api/config';
import { getMemberCenter } from '../../shared/api/member';
import { PageHeader, Panel, RoleBadge } from './accountCenterShared';

const providers = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Claude', value: 'claude' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: '通义千问', value: 'qwen' },
  { label: '自定义', value: 'custom' }
];

const providerDefaults = {
  openai: { baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'] },
  claude: { baseUrl: 'https://api.anthropic.com/v1', models: ['claude-3-5-sonnet-20241022', 'claude-3-7-sonnet-latest'] },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
  custom: { baseUrl: '', models: [] }
};

const modelKinds = [
  { value: 'text', label: '文本模型', icon: Server },
  { value: 'video', label: '视频模型', icon: Video },
  { value: 'image', label: '图片模型', icon: Image }
];

function ModelDirectory({ config, onSaved }) {
  const [kind, setKind] = useState('text');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const models = Array.isArray(config?.models) ? config.models : [];
  const visible = models.filter(item => item.kind === kind);

  function openEditor(model = null) {
    setEditing(model || { kind, provider: 'custom', format: 'openai_compatible', enabled: true });
    form.setFieldsValue(model ? { ...model, apiKey: '' } : { kind, provider: 'custom', format: 'openai_compatible', enabled: true });
  }

  async function submit(values) {
    setSaving(true);
    try {
      const next = editing?.id
        ? models.map(item => item.id === editing.id ? { ...item, ...values, id: editing.id } : item)
        : [...models, { ...values, id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }];
      const saved = await saveConfig({ models: next });
      onSaved(saved);
      setEditing(null);
      form.resetFields();
      message.success(editing?.id ? '模型已更新' : '模型已添加');
    } catch (error) { message.error(error.message || '模型保存失败'); }
    finally { setSaving(false); }
  }

  async function remove(model) {
    try {
      const saved = await saveConfig({ models: models.filter(item => item.id !== model.id) });
      onSaved(saved);
      message.success('模型已删除');
    } catch (error) { message.error(error.message || '模型删除失败'); }
  }

  async function toggle(model, enabled) {
    try {
      const saved = await saveConfig({ models: models.map(item => item.id === model.id ? { ...item, enabled } : item) });
      onSaved(saved);
    } catch (error) { message.error(error.message || '模型状态保存失败'); }
  }

  return <section className="ac-model-directory">
    <div className="ac-directory-heading"><div><h2>模型管理</h2><p>统一配置一次，剧本、小说获取、批量工厂和制作页面按能力自动筛选。</p></div><Button type="primary" icon={<Plus size={16} />} onClick={() => openEditor()}>添加模型</Button></div>
    <div className="ac-model-kind-tabs">{modelKinds.map(item => { const Icon = item.icon; return <button key={item.value} type="button" className={kind === item.value ? 'active' : ''} onClick={() => setKind(item.value)}><Icon size={16} />{item.label}<span>{models.filter(model => model.kind === item.value).length}</span></button>; })}</div>
    <div className="ac-model-list">{visible.map(model => <div className="ac-model-row" key={model.id}><div className="ac-model-row-icon">{kind === 'text' ? <Server size={17} /> : kind === 'video' ? <Video size={17} /> : <Image size={17} />}</div><div className="ac-model-row-main"><strong>{model.name}</strong><span>{model.provider || '自定义'} · {model.model || '未填写模型 ID'}</span></div><Tag color={model.hasApiKey ? 'green' : 'default'}>{model.hasApiKey ? 'Key 已保存' : '未配置 Key'}</Tag><Button type="text" aria-label={`编辑${model.name}`} icon={<Pencil size={15} />} onClick={() => openEditor(model)} /><Popconfirm title="删除这个模型？" onConfirm={() => remove(model)}><Button type="text" danger aria-label={`删除${model.name}`} icon={<Trash2 size={15} />} /></Popconfirm><Switch checked={model.enabled !== false} onChange={value => toggle(model, value)} /></div>)}{!visible.length ? <div className="ac-model-empty">暂无{modelKinds.find(item => item.value === kind)?.label}，点击“添加模型”开始配置。</div> : null}</div>
    <Modal title={editing?.id ? '编辑模型' : '自定义模型'} open={Boolean(editing)} onCancel={() => setEditing(null)} footer={null} destroyOnClose width={560}>
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ kind, provider: 'custom', format: 'openai_compatible', enabled: true }}>
        <Form.Item label="模型类型" name="kind" rules={[{ required: true }]}><Select options={modelKinds.map(item => ({ value: item.value, label: item.label }))} onChange={setKind} /></Form.Item>
        <Form.Item label="API 格式" name="format" rules={[{ required: true }]}><Select options={[{ value: 'openai_compatible', label: 'OpenAI Chat Completions 格式' }, { value: 'provider', label: '供应商专用格式' }]} /></Form.Item>
        <Form.Item label="供应商" name="provider" rules={[{ required: true }]}><Input placeholder="例如 OpenAI、Gemini、MiniMax H3" /></Form.Item>
        <Form.Item label="请求地址" name="endpoint" rules={[{ required: true, message: '请输入请求地址' }]}><Input placeholder="https://api.example.com/v1" /></Form.Item>
        <Form.Item label="模型 ID" name="model" rules={[{ required: true, message: '请输入模型 ID' }]}><Input placeholder="例如 gpt-5.4" /></Form.Item>
        <Form.Item label="模型展示名称" name="name" rules={[{ required: true, message: '请输入展示名称' }]}><Input maxLength={80} placeholder="列表中显示的名称" /></Form.Item>
        <Form.Item label="API 密钥" name="apiKey" extra={editing?.id && editing.hasApiKey ? '已保存密钥；留空表示继续使用原密钥。'}><Input.Password placeholder="请输入 API Key" /></Form.Item>
        <Form.Item label="启用模型" name="enabled" valuePropName="checked"><Switch /></Form.Item>
        <div className="ac-model-editor-footer"><Button onClick={() => setEditing(null)}>取消</Button><Button type="primary" htmlType="submit" loading={saving}>{editing?.id ? '保存修改' : '添加模型'}</Button></div>
      </Form>
    </Modal>
  </section>;
}

function connectionMessage(candidate, fallback) {
  if (typeof candidate === 'string') return candidate;
  if (typeof candidate?.content === 'string') return candidate.content;
  return fallback;
}

export default function ApiConfigPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingText, setTestingText] = useState(false);
  const [testingImage, setTestingImage] = useState(false);
  const [savingVideo, setSavingVideo] = useState(false);
  const [provider, setProvider] = useState('openai');
  const [config, setConfig] = useState(null);
  const [center, setCenter] = useState(null);
  const imageMode = Form.useWatch(['image', 'mode'], form) || 'openai_compatible';

  useEffect(() => {
    let alive = true;
    Promise.all([getConfig(), getMemberCenter()]).then(([nextConfig, nextCenter]) => {
      if (!alive) return;
      setConfig(nextConfig);
      setCenter(nextCenter);
      const nextProvider = nextConfig.provider || 'openai';
      setProvider(nextProvider);
      form.setFieldsValue({
        provider: nextProvider,
        baseUrl: nextConfig.baseUrl || providerDefaults[nextProvider]?.baseUrl || '',
        model: nextConfig.model || '',
        apiKey: '',
        pricing: {
          currency: nextConfig.pricing?.currency || 'USD',
          inputPerMillion: nextConfig.pricing?.inputPerMillion ?? null,
          outputPerMillion: nextConfig.pricing?.outputPerMillion ?? null
        },
        image: {
          provider: nextConfig.image?.provider || 'openai_compatible',
          mode: nextConfig.image?.mode || 'openai_compatible',
          displayName: nextConfig.image?.displayName || '',
          baseUrl: nextConfig.image?.baseUrl || '',
          model: nextConfig.image?.model || '',
          apiKey: ''
        },
        video: { apiKey: '' }
      });
    }).catch(error => message.error(error.message || 'API 配置加载失败'))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [form]);

  const canManageApi = config?.canManageApi !== false;
  const member = center?.member;
  const modelOptions = (providerDefaults[provider]?.models || []).map(model => ({ label: model, value: model }));

  function changeProvider(nextProvider) {
    setProvider(nextProvider);
    const preset = providerDefaults[nextProvider] || providerDefaults.custom;
    form.setFieldsValue({ provider: nextProvider, baseUrl: preset.baseUrl, model: preset.models[0] || '' });
  }

  async function save(values) {
    if (!canManageApi) return;
    setSaving(true);
    try {
      const inputPrice = values.pricing?.inputPerMillion;
      const outputPrice = values.pricing?.outputPerMillion;
      await saveConfig({
        provider: values.provider,
        baseUrl: values.baseUrl,
        model: values.model,
        apiKey: values.apiKey,
        pricing: inputPrice || outputPrice ? {
          currency: values.pricing?.currency || 'USD',
          inputPerMillion: inputPrice || 0,
          outputPerMillion: outputPrice || 0
        } : null,
        image: values.image
      });
      form.setFieldValue('apiKey', '');
      form.setFieldValue(['image', 'apiKey'], '');
      message.success('API 配置与价格快照已保存');
    } catch (error) {
      message.error(error.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function testText() {
    try {
      const values = await form.validateFields(['provider', 'baseUrl', 'model']);
      setTestingText(true);
      const result = await testTextConfig({ ...values, apiKey: form.getFieldValue('apiKey') });
      message.success(connectionMessage(result.message, '文本模型连接成功'));
    } catch (error) {
      if (!error?.errorFields) message.error(error.message || '连接测试失败');
    } finally {
      setTestingText(false);
    }
  }

  async function testImage() {
    try {
      const image = form.getFieldValue('image');
      setTestingImage(true);
      const result = await testImageConfig({ ...image, apiKey: form.getFieldValue(['image', 'apiKey']) });
      message.success(connectionMessage(result.message, '生图连接成功'));
    } catch (error) {
      message.error(error.message || '生图连接测试失败');
    } finally {
      setTestingImage(false);
    }
  }

  async function saveVideo() {
    if (!canManageApi) return;
    setSavingVideo(true);
    try {
      const apiKey = form.getFieldValue(['video', 'apiKey']) || '';
      const saved = await saveConfig({ video: { apiKey } });
      setConfig(saved);
      form.setFieldValue(['video', 'apiKey'], '');
      message.success('视频生成配置已保存');
    } catch (error) {
      message.error(error.message || '视频生成配置保存失败');
    } finally {
      setSavingVideo(false);
    }
  }

  if (loading) return <div className="account-center-page"><Skeleton active paragraph={{ rows: 9 }} /></div>;

  return <div className="account-center-page api-config-page">
    <PageHeader title="API 配置" subtitle="管理云端模型连接与调用价格快照；本地视频执行器请前往设置" />

    {!canManageApi ? <div className="ac-managed-api-card">
      <span><ShieldCheck size={28} /></span>
      <div><div><h2>模型服务由团队托管</h2>{member ? <RoleBadge role={member.role} /> : null}</div><p>你的 MEMBER 身份不会显示、读取或保存管理员 API Key。当前调用会自动使用绑定 MANAGER 的模型配置。</p></div>
      <Tag color={config?.managedBy ? 'green' : 'gold'}>{config?.managedBy ? `托管账号 @${config.managedBy}` : '等待绑定 MANAGER'}</Tag>
    </div> : null}

    {canManageApi ? <ModelDirectory config={config} onSaved={setConfig} /> : null}

    {canManageApi ? <Form form={form} layout="vertical" onFinish={save}>
      <div className="ac-api-layout">
        <div className="ac-api-main">
          <Panel title="文本模型连接" eyebrow="TEXT MODEL" className="ac-form-panel" action={<Tag color={config?.hasApiKey ? 'green' : 'default'}>{config?.hasApiKey ? 'Key 已保存' : '未保存 Key'}</Tag>}>
            <div className="ac-api-status-line"><span className="ac-security-card-icon"><Server size={20} /></span><div><strong>默认文本模型</strong><small>用于 Agent、剧本与普通对话调用</small></div></div>
            <div className="ac-form-row two">
              <Form.Item label="API 提供商" name="provider" rules={[{ required: true }]}><Select options={providers} onChange={changeProvider} /></Form.Item>
              <Form.Item label="模型名称" name="model" rules={[{ required: true, message: '请选择或填写模型' }]}><AutoComplete options={modelOptions} placeholder="选择或输入模型名称" filterOption /></Form.Item>
            </div>
            <Form.Item label="Base URL" name="baseUrl" rules={[{ required: true, message: '请输入 Base URL' }]}><Input prefix={<Server size={15} />} placeholder="https://api.openai.com/v1" /></Form.Item>
            <Form.Item label="API Key" name="apiKey"><Input.Password prefix={<KeyRound size={15} />} placeholder="留空表示不修改已保存的 Key" /></Form.Item>
            <div className="ac-api-actions"><Button icon={<Cable size={16} />} onClick={testText} loading={testingText}>测试文本连接</Button></div>
          </Panel>

          <Panel title="费用估算价格快照" eyebrow="PRICING SNAPSHOT" className="ac-form-panel">
            <div className="ac-api-status-line"><span className="ac-security-card-icon gold"><Coins size={20} /></span><div><strong>按你实际供应商价格填写</strong><small>每次调用会把当时价格写入用量账本；未来改价不会篡改历史费用。</small></div></div>
            <div className="ac-form-row three">
              <Form.Item label="币种" name={['pricing', 'currency']}><Select options={[{ label: 'USD', value: 'USD' }, { label: 'CNY', value: 'CNY' }, { label: 'JPY', value: 'JPY' }]} /></Form.Item>
              <Form.Item label="输入 / 100万 Tokens" name={['pricing', 'inputPerMillion']}><InputNumber min={0} precision={6} style={{ width: '100%' }} placeholder="留空不估算" /></Form.Item>
              <Form.Item label="输出 / 100万 Tokens" name={['pricing', 'outputPerMillion']}><InputNumber min={0} precision={6} style={{ width: '100%' }} placeholder="留空不估算" /></Form.Item>
            </div>
            <p className="ac-form-tip">这里只做估算，不代表供应商最终账单。建议在供应商价格变化时同步更新。</p>
          </Panel>

          <Panel title="生图服务" eyebrow="IMAGE MODEL" className="ac-form-panel" action={<Tag color={config?.image?.hasApiKey ? 'green' : 'default'}>{config?.image?.hasApiKey ? 'Key 已保存' : '未保存 Key'}</Tag>}>
            <div className="ac-api-status-line"><span className="ac-security-card-icon violet"><Image size={20} /></span><div><strong>独立图片生成连接</strong><small>不会复用文本模型的地址或密钥</small></div></div>
            <div className="ac-form-row two">
              <Form.Item label="生图模式" name={['image', 'mode']}><Select options={[
                { label: 'OpenAI 兼容', value: 'openai_compatible' },
                { label: '自定义（OpenAI 兼容）', value: 'custom' }
              ]} /></Form.Item>
              <Form.Item label="生图模型" name={['image', 'model']} rules={[{ required: true, message: '请输入生图模型' }]}><Input placeholder="例如 gpt-image-1" /></Form.Item>
            </div>
            {imageMode === 'custom' ? <Form.Item label="供应商显示名称" name={['image', 'displayName']}><Input maxLength={80} /></Form.Item> : null}
            <Form.Item label="Base URL" name={['image', 'baseUrl']} rules={[{ required: true, message: '请输入生图 Base URL' }]}><Input prefix={<Server size={15} />} /></Form.Item>
            <Form.Item label="API Key" name={['image', 'apiKey']}><Input.Password prefix={<KeyRound size={15} />} placeholder="留空表示不修改已保存的 Key" /></Form.Item>
            <div className="ac-api-actions"><Button icon={<Cable size={16} />} onClick={testImage} loading={testingImage}>测试生图连接</Button></div>
          </Panel>
          <Panel title="视频生成服务" eyebrow="VIDEO MODEL" className="ac-form-panel" action={<Tag color={config?.video?.hasApiKey ? 'green' : 'default'}>{config?.video?.hasApiKey ? 'Key 已保存' : '未保存 Key'}</Tag>}>
            <div className="ac-api-status-line"><span className="ac-security-card-icon violet"><Video size={20} /></span><div><strong>独立视频生成凭据</strong><small>视频服务按自己的保存入口维护，不会覆盖文本或图片配置。</small></div></div>
            <Form.Item label="视频服务 API Key" name={['video', 'apiKey']}><Input.Password prefix={<KeyRound size={15} />} placeholder="留空表示不修改已保存的 Key" /></Form.Item>
            <div className="ac-api-actions"><Button icon={<Save size={16} />} onClick={saveVideo} loading={savingVideo}>保存视频生成</Button></div>
          </Panel>
        </div>

        <aside className="ac-side-stack">
          <Panel title="连接状态">
            <div className="ac-api-health">
              <div><CheckCircle2 size={17} className={config?.hasApiKey ? 'ok' : ''} /><span>文本 API Key</span><b>{config?.hasApiKey ? '已保存' : '未配置'}</b></div>
              <div><CheckCircle2 size={17} className={config?.baseUrl ? 'ok' : ''} /><span>文本 Base URL</span><b>{config?.baseUrl ? '已配置' : '缺失'}</b></div>
              <div><CheckCircle2 size={17} className={config?.model ? 'ok' : ''} /><span>默认模型</span><b>{config?.model || '未配置'}</b></div>
              <div><CheckCircle2 size={17} className={config?.pricing ? 'ok' : ''} /><span>费用价格快照</span><b>{config?.pricing ? `${config.pricing.currency}` : '未配置'}</b></div>
              <div><CheckCircle2 size={17} className={config?.image?.hasApiKey ? 'ok' : ''} /><span>生图 API Key</span><b>{config?.image?.hasApiKey ? '已保存' : '未配置'}</b></div>
              <div><CheckCircle2 size={17} className={config?.video?.hasApiKey ? 'ok' : ''} /><span>视频 API Key</span><b>{config?.video?.hasApiKey ? '已保存' : '未配置'}</b></div>
            </div>
          </Panel>
          <Panel title="安全说明" eyebrow="SECURITY">
            <p className="ac-muted-copy">保存后的 API Key 只在服务端读取。价格快照用于团队费用估算，不会替代供应商正式账单。</p>
          </Panel>
          <Button className="ac-sticky-save" type="primary" icon={<Save size={16} />} loading={saving} onClick={() => form.submit()}>保存 API 配置</Button>
        </aside>
      </div>
    </Form> : <div className="ac-two-column">
      <Panel title="当前服务状态"><div className="ac-service-list"><div><span className={member?.apiScopes?.includes('*') || member?.apiScopes?.includes('text') ? 'dot-on' : 'dot-off'} />团队文本模型<b>{member?.apiScopes?.includes('*') || member?.apiScopes?.includes('text') ? '可用' : '未授权'}</b></div><div><span className={member?.apiScopes?.includes('*') || member?.apiScopes?.includes('image') ? 'dot-on' : 'dot-off'} />团队生图能力<b>{member?.apiScopes?.includes('*') || member?.apiScopes?.includes('image') ? '可用' : '未授权'}</b></div><div><span className={member?.apiScopes?.includes('*') || member?.apiScopes?.includes('tts') ? 'dot-on' : 'dot-off'} />团队 TTS<b>{member?.apiScopes?.includes('*') || member?.apiScopes?.includes('tts') ? '可用' : '未授权'}</b></div></div></Panel>
      <Panel title="为什么看不到 Key"><p className="ac-muted-copy">MEMBER 的调用由服务端根据 boundTo 解析到 MANAGER 配置。密钥和价格配置不会下发到成员浏览器。</p></Panel>
    </div>}
  </div>;
}
