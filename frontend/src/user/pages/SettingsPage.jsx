import { AutoComplete, Button, Form, Input, List, Select, Slider, Switch, Typography, message } from 'antd';
import { Cable, Download, FolderOpen, RefreshCw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getConfig, saveConfig, testImageConfig, testTextConfig } from '../../shared/api/config';
import { getCurrentUsername } from '../../shared/api/auth';
import { apiRequest } from '../../shared/api/client';
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

const localExecutorDownloads = {
  mac: '/downloads/local-executor/yizhan-local-executor-0.1.12-mac-arm64.dmg',
  windows: '/downloads/local-executor/yizhan-local-executor-0.1.12-win-x64.exe'
};

function connectionResponseMessage(candidate, fallback) {
  if (typeof candidate === 'string') return candidate;
  if (typeof candidate?.content === 'string') return candidate.content;
  return fallback;
}

export function SettingsPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [savingSection, setSavingSection] = useState(null);
  const [testingText, setTestingText] = useState(false);
  const [testingImage, setTestingImage] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [listing, setListing] = useState(false);
  const [restoreReport, setRestoreReport] = useState(null);
  const [fileList, setFileList] = useState(null);
  const [provider, setProvider] = useState('openai');
  const [videoHasApiKey, setVideoHasApiKey] = useState(false);
  const [localExecutors, setLocalExecutors] = useState([]);
  const [loadingExecutors, setLoadingExecutors] = useState(false);
  const [pairing, setPairing] = useState(null);
  const imageMode = Form.useWatch(['image', 'mode'], form) || 'openai_compatible';
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
          image: {
            mode: config.image?.mode || 'openai_compatible',
            provider: config.image?.provider || 'openai_compatible',
            displayName: config.image?.displayName || '',
            baseUrl: config.image?.baseUrl || '',
            model: config.image?.model || '',
            apiKey: ''
          },
          video: {
            apiKey: ''
          },
          storageRoot: config.storageRoot || '',
          petId: config.pet?.id || stackyPet.id,
          soundEnabled: config.notifications?.soundEnabled !== false,
          soundVolume: Number.isFinite(config.notifications?.soundVolume) ? config.notifications.soundVolume : 60,
          petVisible: config.notifications?.petVisible !== false
        });
        setProvider(config.provider || 'openai');
        setVideoHasApiKey(Boolean(config.video?.hasApiKey));
      })
      .catch(error => message.error(error.message || '读取设置失败'))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [form]);

  async function loadLocalExecutors() {
    setLoadingExecutors(true);
    try {
      const result = await apiRequest('/api/shuihuo-production/local-executors', { suppressGlobalError: true });
      setLocalExecutors(Array.isArray(result.executors) ? result.executors : []);
    } catch (error) {
      message.error(error.message || '读取本地执行器失败');
    } finally {
      setLoadingExecutors(false);
    }
  }

  useEffect(() => { loadLocalExecutors(); }, []);

  async function createLocalExecutorPairing() {
    try {
      const result = await apiRequest('/api/shuihuo-production/local-executors/pairings', {
        method: 'POST', body: JSON.stringify({ platform: 'doubao' }), suppressGlobalError: true
      });
      setPairing(result);
      message.success('配对码已生成，请在本地执行器中输入');
    } catch (error) {
      message.error(error.message || '生成配对码失败');
    }
  }

  async function saveSection(section) {
    let values;
    try {
      if (section === 'text') {
        values = await form.validateFields(['provider', 'baseUrl', 'model']);
        values.apiKey = form.getFieldValue('apiKey');
      } else if (section === 'image') {
        const fieldNames = [['image', 'baseUrl'], ['image', 'model']];
        if (form.getFieldValue(['image', 'mode']) === 'custom') fieldNames.push(['image', 'displayName']);
        const result = await form.validateFields(fieldNames);
        values = { image: { ...form.getFieldValue('image'), ...result.image } };
      } else if (section === 'video') {
        values = { video: { apiKey: form.getFieldValue(['video', 'apiKey']) || '' } };
      } else if (section === 'workspace') {
        const result = await form.validateFields(['petId', 'soundEnabled', 'soundVolume', 'petVisible']);
        values = {
          pet: result.petId === stackyPet.id ? stackyPet : undefined,
          notifications: {
            soundEnabled: result.soundEnabled !== false,
            soundVolume: Number.isFinite(result.soundVolume) ? result.soundVolume : 60,
            petVisible: result.petVisible !== false
          }
        };
      } else if (section === 'storage') {
        const result = await form.validateFields(['storageRoot']);
        values = { storageRoot: result.storageRoot || '' };
      }
    } catch (error) {
      if (!error?.errorFields) message.error(error.message || '保存失败');
      return;
    }

    setSavingSection(section);
    try {
      const saved = await saveConfig(values);
      if (section === 'text') form.setFieldValue('apiKey', '');
      if (section === 'image') form.setFieldValue(['image', 'apiKey'], '');
      if (section === 'video') {
        form.setFieldValue(['video', 'apiKey'], '');
        setVideoHasApiKey(Boolean(saved.video?.hasApiKey ?? values.video.apiKey));
      }
      if (section === 'workspace') {
        window.dispatchEvent(new CustomEvent('qiantie:notifications-updated', { detail: saved.notifications }));
      }
      message.success(`${({ text: '文本推理', image: '图片生成', video: '视频生成', workspace: '工作台设置', storage: '本地存储' })[section]}已保存`);
    } catch (error) {
      message.error(error.message || '保存失败');
    } finally {
      setSavingSection(null);
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
    try {
      const { image } = await form.validateFields([['image', 'baseUrl'], ['image', 'model']]);
      setTestingImage(true);
      const result = await testImageConfig({ ...image, apiKey: form.getFieldValue(['image', 'apiKey']) });
      const imageMessage = connectionResponseMessage(
        result.message,
        result.modelListed === false ? '连接已建立，但服务未返回当前生图模型' : '生图连接成功'
      );
      if (result.modelListed === false) {
        message.warning(imageMessage);
      } else {
        message.success(imageMessage);
      }
    } catch (error) {
      if (error?.errorFields) return;
      message.error(error.message || '生图连接测试失败');
    } finally {
      setTestingImage(false);
    }
  }

  async function handleRestore() {
    setRestoring(true);
    setRestoreReport(null);
    try {
      const report = await apiRequest('/api/storage/restore', { method: 'POST' });
      setRestoreReport(report);
      message.success(`恢复完成：剧本并入 ${report.scriptResults?.added ?? 0} 条`);
    } catch (error) {
      message.error(error.message || '恢复失败');
    } finally {
      setRestoring(false);
    }
  }

  async function handleList() {
    setListing(true);
    setFileList(null);
    try {
      const list = await apiRequest('/api/storage/list');
      setFileList(list);
    } catch (error) {
      message.error(error.message || '读取文件清单失败');
    } finally {
      setListing(false);
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
        initialValues={{ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', image: { apiKey: '' }, video: { apiKey: '' }, storageRoot: '', petId: stackyPet.id, soundEnabled: true, soundVolume: 60, petVisible: true }}
      >
        <section className="settings-section settings-model-services" aria-labelledby="settings-model-services-title">
          <div>
            <h2 id="settings-model-services-title">模型服务</h2>
            <p>按用途分别配置文本、图片和视频生成服务。</p>
          </div>

          <div className="model-service-row">
            <div className="model-service-summary">
              <h3>文本推理</h3>
              <p>用于剧本、提示词和内容分析。</p>
            </div>
            <div className="model-service-fields">
              <Form.Item label="API 提供商" name="provider">
                <Select options={providers} onChange={handleProviderChange} />
              </Form.Item>
              <Form.Item label="Base URL" name="baseUrl" rules={[{ required: true, message: '请输入 Base URL' }]}>
                <Input placeholder="https://api.openai.com/v1" />
              </Form.Item>
              <Form.Item label="模型名称" name="model" rules={[{ required: true, message: '请选择或输入模型名称' }]}>
                <AutoComplete options={modelOptions} placeholder="选择或输入模型名称" filterOption />
              </Form.Item>
              <Form.Item label="API Key" name="apiKey">
                <Input.Password placeholder="留空表示不修改已保存的 Key" />
              </Form.Item>
              <div className="model-service-actions">
                <Button icon={<Cable size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={handleTestText} loading={testingText}>测试文本连接</Button>
                <Button type="primary" icon={<Save size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={() => saveSection('text')} loading={savingSection === 'text'}>保存文本推理</Button>
              </div>
            </div>
          </div>

          <div className="model-service-row">
            <div className="model-service-summary">
              <h3>图片生成</h3>
              <p>独立用于水货生产的图片生成。</p>
            </div>
            <div className="model-service-fields">
              <Form.Item label="API 提供商" name={['image', 'provider']}>
                <Select options={[{ label: 'OpenAI 兼容', value: 'openai_compatible' }]} disabled />
              </Form.Item>
              <Form.Item label="生图模式" name={['image', 'mode']}>
                <Select options={[{ label: 'OpenAI 兼容', value: 'openai_compatible' }, { label: '自定义（OpenAI 兼容）', value: 'custom' }]} onChange={mode => {
                  if (mode !== 'custom') form.setFieldValue(['image', 'displayName'], '');
                }} />
              </Form.Item>
              {imageMode === 'custom' ? <Form.Item label="供应商名称" name={['image', 'displayName']} rules={[{ required: true, whitespace: true, message: '请输入供应商名称' }]}>
                <Input placeholder="例如 My image gateway" maxLength={80} />
              </Form.Item> : null}
              <Form.Item label="Base URL" name={['image', 'baseUrl']} rules={[{ required: true, message: '请输入生图 Base URL' }]}>
                <Input placeholder="https://api.openai.com/v1" />
              </Form.Item>
              <Form.Item label="API Key" name={['image', 'apiKey']}>
                <Input.Password placeholder="留空表示不修改已保存的 Key" />
              </Form.Item>
              <Form.Item label="生图模型名称" name={['image', 'model']} rules={[{ required: true, message: '请输入生图模型名称' }]}>
                <Input placeholder="例如 gpt-image-1" />
              </Form.Item>
              <div className="model-service-actions">
                <Button icon={<Cable size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={handleTestImage} loading={testingImage}>测试生图连接</Button>
                <Button type="primary" icon={<Save size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={() => saveSection('image')} loading={savingSection === 'image'}>保存图片生成</Button>
              </div>
            </div>
          </div>

          <div className="model-service-row model-service-video-row">
            <div className="model-service-summary">
              <div className="model-service-title-line">
                <h3>视频生成</h3>
                <span className="model-service-provider">中转亚迪</span>
              </div>
              <p>固定的图生视频服务配置。</p>
            </div>
            <div className="model-service-video-fields">
              <Form.Item label="API Key" name={['video', 'apiKey']}>
                <Input.Password placeholder="留空表示不修改已保存的 Key" />
              </Form.Item>
              <div className="model-service-video-meta" aria-label="固定视频服务规格">
                <span>YD2.0 Mini</span>
                <span>720p</span>
                <span>1 秒</span>
                <span className={`model-service-key-status ${videoHasApiKey ? 'is-configured' : 'is-unconfigured'}`}>
                  {videoHasApiKey ? '已配置' : '未配置'}
                </span>
              </div>
              <Button type="primary" icon={<Save size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={() => saveSection('video')} loading={savingSection === 'video'}>保存视频生成</Button>
            </div>
          </div>

          <div className="model-service-row model-service-video-row">
            <div className="model-service-summary">
              <div className="model-service-title-line">
                <h3>豆包本地执行器</h3>
                <span className="model-service-provider">本机多账号渠道</span>
              </div>
              <p>账号登录状态只保存在用户电脑。完成配对后可保持在线，为后续视频任务提供本机执行通道。</p>
            </div>
            <div className="model-service-video-fields">
              <div className="model-service-video-meta" aria-label="本地执行器状态">
                <span>{localExecutors.length} 台已配对</span>
                <span className={`model-service-key-status ${localExecutors.some(item => item.online) ? 'is-configured' : 'is-unconfigured'}`}>
                  {localExecutors.some(item => item.online) ? '至少一台在线' : '暂无在线设备'}
                </span>
              </div>
              {pairing ? <Typography.Paragraph style={{ margin: 0 }}>
                在 Windows 客户端输入配对码：<Typography.Text copyable strong>{pairing.code}</Typography.Text>
              </Typography.Paragraph> : null}
              <div className="settings-action-row">
                <Button icon={<Download size={16} aria-hidden="true" />} href={localExecutorDownloads.mac} target="_blank" rel="noreferrer">下载 Mac 版</Button>
                <Button icon={<Download size={16} aria-hidden="true" />} href={localExecutorDownloads.windows} target="_blank" rel="noreferrer">下载 Windows 版</Button>
                <Button onClick={loadLocalExecutors} loading={loadingExecutors} icon={<RefreshCw size={16} aria-hidden="true" />}>刷新状态</Button>
                <Button type="primary" onClick={createLocalExecutorPairing}>生成配对码</Button>
              </div>
              {localExecutors.map(item => <Typography.Text key={item.id} type="secondary">
                {item.displayName} · 豆包 · {item.online ? '在线' : '离线'}
              </Typography.Text>)}
            </div>
          </div>
        </section>

        <section className="settings-section settings-model-section" aria-labelledby="settings-model-title">
          <div>
            <h2 id="settings-model-title">工作台与 CM</h2>
            <p>管理桌面宠物和工作完成提醒。</p>
          </div>
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
          <Button type="primary" icon={<Save size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={() => saveSection('workspace')} loading={savingSection === 'workspace'}>保存工作台与 CM</Button>
        </section>

        <section className="settings-section settings-storage-section" aria-labelledby="settings-storage-title">
          <div>
            <h2 id="settings-storage-title">本地存储文件夹</h2>
            <p>指定保存剧本、小说与制作工程的本地目录，留空表示关闭。</p>
          </div>
          <Form.Item label="存储文件夹" name="storageRoot" extra="必须是绝对路径；留空表示关闭本地存储。">
            <Input placeholder="例如 D:\我的小说工程" />
          </Form.Item>
          <div className="settings-storage-actions">
            <Button type="primary" icon={<Save size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={() => saveSection('storage')} loading={savingSection === 'storage'}>保存存储设置</Button>
            <Button icon={<RefreshCw size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={handleRestore} loading={restoring}>恢复</Button>
            <Button icon={<FolderOpen size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={handleList} loading={listing}>查看文件清单</Button>
          </div>
          {restoreReport && (
            <div style={{ marginTop: 16 }}>
              <Typography.Text strong>恢复报告</Typography.Text>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: 'var(--legacy-muted)', fontSize: 13, lineHeight: 1.7 }}>
                <li>剧本生成：找到 {restoreReport.scriptResults?.found ?? 0} 个，新并入历史 {restoreReport.scriptResults?.added ?? 0} 条</li>
                <li>小说获取：{restoreReport.novelFetch?.found ?? 0} 个文件</li>
                <li>改编小说：{restoreReport.novelAdapt?.found ?? 0} 个文件</li>
                <li>制作工程：{restoreReport.projects?.found ?? 0} 个项目</li>
              </ul>
              {Array.isArray(restoreReport.errors) && restoreReport.errors.length > 0 && (
                <Typography.Paragraph type="danger" style={{ margin: '8px 0 0', fontSize: 13 }}>错误：{restoreReport.errors.join('；')}</Typography.Paragraph>
              )}
            </div>
          )}
          {fileList && (
            <div style={{ marginTop: 16 }}>
              <Typography.Text strong>文件清单</Typography.Text>
              <List
                size="small"
                style={{ marginTop: 8 }}
                dataSource={[
                  { key: 'scriptResults', title: '剧本生成', files: fileList.scriptResults || [] },
                  { key: 'novelFetch', title: '小说获取', files: fileList.novelFetch || [] },
                  { key: 'novelAdapt', title: '改编小说', files: fileList.novelAdapt || [] },
                  { key: 'projects', title: '制作工程', projects: fileList.projects || [] }
                ]}
                renderItem={group => (
                  <List.Item>
                    <div style={{ width: '100%' }}>
                      <Typography.Text strong>{group.title}（{group.projects ? group.projects.length : group.files.length}）</Typography.Text>
                      <List
                        size="small"
                        dataSource={group.projects || group.files}
                        locale={{ emptyText: '（空）' }}
                        renderItem={item => (
                          <List.Item style={{ padding: '2px 0', borderBottom: 'none' }}>
                            {group.projects
                              ? `${item.name}/（${(item.files || []).length} 个文件）`
                              : `${item.name}（${item.size}B）`}
                          </List.Item>
                        )}
                      />
                    </div>
                  </List.Item>
                )}
              />
            </div>
          )}
        </section>

      </Form>
      </div>
    </div>
  );
}

export default SettingsPage;
