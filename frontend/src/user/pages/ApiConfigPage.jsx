import { AutoComplete, Button, Form, Input, InputNumber, Select, Skeleton, Tag, message } from 'antd';
import { Cable, CheckCircle2, Coins, Image, KeyRound, Save, Server, ShieldCheck, Video } from 'lucide-react';
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
            <Form.Item label="视频服务 API Key（H3 / YD）" name={['video', 'apiKey']} extra="剧本、批量工厂和通用视频生产会从这里读取当前账号的视频凭据。"><Input.Password prefix={<KeyRound size={15} />} placeholder="留空表示不修改已保存的 Key" /></Form.Item>
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
