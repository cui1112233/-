import {
  Alert,
  Button,
  Divider,
  Drawer,
  Segmented,
  Select,
  Space,
  Tag,
  Typography
} from 'antd';
import { CloudDownload, Layers3, Save, Settings2, TimerReset } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BatchFactoryV11ConstraintEditor } from './BatchFactoryV11ConstraintEditor';
import { ChangeImpactNotice } from './ChangeImpactNotice.jsx';
import { FixedSingleVideoControl } from './FixedSingleVideoControl';
import { runSaveFlow } from './saveFlow.js';
import './batch-factory-v11-settings.css';

const full = { width: '100%' };

const VIDEO_MODELS = [
  { value: 'seedance-pro', label: 'Seedance Video Pro · 最大 15s' },
  { value: 'seedance-fast', label: 'Seedance Video Fast · 最大 10s' },
  { value: 'video-model-c', label: 'Video Model C · 最大 12s' }
];

function SettingField({ label, description, children }) {
  return <div className="bf11-setting-field">
    <div className="bf11-setting-field-copy">
      <Typography.Text strong>{label}</Typography.Text>
      {description ? <Typography.Text type="secondary">{description}</Typography.Text> : null}
    </div>
    <div className="bf11-setting-field-control">{children}</div>
  </div>;
}

