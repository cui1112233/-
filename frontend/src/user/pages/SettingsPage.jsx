import { AutoComplete, Button, Form, Input, Select, Switch, Typography, message } from 'antd';
import { Cable, KeyRound, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getConfig, saveConfig, testImageConfig, testTextConfig } from '../../shared/api/config';
import { getCurrentUsername } from '../../shared/api/auth';
import { PET_COMPANION_SETTINGS_EVENT, readCompanionSpeechState, writeCompanionSpeechState } from '../../shared/pet/companionSpeech';

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

const stackyPet = {
  id: 'stacky',
  displayName: 'CM',
  description: 'CM，前贴的桌面宠物。',
  spriteVersionNumber: 2,
  spritesheetPath: '/pets/stacky/spritesheet.webp'
};

const petOptions = [
  { label: 'CM', value: 'stacky' }
];

function connectionResponseMessage(candidate, fallback) {
  if (typeof candidate === 'string') return candidate;
  if (typeof candidate?.content === 'string') return candidate.content;
  return fallback;
}

export function SettingsPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingText, setTestingText] = useState(false);
  const [testingImage, setTestingImage] = useState(false);
  const [provider, setProvider] = useState('openai');
  const [canManageApi, setCanManageApi] = useState(true);
  const [managedBy, setManagedBy] = useState(null);
  const imageMode = Form.useWatch(['image', 'mode'], form) || 'openai_compatible';
  const [companionActive, setCompanionActive] = useState(() => readCompanionSpeechState(getCurrentUsername()).active);
  const username = getCurrentUsername();

  useEffect(() => {
    setCompanionActive(readCompanionSpeechState(username).active);
  }, [username]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getConfig()
      .then(config => {
        if (!alive) return;
        setCanManageApi(config.canManageApi !== false);
        setManagedBy(config.managedBy || null);
        form.setFieldsValue({
          provider: config.canManageApi === false ? 'openai' : (config.provider || 'openai'),
          baseUrl: config.baseUrl || 'https://api.openai.com/v1',
          model: config.model || 'gpt-4o-mini',
          apiKey: '',
          image: {
            mode: config.image?.mode || 'openai_compatible',
            provider: config.image?.provider || 'openai_compatible',
            displayName: config.image?.displayName || '',
            baseUrl: config.image?.baseUrl || '',
            model: config.image?.model || '',
            apiKey: ''
          },
          petId: config.pet?.id || stackyPet.id
        });
        setProvider(config.canManageApi === false ? 'openai' : (config.provider || 'openai'));
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
      const payload = {
        pet: values.petId === stackyPet.id ? stackyPet : undefined
      };
      if (canManageApi) {
        Object.assign(payload, {
          provider: values.provider,
          baseUrl: values.baseUrl,
          model: values.model,
          apiKey: values.apiKey,
          image: values.image
        });
      }
      await saveConfig(payload);
      form.setFieldValue('apiKey', '');
      form.setFieldValue(['image', 'apiKey'], '');
      message.success('设置已保存');
    } catch (error) {
      message.error(error.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  function handleProviderChange(nextProvider) {
    const preset = providerDefaults[nextProvider] || providerDefaults.custom;
    setProvider(nextProvider);
    form.setFieldsValue({
      provider: nextProvider,
      baseUrl: preset.baseUrl,
      model: preset.models[0] || ''
    });
  }

  async function handleTestText() {
    if (!canManageApi) return;
    try {
      const values = await form.validateFields(['provider', 'baseUrl', 'model']);
      setTestingText(true);
      const result = await testTextConfig({ ...values, apiKey: form.getFieldValue('apiKey') });
      message.success(connectionResponseMessage(result.message, '连接成功'));
    } catch (error) {
      if (error?.errorFields) return;
      message.error(error.message || '连接测试失败');
    } finally {
      setTestingText(false);
    }
  }

  async function handleTestImage() {
    if (!canManageApi) return;
    try {
      const { image } = await form.validateFields([['image', 'baseUrl'], ['image', 'model']]);
      setTestingImage(true);
      const result = await testImageConfig({ ...image, apiKey: form.getFieldValue(['image', 'apiKey']) });
      const imageMessage = connectionResponseMessage(
        result.message,
        result.modelListed === false ? '连接已建立，但服务未返回当前生图模型' : '生图连接成功'
      );
      if (result.modelListed === false) message.warning(imageMessage);
      else message.success(imageMessage);
    } catch (error) {
      if (error?.errorFields) return;
      message.error(error.message || '生图连接测试失败');
    } finally {
      setTestingImage(false);
    }
  }

  const modelOptions = (providerDefaults[provider]?.models || []).map(model => ({ label: model, value: model }));

  return (
    <div className="utility-page settings-page">
      <div className="settings-workbench">
        <div className="settings-heading">
          <div>
            <Typography.Title level={3}>工作台设置</Typography.Title>
            <Typography.Paragraph>{canManageApi ? '配置模型服务与前贴桌面宠物。' : '管理你的工作台偏好；模型服务由团队管理员统一提供。'}</Typography.Paragraph>
          </div>
          <span className="settings-status">{canManageApi ? '本账号配置' : '团队托管'}</span>
        </div>
      <Form
        className="settings-form"
        form={form}
        layout="vertical"
        disabled={loading}
        initialValues={{ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', petId: stackyPet.id }}
        onFinish={handleSave}
      >
        {!canManageApi ? <section className="settings-section settings-connection-section" aria-label="团队 API 托管">
          <div>
            <h2>模型连接由团队托管</h2>
            <p>你的 MEMBER 身份不会显示或保存 API Key。{managedBy ? `当前服务绑定至 @${managedBy}。` : '绑定管理员后即可使用团队模型服务。'}</p>
          </div>
          <div className="member-managed-note"><KeyRound size={16} /> API 地址、模型和密钥仅 DEV / MANAGER 可以配置；你仍可在下方修改宠物等个人偏好。</div>
        </section> : null}

        {canManageApi ? <section className="settings-section settings-connection-section" aria-labelledby="settings-connection-title">
          <div>
            <h2 id="settings-connection-title">连接配置</h2>
            <p>选择模型服务并填写访问地址。</p>
          </div>
          <Form.Item label="API 提供商" name="provider"><Select options={providers} onChange={handleProviderChange} /></Form.Item>
          <Form.Item label="Base URL" name="baseUrl" rules={[{ required: true, message: '请输入 Base URL' }]}><Input placeholder="https://api.openai.com/v1" /></Form.Item>
          <Form.Item label="API Key" name="apiKey"><Input.Password placeholder="留空表示不修改已保存的 Key" /></Form.Item>
        </section> : null}

        <section className="settings-section settings-model-section" aria-labelledby="settings-model-title">
          <div>
            <h2 id="settings-model-title">{canManageApi ? '模型与助手' : '助手偏好'}</h2>
            <p>{canManageApi ? '指定默认模型，并确认当前桌面宠物。' : '确认当前桌面宠物和个人交互偏好。'}</p>
          </div>
          {canManageApi ? <Form.Item label="模型名称" name="model" rules={[{ required: true, message: '请选择或输入模型名称' }]}><AutoComplete options={modelOptions} placeholder="选择或输入模型名称" filterOption /></Form.Item> : null}
          <Form.Item label="前贴宠物" name="petId"><Select options={petOptions} /></Form.Item>
          <div className="settings-pet-preview" aria-label="当前前贴宠物 CM">
            <div className="settings-pet-frame"><img src={stackyPet.spritesheetPath} alt="CM" /></div>
            <div><Typography.Text strong>{stackyPet.displayName}</Typography.Text><Typography.Paragraph type="secondary">{stackyPet.description}</Typography.Paragraph></div>
          </div>
          <Form.Item label="宠物主动说话" valuePropName="checked">
            <Switch checked={companionActive} onChange={checked => {
              setCompanionActive(checked);
              writeCompanionSpeechState(username, { ...readCompanionSpeechState(username), active: checked, nextIdleAt: 0 });
              window.dispatchEvent(new CustomEvent(PET_COMPANION_SETTINGS_EVENT, { detail: { active: checked, username } }));
            }} />
          </Form.Item>
          {canManageApi ? <Button icon={<Cable size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={handleTestText} loading={testingText}>测试文本连接</Button> : null}
        </section>

        {canManageApi ? <section className="settings-section settings-image-section" aria-labelledby="settings-image-title">
          <div><h2 id="settings-image-title">生图服务</h2><p>独立用于水货生产的图片生成，不会复用文本模型的地址或密钥。</p></div>
          <Form.Item label="API 提供商" name={['image', 'provider']}><Select options={[{ label: 'OpenAI 兼容', value: 'openai_compatible' }]} disabled /></Form.Item>
          <Form.Item label="生图模式" name={['image', 'mode']}><Select options={[{ label: 'OpenAI 兼容', value: 'openai_compatible' }, { label: '自定义（OpenAI 兼容）', value: 'custom' }]} onChange={mode => { if (mode !== 'custom') form.setFieldValue(['image', 'displayName'], ''); }} /></Form.Item>
          {imageMode === 'custom' ? <Form.Item label="供应商名称" name={['image', 'displayName']} rules={[{ required: true, whitespace: true, message: '请输入供应商名称' }]}><Input placeholder="例如 My image gateway" maxLength={80} /></Form.Item> : null}
          <Form.Item label="Base URL" name={['image', 'baseUrl']} rules={[{ required: true, message: '请输入生图 Base URL' }]}><Input placeholder="https://api.openai.com/v1" /></Form.Item>
          <Form.Item label="API Key" name={['image', 'apiKey']}><Input.Password placeholder="留空表示不修改已保存的 Key" /></Form.Item>
          <Form.Item label="生图模型名称" name={['image', 'model']} rules={[{ required: true, message: '请输入生图模型名称' }]}><Input placeholder="例如 gpt-image-1" /></Form.Item>
          <Button icon={<Cable size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={handleTestImage} loading={testingImage}>测试生图连接</Button>
        </section> : null}

        <div className="settings-savebar">
          <span>{canManageApi ? '保存后仅更新当前账号的工作台连接配置。' : '保存后仅更新当前账号的个人工作台偏好。'}</span>
          <div className="settings-savebar-actions"><Button type="primary" icon={<Save size={16} strokeWidth={1.8} aria-hidden="true" />} htmlType="submit" loading={saving}>保存设置</Button></div>
        </div>
      </Form>
      </div>
    </div>
  );
}

export default SettingsPage;
