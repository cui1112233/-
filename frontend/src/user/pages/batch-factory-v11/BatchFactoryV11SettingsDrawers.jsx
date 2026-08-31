import {
  Alert,
  Button,
  Divider,
  Drawer,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Typography
} from 'antd';
import { CloudDownload, Layers3, Save, Settings2, TimerReset } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BatchFactoryV11ConstraintEditor } from './BatchFactoryV11ConstraintEditor';
import { SHOWCASE_BATCH_SETTINGS } from './showcaseData';
import './batch-factory-v11-settings.css';

const full = { width: '100%' };

const CONFIG_VERSIONS = [
  { value: 'v3.5', label: '批量配置 V3.5 · 后台最新' },
  { value: 'v3.2', label: '批量配置 V3.2 · 当前批次' },
  { value: 'v3.1', label: '批量配置 V3.1 · 历史' },
  { value: 'v3.0', label: '批量配置 V3.0 · 历史' }
];

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
  initialValue = SHOWCASE_BATCH_SETTINGS,
  onClose,
  onSave
}) {
  const [form, setForm] = useState(initialValue);

  useEffect(() => {
    if (!open) return;
    setForm({ ...SHOWCASE_BATCH_SETTINGS, ...initialValue });
  }, [open, batch?.id]);

  const hasLatestConfig = form.configVersion !== 'v3.5';
  const modeChanged = form.productionMode !== initialValue.productionMode;
  const modelChanged = form.videoModelId !== initialValue.videoModelId;
  const impactfulChange = modeChanged || modelChanged || form.configVersion !== initialValue.configVersion;

  const enabledConstraintCount = useMemo(() => [
    form.injectBaseSettings !== false,
    form.injectCharacterPrompt !== false,
    form.injectScenePrompt !== false,
    form.injectPropPrompt !== false,
    form.prefixEnabled === true,
    form.qualityEnabled === true,
    form.restrictionEnabled === true,
    form.negativeEnabled === true
  ].filter(Boolean).length, [form]);

  function patch(next) {
    setForm(current => ({ ...current, ...next }));
  }

  function syncLatest() {
    patch({ configVersion: 'v3.5' });
  }

  function save() {
    onSave?.(form);
    onClose?.();
  }

  return <Drawer
    title={<Space><Settings2 size={18} /><span>生产统一设置</span></Space>}
    width={820}
    open={open}
    onClose={onClose}
    destroyOnClose={false}
    extra={<Button type="primary" icon={<Save size={15} />} onClick={save}>保存生产统一设置</Button>}
  >
    <div className="bf11-settings-drawer">
      <div className="bf11-settings-scope">
        <div>
          <Typography.Text strong>应用于当前批次</Typography.Text>
          <Typography.Text type="secondary">{batch?.title || '当前批次'} · {batch?.count || 0} 本小说</Typography.Text>
        </div>
        <Space wrap>
          <Tag color="blue">{batch?.mode === 'viral' ? '爆款开头' : '原文直转'}</Tag>
          <Tag>{batch?.aspectRatio || form.aspectRatio}</Tag>
          <Tag>{enabledConstraintCount} 项约束启用</Tag>
        </Space>
      </div>

      <Divider orientation="left">配置版本</Divider>
      <section className="bf11-setting-section bf11-config-version-card">
        <div className="bf11-config-version-head">
          <div>
            <Typography.Text strong>当前生产配置</Typography.Text>
            <Typography.Text type="secondary">批次冻结配置不会被后台新版本静默覆盖。</Typography.Text>
          </div>
          {hasLatestConfig ? <Tag color="gold">后台已有新版本 V3.5</Tag> : <Tag color="green">已是后台最新</Tag>}
        </div>
        <div className="bf11-config-version-actions">
          <Select
            value={form.configVersion}
            onChange={configVersion => patch({ configVersion })}
            options={CONFIG_VERSIONS}
            style={full}
          />
          <Button icon={<CloudDownload size={15} />} onClick={syncLatest}>同步批量后台配置</Button>
        </div>
        <Typography.Text type="secondary">同步只会载入新的批次配置快照；当前小说和单 VIDEO 已存在的手动覆盖不会被清空。仍需点击“保存生产统一设置”才会正式应用。</Typography.Text>
      </section>

      {impactfulChange ? <Alert
        type="warning"
        showIcon
        message="本次修改可能影响已有导演结果"
        description="生产方式、模型或配置版本发生变化时，已完成导演的小说不会自动重做；第二阶段接入后由 V11 计算影响范围并要求明确确认。"
      /> : null}

      <Divider orientation="left">基础生产设置</Divider>
      <section className="bf11-setting-section">
        <SettingField label="生产方式" description="决定小说进入导演前是否先生成并审核爆款开头。">
          <Segmented
            value={form.productionMode}
            onChange={productionMode => patch({ productionMode })}
            options={[
              { value: 'original', label: '原文直转' },
              { value: 'viral', label: '爆款开头' }
            ]}
          />
        </SettingField>

        <SettingField label="剧本提示词" description="普通生产页只选择名称；完整系统 Prompt 在管理后台维护。">
          <Select
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
            value={form.assetPromptPresetId}
            onChange={assetPromptPresetId => patch({ assetPromptPresetId })}
            options={[{ value: 'standard-asset-extraction', label: '标准资产提取' }]}
          />
        </SettingField>

        <SettingField label="视频模型" description="导演前绑定模型；最大时长表示单个 VIDEO 的能力上限。">
          <Select
            value={form.videoModelId}
            onChange={videoModelId => patch({ videoModelId })}
            options={VIDEO_MODELS}
          />
        </SettingField>

        <SettingField label="视频画幅" description="最终每一个 VIDEO 请求都会携带对应画幅。">
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

        <SettingField label="固定单 VIDEO" description="开启后整本只输出一个 VIDEO；单个 VIDEO 内仍允许多个 Shot。">
          <Space>
            <Switch checked={form.fixedSingleVideo === true} onChange={fixedSingleVideo => patch({ fixedSingleVideo })} />
            {form.fixedSingleVideo ? <Tag color="purple">只输出 1 个 VIDEO</Tag> : <Tag>按导演拆分多个 VIDEO</Tag>}
          </Space>
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
          <Typography.Text type="secondary">所有开关都在当前位置直接编辑；不再进入二级设置，也不使用铅笔按钮。</Typography.Text>
        </div>
        <BatchFactoryV11ConstraintEditor
          value={form}
          onChange={patch}
          scopeLabel={`应用于当前批次 · ${batch?.count || 0} 本小说`}
        />
      </section>

      <div className="bf11-settings-footer-note">
        <TimerReset size={16} />
        <Typography.Text type="secondary">第二阶段接入真实 V11 后，保存将写入 Go/MySQL，并保留当前小说 / VIDEO sparse override。</Typography.Text>
      </div>
    </div>
  </Drawer>;
}

export default ProductionSettingsDrawer;
