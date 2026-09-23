import { SettingOutlined } from '@ant-design/icons';
import { Alert, Button, Divider, Input, InputNumber, Modal, Segmented, Select, Space, Switch, Tabs, Tooltip, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { listAvailableModels } from '../../../shared/api/modelCatalog';
import { checkWebSubmitEnvironment, getWebSubmitConfig, saveWebSubmitConfig, syncWebSubmitConfigs, syncWebSubmitStyles, testWebSubmitVisible } from '../../../shared/api/novelFetch';
import {
  createAutomationPreset,
  deleteAutomationPreset,
  listAutomationPresets,
  listSystemPresetCatalog,
  updateAutomationPreset
} from '../../../shared/api/batchFactoryV11';
import { videoProviderForModel } from './videoProviderBinding';

const clone = value => JSON.parse(JSON.stringify(value || {}));
const normalizeLegacyPatch = value => {
  const patch = clone(value);
  delete patch.expectedRevision;
  if (!patch.patch || typeof patch.patch !== 'object' || Array.isArray(patch.patch)) return patch;
  const nested = normalizeLegacyPatch(patch.patch);
  delete patch.patch;
  return { ...nested, ...patch };
};
const DEFAULT_TTS = { voice: 'zh-CN-XiaoxiaoNeural', style: 'general', speed: 1.8, pitch: 10 };
const voices = [
  { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女声·温柔）' },
  { value: 'zh-CN-XiaochenNeural', label: '晓辰（女声·知性）' },
  { value: 'zh-CN-YunxiNeural', label: '云希（男声·清朗）' },
  { value: 'zh-CN-YunyangNeural', label: '云扬（男声·阳光）' }
];
const styles = ['general', 'cheerful', 'sad', 'friendly', 'chat'].map(value => ({ value, label: value === 'general' ? '通用' : value }));
const selectOption = preset => ({ value: preset.id, label: `${preset.name || preset.id} · v${preset.version || 1}` });
const presetValue = preset => preset ? { presetId: preset.id, presetName: preset.name || preset.id, presetSlot: preset.slot || '', presetVersion: preset.version || 1, constraintCategory: preset.constraintCategory || '' } : { presetId: '', presetName: '', presetSlot: '', presetVersion: null, constraintCategory: '' };
const TARGET_ADMIN_URL = 'http://two.121w.com/tttadmin/index.php';
const SESSION_CHECK_NAMES = ['视频管理系统登录会话', '121 后台登录会话'];

export function BatchFactoryEngineSettingsForm({ value, onChange, sections = ['models', 'audio', 'publish'], active = true }) {
  const [models, setModels] = useState([]);
  const [modelsError, setModelsError] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelReloadKey, setModelReloadKey] = useState(0);
  const patch = next => onChange({ ...value, ...next });
  const tts = { ...DEFAULT_TTS, ...(value.tts || {}) };
  const modelSettingsEnabled = sections.includes('models');
  const modelOptions = useMemo(() => {
    const asOptions = kind => models.filter(model => model.kind === kind).map(model => ({ value: model.id, label: model.displayName || model.name || model.modelId || model.id }));
    return { text: asOptions('text'), image: asOptions('image'), video: asOptions('video') };
  }, [models]);
  useEffect(() => {
    if (!active || !modelSettingsEnabled) return undefined;
    let alive = true;
    setModelsLoading(true);
    setModelsError('');
    Promise.all([
      listAvailableModels('text'),
      listAvailableModels('image'),
      listAvailableModels('video')
    ]).then(groups => {
      if (alive) setModels(groups.flat());
    }).catch(error => {
      if (!alive) return;
      setModels([]);
      setModelsError(error?.message || '未能读取个人中心已启用模型');
    }).finally(() => { if (alive) setModelsLoading(false); });
    return () => { alive = false; };
  }, [active, modelSettingsEnabled, modelReloadKey]);
  const publish = value.publishSettings || {};
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Alert type="info" showIcon message="当前批次统一生产参数" description="保存后作为全部小说的默认值；单书已保存的显式覆盖不会被预设载入或本页保存清空。" />
    {modelSettingsEnabled ? <><section className="batch-factory-engine-card"><header><b>模型配置</b><small>文本、图片、视频和配音</small></header><div className="batch-factory-engine-card-body batch-factory-engine-grid">
      <label className="batch-factory-engine-field"><span><b>文本模型</b></span><Select allowClear loading={modelsLoading} value={value.textModelId || undefined} options={modelOptions.text} placeholder="选择已启用文本模型" onChange={textModelId => patch({ textModelId: textModelId || '' })} /></label>
      <label className="batch-factory-engine-field"><span><b>图片模型</b></span><Select allowClear loading={modelsLoading} value={value.imageModelId || undefined} options={modelOptions.image} placeholder="选择已启用图片模型" onChange={imageModelId => patch({ imageModelId: imageModelId || '' })} /></label>
      <label className="batch-factory-engine-field"><span><b>视频模型</b></span><Select allowClear loading={modelsLoading} value={value.videoModelId || undefined} options={modelOptions.video} placeholder="选择已启用视频模型" onChange={videoModelId => patch({ videoModelId: videoModelId || '', ...(videoModelId ? { videoProvider: videoProviderForModel(videoModelId, value.videoProvider) } : {}) })} /></label>
      <label className="batch-factory-engine-field"><span><b>画幅</b></span><Segmented value={value.aspectRatio || '9:16'} options={['9:16', '16:9', '1:1']} onChange={aspectRatio => patch({ aspectRatio })} /></label>
      <label className="batch-factory-engine-field"><span><b>分镜时长</b></span><Segmented value={Number(value.storyboardDurationLimit) === 15 ? 15 : 10} options={[{ value: 10, label: '10 秒' }, { value: 15, label: '15 秒' }]} onChange={storyboardDurationLimit => patch({ storyboardDurationLimit, maxVideoDuration: storyboardDurationLimit })} /></label>
      <label className="batch-factory-engine-field"><span><b>配音音色</b></span><Select value={tts.voice} options={voices} onChange={voice => patch({ tts: { ...tts, voice } })} /></label>
      <label className="batch-factory-engine-field"><span><b>配音风格</b></span><Select value={tts.style} options={styles} onChange={style => patch({ tts: { ...tts, style } })} /></label>
      <label className="batch-factory-engine-field"><span><b>语速</b></span><InputNumber min={0.5} max={2} step={0.1} value={tts.speed} onChange={speed => patch({ tts: { ...tts, speed: speed ?? DEFAULT_TTS.speed } })} /></label>
    </div></section>
    {modelsError ? <Alert type="warning" showIcon message="模型目录暂不可用" description={<Space direction="vertical"><span>{modelsError}</span><Button size="small" onClick={() => setModelReloadKey(value => value + 1)}>重试读取模型</Button></Space>} /> : null}
    {!modelsLoading && !modelsError && !models.length ? <Alert type="warning" showIcon message="个人中心没有已启用模型" description={<Space direction="vertical"><span>请先在个人中心按文本、图片、视频类型新增并启用模型，再返回当前批量作品选择。</span><Button type="link" href="/api-config">前往个人中心配置模型</Button></Space>} /> : null}
    </> : null}
    {sections.includes('audio') ? <section className="batch-factory-engine-card"><header><b>跟随配音</b><small>开启后只测量没有有效缓存的视频原文非空行。</small></header><div className="batch-factory-engine-card-body"><Space direction="vertical" style={{ width: '100%' }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}><span>分镜规划跟随配音</span><Switch checked={value.audioPlanningEnabled === true} onChange={audioPlanningEnabled => patch({ audioPlanningEnabled })} /></Space>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}><span>合并跟随配音</span><Switch checked={value.audioMergeEnabled === true} onChange={audioMergeEnabled => patch({ audioMergeEnabled })} /></Space>
    </Space></div></section> : null}
    {sections.includes('publish') ? <section className="batch-factory-engine-card"><header><b>发布统一</b><small>视频管理系统的批量默认上传设置。</small></header><div className="batch-factory-engine-card-body batch-factory-engine-grid">
      <label className="batch-factory-engine-field"><span><b>网站配置档</b></span><Input value={publish.versionProfile || ''} placeholder="例如：女频短剧版" onChange={event => patch({ publishSettings: { ...publish, versionProfile: event.target.value } })} /></label>
      <label className="batch-factory-engine-field"><span><b>上传视频类型</b></span><Segmented value={publish.uploadVideoType || 'merged'} options={[{ value: 'merged', label: '合并成品' }, { value: 'individual', label: '独立 VIDEO' }]} onChange={uploadVideoType => patch({ publishSettings: { ...publish, uploadVideoType } })} /></label>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}><span>改文后上传</span><Switch checked={value.publishRewriteEnabled === true} onChange={publishRewriteEnabled => patch({ publishRewriteEnabled })} /></Space>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}><span>素材复用</span><Switch checked={publish.materialReuse === true} onChange={materialReuse => patch({ publishSettings: { ...publish, materialReuse } })} /></Space>
    </div></section> : null}
  </Space>;
}

