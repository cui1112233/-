import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Modal, Popover, Select, Switch, Tag } from 'antd';
import { Pencil, RefreshCw, RotateCcw } from 'lucide-react';
import { getBatchFactoryPromptCatalog } from '../../../shared/api/batchFactory';
import { listModels } from '../../../shared/api/shuihuoProduction';

const OVERRIDE_KEYS = Object.freeze([
  'aspectRatio',
  'prefixMode',
  'customPrefix',
  'prefixEnabled',
  'injectCharacterPrompt',
  'injectScenePrompt',
  'injectPropPrompt',
  'quality',
  'qualityEnabled',
  'restriction',
  'restrictionEnabled',
  'negative',
  'negativeEnabled',
  'subtitlePolicy'
]);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { hour12: false });
}

function snapshotFields(snapshot) {
  if (!snapshot) return {};
  return {
    systemConfigRevision: snapshot.revision || '',
    systemConfigLabel: snapshot.label || '',
    systemConfigSyncedAt: new Date().toISOString(),
    systemPresetVersions: { ...(snapshot.presetVersions || {}) }
  };
}

function promptDefaults(settings = {}) {
  return {
    aspectRatio: settings.aspectRatio === '16:9' ? '16:9' : '9:16',
    prefixMode: settings.prefixMode === 'manual' ? 'manual' : 'auto',
    customPrefix: settings.customPrefix || '',
    prefixEnabled: settings.prefixEnabled !== false,
    injectCharacterPrompt: settings.injectCharacterPrompt !== false,
    injectScenePrompt: settings.injectScenePrompt !== false,
    injectPropPrompt: settings.injectPropPrompt !== false,
    quality: settings.quality || '',
    qualityEnabled: settings.qualityEnabled !== false,
    restriction: settings.restriction || '',
    restrictionEnabled: settings.restrictionEnabled !== false,
    negative: settings.negative || '',
    negativeEnabled: settings.negativeEnabled !== false,
    subtitlePolicy: settings.subtitlePolicy === 'allow' ? 'allow' : 'forbid-auto-dialogue-subtitle'
  };
}

export function mergePromptSettings(parent = {}, override = {}) {
  const next = { ...promptDefaults(parent) };
  for (const key of OVERRIDE_KEYS) {
    if (hasOwn(override, key) && override[key] !== 'inherit') next[key] = override[key];
  }
  return next;
}

