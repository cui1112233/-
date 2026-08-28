import { Alert, Button, Drawer, Input, Segmented, Select, Space, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import {
  clearBatchFactoryItemOverrides,
  getBatchFactoryPromptCatalog,
  updateBatchFactoryItemOverrides
} from '../../../shared/api/batchFactory';

const full = { width: '100%' };

function initialForm(item) {
  const value = item?.settingsOverride || {};
  const boolMode = key => typeof value[key] === 'boolean' ? (value[key] ? 'on' : 'off') : 'inherit';
  return {
    scriptPromptPresetId: value.scriptPromptPresetId || 'inherit',
    assetPromptPresetId: value.assetPromptPresetId || 'inherit',
    aspectRatio: value.aspectRatio || 'inherit',
    fixedSingleVideo: typeof value.fixedSingleVideo === 'boolean' ? (value.fixedSingleVideo ? 'fixed' : 'auto') : 'inherit',
    prefixMode: value.prefixMode || 'inherit',
    customPrefix: value.customPrefix || '',
    quality: value.quality || '',
    restriction: value.restriction || '',
    negative: value.negative || '',
    injectCharacterPrompt: boolMode('injectCharacterPrompt'),
    injectScenePrompt: boolMode('injectScenePrompt'),
    injectPropPrompt: boolMode('injectPropPrompt'),
    subtitlePolicy: value.subtitlePolicy || 'inherit'
  };
}

function toBooleanOverride(value) {
  if (value === 'on') return true;
  if (value === 'off') return false;
  return 'inherit';
}

export function BatchFactoryBookSettings({ open, batch, item, onClose, onSaved }) {
  const [catalog, setCatalog] = useState({ scriptPrompts: [], assetPrompts: [] });
  const [form, setForm] = useState(() => initialForm(item));
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(initialForm(item));
    getBatchFactoryPromptCatalog().then(setCatalog).catch(() => setCatalog({ scriptPrompts: [], assetPrompts: [] }));
  }, [open, item?.id]);

  function patch(key, value) {
    setForm(current => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!batch?.id || !item?.id) return;
    setSaving(true);
    try {
      await updateBatchFactoryItemOverrides(batch.id, item.id, {
        scriptPromptPresetId: form.scriptPromptPresetId,
        assetPromptPresetId: form.assetPromptPresetId,
        aspectRatio: form.aspectRatio,
        fixedSingleVideo: form.fixedSingleVideo === 'inherit' ? 'inherit' : form.fixedSingleVideo === 'fixed',
        prefixMode: form.prefixMode,
        customPrefix: form.customPrefix,
        quality: form.quality,
        restriction: form.restriction,
        negative: form.negative,
        injectCharacterPrompt: toBooleanOverride(form.injectCharacterPrompt),
        injectScenePrompt: toBooleanOverride(form.injectScenePrompt),
        injectPropPrompt: toBooleanOverride(form.injectPropPrompt),
        subtitlePolicy: form.subtitlePolicy
      });
      await onSaved?.();
      message.success('当前小说单独设置已保存；涉及导演结构的修改会自动使旧导演结果失效');
      onClose?.();
    } catch (error) {
      message.error(error.message || '保存当前小说设置失败');
    } finally {
      setSaving(false);
    }
  }

  async function restore() {
    if (!batch?.id || !item?.id) return;
    setRestoring(true);
    try {
      await clearBatchFactoryItemOverrides(batch.id, item.id);
      await onSaved?.();
      message.success('当前小说已恢复批次统一设置');
      onClose?.();
    } catch (error) {
      message.error(error.message || '恢复统一设置失败');
    } finally {
      setRestoring(false);
    }
  }

  const promptOption = (item, inherited) => ({ value: item.id, label: `${item.name}${item.id === inherited ? ' · 批次当前' : ''}` });
  return <Drawer
    title={`当前小说设置 · ${item?.title || ''}`}
    width={540}
    open={open}
    onClose={onClose}
    extra={<Space><Button loading={restoring} onClick={restore}>恢复统一设置</Button><Button type="primary" loading={saving} onClick={save}>保存</Button></Space>}
  >
    <Space direction="vertical" size={16} style={full}>
      <Alert
        showIcon
        type="info"
        message="只覆盖当前小说"
        description="留在“跟随统一设置”的项目继续继承批次。剧本提示词、人物场景提示词、画幅或 VIDEO 时长策略发生变化时，需要重新导演当前小说；前缀、画质、限制和负面词只影响之后的模型提交 Prompt。"
      />
      {item?.production?.projectId ? <Alert showIcon type="warning" message="当前小说已经进入视频生产" description="为避免已有 VIDEO 与导演拆分错位，导演级设置会被锁定；仍可调整生成附加项并单独重生成 VIDEO。" /> : null}

      <div>
        <Typography.Text strong>剧本提示词</Typography.Text>
        <Select
          style={{ ...full, marginTop: 8 }}
          value={form.scriptPromptPresetId}
          onChange={value => patch('scriptPromptPresetId', value)}
          options={[{ value: 'inherit', label: `跟随统一设置 · ${batch?.settings?.scriptPromptPresetId || '默认'}` }, ...catalog.scriptPrompts.map(item => promptOption(item, batch?.settings?.scriptPromptPresetId))]}
        />
      </div>
      <div>
        <Typography.Text strong>人物场景提示词</Typography.Text>
        <Select
          style={{ ...full, marginTop: 8 }}
          value={form.assetPromptPresetId}
          onChange={value => patch('assetPromptPresetId', value)}
          options={[{ value: 'inherit', label: `跟随统一设置 · ${batch?.settings?.assetPromptPresetId || '默认'}` }, ...catalog.assetPrompts.map(item => promptOption(item, batch?.settings?.assetPromptPresetId))]}
        />
      </div>
      <div>
        <Typography.Text strong>画幅</Typography.Text>
        <div style={{ marginTop: 8 }}><Segmented block value={form.aspectRatio} onChange={value => patch('aspectRatio', value)} options={[{ value: 'inherit', label: '跟随统一' }, { value: '9:16', label: '9:16' }, { value: '16:9', label: '16:9' }]} /></div>
      </div>
      <div>
        <Typography.Text strong>VIDEO 时长策略</Typography.Text>
        <div style={{ marginTop: 8 }}><Segmented block value={form.fixedSingleVideo} onChange={value => patch('fixedSingleVideo', value)} options={[{ value: 'inherit', label: '跟随统一' }, { value: 'auto', label: 'AI 自动拆分' }, { value: 'fixed', label: `固定单 VIDEO · ${batch?.settings?.maxVideoDuration || 10}s` }]} /></div>
      </div>
      <div>
        <Typography.Text strong>画面前缀</Typography.Text>
        <Segmented block style={{ marginTop: 8 }} value={form.prefixMode} onChange={value => patch('prefixMode', value)} options={[{ value: 'inherit', label: '跟随统一' }, { value: 'auto', label: 'AI 自动' }, { value: 'manual', label: '当前小说自定义' }]} />
        {form.prefixMode === 'manual' ? <Input.TextArea rows={4} style={{ marginTop: 8 }} value={form.customPrefix} onChange={event => patch('customPrefix', event.target.value)} placeholder="当前小说专用前缀词" /> : null}
      </div>

      <div>
        <Typography.Text strong>生成时附加资产</Typography.Text>
        <Space direction="vertical" size={8} style={{ ...full, marginTop: 8 }}>
          {[['injectCharacterPrompt', '人物'], ['injectScenePrompt', '场景'], ['injectPropPrompt', '道具']].map(([key, label]) => <Space key={key} style={{ justifyContent: 'space-between', width: '100%' }}><Typography.Text>{label}</Typography.Text><Segmented size="small" value={form[key]} onChange={value => patch(key, value)} options={[{ value: 'inherit', label: '跟随' }, { value: 'on', label: '附加' }, { value: 'off', label: '不附加' }]} /></Space>)}
        </Space>
      </div>

      <div><Typography.Text strong>画质要求</Typography.Text><Input.TextArea rows={3} style={{ marginTop: 8 }} value={form.quality} onChange={event => patch('quality', event.target.value)} placeholder="留空继续使用批次统一画质" /></div>
      <div><Typography.Text strong>画面限制</Typography.Text><Input.TextArea rows={3} style={{ marginTop: 8 }} value={form.restriction} onChange={event => patch('restriction', event.target.value)} placeholder="留空继续使用批次统一限制" /></div>
      <div><Typography.Text strong>负面提示词</Typography.Text><Input.TextArea rows={4} style={{ marginTop: 8 }} value={form.negative} onChange={event => patch('negative', event.target.value)} placeholder="留空继续使用批次统一负面提示词" /></div>
      <div>
        <Typography.Text strong>字幕规则</Typography.Text>
        <Select style={{ ...full, marginTop: 8 }} value={form.subtitlePolicy} onChange={value => patch('subtitlePolicy', value)} options={[{ value: 'inherit', label: '跟随统一设置' }, { value: 'forbid-auto-dialogue-subtitle', label: '禁止自动对白字幕，允许正常说台词' }, { value: 'allow', label: '允许模型文字/字幕' }]} />
      </div>
    </Space>
  </Drawer>;
}

export default BatchFactoryBookSettings;