function BatchFactoryPublishSettingsForm({ value, onChange, active }) {
  const [checking, setChecking] = useState(false);
  const [syncing, setSyncing] = useState('');
  const [account, setAccount] = useState(null);
  const [environment, setEnvironment] = useState(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const publish = value.publishSettings || {};
  const patch = next => onChange({ ...value, ...next });
  const hasSession = result => Boolean(result?.ok && (result?.checks || []).some(check => SESSION_CHECK_NAMES.includes(check.name) && check.ok));
  const checkDetail = (result, name) => String((result?.checks || []).find(check => check.name === name)?.detail || '').trim();
  const publishSessionReady = Boolean(environment?.session && environment?.visible?.ok);
  const loadAccount = async () => {
    const [config, result] = await Promise.all([getWebSubmitConfig(), checkWebSubmitEnvironment()]);
    setAccount(config?.settings || config?.config || {});
    setEnvironment({ environment: result, session: hasSession(result), visible: null });
  };
  const selfCheck = async () => {
    setChecking(true);
    try {
      const result = await checkWebSubmitEnvironment();
      const session = hasSession(result);
      const visible = session ? await testWebSubmitVisible() : null;
      const checked = { environment: result, session, visible };
      setEnvironment(checked);
      return checked;
    } catch (error) {
      const checked = { error: error?.message || '视频管理系统环境自检失败', session: false, visible: null };
      setEnvironment(checked);
      return checked;
    } finally { setChecking(false); }
  };
  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    loadAccount().catch(error => alive && setEnvironment({ error: error?.message || '无法读取视频管理系统状态', session: false, visible: null }));
    return () => { alive = false; };
  }, [active]);
  const login = async () => {
    if (!loginUsername.trim() || !loginPassword) return message.warning('请输入视频管理系统账号和密码');
    setLoginBusy(true);
    try {
      const saved = await saveWebSubmitConfig({ settings: { ...(account || {}), username: loginUsername.trim(), password: loginPassword } });
      setAccount(saved?.settings || { username: loginUsername.trim(), password_masked: true });
      setLoginPassword('');
      const checked = await selfCheck();
      if (!checked?.session || !checked.visible?.ok) throw new Error(checkDetail(checked?.environment, '121 后台登录会话') || checked?.error || '视频管理系统登录后验证未通过');
      setLoginOpen(false);
      message.success('视频管理系统已登录并完成验证');
    } catch (error) { message.error(error?.message || '视频管理系统登录失败'); }
    finally { setLoginBusy(false); }
  };
  const syncProfiles = async () => {
    if (!publishSessionReady) return message.warning('请先登录并验证视频管理系统');
    setSyncing('profiles');
    try {
      const result = await syncWebSubmitConfigs({ persist: false });
      patch({ publishSettings: { ...publish, websiteProfiles: Array.isArray(result?.groups) ? result.groups : [] } });
    } catch (error) { message.error(error?.message || '同步网站配置档失败'); }
    finally { setSyncing(''); }
  };
  const syncStyles = async () => {
    if (!publishSessionReady) return message.warning('请先登录并验证视频管理系统');
    setSyncing('styles');
    try {
      const result = await syncWebSubmitStyles({ persist: false });
      const styles = Array.isArray(result?.settings?.style_catalog) ? result.settings.style_catalog : (Array.isArray(result?.styles) ? result.styles : []);
      patch({ publishSettings: { ...publish, websiteStyleCatalog: styles } });
    } catch (error) { message.error(error?.message || '同步风格目录失败'); }
    finally { setSyncing(''); }
  };
  return <><Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Alert type="info" showIcon message="批量默认发布规则" description="这里维护视频管理系统连接、网站配置映射和上传素材规则；单书配置可覆盖默认值。" />
    <section className="batch-factory-vms-connection-card"><div className="batch-factory-vms-main"><div className="batch-factory-vms-icon" aria-hidden="true">▣</div><div className="batch-factory-vms-copy"><div className="batch-factory-vms-title-row"><b>视频管理系统</b><span>{publishSessionReady ? '已登录并验证' : account?.username ? '待重新验证' : '未登录'}</span></div><div className="batch-factory-vms-meta"><span>当前账号</span><strong>{account?.username || '尚未登录'}</strong></div><div className="batch-factory-vms-meta"><span>后台地址</span><a href={TARGET_ADMIN_URL} target="_blank" rel="noreferrer">two.121w.com/tttadmin</a></div></div></div><div className="batch-factory-vms-actions"><Button href={TARGET_ADMIN_URL} target="_blank">打开后台</Button><Button onClick={() => { setLoginUsername(String(account?.username || '').trim()); setLoginPassword(''); setLoginOpen(true); }}>{account?.username ? '更换账号' : '登录并验证'}</Button><Button onClick={selfCheck} loading={checking}>{account?.username ? '重新验证' : '环境自检'}</Button></div></section>
    <div className="batch-factory-publish-two-column"><section className="batch-factory-engine-card"><header><b>发布映射</b><small>同步真实后台配置后，绑定到当前批量作品。</small></header><div className="batch-factory-engine-card-body"><label className="batch-factory-engine-field"><span><b>网站配置档</b></span><Select allowClear showSearch value={publish.websiteProfileId || undefined} options={(publish.websiteProfiles || []).map(profile => ({ value: profile.id, label: profile.name || profile.id }))} placeholder="同步网站配置档后选择" onChange={websiteProfileId => { const profile = (publish.websiteProfiles || []).find(item => item.id === websiteProfileId) || {}; patch({ publishSettings: { ...publish, websiteProfileId: websiteProfileId || '', versionProfile: profile.name || '' } }); }} /></label><div className="batch-factory-publish-sync-row"><Button disabled={!publishSessionReady} onClick={syncProfiles} loading={syncing === 'profiles'}>同步网站配置档</Button><Button disabled={!publishSessionReady} onClick={syncStyles} loading={syncing === 'styles'}>同步风格目录</Button></div><div className="batch-factory-publish-ai-note"><b>男女频 / 风格 / 标签</b><span>提交时按每本书的已保存结果或 AI 判断结果处理。</span></div></div></section>
      <section className="batch-factory-engine-card"><header><b>批量默认上传规则</b><small>这些规则可被单书发布设置覆盖。</small></header><div className="batch-factory-engine-card-body"><label className="batch-factory-engine-field"><span><b>上传视频类型</b></span><Segmented value={publish.uploadVideoType || 'merged'} options={[{ value: 'merged', label: '合并成品' }, { value: 'individual', label: '独立 VIDEO' }]} onChange={uploadVideoType => patch({ publishSettings: { ...publish, uploadVideoType } })} /></label><div className="batch-factory-publish-rule-list"><section><div><b>素材复用</b></div><Switch checked={publish.materialReuse === true} onChange={materialReuse => patch({ publishSettings: { ...publish, materialReuse } })} /></section><section><div><b>水平翻转</b></div><Switch checked={publish.horizontalFlip === true} onChange={horizontalFlip => patch({ publishSettings: { ...publish, horizontalFlip } })} /></section><section><div><b>改文后上传</b></div><Switch checked={value.publishRewriteEnabled === true} onChange={publishRewriteEnabled => patch({ publishRewriteEnabled })} /></section></div></div></section></div>
    <section className="batch-factory-engine-card"><header><b>连接与环境状态</b><small>登录、后台页面和直接接口均需可用。</small></header><div className="batch-factory-engine-card-body"><div className="batch-factory-env-status-row"><div><b>登录会话</b><span>{environment ? (environment.session ? '已登录' : '未登录 / 已失效') : '等待检查'}</span><small>{checkDetail(environment?.environment, '121 后台登录会话')}</small></div><div><b>后台页面</b><span>{environment?.visible ? (environment.visible.ok ? '可访问' : '验证未通过') : '等待检查'}</span></div><div><b>直接接口</b><span>{checkDetail(environment?.environment, '121 直接接口') || '等待检查'}</span></div><Button onClick={selfCheck} loading={checking}>重新检查</Button></div>{environment?.error ? <Alert type="error" showIcon message="视频管理系统环境自检失败" description={environment.error} /> : null}</div></section>
  </Space>
  <Modal title={account?.username ? '更换视频管理系统账号' : '登录视频管理系统'} open={loginOpen} onCancel={() => { setLoginPassword(''); setLoginOpen(false); }} onOk={login} confirmLoading={loginBusy} okText="登录并验证" destroyOnClose><Space direction="vertical" size={12} style={{ width: '100%' }}><Input value={loginUsername} autoComplete="username" placeholder="视频管理系统账号" onChange={event => setLoginUsername(event.target.value)} /><Input.Password value={loginPassword} autoComplete="current-password" placeholder="视频管理系统密码" onChange={event => setLoginPassword(event.target.value)} /><a href={TARGET_ADMIN_URL} target="_blank" rel="noreferrer">打开视频管理系统后台</a></Space></Modal>
  </>;
}