function ConstraintEditor({ title, value, placeholder, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  return <Popover
    open={open}
    onOpenChange={setOpen}
    trigger="click"
    placement="left"
    content={<div className="bf-settings-popover">
      <strong>{title}</strong>
      <Input.TextArea rows={5} value={value || ''} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
      <Button type="primary" size="small" onClick={() => setOpen(false)}>完成</Button>
    </div>}
  >
    <Button size="small" type="text" icon={<Pencil size={13} />} disabled={disabled}>编辑</Button>
  </Popover>;
}

function ConstraintRow({ label, description, enabled, onEnabledChange, value, onValueChange, placeholder }) {
  return <div className="bf-settings-row">
    <div className="bf-settings-row-copy"><strong>{label}</strong><small>{description}</small></div>
    <div className="bf-settings-row-actions">
      <Switch size="small" checked={enabled} onChange={onEnabledChange} />
      {onValueChange ? <ConstraintEditor title={label} value={value} onChange={onValueChange} placeholder={placeholder} disabled={!enabled} /> : null}
    </div>
  </div>;
}

function VersionCard({ catalog, local, onSelect, onSync }) {
  const versions = [...(catalog?.configVersions || [])].reverse();
  const latest = catalog?.latestConfig || null;
  const upToDate = Boolean(latest?.revision && local.systemConfigRevision === latest.revision);
  return <div className="bf-settings-version-card">
    <div className="bf-settings-version-head">
      <div><strong>配置版本</strong><small>冻结当前批次使用的后台批量工厂 Prompt 版本，后台后续发布不会静默改变本批次。</small></div>
      {upToDate ? <Tag color="green">后台最新</Tag> : <Tag color="gold">可同步</Tag>}
    </div>
    <Select
      loading={!catalog}
      value={local.systemConfigRevision || undefined}
      placeholder="选择配置版本"
      onChange={onSelect}
      options={versions.map(snapshot => ({ value: snapshot.revision, label: `${snapshot.label}${snapshot.publishedAt ? ` · ${formatDate(snapshot.publishedAt)}` : ''}` }))}
    />
    <div className="bf-settings-version-meta">
      <span>当前：{local.systemConfigLabel || '未冻结'}</span>
      {local.systemConfigSyncedAt ? <span>同步：{formatDate(local.systemConfigSyncedAt)}</span> : null}
    </div>
    <Button icon={<RefreshCw size={14} />} disabled={!latest || upToDate} onClick={onSync}>同步批量后台配置</Button>
  </div>;
}

export function UnifiedProductionSettingsModal({ open, settings, onClose, onSave, saving }) {
  const [local, setLocal] = useState({});
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState('');
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelError, setModelError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLocal({ ...promptDefaults(settings), ...settings });
    setCatalogError('');
    setModelError('');
    setModelsLoading(true);
    getBatchFactoryPromptCatalog().then(result => {
      if (!active) return;
      setCatalog(result);
      setLocal(current => current.systemConfigRevision || !result.latestConfig ? current : { ...current, ...snapshotFields(result.latestConfig) });
    }).catch(error => active && setCatalogError(error.message || '读取配置版本失败'));
    listModels().then(result => {
      if (!active) return;
      const available = (result.models || []).filter(model => (
        model.kind === 'video'
        && model.requiresImageInput !== true
        && Number(model.maxVideoDuration) >= 1
      ));
      setModels(available);
    }).catch(error => active && setModelError(error.message || '读取视频模型失败'))
      .finally(() => active && setModelsLoading(false));
    return () => { active = false; };
    // Only reinitialize when the modal is opened. Batch polling replaces the
    // settings object every few seconds and must not wipe unsaved user edits.
  }, [open]);

  const set = (key, value) => setLocal(current => ({ ...current, [key]: value }));
  const selectModel = modelId => {
    const model = models.find(entry => Number(entry.id) === Number(modelId));
    if (!model) return;
    setLocal(current => ({
      ...current,
      videoModelId: model.id,
      videoModelVersionId: model.versionId,
      videoModelName: model.name,
      maxVideoDuration: Number(model.maxVideoDuration)
    }));
  };
  const selectSnapshot = revision => {
    const snapshot = catalog?.configVersions?.find(entry => entry.revision === revision);
    if (snapshot) setLocal(current => ({ ...current, ...snapshotFields(snapshot) }));
  };
  const syncLatest = () => {
    const latest = catalog?.latestConfig;
    if (!latest) return;
    Modal.confirm({
      title: `同步到 ${latest.label}`,
      content: '只更新当前批次冻结的后台 Prompt 版本。当前小说和单 VIDEO 的手动覆盖不会被清除。',
      okText: '同步到最新',
      cancelText: '取消',
      onOk: () => setLocal(current => ({ ...current, ...snapshotFields(latest) }))
    });
  };

  return <Modal title="生产统一设置" open={open} onCancel={onClose} width={720} footer={null} destroyOnClose>
    <div className="bf-settings-modal">
      {catalogError ? <Alert type="warning" showIcon message={catalogError} /> : null}
      {modelError ? <Alert type="warning" showIcon message={modelError} description="视频模型仍沿用个人中心 / 模型中心配置；请确认对应模型已经配置密钥。" /> : null}
      <VersionCard catalog={catalog} local={local} onSelect={selectSnapshot} onSync={syncLatest} />

      <section className="bf-settings-section">
        <div className="bf-settings-section-title">基础生产设置</div>
        <div className="bf-settings-two-col">
          <label>视频模型<Select
            showSearch
            optionFilterProp="label"
            loading={modelsLoading}
            value={local.videoModelId || undefined}
            placeholder="选择视频模型"
            onChange={selectModel}
            options={models.map(model => ({ value: model.id, label: `${model.name} · 最大 ${model.maxVideoDuration}s` }))}
          /><small>沿用个人中心 / 模型中心的视频模型配置；对应密钥仍在原配置入口维护。</small></label>
          <label>视频画幅<Select value={local.aspectRatio || '9:16'} onChange={value => set('aspectRatio', value)} options={[{ value: '9:16', label: '9:16（竖屏）' }, { value: '16:9', label: '16:9（横屏）' }]} /></label>
          <label>剧本 Prompt<Select value={local.scriptPromptPresetId || 'standard-short-drama'} onChange={value => set('scriptPromptPresetId', value)} options={(catalog?.scriptPrompts || []).map(item => ({ value: item.id, label: `${item.name} · v${item.version}` }))} /></label>
          <label>人物 / 场景 Prompt<Select value={local.assetPromptPresetId || 'standard-asset-extraction'} onChange={value => set('assetPromptPresetId', value)} options={(catalog?.assetPrompts || []).map(item => ({ value: item.id, label: `${item.name} · v${item.version}` }))} /></label>
        </div>
        <div className="bf-settings-row">
          <div className="bf-settings-row-copy"><strong>固定单 VIDEO</strong><small>开启后整段输入最终只输出 1 个 VIDEO；VIDEO 内仍可包含多个 shot，时长严格等于模型当前上限。</small></div>
          <Switch checked={local.fixedSingleVideo === true} onChange={checked => set('fixedSingleVideo', checked)} />
        </div>
        <div className="bf-settings-two-col">
          <label>前缀模式<Select value={local.prefixMode || 'auto'} onChange={value => set('prefixMode', value)} options={[{ value: 'auto', label: 'AI 自动判断 + 可追加统一前缀' }, { value: 'manual', label: '只使用统一手动前缀' }]} /></label>
          <label>字幕策略<Select value={local.subtitlePolicy || 'forbid-auto-dialogue-subtitle'} onChange={value => set('subtitlePolicy', value)} options={[{ value: 'forbid-auto-dialogue-subtitle', label: '禁止自动对白字幕' }, { value: 'allow', label: '允许视频模型生成字幕' }]} /></label>
        </div>
      </section>

      <section className="bf-settings-section">
        <div className="bf-settings-section-title">约束设置</div>
        <ConstraintRow label="画面前缀词" description={local.prefixMode === 'manual' ? '统一手动前缀会直接加入每个 VIDEO。' : 'AI 会先判断题材前缀，再追加这里的统一前缀。'} enabled={local.prefixEnabled !== false} onEnabledChange={checked => set('prefixEnabled', checked)} value={local.customPrefix || ''} onValueChange={value => set('customPrefix', value)} placeholder="例如：电影级动漫短剧，强情绪表演，动态镜头……" />
        <ConstraintRow label="人物 Prompt" description="把当前 VIDEO 引用的人物设定动态注入视频模型。" enabled={local.injectCharacterPrompt !== false} onEnabledChange={checked => set('injectCharacterPrompt', checked)} />
        <ConstraintRow label="场景 Prompt" description="把当前 VIDEO 引用的场景设定动态注入视频模型。" enabled={local.injectScenePrompt !== false} onEnabledChange={checked => set('injectScenePrompt', checked)} />
        <ConstraintRow label="道具 Prompt" description="把当前 VIDEO 引用的道具设定动态注入视频模型。" enabled={local.injectPropPrompt !== false} onEnabledChange={checked => set('injectPropPrompt', checked)} />
        <ConstraintRow label="画质约束" description="只在编译最终 VIDEO Prompt 时注入，不写死进剧情描述。" enabled={local.qualityEnabled !== false} onEnabledChange={checked => set('qualityEnabled', checked)} value={local.quality || ''} onValueChange={value => set('quality', value)} placeholder="8K超清、电影级光影、高细节……" />
        <ConstraintRow label="画面限制" description="限制水印、变形、无关文字等画面问题。" enabled={local.restrictionEnabled !== false} onEnabledChange={checked => set('restrictionEnabled', checked)} value={local.restriction || ''} onValueChange={value => set('restriction', value)} placeholder="禁止无关文字、禁止畸形手部、禁止画面水印……" />
        <ConstraintRow label="负面提示词" description="作为最终视频请求的负面约束动态注入。" enabled={local.negativeEnabled !== false} onEnabledChange={checked => set('negativeEnabled', checked)} value={local.negative || ''} onValueChange={value => set('negative', value)} placeholder="低清、模糊、畸形、重复人物……" />
      </section>

      <Button type="primary" block loading={saving} onClick={() => onSave(local)}>保存并应用到当前批次</Button>
    </div>
  </Modal>;
}

