import { AutoComplete, Button, Form, Input, Select, Slider, Switch, Typography, message } from 'antd';
import { Cable, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getConfig, saveConfig, testConfig } from '../../shared/api/config';
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

export function SettingsPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [provider, setProvider] = useState('openai');
  const [companionActive, setCompanionActive] = useState(() => readCompanionSpeechState(getCurrentUsername()).active);
  const username = getCurrentUsername();
  const soundEnabled = Form.useWatch('soundEnabled', form);
  const soundVolume = Form.useWatch('soundVolume', form);
  const soundVolumePercent = Number.isFinite(soundVolume) ? Math.round(soundVolume) : 60;

  useEffect(() => {
    setCompanionActive(readCompanionSpeechState(username).active);
  }, [username]);

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
          apiKey: '',
          petId: config.pet?.id || stackyPet.id,
          soundEnabled: config.notifications?.soundEnabled !== false,
          soundVolume: Number.isFinite(config.notifications?.soundVolume) ? config.notifications.soundVolume : 60,
          petVisible: config.notifications?.petVisible !== false
        });
        setProvider(config.provider || 'openai');
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
      const saved = await saveConfig({
        provider: values.provider,
        baseUrl: values.baseUrl,
        model: values.model,
        apiKey: values.apiKey,
        pet: values.petId === stackyPet.id ? stackyPet : undefined,
        notifications: {
          soundEnabled: values.soundEnabled !== false,
          soundVolume: Number.isFinite(values.soundVolume) ? values.soundVolume : 60,
          petVisible: values.petVisible !== false
        }
      });
      window.dispatchEvent(new CustomEvent('qiantie:notifications-updated', { detail: saved.notifications }));
      form.setFieldValue('apiKey', '');
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

  async function handleTest() {
    try {
      const values = await form.validateFields(['provider', 'baseUrl', 'model']);
      setTesting(true);
      const result = await testConfig({ ...values, apiKey: form.getFieldValue('apiKey') });
      message.success(result.message ? `连接成功：${result.message}` : '连接成功');
    } catch (error) {
      if (error?.errorFields) return;
      message.error(error.message || '连接测试失败');
    } finally {
      setTesting(false);
    }
  }

  const modelOptions = (providerDefaults[provider]?.models || []).map(model => ({ label: model, value: model }));

  return (
    <div className="utility-page settings-page">
      <div className="settings-workbench">
        <div className="settings-heading">
          <div>
            <Typography.Title level={3}>工作台设置</Typography.Title>
            <Typography.Paragraph>配置模型服务与前贴桌面宠物。</Typography.Paragraph>
          </div>
          <span className="settings-status">本账号配置</span>
        </div>
      <Form
        className="settings-form"
        form={form}
        layout="vertical"
        disabled={loading}
        initialValues={{ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', petId: stackyPet.id, soundEnabled: true, soundVolume: 60, petVisible: true }}
        onFinish={handleSave}
      >
        <section className="settings-section settings-connection-section" aria-labelledby="settings-connection-title">
          <div>
            <h2 id="settings-connection-title">连接配置</h2>
            <p>选择模型服务并填写访问地址。</p>
          </div>
          <Form.Item label="API 提供商" name="provider">
            <Select options={providers} onChange={handleProviderChange} />
          </Form.Item>
          <Form.Item label="Base URL" name="baseUrl" rules={[{ required: true, message: '请输入 Base URL' }]}>
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item label="API Key" name="apiKey">
            <Input.Password placeholder="留空表示不修改已保存的 Key" />
          </Form.Item>
        </section>

        <section className="settings-section settings-model-section" aria-labelledby="settings-model-title">
          <div>
            <h2 id="settings-model-title">模型与助手</h2>
            <p>指定默认模型，并确认当前桌面宠物。</p>
          </div>
          <Form.Item label="模型名称" name="model" rules={[{ required: true, message: '请选择或输入模型名称' }]}>
            <AutoComplete options={modelOptions} placeholder="选择或输入模型名称" filterOption />
          </Form.Item>
          <Form.Item label="前贴宠物" name="petId">
            <Select options={petOptions} />
          </Form.Item>
          <Form.Item label="提示音" name="soundEnabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Typography.Paragraph type="secondary">用于在剧本人物/场景提取完成、剧本生成完成时提醒；提取或生成失败（如网络、404、鉴权错误）时播放警示音。</Typography.Paragraph>
          <Form.Item label="提示音音量">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Form.Item name="soundVolume" noStyle>
                <Slider min={0} max={100} step={1} value={soundVolume} disabled={!soundEnabled} tooltip={{ formatter: value => `${value}%` }} style={{ flex: 1 }} />
              </Form.Item>
              <Typography.Text>{soundVolumePercent}%</Typography.Text>
            </div>
          </Form.Item>
          <Form.Item label="显示 CM 宠物" name="petVisible" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Typography.Paragraph type="secondary">控制右下角 CM 助手是否显示，关闭后可减少界面干扰。</Typography.Paragraph>
          <div className="settings-pet-preview" aria-label="当前前贴宠物 CM">
            <div className="settings-pet-frame">
              <img src={stackyPet.spritesheetPath} alt="CM" />
            </div>
            <div>
              <Typography.Text strong>{stackyPet.displayName}</Typography.Text>
              <Typography.Paragraph type="secondary">{stackyPet.description}</Typography.Paragraph>
            </div>
          </div>
          <Form.Item label="宠物主动说话" valuePropName="checked">
            <Switch checked={companionActive} onChange={checked => {
              setCompanionActive(checked);
              writeCompanionSpeechState(username, { ...readCompanionSpeechState(username), active: checked, nextIdleAt: 0 });
              window.dispatchEvent(new CustomEvent(PET_COMPANION_SETTINGS_EVENT, { detail: { active: checked, username } }));
            }} />
          </Form.Item>
        </section>

        <div className="settings-savebar">
          <span>保存后仅更新当前账号的工作台连接配置。</span>
          <div className="settings-savebar-actions">
            <Button icon={<Cable size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={handleTest} loading={testing}>测试连接</Button>
            <Button type="primary" icon={<Save size={16} strokeWidth={1.8} aria-hidden="true" />} htmlType="submit" loading={saving}>保存设置</Button>
          </div>
        </div>
      </Form>
      </div>
    </div>
  );
}

export default SettingsPage;