export function BatchFactoryAiReasoningForm({ value, onChange }) {
  const [catalog, setCatalog] = useState([]);
  const config = value && typeof value === 'object' ? value : {};
  const assets = config.assets || {};
  const constraints = config.constraints || {};
  const derivedOpening = config.derivedOpening || {};
  const video = config.video || {};
  const visual = config.visual || {};
  useEffect(() => {
    let active = true;
    Promise.all([listSystemPresetCatalog('script'), listSystemPresetCatalog('batch-factory')]).then(results => {
      if (active) setCatalog(results.flatMap(result => Array.isArray(result?.catalog) ? result.catalog : []));
    }).catch(() => active && setCatalog([]));
    return () => { active = false; };
  }, []);
  const bySlot = slot => catalog.filter(item => item.slot === slot).map(selectOption);
  const bySlots = slots => catalog.filter(item => slots.includes(item.slot)).map(selectOption);
  const byConstraint = category => catalog.filter(item => item.kind === 'addon' && item.constraintCategory === category).map(selectOption);
  const updateConstraint = (category, presetId) => {
    const selected = catalog.find(item => item.id === presetId);
    const rest = (constraints.selections || []).filter(item => item.constraintCategory !== category);
    onChange({ ...config, constraints: { ...constraints, enabled: true, enabledCategories: [...new Set([...(constraints.enabledCategories || []), category])], selections: selected ? [...rest, presetValue(selected)] : rest } });
  };
  const selectedConstraint = category => (constraints.selections || []).find(item => item.constraintCategory === category)?.presetId;
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Alert type="info" showIcon message="AI 推理" description="选择规则后，资产提取、智能统一、导演分镜和最终 Prompt 都共用同一份批量草稿。" />
    <section className="batch-factory-engine-card"><header><b>资产设置</b><small>H3 选项会按名单、事实、关系和全部人物外形的两次调用运行。</small></header><div className="batch-factory-engine-card-body">
      <label className="batch-factory-engine-field"><span><b>人物场景道具提示词</b></span><Select allowClear value={assets.extraction?.presetId || undefined} options={bySlot('script.asset-extraction')} placeholder="选择已发布预设词" onChange={presetId => onChange({ ...config, assets: { ...assets, enabled: true, extraction: presetValue(catalog.find(item => item.id === presetId)) } })} /></label>
    </div></section>
    <section className="batch-factory-engine-card"><header><b>约束设置</b><small>智能统一只有这里的画面前缀入口；基础设定和画面限制只控制最终注入层。</small></header><div className="batch-factory-engine-card-body batch-factory-engine-grid">
      <label className="batch-factory-engine-field"><span><b>画面前缀词（智能统一）</b></span><Select allowClear value={selectedConstraint('prefix')} options={byConstraint('prefix')} placeholder="选择系统预设" onChange={presetId => updateConstraint('prefix', presetId)} /></label>
      <label className="batch-factory-engine-field"><span><b>画面限制</b></span><Select allowClear value={selectedConstraint('restriction')} options={byConstraint('restriction')} placeholder="选择系统预设" onChange={presetId => updateConstraint('restriction', presetId)} /></label>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}><span>基础设定</span><Switch checked={constraints.baseSetup?.enabled !== false} onChange={enabled => onChange({ ...config, constraints: { ...constraints, baseSetup: { enabled } } })} /></Space>
    </div></section>
    <section className="batch-factory-engine-card"><header><b>视频设置</b><small>视频提示词决定结构化导演分镜的输出规则与最终模板。</small></header><div className="batch-factory-engine-card-body">
      <label className="batch-factory-engine-field"><span><b>衍生开篇</b></span><Select allowClear value={derivedOpening.presetId || undefined} options={bySlots(['batch.hook-adaptation', 'batch.original-director', 'batch.viral-director'])} placeholder="选择已发布衍生开篇提示词" onChange={presetId => onChange({ ...config, derivedOpening: { ...derivedOpening, ...presetValue(catalog.find(item => item.id === presetId)), enabled: Boolean(presetId) } })} /></label>
      <label className="batch-factory-engine-field"><span><b>视频提示词</b></span><Select value={video.presetId || undefined} options={bySlot('batch.video-meta')} placeholder="选择已发布视频提示词" onChange={presetId => onChange({ ...config, video: { ...video, ...presetValue(catalog.find(item => item.id === presetId)), enabled: true } })} /></label>
      <label className="batch-factory-engine-field"><span><b>画面提示词</b></span><Select allowClear value={visual.presetId || undefined} options={bySlot('batch.visual-meta')} placeholder="选择已发布画面提示词" onChange={presetId => onChange({ ...config, visual: { ...visual, ...presetValue(catalog.find(item => item.id === presetId)) } })} /></label>
    </div></section>
  </Space>;
}