function OverrideState({ overridden, onRestore }) {
  return overridden
    ? <div className="bf-settings-override-state"><Tag color="purple">当前层已覆盖</Tag><Button size="small" type="link" icon={<RotateCcw size={12} />} onClick={onRestore}>恢复继承</Button></div>
    : <Tag>继承上一级</Tag>;
}

function ScopedBooleanRow({ label, description, field, parent, local, onSet, onRestore }) {
  const overridden = hasOwn(local, field);
  const effective = overridden ? local[field] : parent[field];
  return <div className="bf-settings-row">
    <div className="bf-settings-row-copy"><strong>{label}</strong><small>{description}</small><OverrideState overridden={overridden} onRestore={() => onRestore(field)} /></div>
    <Switch size="small" checked={effective !== false} onChange={checked => onSet(field, checked)} />
  </div>;
}

function ScopedConstraintRow({ label, description, enabledField, textField, parent, local, onSet, onRestore, placeholder }) {
  const enabledOverride = hasOwn(local, enabledField);
  const textOverride = hasOwn(local, textField);
  const enabled = enabledOverride ? local[enabledField] : parent[enabledField];
  const textValue = textOverride ? local[textField] : parent[textField];
  return <div className="bf-settings-row">
    <div className="bf-settings-row-copy">
      <strong>{label}</strong><small>{description}</small>
      <OverrideState overridden={enabledOverride || textOverride} onRestore={() => { onRestore(enabledField); onRestore(textField); }} />
    </div>
    <div className="bf-settings-row-actions">
      <Switch size="small" checked={enabled !== false} onChange={checked => onSet(enabledField, checked)} />
      <ConstraintEditor title={label} value={textValue || ''} onChange={value => onSet(textField, value)} placeholder={placeholder} disabled={enabled === false} />
    </div>
  </div>;
}

