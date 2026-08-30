import { Alert, Button, Input, Modal, Spin, message } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { confirmSegmentation, listModels, paragraphSegmentation, smartSegmentation } from '../../../shared/api/shuihuoProduction';

function projectIdOf(data) {
  return data?.project?.id;
}

export function SegmentationModeModal({ project, initialMode, onCancel, onCompleted }) {
  const [candidates, setCandidates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const open = Boolean(projectIdOf(project));
  const mode = initialMode === 'smart' ? 'smart' : 'paragraph';

  const generateCandidates = useCallback(async () => {
    const projectId = projectIdOf(project);
    if (!projectId) return;
    setBusy(true);
    setPreviewError('');
    setCandidates([]);
    try {
      if (mode === 'smart') {
        const modelResult = await listModels();
        const textModels = modelResult.models || [];
        const textModel = textModels.find(model => model.kind === 'text');
        if (!textModel) throw new Error('当前没有可用的文本分析模型，请联系管理员配置后重试');
        const result = await smartSegmentation(projectId, { modelId: textModel.id });
        setCandidates(result.candidates || []);
      } else {
        const result = await paragraphSegmentation(projectId, {});
        setCandidates(result.candidates || []);
      }
    } catch (error) {
      setPreviewError(error.message || '生成分段候选失败');
    } finally {
      setBusy(false);
    }
  }, [mode, project]);

  useEffect(() => {
    if (!open) {
      setCandidates([]);
      setPreviewError('');
      setBusy(false);
      return undefined;
    }
    void generateCandidates();
    return undefined;
  }, [generateCandidates, open]);

  async function confirm() {
    const projectId = projectIdOf(project);
    if (!projectId || !candidates.length) {
      message.warning('请先生成至少一个分段候选');
      return;
    }
    setBusy(true);
    try {
      await confirmSegmentation(projectId, candidates);
      await onCompleted();
      message.success('分段已确认');
    } catch (error) {
      message.error(error.message || '确认分段失败');
    } finally {
      setBusy(false);
    }
  }

  const modeLabel = mode === 'smart' ? '智能识别' : '自动识别';

  return <Modal className="shuihuo-segmentation-mode-modal" title="确认分段候选" open={open} onCancel={onCancel} width={720} footer={<><Button onClick={onCancel}>稍后确认</Button><Button onClick={generateCandidates} loading={busy}>重新生成候选</Button><Button type="primary" onClick={confirm} loading={busy} disabled={!candidates.length}>确认分段并进入工作台</Button></>} destroyOnClose>
    <p className="shuihuo-modal-note">已按创建时选择的“{modeLabel}”生成候选。核对或编辑后确认，才会创建分镜，不会自动生成图片、视频或配音。</p>
    {busy ? <div className="shuihuo-segmentation-generating"><Spin /><span>正在生成分段候选...</span></div> : null}
    {previewError ? <Alert className="shuihuo-inline-alert" showIcon type="error" message="生成候选失败" description={previewError} /> : null}
    {candidates.length ? <div className="shuihuo-segmentation-candidates"><strong>分段候选</strong>{candidates.map((candidate, index) => <Input.TextArea key={index} value={candidate.text} onChange={event => setCandidates(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} rows={3} addonBefore={`#${index + 1}`} />)}</div> : null}
  </Modal>;
}