export function BatchFactoryUnifiedSettingsModal({ open, batch, onClose, onSaved }) {
  const [draftPatch, setDraftPatch] = useState({});
  const [saving, setSaving] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [presets, setPresets] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presetBusy, setPresetBusy] = useState(false);
  const selectedPreset = presets.find(item => item.id === selectedPresetId);
  useEffect(() => {
    if (open) setDraftPatch(normalizeLegacyPatch(batch?.settingsState?.patch));
  }, [open, batch?.id, batch?.settingsState?.revision]);
  const loadPresets = async () => {
    const result = await listAutomationPresets();
    const values = Array.isArray(result?.presets) ? result.presets : [];
    setPresets(values);
    return values;
  };
  const openPresetManager = async () => {
    try { await loadPresets(); setPresetOpen(true); }
    catch (error) { message.error(error?.message || '读取自动化预设失败'); }
  };
  const clonePresetConfig = clone(selectedPreset?.config);
  const loadPreset = () => {
    if (!selectedPreset) return message.warning('请先选择自动化预设');
    Modal.confirm({ title: '确认载入此预设', content: '它只替换当前统一配置草稿；点击主弹窗的“保存统一配置”后才会写入批量。', okText: '载入草稿', onOk: () => setDraftPatch(clonePresetConfig) });
  };
  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return message.warning('请填写预设名称');
    setPresetBusy(true);
    try { const result = await createAutomationPreset({ name, config: draftPatch }); const saved = result?.preset || result; await loadPresets(); setSelectedPresetId(saved?.id || ''); setPresetName(''); message.success('已保存自动化预设。'); }
    catch (error) { message.error(error?.message || '保存自动化预设失败'); }
    finally { setPresetBusy(false); }
  };
  const renamePreset = async () => {
    if (!selectedPreset) return message.warning('请先选择自动化预设');
    const name = presetName.trim();
    if (!name) return message.warning('请填写新的预设名称');
    setPresetBusy(true);
    try { await updateAutomationPreset(selectedPreset.id, { name, config: selectedPreset.config, expectedVersion: selectedPreset.version }); await loadPresets(); setPresetName(''); message.success('自动化预设已重命名。'); }
    catch (error) { message.error(error?.message || '重命名自动化预设失败'); }
    finally { setPresetBusy(false); }
  };
  const removePreset = () => {
    if (!selectedPreset) return message.warning('请先选择自动化预设');
    Modal.confirm({ title: '删除所选预设', content: `删除“${selectedPreset.name}”不会影响已经排期或执行中的任务。`, okText: '删除', okButtonProps: { danger: true }, onOk: async () => { await deleteAutomationPreset(selectedPreset.id); setSelectedPresetId(''); await loadPresets(); } });
  };
  const save = async () => {
    setSaving(true);
    try { const result = await onSaved(draftPatch); if (result !== false) onClose(); }
    finally { setSaving(false); }
  };
  return <><Modal title={<Space><Tooltip title="自动化预设"><Button type="text" icon={<SettingOutlined />} aria-label="自动化预设" onClick={openPresetManager} /></Tooltip><span>统一配置</span></Space>} open={open} onCancel={onClose} width={980} destroyOnClose={false} className="batch-factory-unified-settings-modal" footer={<Space><Button onClick={onClose}>取消</Button><Button type="primary" loading={saving} onClick={save}>保存统一配置</Button></Space>}>
    <Tabs items={[
      { key: 'models', label: '模型配置', children: <BatchFactoryEngineSettingsForm value={draftPatch} onChange={setDraftPatch} sections={['models', 'audio']} active={open} /> },
      { key: 'reasoning', label: 'AI 推理', children: <BatchFactoryAiReasoningForm value={draftPatch.aiPromptConfig} onChange={aiPromptConfig => setDraftPatch(current => ({ ...current, aiPromptConfig }))} /> },
      { key: 'publish', label: '发布统一', children: <BatchFactoryPublishSettingsForm value={draftPatch} onChange={setDraftPatch} active={open} /> }
    ]} />
  </Modal>
  <Modal title="自动化预设" open={presetOpen} onCancel={() => setPresetOpen(false)} footer={null} width={620} destroyOnClose><Space direction="vertical" size={14} style={{ width: '100%' }}>
    <Alert type="info" showIcon message="预设只保存统一配置" description="不保存正文、资产、导演结果或视频结果；载入后仍须保存统一配置才会应用到当前批量。" />
    <label className="batch-factory-engine-field"><span><b>已保存预设</b></span><Select allowClear value={selectedPresetId || undefined} onChange={setSelectedPresetId} placeholder="选择自动化预设" options={presets.map(item => ({ value: item.id, label: `${item.name} · v${item.version}` }))} /></label>
    <Space wrap><Button disabled={!selectedPreset} onClick={loadPreset}>载入预设</Button></Space>
    <Divider />
    <label className="batch-factory-engine-field"><span><b>{selectedPreset ? '预设新名称' : '新预设名称'}</b></span><Input value={presetName} maxLength={255} placeholder={selectedPreset?.name || '例如：女频 H3 全自动'} onChange={event => setPresetName(event.target.value)} /></label>
    <Space wrap><Button type="primary" loading={presetBusy} onClick={savePreset}>保存为新预设</Button><Button disabled={!selectedPreset} loading={presetBusy} onClick={renamePreset}>重命名所选预设</Button><Button danger disabled={!selectedPreset} onClick={removePreset}>删除所选预设</Button></Space>
  </Space></Modal></>;
}