function ScopedSettingsEditor({ parentSettings, override, onChange, setInheritKeys }) {
  const parent = promptDefaults(parentSettings);
  const local = override;
  const setField = (field, value) => {
    onChange(current => ({ ...current, [field]: value }));
    setInheritKeys(current => current.filter(key => key !== field));
  };
  const restore = field => {
    onChange(current => { const next = { ...current }; delete next[field]; return next; });
    setInheritKeys(current => current.includes(field) ? current : [...current, field]);
  };

  return <>
    <div className="bf-settings-two-col">
      <label>视频画幅<Select value={hasOwn(local, 'aspectRatio') ? local.aspectRatio : 'inherit'} onChange={value => value === 'inherit' ? restore('aspectRatio') : setField('aspectRatio', value)} options={[{ value: 'inherit', label: `继承 · ${parent.aspectRatio}` }, { value: '9:16', label: '覆盖为 9:16' }, { value: '16:9', label: '覆盖为 16:9' }]} /></label>
      <label>前缀模式<Select value={hasOwn(local, 'prefixMode') ? local.prefixMode : 'inherit'} onChange={value => value === 'inherit' ? restore('prefixMode') : setField('prefixMode', value)} options={[{ value: 'inherit', label: `继承 · ${parent.prefixMode === 'manual' ? '手动' : 'AI自动'}` }, { value: 'auto', label: '覆盖为 AI 自动' }, { value: 'manual', label: '覆盖为统一手动' }]} /></label>
    </div>
    <ScopedConstraintRow label="画面前缀词" description="只覆盖这一层的前缀开关/附加词。" enabledField="prefixEnabled" textField="customPrefix" parent={parent} local={local} onSet={setField} onRestore={restore} placeholder="当前层专用画面前缀……" />
    <ScopedBooleanRow label="人物 Prompt" description="当前层是否注入人物设定。" field="injectCharacterPrompt" parent={parent} local={local} onSet={setField} onRestore={restore} />
    <ScopedBooleanRow label="场景 Prompt" description="当前层是否注入场景设定。" field="injectScenePrompt" parent={parent} local={local} onSet={setField} onRestore={restore} />
    <ScopedBooleanRow label="道具 Prompt" description="当前层是否注入道具设定。" field="injectPropPrompt" parent={parent} local={local} onSet={setField} onRestore={restore} />
    <ScopedConstraintRow label="画质约束" description="当前层专用画质要求。" enabledField="qualityEnabled" textField="quality" parent={parent} local={local} onSet={setField} onRestore={restore} placeholder="当前层画质约束……" />
    <ScopedConstraintRow label="画面限制" description="当前层专用画面限制。" enabledField="restrictionEnabled" textField="restriction" parent={parent} local={local} onSet={setField} onRestore={restore} placeholder="当前层画面限制……" />
    <ScopedConstraintRow label="负面提示词" description="当前层专用负面词。" enabledField="negativeEnabled" textField="negative" parent={parent} local={local} onSet={setField} onRestore={restore} placeholder="当前层负面提示词……" />
    <div className="bf-settings-two-col">
      <label>字幕策略<Select value={hasOwn(local, 'subtitlePolicy') ? local.subtitlePolicy : 'inherit'} onChange={value => value === 'inherit' ? restore('subtitlePolicy') : setField('subtitlePolicy', value)} options={[{ value: 'inherit', label: `继承 · ${parent.subtitlePolicy === 'allow' ? '允许字幕' : '禁止自动对白字幕'}` }, { value: 'forbid-auto-dialogue-subtitle', label: '覆盖为禁止自动对白字幕' }, { value: 'allow', label: '覆盖为允许字幕' }]} /></label>
    </div>
  </>;
}

