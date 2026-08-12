import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Dropdown, Input, Modal, Popconfirm, Segmented, Select, Tag, message } from 'antd';
import { apiRequest } from '../../../shared/api/client';
import { attachMedia, confirmSegmentation, createSegment, deleteMedia, deleteSegment, fixedSegmentation, importSegmentation, listModels, reorderSegments, replaceSegmentAssets, setPrimaryMedia, smartSegmentation, updateSegment, uploadMedia } from '../../../shared/api/shuihuoProduction';
import { MediaModal } from './MediaModal';
import { SegmentAssetsModal } from './SegmentAssetsModal';
import { SegmentEditorModal } from './SegmentEditorModal';
import { TaskDrawer } from './TaskDrawer';

const blankSegment = { sourceText: '', subtitleText: '', imagePrompt: '', videoPrompt: '', imagePromptLocked: false, videoPromptLocked: false };

function MediaPreview({ item, index }) {
  const [url, setURL] = useState('');
  useEffect(() => {
    let objectURL = '';
    apiRequest(item.url || `/api/shuihuo-production/media/${item.media.id}/download`, { responseType: 'blob' }).then(blob => {
      objectURL = URL.createObjectURL(blob); setURL(objectURL);
    }).catch(() => setURL(''));
    return () => { if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [item]);
  if (!url) return <span className="shuihuo-muted">读取素材...</span>;
  if (item.media.kind === 'image') return <img src={url} alt={`分段 ${index + 1} 图片`} />;
  if (item.media.kind === 'audio') return <audio controls src={url} />;
  return <video controls preload="metadata" src={url} />;
}

export function StudioView({ data, onRefresh, onAssets }) {
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
  function assetsFor(segment) { return (bindings[segment.id] || []).map(id => data.assets?.find(asset => asset.id === id)).filter(Boolean); }
  function mediaFor(segment) { return mediaItems.filter(item => item.media.segmentId === segment.id); }
  const taskUnavailable = confirmed ? '在任务中心选择管理员已启用模型后提交。' : '请先确认分段';

  return <section className="shuihuo-view">
    <div className="shuihuo-stepper"><span className="done">1 上传原文</span><i /><span className={confirmed ? 'done' : 'active'}>2 分段审核</span><i /><span className={confirmed ? 'active' : ''}>3 资产与提示词</span><i /><span>4 生成素材</span><i /><span>5 导出</span></div>
    <div className="shuihuo-page-heading"><div><h2>{project.name}</h2><p>{confirmed ? `已确认 ${data.segments?.length || 0} 个分段。现在可以逐段编辑、绑定资产与上传素材。` : '请先完成分段审核；系统不会自动输出人物、场景或提示词。'}</p></div><div className="shuihuo-actions"><Button onClick={() => setSegmentOpen(true)}>分段设置</Button><Button onClick={() => setEditing({ ...blankSegment })} disabled={!confirmed}>新增分段</Button><Button onClick={onAssets} disabled={!confirmed}>人物场景预设</Button><Button onClick={() => setMediaOpen(true)} disabled={!confirmed}>上传素材</Button><Button onClick={() => setTasksOpen(true)} disabled={!confirmed} title={taskUnavailable}>任务中心</Button><Button type="primary" disabled title={taskUnavailable}>导出</Button></div></div>
    {!confirmed ? <Alert showIcon type="info" message="请先确认分段" description="候选分段可反复编辑和重新生成；确认之前不会启动资产分析、提示词生成、图片、视频或导出任务。" /> : <Alert showIcon type="info" message="通过任务中心生成" description="当前可保存人工提示词、资产绑定和上传素材。任务中心只显示管理员已启用模型；没有模型时会明确阻止提交。" />}
    <div className="shuihuo-table"><div className="shuihuo-table-head"><span>序号</span><span>字幕 / 原文</span><span>配音</span><span>人物 · 场景 · 道具</span><span>图片 / 视频提示词</span><span>片段库</span><span>操作</span></div>{(data.segments || []).map((segment, index) => {
      const segmentMedia = mediaFor(segment); const segmentAssets = assetsFor(segment);
      return <div className="shuihuo-segment-row" key={segment.id}><span>{index + 1}</span><div><p>{segment.sourceText}</p><small>{segment.subtitleText || '未设置字幕'}</small></div><div>{segmentMedia.filter(item => item.media.kind === 'audio').map(item => <MediaPreview key={item.media.id} item={item} index={index} />)}{!segmentMedia.some(item => item.media.kind === 'audio') ? <span className="shuihuo-muted">未配置</span> : null}</div><div><div className="shuihuo-tag-list">{segmentAssets.map(asset => <Tag key={asset.id}>{asset.name}</Tag>)}</div><Button type="link" size="small" onClick={() => openAssets(segment)}>调整资产</Button></div><div className="shuihuo-prompt-preview"><b>图</b><span>{segment.imagePrompt || '未设置'}</span><b>视</b><span>{segment.videoPrompt || '未设置'}</span></div><div className="shuihuo-media-list">{segmentMedia.map(item => <div key={item.media.id} className="shuihuo-media-item"><MediaPreview item={item} index={index} /><Dropdown menu={{ items: [{ key: 'primary', label: '设为主素材' }, { key: 'delete', label: '删除素材', danger: true }], onClick: ({ key }) => changeMedia(item.media, key) }}><Button type="text" size="small">...</Button></Dropdown></div>)}{!segmentMedia.length ? <span className="shuihuo-muted">暂无素材</span> : null}</div><div className="shuihuo-row-actions"><Button type="text" size="small" onClick={() => moveSegment(segment, -1)} disabled={index === 0}>上移</Button><Button type="text" size="small" onClick={() => moveSegment(segment, 1)} disabled={index === (data.segments?.length || 0) - 1}>下移</Button><Button type="text" size="small" onClick={() => setEditing({ ...segment })}>编辑</Button><Popconfirm title="删除这个分段？绑定的素材关系也会解除。" onConfirm={() => removeSegment(segment.id)}><Button type="text" danger size="small">删除</Button></Popconfirm></div></div>;
    })}</div>
    <Modal title="分段审核" open={segmentOpen} onCancel={() => setSegmentOpen(false)} onOk={confirm} okText="确认分段" confirmLoading={busy} width={860}><Segmented value={mode} onChange={setMode} options={[{ value: 'fixed', label: '快速初分段' }, { value: 'import', label: '导入分段' }, { value: 'smart', label: '智能分段' }]} />{mode === 'fixed' ? <div className="shuihuo-modal-row"><Input type="number" value={lines} min={1} onChange={event => setLines(Number(event.target.value))} addonBefore="每段行数" /></div> : null}{mode === 'smart' ? <Select value={textModelId} onChange={setTextModelId} placeholder={textModels.length ? '选择文本分析模型' : '管理员尚未启用文本模型'} options={textModels.map(model => ({ value: model.id, label: model.name }))} /> : null}<Input.TextArea value={text} onChange={event => setText(event.target.value)} rows={8} placeholder={mode === 'import' ? '粘贴 TXT、SRT 或 WebVTT 内容' : '留空时按项目原文分段'} /><Alert className="shuihuo-inline-alert" type="info" showIcon message="候选需要人工确认" description="分析只返回候选和预设版本，不会直接改写已确认分段、资产或提示词。" /><Button className="shuihuo-preview-button" onClick={preview} loading={busy}>生成候选</Button>{candidates.length ? <div className="shuihuo-candidates">{candidates.map((candidate, candidateIndex) => <Input.TextArea key={candidateIndex} value={candidate.text} onChange={event => setCandidates(items => items.map((item, itemIndex) => itemIndex === candidateIndex ? { ...item, text: event.target.value } : item))} rows={3} addonBefore={`#${candidateIndex + 1}`} />)}</div> : null}</Modal>
    <SegmentEditorModal open={Boolean(editing)} segment={editing} saving={busy} onCancel={() => setEditing(null)} onChange={setEditing} onSave={saveSegment} />
    <SegmentAssetsModal open={Boolean(assetSegment)} segment={assetSegment} assets={data.assets || []} selectedIds={selectedAssetIds} saving={busy} onCancel={() => setAssetSegment(null)} onChange={setSelectedAssetIds} onSave={saveAssets} />
    <MediaModal open={mediaOpen} projectId={project.id} segments={data.segments || []} saving={busy} onCancel={() => setMediaOpen(false)} onUpload={saveUpload} />
    <TaskDrawer open={tasksOpen} project={project} segments={data.segments || []} onClose={() => setTasksOpen(false)} onCompleted={onRefresh} />
  </section>;
}
