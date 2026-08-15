import { useEffect, useState } from 'react';
import { Button, Checkbox, Input, Modal, Select, message } from 'antd';
import { applyPromptCandidates, generatePromptCandidates, listModels } from '../../../shared/api/shuihuoProduction';

export function PromptCandidatesModal({ open, projectId, kind, segments, onClose, onApplied }) {
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState();
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const label = kind === 'image' ? '图片' : '视频';

  useEffect(() => {
    if (!open) return;
    setCandidates([]);
    setModelId();
    listModels().then(result => setModels((result.models || []).filter(model => model.kind === 'text'))).catch(() => setModels([]));
  }, [open]);

  async function generate() {
    if (!modelId) { message.warning('请选择文本模型'); return; }
    setLoading(true);
    try {
      const result = await generatePromptCandidates(projectId, kind, { modelId });
      setCandidates((result.candidates || []).map(item => ({ ...item, selected: true })));
    } catch (error) { message.error(error.message || `生成${label}提示词失败`); } finally { setLoading(false); }
  }

  async function apply() {
    const selected = candidates.filter(item => item.selected && item.prompt?.trim()).map(item => ({ segmentId: item.segmentId, prompt: item.prompt.trim() }));
    if (!selected.length) { message.warning('请至少选择一条非空提示词'); return; }
    setLoading(true);
    try {
      const result = await applyPromptCandidates(projectId, kind, selected);
      if (result.skippedLockedSegmentIds?.length) message.warning(`已跳过锁定分镜：${result.skippedLockedSegmentIds.join('、')}`);
      message.success(`已应用 ${result.appliedSegmentIds?.length || 0} 条${label}提示词`);
      await onApplied();
      onClose();
    } catch (error) { message.error(error.message || `应用${label}提示词失败`); } finally { setLoading(false); }
  }

  function segmentText(segmentId) { return segments.find(item => item.id === segmentId)?.sourceText || ''; }

  return <Modal title={`批量生成${label}提示词`} open={open} onCancel={onClose} width={820} footer={candidates.length ? <><Button onClick={onClose}>取消</Button><Button type="primary" loading={loading} onClick={apply}>应用已选</Button></> : <Button onClick={onClose}>关闭</Button>}>
    <p className="shuihuo-modal-note">AI 只会生成候选。请检查后应用；已锁定的人工提示词不会被覆盖。</p>
    <div className="shuihuo-analysis-controls"><Select value={modelId} onChange={setModelId} placeholder="选择文本模型" options={models.map(model => ({ value: model.id, label: model.name }))} /><Button type="primary" loading={loading} onClick={generate}>生成候选</Button></div>
    {candidates.length ? <div className="shuihuo-candidate-list">{candidates.map((item, index) => <article className="shuihuo-prompt-candidate" key={`${item.segmentId}-${index}`}><Checkbox checked={item.selected} onChange={event => setCandidates(items => items.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, selected: event.target.checked } : candidate))}>应用到分镜 #{segments.find(item2 => item2.id === item.segmentId)?.orderIndex || item.segmentId}</Checkbox><small>{segmentText(item.segmentId)}</small><Input.TextArea rows={4} value={item.prompt} onChange={event => setCandidates(items => items.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, prompt: event.target.value } : candidate))} /></article>)}</div> : <div className="shuihuo-empty"><p>选择文本模型后生成候选，系统会依据已绑定资产和分镜原文生成提示词。</p></div>}
  </Modal>;
}