function LayeredSettingsModal({ title, subtitle, open, parentSettings, initialOverride, onClose, onSave, saving, extraHeader }) {
  const [local, setLocal] = useState({});
  const [inheritKeys, setInheritKeys] = useState([]);

  useEffect(() => {
    if (!open) return;
    setLocal({ ...(initialOverride || {}) });
    setInheritKeys([]);
    // Do not depend on initialOverride: background polling returns a new item
    // object and must not reset edits while this modal stays open.
  }, [open]);

  return <Modal title={title} open={open} onCancel={onClose} width={660} footer={null} destroyOnClose>
    <div className="bf-settings-modal">
      <div className="bf-settings-layer-head"><div><strong>{subtitle}</strong><small>只保存真正修改过的字段；“恢复继承”会删除 override，之后继续跟随上一级变化。</small></div>{extraHeader}</div>
      <ScopedSettingsEditor parentSettings={parentSettings} override={local} onChange={setLocal} setInheritKeys={setInheritKeys} />
      <Button type="primary" block loading={saving} onClick={() => onSave(local, inheritKeys)}>保存当前层设置</Button>
    </div>
  </Modal>;
}

export function BookSettingsModal({ open, item, batchSettings, onClose, onSave, saving }) {
  return <LayeredSettingsModal
    title="当前小说设置"
    subtitle={item?.title || '当前小说'}
    open={open}
    parentSettings={batchSettings}
    initialOverride={item?.settingsOverride || {}}
    onClose={onClose}
    onSave={onSave}
    saving={saving}
    extraHeader={<Tag>{`继承生产统一设置 · ${batchSettings?.systemConfigLabel || '当前版本'}`}</Tag>}
  />;
}

export function VideoSettingsOverrideModal({ open, video, item, batchSettings, onClose, onSave, saving }) {
  const bookSettings = useMemo(() => mergePromptSettings(batchSettings, item?.settingsOverride || {}), [batchSettings, item?.settingsOverride]);
  const videoId = String(video?.id ?? '');
  return <LayeredSettingsModal
    title={`VIDEO ${videoId || '—'} 设置覆盖`}
    subtitle={`当前 VIDEO · ${video?.duration_sec || '—'}s`}
    open={open}
    parentSettings={bookSettings}
    initialOverride={item?.videoSettingsOverrides?.[videoId] || {}}
    onClose={onClose}
    onSave={onSave}
    saving={saving}
    extraHeader={<Tag>最高优先级</Tag>}
  />;
}