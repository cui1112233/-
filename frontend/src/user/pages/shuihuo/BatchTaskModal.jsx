import { Alert, Checkbox, InputNumber, Modal, Select, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { createBatchTasks, getProductionConfig, listModels } from '../../../shared/api/shuihuoProduction';
import { selectBatchSegmentIds } from './batchSelection';
import { defaultModelIdForKind } from './modelDefaults';

function publicMedia(item) {
  return item?.media || item;
}

function segmentLabel(segment) {
  const text = (segment.sourceText || '').replace(/\s+/g, ' ').trim();
  return `#${segment.orderIndex} ${text.slice(0, 36) || '未填写原文'}`;
}

function defaultModelIdFor(config, models, kind) {
  if (kind === 'image') return defaultModelIdForKind(models, kind, config?.imageModelId);
  if (kind === 'video') return config?.videoModelId;
  if (kind === 'audio') return config?.audioModelId;
  return undefined;
}

const YD_VIDEO_RATIOS = ['9:16', '16:9'];

export function BatchTaskModal({ open, projectId, segments, media, kind, availability, models: initialModels = [], initialSegmentIds = [], initialScope = 'all', audioSettingsBySegment = {}, onClose, onSubmitted }) {
  const [models, setModels] = useState(initialModels);
  const [productionConfig, setProductionConfig] = useState(null);
  const [modelId, setModelId] = useState();
  const [videoAspectRatio, setVideoAspectRatio] = useState('9:16');
  const [selectedSegmentIds, setSelectedSegmentIds] = useState([]);
  const [scope, setScope] = useState(initialScope);
  const [rangeStart, setRangeStart] = useState();
  const [rangeEnd, setRangeEnd] = useState();
  const [loadingModels, setLoadingModels] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [submissionSummary, setSubmissionSummary] = useState(null);

  const eligibleSegmentIds = useMemo(() => (segments || []).filter(segment => segment.confirmed).map(segment => segment.id), [segments]);
  const eligibleIdSet = useMemo(() => new Set(eligibleSegmentIds), [eligibleSegmentIds]);
  const availableModels = useMemo(() => models.filter(model => model.kind === kind), [kind, models]);
  const selectedModel = useMemo(() => models.find(model => model.id === modelId), [modelId, models]);
  const isYDVideoModel = kind === 'video' && selectedModel?.adapterKind === 'yd_video';
  const rangeBounds = useMemo(() => {
    const orders = (segments || []).map(segment => segment.orderIndex).filter(Number.isFinite);
    return { start: orders.length ? Math.min(...orders) : undefined, end: orders.length ? Math.max(...orders) : undefined };
  }, [segments]);
  const scopedSegmentIds = useMemo(() => selectBatchSegmentIds({
    segments,
    media,
    kind,
    scope,
    start: rangeStart,
    end: rangeEnd,
    selectedIds: selectedSegmentIds
  }), [kind, media, rangeEnd, rangeStart, scope, segments, selectedSegmentIds]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setModelId(undefined);
    setVideoAspectRatio('9:16');
    setModels([]);
    setProductionConfig(null);
    setSelectedSegmentIds(initialSegmentIds);
    setScope(initialScope);
    setRangeStart(rangeBounds.start);
    setRangeEnd(rangeBounds.end);
    setSubmissionSummary(null);
    setLoadError('');
    setLoadingModels(true);
    Promise.all([listModels(), getProductionConfig()]).then(([result, config]) => {
      if (!active) return;
      const nextModels = (result.models || []).filter(model => typeof model?.id === 'number' && model?.name && model?.kind);
      setModels(nextModels);
      setProductionConfig(config || {});
      const savedModelId = defaultModelIdFor(config, nextModels, kind);
      if (savedModelId !== undefined && savedModelId !== null && nextModels.some(model => model.id === savedModelId && model.kind === kind)) {
        setModelId(savedModelId);
      }
    }).catch(error => {
      if (active) setLoadError(error.message || '读取可用模型失败');
    }).finally(() => {
      if (active) setLoadingModels(false);
    });
    return () => { active = false; };
  }, [initialScope, initialSegmentIds, kind, open, rangeBounds.end, rangeBounds.start]);

  function setSegmentSelected(segmentId, checked) {
    if (!eligibleIdSet.has(segmentId)) return;
    setSelectedSegmentIds(items => checked ? [...new Set([...items, segmentId])] : items.filter(id => id !== segmentId));
  }

  async function submit() {
    const selectedIds = scopedSegmentIds;
    if (!availability?.ready) { message.warning(availability?.reason || '当前任务依赖未就绪'); return; }
    if (modelId === undefined || modelId === null) { message.warning('请选择生成模型'); return; }
    if (kind === 'video' && productionConfig?.videoGenerationMode === 'text_to_video' && isYDVideoModel) {
      message.warning('YD2.0 Mini 仅支持图生视频，请先在引擎设置中调整');
      return;
    }
    if (!selectedIds.length) { message.warning('请至少选择一个可提交分段'); return; }

    setSubmitting(true);
    try {
      const response = await createBatchTasks(projectId, { segmentIds: selectedIds, kind, modelId, ...(isYDVideoModel ? { videoSettings: { aspectRatio: videoAspectRatio } } : {}), ...(kind === 'audio' ? { audioSettingsBySegment: Object.fromEntries(selectedIds.map(id => [id, audioSettingsBySegment[id] || { speechRate: 1, pitch: 0 }])) } : {}) });
      const results = Array.isArray(response?.results) ? response.results : [];
      const failed = results.filter(result => result?.error);
      const succeeded = results.filter(result => result?.task).length;
      if (failed.length) {
        const failedSegmentIds = failed.map(result => result.segmentId).filter(id => eligibleIdSet.has(id));
        setScope('selected');
        setSelectedSegmentIds(failedSegmentIds);
        setSubmissionSummary({ succeeded, failed });
        message.warning(`已提交 ${succeeded} 个任务，${failed.length} 个分段未提交`);
      } else {
        setSubmissionSummary({ succeeded, failed: [] });
        message.success(`已提交 ${succeeded} 个${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '配音'}任务`);
      }
      try {
        await onSubmitted?.();
      } catch (refreshError) {
        message.warning(refreshError.message || '任务已提交，请在任务中心手动刷新状态');
      }
      if (!failed.length) onClose();
    } catch (error) {
      message.error(error.message || '批量提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  return <Modal
    title={kind === 'image' ? '批量生成图片' : kind === 'video' ? '批量生成视频' : '批量生成配音'}
    open={open}
    onCancel={onClose}
    onOk={submit}
    okText="提交所选任务"
    confirmLoading={submitting}
    okButtonProps={{ disabled: !availability?.ready || loadingModels || !availableModels.length || !scopedSegmentIds.length }}
    width={720}
  >
    <Alert type="info" showIcon message={kind === 'image' ? '图片任务按已确认分段提交' : kind === 'video' ? (productionConfig?.videoGenerationMode === 'text_to_video' ? '文生视频不发送图片' : '图生视频使用当前分镜的预设图或主图片') : '配音任务按已确认分段提交'} description={kind === 'video' ? '模型与生成方式来自引擎设置。服务端会在提交时冻结当前分镜的最终提示词和图片输入。' : '提交后请在任务中心查看后端返回的排队、运行、完成或失败状态。'} />
    {!availability?.ready ? <Alert className="shuihuo-inline-alert" type="warning" showIcon message="当前任务依赖未就绪" description={availability?.reason || '请检查运行配置'} /> : null}
    {loadError ? <Alert className="shuihuo-inline-alert" type="warning" showIcon message="无法读取可用模型" description={loadError} /> : null}
    {isYDVideoModel ? <p className="shuihuo-task-empty-note">YD2.0 Mini 固定 1 秒、720p；仅可用于图生视频。</p> : null}
    {!loadingModels && !loadError && (modelId === undefined || modelId === null) ? <p className="shuihuo-task-empty-note">请先在引擎设置中选择{kind === 'image' ? '生图' : kind === 'video' ? '视频' : '配音'}模型。</p> : null}
    <label className="shuihuo-form-label">批量范围</label>
    <Select value={scope} onChange={setScope} options={[{ value: 'all', label: '全部已确认' }, { value: 'incomplete', label: '未完成' }, { value: 'range', label: '指定编号范围' }, { value: 'selected', label: '手工勾选' }]} />
    {scope === 'range' ? <div className="shuihuo-batch-range"><InputNumber min={rangeBounds.start} max={rangeBounds.end} value={rangeStart} onChange={value => setRangeStart(value ?? rangeBounds.start)} addonBefore="从" /><InputNumber min={rangeBounds.start} max={rangeBounds.end} value={rangeEnd} onChange={value => setRangeEnd(value ?? rangeBounds.end)} addonBefore="到" /></div> : null}
    <p className="shuihuo-task-empty-note">当前范围可提交 {scopedSegmentIds.length} 个分镜。</p>
    {scope === 'selected' ? <><label className="shuihuo-form-label">选择分段</label>
    <div className="shuihuo-batch-segments">
      {(segments || []).map(segment => {
        const eligible = eligibleIdSet.has(segment.id);
        const reason = !segment.confirmed ? '分段未确认' : '';
        return <div className="shuihuo-batch-segment" key={segment.id}>
          <Checkbox checked={selectedSegmentIds.includes(segment.id)} disabled={!eligible} onChange={event => setSegmentSelected(segment.id, event.target.checked)}>{segmentLabel(segment)}</Checkbox>
          {!eligible ? <span>{reason}</span> : null}
        </div>;
      })}
      {!segments?.length ? <span className="shuihuo-muted">当前没有可提交的分段。</span> : null}
    </div></> : null}
    {submissionSummary?.failed?.length ? <Alert className="shuihuo-inline-alert" type="warning" showIcon message={`已提交 ${submissionSummary.succeeded} 个任务`} description={<ul className="shuihuo-batch-errors">{submissionSummary.failed.map(result => <li key={result.segmentId}>分段 #{result.segmentId}：{result.error || '提交失败'}</li>)}</ul>} /> : null}
  </Modal>;
}
