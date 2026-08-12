import { Alert, Button, Drawer, Empty, Popconfirm, Select, Tag, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../shared/api/client';
import { cancelTask, createTask, listModels, listTasks, retryTask } from '../../../shared/api/shuihuoProduction';

const labels = { draft: '草稿', queued: '排队中', running: '生成中', succeeded: '已完成', failed: '失败', cancelled: '已取消' };
const colors = { queued: 'blue', running: 'gold', succeeded: 'green', failed: 'red', cancelled: 'default' };

function completedMediaFor(task, media) {
  return media.find(item => item.media?.taskId === task.id)?.media || null;
}

export function TaskDrawer({ open, project, segments, media = [], readiness, onClose, onCompleted }) {
  const [models, setModels] = useState([]); const [tasks, setTasks] = useState([]); const [modelId, setModelId] = useState(); const [segmentId, setSegmentId] = useState(); const [kind, setKind] = useState('image'); const [busy, setBusy] = useState(false);
  const availableModels = useMemo(() => models.filter(model => model.kind === kind), [models, kind]);
  const enabledModelKinds = useMemo(() => new Set(readiness?.enabledModelKinds || []), [readiness]);
  const runtimeReady = Boolean(readiness?.database?.ready && readiness?.redis?.ready && readiness?.storage?.ready);
  const kindReady = runtimeReady && enabledModelKinds.has(kind);
  const refresh = async () => { if (!project?.id) return; const [modelResult, taskResult] = await Promise.all([listModels(), listTasks(project.id)]); setModels(modelResult.models || []); setTasks(taskResult.tasks || []); };
  useEffect(() => { if (open) refresh().catch(error => message.error(error.message || '读取任务中心失败')); }, [open, project?.id]);
  useEffect(() => {
    if (!open || !tasks.some(task => task.status === 'queued' || task.status === 'running')) return undefined;
    const timer = window.setInterval(() => refresh().then(() => onCompleted?.()).catch(() => {}), 2500);
    return () => window.clearInterval(timer);
  }, [open, project?.id, tasks, onCompleted]);
  useEffect(() => { setModelId(undefined); }, [kind]);
  async function submit() {
    if (!segmentId || !modelId) { message.warning(availableModels.length ? '请选择分段与模型' : '管理员尚未启用对应模型'); return; }
    setBusy(true);
    try {
      await createTask(project.id, { segmentId, modelId, kind });
      await refresh();
      message.success('任务已进入队列');
    } catch (error) { message.error(error.message || '提交任务失败'); } finally { setBusy(false); }
  }
  async function operate(task, action) { setBusy(true); try { if (action === 'cancel') await cancelTask(task.id); else await retryTask(task.id); await refresh(); } catch (error) { message.error(error.message || '任务操作失败'); } finally { setBusy(false); } }
  async function openCompletedMedia(completedMedia) {
    try {
      const blob = await apiRequest(`/api/shuihuo-production/media/${completedMedia.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) { message.error(error.message || '读取完成素材失败'); }
  }
  return <Drawer title="生成任务中心" open={open} onClose={onClose} width={520} extra={<Button type="primary" onClick={submit} loading={busy} disabled={!kindReady}>提交任务</Button>}>
    <div className="shuihuo-task-form">
      <Select value={kind} onChange={setKind} options={[{ value:'image', label:'生成图片' }, { value:'video', label:'图生视频' }, { value:'audio', label:'生成配音' }]} />
      <Select placeholder="选择已确认分段" value={segmentId} onChange={setSegmentId} options={segments.map(segment => ({ value:segment.id, label:`#${segment.orderIndex} ${segment.sourceText.slice(0, 24)}` }))} />
      <Select placeholder={availableModels.length ? '选择管理员启用的模型' : '管理员尚未启用此类模型'} value={modelId} onChange={setModelId} options={availableModels.map(model => ({ value:model.id, label:model.name }))} disabled={!availableModels.length || !kindReady} />
    </div>
    {kind === 'video' ? <Alert type="info" showIcon message="图生视频" description="每个分段必须先有一张主图片；任务会把这张图片作为视频模型的参考图。" /> : null}
    {!kindReady ? <Alert className="shuihuo-inline-alert" type="warning" showIcon message="当前任务依赖未就绪" description="需要数据库、Redis、存储和管理员启用的对应模型后才能提交。" /> : null}
    {!availableModels.length ? <p className="shuihuo-task-empty-note">当前没有启用的{kind === 'image' ? '图片' : kind === 'video' ? '视频' : '配音'}模型，不能提交生成任务。</p> : null}
    <div className="shuihuo-task-list">{tasks.map(task => {
      const completedMedia = task.status === 'succeeded' ? completedMediaFor(task, media) : null;
      const retryable = task.status === 'failed' || task.status === 'cancelled';
      return <article key={task.id} className="shuihuo-task-item"><div><strong>{task.kind === 'image' ? '图片生成' : task.kind === 'video' ? '视频生成' : task.kind === 'audio' ? '配音生成' : task.kind}</strong><span>#{task.id} · 分段 {task.segmentId || '-'}</span>{task.provider ? <span>提供方：{task.provider}{task.providerTaskId ? ` · 上游任务 ${task.providerTaskId}` : ''}</span> : null}{task.errorCode ? <span>错误代码：{task.errorCode}</span> : null}{task.errorMessage ? <p>{task.errorMessage}</p> : null}{retryable ? <span>此任务可重试</span> : null}{completedMedia ? <Button type="link" size="small" onClick={() => openCompletedMedia(completedMedia)}>查看完成素材</Button> : null}</div><Tag color={colors[task.status]}>{labels[task.status] || task.status}</Tag>{task.status === 'queued' || task.status === 'running' ? <Popconfirm title="取消该任务？" onConfirm={() => operate(task, 'cancel')}><Button size="small">取消</Button></Popconfirm> : null}{retryable ? <Button size="small" onClick={() => operate(task, 'retry')}>重试</Button> : null}</article>;
    })}{!tasks.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂未提交任务" /> : null}</div>
  </Drawer>;
}
