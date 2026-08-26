import { Alert, Checkbox, Input, Modal, Select, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { createBatchTasks, listModels } from '../../../shared/api/shuihuoProduction';

function publicMedia(item) {
  return item?.media || item;
}

function segmentLabel(segment) {
  const text = (segment.sourceText || '').replace(/\s+/g, ' ').trim();
  return `#${segment.orderIndex} ${text.slice(0, 36) || '未填写原文'}`;
}

function parseParameterSchema(model) {
  try {
    return JSON.parse(model?.parameterSchema || '{}') || {};
  } catch {
    return {};
  }
}

function schemaField(schema, ...keys) {
  for (const key of keys) {
    const field = schema?.properties?.[key] || schema?.[key];
    if (field && typeof field === 'object') return field;
  }
  return {};
}

function fieldOptions(field) {
  const values = Array.isArray(field?.enum) ? field.enum : Array.isArray(field?.options) ? field.options : [];
  return values.map(item => {
    if (item && typeof item === 'object') {
      const value = item.value ?? item.id ?? item.label;
      return { value: String(value), label: item.label ?? String(value) };
    }
    return { value: String(item), label: String(item) };
  });
}

function videoModelRequiresImage(model) {
  if (!model) return false;
  if (typeof model.requiresImage === 'boolean') return model.requiresImage;
  if (model.adapterKind !== 'generic_http') return true;
  return Boolean((model.imageInputFormat || '').trim() || (model.imageRequestMode || '').trim());
}

export function BatchTaskModal({ open, projectId, segments, media, kind, models: initialModels = [], onClose, onSubmitted }) {
  const [models, setModels] = useState(initialModels);
  const [modelId, setModelId] = useState();
  const [selectedSegmentIds, setSelectedSegmentIds] = useState([]);
  const [videoSettings, setVideoSettings] = useState({ duration: '', aspectRatio: '', resolution: '' });
  const [loadingModels, setLoadingModels] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [submissionSummary, setSubmissionSummary] = useState(null);

  const primaryImageSegmentIds = useMemo(() => new Set(
    (media || []).map(publicMedia)
      .filter(item => item?.kind === 'image' && item.isPrimary === true && item.segmentId)
      .map(item => item.segmentId)
  ), [media]);
  const availableModels = useMemo(() => models.filter(model => model.kind === kind), [kind, models]);
  const selectedModel = useMemo(() => availableModels.find(model => model.id === modelId), [availableModels, modelId]);
  const selectedVideoNeedsImage = kind === 'video' && videoModelRequiresImage(selectedModel);
  const eligibleSegmentIds = useMemo(() => (segments || []).filter(segment => (
    segment.confirmed && (!selectedVideoNeedsImage || primaryImageSegmentIds.has(segment.id))
  )).map(segment => segment.id), [primaryImageSegmentIds, segments, selectedVideoNeedsImage]);
  const eligibleIdSet = useMemo(() => new Set(eligibleSegmentIds), [eligibleSegmentIds]);
  const parameterSchema = useMemo(() => parseParameterSchema(selectedModel), [selectedModel]);
  const durationField = useMemo(() => schemaField(parameterSchema, 'duration'), [parameterSchema]);
  const aspectRatioField = useMemo(() => schemaField(parameterSchema, 'aspectRatio', 'aspect_ratio'), [parameterSchema]);
  const resolutionField = useMemo(() => schemaField(parameterSchema, 'resolution'), [parameterSchema]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setModelId(undefined);
    setModels([]);
    setSelectedSegmentIds([]);
    setVideoSettings({ duration: '', aspectRatio: '', resolution: '' });
    setSubmissionSummary(null);
    setLoadError('');
    setLoadingModels(true);
    listModels().then(result => {
      if (active) setModels((result.models || []).filter(model => model?.id && model?.name && model?.kind));
    }).catch(error => {
      if (active) setLoadError(error.message || '读取可用模型失败');
    }).finally(() => {
      if (active) setLoadingModels(false);
    });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    setSelectedSegmentIds(items => items.filter(id => eligibleIdSet.has(id)));
  }, [eligibleIdSet]);

  function selectModel(nextModelId) {
    setModelId(nextModelId);
    const nextModel = availableModels.find(model => model.id === nextModelId);
    const schema = parseParameterSchema(nextModel);
    setVideoSettings({
      duration: String(schemaField(schema, 'duration')?.default ?? ''),
      aspectRatio: String(schemaField(schema, 'aspectRatio', 'aspect_ratio')?.default ?? ''),
      resolution: String(schemaField(schema, 'resolution')?.default ?? '')
    });
  }

  function setSegmentSelected(segmentId, checked) {
    if (!eligibleIdSet.has(segmentId)) return;
    setSelectedSegmentIds(items => checked ? [...new Set([...items, segmentId])] : items.filter(id => id !== segmentId));
  }

  function updateVideoSetting(name, value) {
    setVideoSettings(settings => ({ ...settings, [name]: value || '' }));
  }

  async function submit() {
    const selectedIds = selectedSegmentIds.filter(id => eligibleIdSet.has(id));
    if (!modelId) { message.warning('请选择管理员启用的模型'); return; }
    if (!selectedIds.length) { message.warning('请至少选择一个可提交分段'); return; }

    setSubmitting(true);
    try {
      const payload = { segmentIds: selectedIds, kind, modelId };
      if (kind === 'video') {
        const normalizedVideoSettings = Object.fromEntries(Object.entries(videoSettings).filter(([, value]) => String(value || '').trim()));
        if (Object.keys(normalizedVideoSettings).length) payload.videoSettings = normalizedVideoSettings;
      }
      const response = await createBatchTasks(projectId, payload);
      const results = Array.isArray(response?.results) ? response.results : [];
      const failed = results.filter(result => result?.error);
      const succeeded = results.filter(result => result?.task).length;
      if (failed.length) {
        const failedSegmentIds = failed.map(result => result.segmentId).filter(id => eligibleIdSet.has(id));
        setSelectedSegmentIds(failedSegmentIds);
        setSubmissionSummary({ succeeded, failed });
        message.warning(`已提交 ${succeeded} 个任务，${failed.length} 个分段未提交`);
      } else {
        setSubmissionSummary({ succeeded, failed: [] });
        message.success(`已提交 ${succeeded} 个${kind === 'image' ? '图片' : '视频'}任务`);
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

  function renderVideoSetting(label, name, field, placeholder) {
    const options = fieldOptions(field);
    return <div>
      <label className="shuihuo-form-label">{field?.label || field?.title || label}</label>
      {options.length ? <Select
        allowClear
        placeholder={placeholder}
        value={videoSettings[name] || undefined}
        onChange={value => updateVideoSetting(name, value)}
        options={options}
      /> : <Input
        placeholder={placeholder}
        value={videoSettings[name]}
        onChange={event => updateVideoSetting(name, event.target.value)}
      />}
    </div>;
  }

  return <Modal
    title={kind === 'image' ? '批量生成图片' : '批量生成视频'}
    open={open}
    onCancel={onClose}
    onOk={submit}
    okText="提交所选任务"
    confirmLoading={submitting}
    okButtonProps={{ disabled: loadingModels || !availableModels.length || !selectedSegmentIds.some(id => eligibleIdSet.has(id)) }}
    width={720}
  >
    <Alert
      type="info"
      showIcon
      message={kind === 'image' ? '图片任务按已确认分段提交' : selectedModel ? selectedVideoNeedsImage ? '当前模型为图生视频，需要主图片' : '当前模型支持无需主图的视频生成' : '选择视频模型后会按模型输入能力检查主图片'}
      description="提交后请在任务中心查看后端返回的排队、运行、完成或失败状态。"
    />
    {loadError ? <Alert className="shuihuo-inline-alert" type="warning" showIcon message="无法读取可用模型" description={loadError} /> : null}
    <label className="shuihuo-form-label">生成模型</label>
    <Select
      placeholder={loadingModels ? '正在读取管理员启用的模型' : availableModels.length ? '选择管理员启用的模型' : '管理员尚未启用此类模型'}
      value={modelId}
      onChange={selectModel}
      options={availableModels.map(model => ({ value: model.id, label: model.name }))}
      loading={loadingModels}
      disabled={loadingModels || !availableModels.length}
    />
    {!loadingModels && !loadError && !availableModels.length ? <p className="shuihuo-task-empty-note">当前没有启用的{kind === 'image' ? '图片' : '视频'}模型，不能提交生成任务。</p> : null}
    {kind === 'video' && selectedModel ? <div className="shuihuo-video-settings">
      {renderVideoSetting('视频时长', 'duration', durationField, '按模型要求填写，例如 5')}
      {renderVideoSetting('画面比例', 'aspectRatio', aspectRatioField, '按模型要求填写，例如 16:9')}
      {renderVideoSetting('清晰度', 'resolution', resolutionField, '按模型要求填写，例如 1080p')}
    </div> : null}
    <label className="shuihuo-form-label">选择分段</label>
    <div className="shuihuo-batch-segments">
      {(segments || []).map(segment => {
        const eligible = eligibleIdSet.has(segment.id);
        const reason = !segment.confirmed ? '分段未确认' : selectedVideoNeedsImage && !primaryImageSegmentIds.has(segment.id) ? '当前模型缺少主图片' : '';
        return <div className="shuihuo-batch-segment" key={segment.id}>
          <Checkbox checked={selectedSegmentIds.includes(segment.id)} disabled={!eligible} onChange={event => setSegmentSelected(segment.id, event.target.checked)}>{segmentLabel(segment)}</Checkbox>
          {!eligible ? <span>{reason}</span> : null}
        </div>;
      })}
      {!segments?.length ? <span className="shuihuo-muted">当前没有可提交的分段。</span> : null}
    </div>
    {submissionSummary?.failed?.length ? <Alert className="shuihuo-inline-alert" type="warning" showIcon message={`已提交 ${submissionSummary.succeeded} 个任务`} description={<ul className="shuihuo-batch-errors">{submissionSummary.failed.map(result => <li key={result.segmentId}>分段 #{result.segmentId}：{result.error || '提交失败'}</li>)}</ul>} /> : null}
  </Modal>;
}
