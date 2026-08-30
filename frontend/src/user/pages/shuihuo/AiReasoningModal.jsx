import { useEffect, useMemo, useState } from 'react';
import { Button, Modal, Select, message } from 'antd';
import { applyPromptCandidates, generatePromptCandidates, getProductionConfig, listModels, listShuihuoPresetSlots } from '../../../shared/api/shuihuoProduction';

const systemPresetOptions = [
  { value: 'image', presetId: 'shuihuo-image-prompt', slot: 'shuihuo.prompt.image', label: '画面提示词' },
  { value: 'video', presetId: 'shuihuo-video-prompt', slot: 'shuihuo.prompt.video', label: '视频提示词' }
];

const scopeOptions = [
  { value: 'all', label: '全部' },
  { value: 'unfinished', label: '未完成' },
  { value: 'custom', label: '自定义范围' }
];

function hasPrompt(segment, kind) {
  if (kind === 'image') return Boolean(segment.imagePrompt?.trim());
  return Boolean(segment.videoPrompt?.trim());
}

export function AiReasoningModal({ open, projectId, segments, onClose, onApplied }) {
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState();
  const [kind, setKind] = useState('image');
  const [promptPresetId, setPromptPresetId] = useState('shuihuo-image-prompt');
  const [promptPresetOptions, setPromptPresetOptions] = useState([]);
  const [scope, setScope] = useState('all');
  const [customSegmentIds, setCustomSegmentIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const textModels = useMemo(() => models.filter(model => model.kind === 'text'), [models]);
  const segmentOptions = useMemo(() => (segments || []).map(segment => ({ value: segment.id, label: `#${segment.orderIndex || segment.id} ${segment.subtitleText || segment.sourceText || ''}` })), [segments]);
  const activePreset = systemPresetOptions.find(item => item.value === kind) || systemPresetOptions[0];
  const currentPromptPresetOptions = useMemo(() => promptPresetOptions.filter(item => item.slot === activePreset.slot), [activePreset.slot, promptPresetOptions]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setCustomSegmentIds([]);
    Promise.all([listModels(), getProductionConfig(), listShuihuoPresetSlots()]).then(([result, config, presetResult]) => {
      const nextModels = result.models || [];
      setModels(nextModels);
      setPromptPresetOptions(presetResult.presets || []);
      const savedTextModelId = config?.textModelId;
      setModelId(savedTextModelId && nextModels.some(model => model.id === savedTextModelId && model.kind === 'text')
        ? savedTextModelId
        : nextModels.find(model => model.kind === 'text')?.id);
    }).catch(error => message.error(error.message || '读取推理模型失败')).finally(() => setLoading(false));
  }, [open]);

  function targetSegmentIds() {
    if (scope === 'custom') return new Set(customSegmentIds);
    if (scope === 'unfinished') return new Set((segments || []).filter(segment => !hasPrompt(segment, kind)).map(segment => segment.id));
    return new Set((segments || []).map(segment => segment.id));
  }

  function changeKind(value) {
    const next = systemPresetOptions.find(item => item.value === value) || systemPresetOptions[0];
    setKind(next.value);
    const available = promptPresetOptions.filter(item => item.slot === next.slot);
    setPromptPresetId(available.find(item => item.id === next.presetId)?.id || available[0]?.id || next.presetId);
  }

  async function submit() {
    if (!modelId) { message.warning('请选择文本模型'); return; }
    if (!currentPromptPresetOptions.some(item => item.id === promptPresetId)) {
      message.error(`${activePreset.label}预设词已失效，请在管理后台发布或重新选择。`);
      return;
    }
    const targetIds = targetSegmentIds();
    if (!targetIds.size) { message.warning('当前范围没有可推理分镜'); return; }
    setLoading(true);
    try {
      const result = await generatePromptCandidates(projectId, kind, { modelId, promptPresetId });
      const candidates = (result.candidates || []).filter(item => targetIds.has(item.segmentId) && item.prompt?.trim()).map(item => ({ segmentId: item.segmentId, prompt: item.prompt.trim() }));
      if (!candidates.length) throw new Error('模型没有返回可应用的提示词候选');
      const applied = await applyPromptCandidates(projectId, kind, candidates);
      if (applied.skippedLockedSegmentIds?.length) message.warning(`已跳过锁定分镜：${applied.skippedLockedSegmentIds.join('、')}`);
      message.success(`AI 推理已应用 ${applied.appliedSegmentIds?.length || 0} 条`);
      await onApplied();
      onClose();
    } catch (error) {
      message.error(error.message || 'AI 推理失败');
    } finally {
      setLoading(false);
    }
  }

  return <Modal title="AI推理" open={open} onCancel={onClose} width={600} className="shuihuo-ai-modal" footer={<><Button onClick={onClose}>取消</Button><Button type="primary" loading={loading} onClick={submit}>确认</Button></>}>
    <div className="shuihuo-ai-form">
      <label><span>模型</span><Select value={modelId} onChange={setModelId} placeholder={textModels.length ? '选择模型' : '没有已启用文本模型'} options={textModels.map(model => ({ value: model.id, label: model.name }))} /></label>
      <label className="wide"><span>系统预设词类型</span><Select value={kind} onChange={changeKind} options={systemPresetOptions.map(({ value, label }) => ({ value, label }))} /></label>
      <label className="wide"><span>提示词版本</span><Select value={promptPresetId} onChange={setPromptPresetId} options={currentPromptPresetOptions.map(item => ({ value: item.id, label: `${item.name}（v${item.version}）` }))} /></label>
      <label className="wide"><span>范围</span><Select value={scope} onChange={setScope} options={scopeOptions} /></label>
      {scope === 'custom' ? <label className="wide"><span>自定义分镜</span><Select mode="multiple" value={customSegmentIds} onChange={setCustomSegmentIds} placeholder="选择要推理的分镜" options={segmentOptions} /></label> : null}
    </div>
  </Modal>;
}