export function ProductionSettingsDrawer({
  open,
  batch,
  initialValue = {},
  configVersions = [],
  latestConfigVersion = null,
  configVersionsError = null,
  onClose,
  onSave,
  onPreviewChangeImpact,
  onSyncConfigVersion
}) {
  const [form, setForm] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [syncingConfig, setSyncingConfig] = useState(false);
  const [impactState, setImpactState] = useState({ phase: 'idle' });
  const [impactRequest, setImpactRequest] = useState(0);

  useEffect(() => {
    if (!open) return;
    setForm({ ...initialValue });
    setImpactState({ phase: 'idle' });
    setImpactRequest(current => current + 1);
  }, [open, batch?.id, initialValue]);

  const configVersionOptions = useMemo(() => (Array.isArray(configVersions) ? configVersions : [])
    .filter(version => typeof version?.id === 'string' && version.id.length > 0)
    .map(version => ({
      value: version.id,
      label: version.name || version.id
    })), [configVersions]);

  const selectedConfigVersion = configVersionOptions.some(option => option.value === form.configVersion)
    ? form.configVersion
    : '';
  const configCatalogUnavailable = Boolean(configVersionsError) || configVersionOptions.length === 0;

  const enabledConstraintCount = useMemo(() => [
    form.injectBaseSettings === true,
    form.injectCharacterPrompt === true,
    form.injectScenePrompt === true,
    form.injectPropPrompt === true,
    form.prefixEnabled === true,
    form.qualityEnabled === true,
    form.restrictionEnabled === true,
    form.negativeEnabled === true
  ].filter(Boolean).length, [form]);

  useEffect(() => {
    if (!open || typeof onPreviewChangeImpact !== 'function' || impactRequest === 0) return undefined;
    const requestId = impactRequest;
    const timer = window.setTimeout(async () => {
      setImpactState({ phase: 'loading', requestId });
      try {
        const result = await onPreviewChangeImpact(form);
        if (requestId !== impactRequest) return;
        if (result?.ok === true) {
          setImpactState({ phase: 'ready', impact: result.impact });
        } else {
          setImpactState({
            phase: 'error',
            status: Number(result?.status || 0),
            message: result?.message || '无法读取影响'
          });
        }
      } catch (error) {
        if (requestId !== impactRequest) return;
        setImpactState({
          phase: 'error',
          status: Number(error?.status || 0),
          message: error?.message || '无法读取影响'
        });
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, impactRequest, onPreviewChangeImpact, form]);

  function patch(next) {
    setForm(current => ({ ...current, ...next }));
    setImpactRequest(current => current + 1);
  }

  async function save() {
    setSaving(true);
    try {
      return await runSaveFlow({ payload: form, onSave, onClose });
    } finally {
      setSaving(false);
    }
  }

  async function syncConfigVersion() {
    if (!selectedConfigVersion || configCatalogUnavailable || typeof onSyncConfigVersion !== 'function') return false;
    setSyncingConfig(true);
    try {
      return await onSyncConfigVersion(selectedConfigVersion);
    } finally {
      setSyncingConfig(false);
    }
  }

  const syncDisabledReason = configVersionsError
    ? '无法读取配置版本，暂不能同步。'
    : configVersionOptions.length === 0
      ? '服务端未返回可用配置版本。'
      : !selectedConfigVersion
        ? '请先选择服务端返回的配置版本。'
        : typeof onSyncConfigVersion !== 'function'
          ? '配置版本同步动作尚未接线。'
          : '';

  return <Drawer
    title={<Space><Settings2 size={18} /><span>生产统一设置</span></Space>}
    width={820}
    open={open}
    onClose={onClose}
    destroyOnClose={false}
    extra={<Button type="primary" loading={saving} icon={<Save size={15} />} onClick={save}>保存生产统一设置</Button>}
  >
    <div className="bf11-settings-drawer">
      <div className="bf11-settings-scope">
        <div>
          <Typography.Text strong>应用于当前批次</Typography.Text>
          <Typography.Text type="secondary">{batch?.title || '当前批次'} · {batch?.count || 0} 本小说</Typography.Text>
        </div>
        <Space wrap>
          {form.productionMode ? <Tag color="blue">{form.productionMode === 'viral' ? '爆款开头' : '原文直转'}</Tag> : <Tag>生产方式继承系统</Tag>}
          {form.aspectRatio ? <Tag>{form.aspectRatio}</Tag> : <Tag>画幅继承系统</Tag>}
          <Tag>{enabledConstraintCount} 项显式启用</Tag>
        </Space>
      </div>

      <Divider orientation="left">配置版本</Divider>
      <section className="bf11-setting-section bf11-config-version-card">
        <div className="bf11-config-version-head">
          <div>
            <Typography.Text strong>当前生产配置</Typography.Text>
            <Typography.Text type="secondary">这里只保存当前批次自己的 sparse patch；未设置字段继续继承系统层。</Typography.Text>
          </div>
          <Space wrap>
            <Tag>{form.configVersion || '继承系统'}</Tag>
            {latestConfigVersion?.id ? <Tag color="blue">最新 · {latestConfigVersion.name || latestConfigVersion.id}</Tag> : null}
          </Space>
        </div>
        {configVersionsError ? <Alert
          type="error"
          showIcon
          message="无法读取配置版本"
          description={configVersionsError.message || '配置版本目录当前不可用；不会使用本地替代版本。'}
        /> : configVersionOptions.length === 0 ? <Alert
          type="warning"
          showIcon
          message="暂无可用配置版本"
          description="Go 服务端没有返回配置版本目录；版本选择和同步保持关闭。"
        /> : null}
        <div className="bf11-config-version-actions">
          <Select
            allowClear
            disabled={configCatalogUnavailable}
            placeholder="跟随系统配置版本"
            value={form.configVersion}
            onChange={configVersion => patch({ configVersion })}
            options={configVersionOptions}
            style={full}
          />
          <Button
            icon={<CloudDownload size={15} />}
            loading={syncingConfig}
            disabled={Boolean(syncDisabledReason)}
            title={syncDisabledReason}
            onClick={syncConfigVersion}
          >同步批量后台配置</Button>
        </div>
        <Typography.Text type="secondary">版本 ID、名称和最新顺序全部来自 Go `/config-versions`；同步只保存当前 Batch 的 `configVersion` sparse key，不会修改 Book / VIDEO override。</Typography.Text>
      </section>

      <ChangeImpactNotice state={impactState} />

      <Divider orientation="left">基础生产设置</Divider>
      <section className="bf11-setting-section">
        <SettingField label="生产方式" description="未选择时继承系统层；选择后写入当前批次 patch。">
          <Segmented
            value={form.productionMode}
            onChange={productionMode => patch({ productionMode })}
            options={[
              { value: 'original', label: '原文直转' },
              { value: 'viral', label: '爆款开头' }
            ]}
          />
        </SettingField>

        <SettingField label="剧本提示词" description="普通生产页只选择名称；提示词正文由 V11 Prompt 库管理。">
          <Select
            allowClear
            placeholder="继承系统提示词"
            value={form.scriptPromptPresetId}
            onChange={scriptPromptPresetId => patch({ scriptPromptPresetId })}
            options={[
              { value: 'standard-short-drama', label: '标准短剧分镜' },
              { value: 'commercial-dynamic', label: '商业动态分镜' },
              { value: 'spatial-continuity', label: '空间连续分镜' }
            ]}
          />
        </SettingField>

        <SettingField label="人物场景提示词" description="用于人物 / 场景 / 道具基础资产提取。">
          <Select
            allowClear
            placeholder="继承系统资产提示词"
            value={form.assetPromptPresetId}
            onChange={assetPromptPresetId => patch({ assetPromptPresetId })}
            options={[{ value: 'standard-asset-extraction', label: '标准资产提取' }]}
          />
        </SettingField>

        <SettingField label="视频模型" description="导演前绑定模型；最大时长表示单个 VIDEO 的能力上限。">
          <Select
            allowClear
            placeholder="继承系统模型"
            value={form.videoModelId}
            onChange={videoModelId => patch({ videoModelId })}
            options={VIDEO_MODELS}
          />
        </SettingField>

        <SettingField label="视频画幅" description="未覆盖时继续继承系统层。">
          <Segmented
            value={form.aspectRatio}
            onChange={aspectRatio => patch({ aspectRatio })}
            options={['9:16', '16:9']}
          />
        </SettingField>

        <SettingField label="VIDEO 时长策略" description="AI 自动按剧情密度自然分配时长，不要求凑满模型最大值。">
          <Segmented
            value={form.durationMode}
            onChange={durationMode => patch({ durationMode })}
            options={[
              { value: 'auto', label: 'AI 自动' },
              { value: 'model-max', label: '按模型上限规划' }
            ]}
          />
        </SettingField>

        <SettingField label="固定单 VIDEO" description="只有用户操作开关后才写入 true / false；显式 false 也会被保留。">
          <FixedSingleVideoControl
            checked={form.fixedSingleVideo === true}
            hasOverride={Object.prototype.hasOwnProperty.call(form, 'fixedSingleVideo')}
            maxDurationSeconds={Number(batch?.modelMaxDuration || batch?.modelCapability?.maxDurationSeconds || 0)}
            onChange={fixedSingleVideo => patch({ fixedSingleVideo })}
          />
        </SettingField>

        <SettingField label="前缀模式" description="自动模式由内容判断前缀；手动模式使用统一指定前缀。">
          <Segmented
            value={form.prefixMode}
            onChange={prefixMode => patch({ prefixMode })}
            options={[
              { value: 'auto', label: 'AI 自动' },
              { value: 'manual', label: '手动统一' }
            ]}
          />
        </SettingField>

        <SettingField label="字幕策略" description="“禁止自动对白字幕”不等于禁止人物说话或 Lip-sync。">
          <Select
            allowClear
            placeholder="继承系统字幕策略"
            value={form.subtitlePolicy}
            onChange={subtitlePolicy => patch({ subtitlePolicy })}
            options={[
              { value: 'forbid-auto-dialogue-subtitle', label: '禁止自动对白字幕' },
              { value: 'allow', label: '允许自动字幕' }
            ]}
          />
        </SettingField>
      </section>

      <Divider orientation="left">约束设置</Divider>
      <section className="bf11-setting-section bf11-constraint-section">
        <div className="bf11-section-intro">
          <Space><Layers3 size={17} /><Typography.Text strong>生成约束</Typography.Text></Space>
          <Typography.Text type="secondary">所有开关都在当前位置直接编辑；不再进入二级设置。</Typography.Text>
        </div>
        <BatchFactoryV11ConstraintEditor
          value={form}
          onChange={patch}
          scopeLabel={`应用于当前批次 · ${batch?.count || 0} 本小说`}
        />
      </section>

      <div className="bf11-settings-footer-note">
        <TimerReset size={16} />
        <Typography.Text type="secondary">保存写入 `/api/batch-factory/v11/...` 的 Go SettingsState；Book / VIDEO sparse override 不会被清空。</Typography.Text>
      </div>
    </div>
  </Drawer>;
}

export default ProductionSettingsDrawer;
