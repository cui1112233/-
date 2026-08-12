import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Modal, Segmented, Select, message } from 'antd';
import { apiRequest } from '../../../shared/api/client';
import { attachMedia, confirmSegmentation, createSegment, deleteMedia, deleteSegment, fixedSegmentation, importSegmentation, listModels, reorderSegments, replaceSegmentAssets, setPrimaryMedia, smartSegmentation, updateSegment, uploadMedia } from '../../../shared/api/shuihuoProduction';
import { MediaModal } from './MediaModal';
import { SegmentAssetsModal } from './SegmentAssetsModal';
import { SegmentEditorModal } from './SegmentEditorModal';
import { SegmentProductionCard } from './SegmentProductionCard';
import { TaskDrawer } from './TaskDrawer';

const blankSegment = { sourceText: '', subtitleText: '', imagePrompt: '', videoPrompt: '', imagePromptLocked: false, videoPromptLocked: false };

export function StudioView({ data, readiness, onRefresh, onAssets }) {
  const [segmentOpen, setSegmentOpen] = useState(false);
  const [mode, setMode] = useState('fixed');
  const [lines, setLines] = useState(3);
  const [text, setText] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [assetSegment, setAssetSegment] = useState(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState([]);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [textModels, setTextModels] = useState([]);
  const [textModelId, setTextModelId] = useState();
  const project = data.project;
  const confirmed = project.segmentationStatus === 'confirmed';
  const bindings = data.segmentAssetIDs || {};
  const mediaItems = useMemo(() => (data.media || []).map(item => item.media ? item : { media: item }), [data.media]);
  const enabledModelKinds = useMemo(() => new Set(readiness?.enabledModelKinds || []), [readiness]);
  const runtimeReady = Boolean(readiness?.database?.ready && readiness?.redis?.ready && readiness?.storage?.ready);
  const textReady = runtimeReady && enabledModelKinds.has('text');
  const taskReady = runtimeReady && (enabledModelKinds.has('image') || enabledModelKinds.has('video'));

  useEffect(() => { if (segmentOpen && mode === 'smart') listModels().then(result => setTextModels((result.models || []).filter(model => model.kind === 'text'))).catch(() => setTextModels([])); }, [segmentOpen, mode]);

  async function preview() {
    setBusy(true);
    try {
      if (mode === 'smart' && !textModelId) { message.warning('请选择管理员启用的文本模型'); return; }
      const response = mode === 'fixed' ? await fixedSegmentation(project.id, { text, linesPerSegment: lines }) : mode === 'import' ? await importSegmentation(project.id, { text }) : await smartSegmentation(project.id, { text, modelId: textModelId });
      setCandidates(response.candidates || []);
    } catch (error) { message.error(error.message || '生成分段候选失败'); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!candidates.length) { message.warning('请先生成或导入候选分段'); return; }
    setBusy(true);
    try { await confirmSegmentation(project.id, candidates); setSegmentOpen(false); await onRefresh(); message.success('分段已确认'); } catch (error) { message.error(error.message || '确认分段失败'); } finally { setBusy(false); }
  }
  async function saveSegment() {
    if (!editing?.sourceText?.trim()) { message.warning('请填写分段原文'); return; }
    setBusy(true);
    try {
      if (editing.id) await updateSegment(editing.id, editing); else await createSegment(project.id, editing);
      setEditing(null); await onRefresh(); message.success('人工分段已保存');
    } catch (error) { message.error(error.message || '保存分段失败'); } finally { setBusy(false); }
  }
  async function moveSegment(segment, direction) {
    const current = data.segments || [];
    const index = current.findIndex(item => item.id === segment.id);
    const target = index + direction;
    if (target < 0 || target >= current.length) return;
    const ids = current.map(item => item.id); [ids[index], ids[target]] = [ids[target], ids[index]];
    try { await reorderSegments(project.id, ids); await onRefresh(); } catch (error) { message.error(error.message || '调整顺序失败'); }
  }
  async function removeSegment(id) {
    try { await deleteSegment(id); await onRefresh(); message.success('分段已删除'); } catch (error) { message.error(error.message || '删除分段失败'); }
  }
  function openAssets(segment) { setAssetSegment(segment); setSelectedAssetIds(bindings[segment.id] || []); }
  async function saveAssets() {
    if (!assetSegment) return;
    setBusy(true);
    try { await replaceSegmentAssets(assetSegment.id, selectedAssetIds); setAssetSegment(null); await onRefresh(); message.success('资产绑定已保存'); } catch (error) { message.error(error.message || '保存资产绑定失败'); } finally { setBusy(false); }
  }
  async function saveUpload(payload) {
    setBusy(true);
    try {
      const result = await uploadMedia(project.id, payload);
      if (payload.segmentId) await attachMedia(result.media.id, payload.segmentId);
      setMediaOpen(false); await onRefresh(); message.success('素材已上传');
    } finally { setBusy(false); }
  }
  async function changeMedia(media, action) {
    try {
      if (action === 'primary') await setPrimaryMedia(media.id);
      if (action === 'delete') await deleteMedia(media.id);
      await onRefresh();
    } catch (error) { message.error(error.message || '素材操作失败'); }
  }
  async function openMediaPreview(media) {
    try {
      const blob = await apiRequest(`/api/shuihuo-production/media/${media.id}/download`, { responseType: 'blob' });
      const objectURL = URL.createObjectURL(blob);
      window.open(objectURL, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(objectURL), 60000);
    } catch (error) { message.error(error.message || '读取素材失败'); }
  }
  function downloadSegmentMedia(media, blob) {
    const objectURL = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectURL;
    link.download = `水货素材-${media.id}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectURL), 60000);
  }
  function assetsFor(segment) { return (bindings[segment.id] || []).map(id => data.assets?.find(asset => asset.id === id)).filter(Boolean); }
  function mediaFor(segment) { return mediaItems.filter(item => item.media.segmentId === segment.id).map(item => item.media); }
  const textUnavailable = textReady ? '' : '智能分段需要 Redis、存储和管理员启用的文本模型。';
  const taskUnavailable = !confirmed ? '请先确认分段' : taskReady ? '在任务中心选择管理员已启用模型后提交。' : '生成任务需要 Redis、存储和管理员启用的图片或视频模型。';

  return <section className="shuihuo-view">
    <div className="shuihuo-stepper"><span className="done">1 上传原文</span><i /><span className={confirmed ? 'done' : 'active'}>2 分段审核</span><i /><span className={confirmed ? 'active' : ''}>3 资产与提示词</span><i /><span>4 生成素材</span><i /><span>5 导出</span></div>
    <div className="shuihuo-page-heading"><div><h2>{project.name}</h2><p>{confirmed ? `已确认 ${data.segments?.length || 0} 个分段。现在可以逐段编辑、绑定资产与上传素材。` : '请先完成分段审核；系统不会自动输出人物、场景或提示词。'}</p></div><div className="shuihuo-actions"><Button onClick={() => setSegmentOpen(true)}>分段设置</Button><Button onClick={() => setEditing({ ...blankSegment })} disabled={!confirmed}>新增分段</Button><Button onClick={onAssets} disabled={!confirmed}>人物场景预设</Button><Button onClick={() => setMediaOpen(true)} disabled={!confirmed}>上传素材</Button><Button onClick={() => setTasksOpen(true)} disabled={!confirmed || !taskReady} title={taskUnavailable}>任务中心</Button><Button type="primary" disabled title={taskUnavailable}>导出</Button></div></div>
    {!confirmed ? <Alert showIcon type="info" message="请先确认分段" description="候选分段可反复编辑和重新生成；确认之前不会启动资产分析、提示词生成、图片、视频或导出任务。" /> : <Alert showIcon type="info" message="通过任务中心生成" description="当前可保存人工提示词、资产绑定和上传素材。任务中心只显示管理员已启用模型；没有模型时会明确阻止提交。" />}
    <div className="shuihuo-production-scroll"><div className="shuihuo-production-list">{(data.segments || []).map((segment, index) => <SegmentProductionCard key={segment.id} index={index} segment={segment} assets={assetsFor(segment)} media={mediaFor(segment)} onEdit={item => setEditing({ ...item })} onBindAssets={openAssets} onSetPrimary={mediaId => changeMedia({ id: mediaId }, 'primary')} onDeleteMedia={mediaId => changeMedia({ id: mediaId }, 'delete')} onPreviewMedia={openMediaPreview} onDownloadMedia={downloadSegmentMedia} onMove={direction => moveSegment(segment, direction)} onDelete={() => removeSegment(segment.id)} />)}</div></div>
    <Modal title="分段审核" open={segmentOpen} onCancel={() => setSegmentOpen(false)} onOk={confirm} okText="确认分段" confirmLoading={busy} width={860}><Segmented value={mode} onChange={setMode} options={[{ value: 'fixed', label: '快速初分段' }, { value: 'import', label: '导入分段' }, { value: 'smart', label: '智能分段', disabled: !textReady }]} />{mode === 'fixed' ? <div className="shuihuo-modal-row"><Input type="number" value={lines} min={1} onChange={event => setLines(Number(event.target.value))} addonBefore="每段行数" /></div> : null}{mode === 'smart' ? <Select value={textModelId} onChange={setTextModelId} placeholder={textModels.length ? '选择文本分析模型' : '管理员尚未启用文本模型'} options={textModels.map(model => ({ value: model.id, label: model.name }))} disabled={!textReady} /> : null}{!textReady ? <Alert className="shuihuo-inline-alert" type="warning" showIcon message="智能分段暂不可用" description={textUnavailable} /> : null}<Input.TextArea value={text} onChange={event => setText(event.target.value)} rows={8} placeholder={mode === 'import' ? '粘贴 TXT、SRT 或 WebVTT 内容' : '留空时按项目原文分段'} /><Alert className="shuihuo-inline-alert" type="info" showIcon message="候选需要人工确认" description="分析只返回候选和预设版本，不会直接改写已确认分段、资产或提示词。" /><Button className="shuihuo-preview-button" onClick={preview} loading={busy} disabled={mode === 'smart' && !textReady}>生成候选</Button>{candidates.length ? <div className="shuihuo-candidates">{candidates.map((candidate, candidateIndex) => <Input.TextArea key={candidateIndex} value={candidate.text} onChange={event => setCandidates(items => items.map((item, itemIndex) => itemIndex === candidateIndex ? { ...item, text: event.target.value } : item))} rows={3} addonBefore={`#${candidateIndex + 1}`} />)}</div> : null}</Modal>
    <SegmentEditorModal open={Boolean(editing)} segment={editing} saving={busy} onCancel={() => setEditing(null)} onChange={setEditing} onSave={saveSegment} />
    <SegmentAssetsModal open={Boolean(assetSegment)} segment={assetSegment} assets={data.assets || []} selectedIds={selectedAssetIds} saving={busy} onCancel={() => setAssetSegment(null)} onChange={setSelectedAssetIds} onSave={saveAssets} />
    <MediaModal open={mediaOpen} projectId={project.id} segments={data.segments || []} saving={busy} onCancel={() => setMediaOpen(false)} onUpload={saveUpload} />
    <TaskDrawer open={tasksOpen} project={project} segments={data.segments || []} media={mediaItems} readiness={readiness} onClose={() => setTasksOpen(false)} onCompleted={onRefresh} />
  </section>;
}
