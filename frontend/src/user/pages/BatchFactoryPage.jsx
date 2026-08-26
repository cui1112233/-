import { Alert, Button, Card, Collapse, Divider, Empty, Input, List, Modal, Segmented, Select, Space, Spin, Switch, Tabs, Tag, Typography, message } from 'antd';
import { Check, FilePlus2, Pencil, RefreshCw, Sparkles, UploadCloud, WandSparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  approveBatchFactoryHook,
  compileBatchFactoryVideo,
  createBatchFactoryBatch,
  getBatchFactoryBatch,
  getBatchFactoryIntake,
  listBatchFactoryBatches,
  regenerateBatchFactoryDirector,
  rewriteBatchFactoryHook,
  startBatchFactoryBatch,
  updateBatchFactoryDirectorResult
} from '../../shared/api/batchFactory';
import { reportClientError } from '../../shared/error-reporting';
import { BatchFactoryBulkProduction } from './batch-factory/BatchFactoryBulkProduction';
import { BatchFactoryProductionControls, loadBatchFactoryVideoModels } from './batch-factory/BatchFactoryProductionControls';

const activeStatuses = new Set(['queued_hook', 'hook_generating', 'queued_director', 'director_generating']);
const DEFAULT_STYLE = '高质量动漫短视频';

const statusLabels = {
  pending: ['待开始', 'default'],
  queued_hook: ['爆款排队', 'processing'],
  hook_generating: ['爆款生成中', 'processing'],
  hook_review: ['待审核', 'gold'],
  queued_director: ['导演排队', 'processing'],
  director_generating: ['导演生成中', 'processing'],
  complete: ['导演完成', 'green'],
  failed: ['制作失败', 'red']
};

function inferTitle(text, index) {
  const first = String(text || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
  return (first.replace(/^[#《【\s]+|[》】#\s]+$/g, '').slice(0, 36) || `开篇 ${index + 1}`);
}

function splitPastedText(value) {
  return String(value || '').split(/\n\s*(?:---+|===+)\s*\n/g)
    .map(text => text.trim())
    .filter(Boolean)
    .map((sourceText, index) => ({ title: inferTitle(sourceText, index), sourceText }));
}

function statusTag(status) {
  const [label, color] = statusLabels[status] || [status || '未知', 'default'];
  return <Tag color={color}>{label}</Tag>;
}

function settingSummary(batch) {
  if (!batch) return '';
  const duration = batch.settings?.maxVideoDuration || 10;
  const model = batch.settings?.videoModelName ? `${batch.settings.videoModelName} · ` : '';
  const durationLabel = batch.settings?.fixedSingleVideo ? `固定 ${duration}s` : `AI自动 1-${duration}s`;
  return `${batch.mode === 'viral' ? '爆款开头' : '原文直转'} · ${model}${durationLabel} · ${batch.settings?.aspectRatio || '9:16'}`;
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
}

function itemCardStyle(item) {
  if (item?.status === 'failed' || item?.production?.failed) {
    return { borderInlineStart: '3px solid #ff4d4f', background: 'rgba(255,77,79,0.035)' };
  }
  if (item?.manuallyEdited || item?.settingOverrides) {
    return { borderInlineStart: '3px solid #7c3aed', background: 'rgba(124,58,237,0.045)' };
  }
  return undefined;
}

function activityEntries(item) {
  const entries = Array.isArray(item?.activityLog) ? [...item.activityLog] : [];
  if (item?.production?.submittedAt) {
    entries.push({
      at: item.production.submittedAt,
      type: item.production.failed ? 'error' : 'production',
      message: item.production.failed
        ? `已提交视频生产：${item.production.queued}/${item.production.total} 个 VIDEO 入队，${item.production.failed} 个提交失败`
        : `全部 ${item.production.total} 个 VIDEO 已提交视频生产`,
      status: item.production.status || '',
      videoId: ''
    });
  }
  return entries.sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
}

export function BatchFactoryPage() {
  const [pasted, setPasted] = useState('');
  const [draftItems, setDraftItems] = useState([]);
  const [sourceIntakeId, setSourceIntakeId] = useState('');
  const [mode, setMode] = useState('original');
  const [videoModels, setVideoModels] = useState([]);
  const [videoModelId, setVideoModelId] = useState(null);
  const [videoModelsLoading, setVideoModelsLoading] = useState(false);
  const [fixedSingleVideo, setFixedSingleVideo] = useState(false);
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [prefixMode, setPrefixMode] = useState('auto');
  const [customPrefix, setCustomPrefix] = useState('');
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [quality, setQuality] = useState('');
  const [restriction, setRestriction] = useState('');
  const [negative, setNegative] = useState('');
  const [creating, setCreating] = useState(false);
  const [activeBatch, setActiveBatch] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hookEdits, setHookEdits] = useState({});
  const [compileIssues, setCompileIssues] = useState({});
  const [compiled, setCompiled] = useState({ open: false, loading: false, title: '', prompt: '', payload: null, error: '' });
  const [directorEditor, setDirectorEditor] = useState({ open: false, saving: false, itemId: '', title: '', value: '' });
  const fileInputRef = useRef(null);
  const intakeLoadedRef = useRef('');

  const hasActiveJobs = useMemo(() => activeBatch?.items?.some(item => activeStatuses.has(item.status)), [activeBatch]);
  const directVideoModels = useMemo(() => videoModels.filter(model => (
    model.requiresImageInput !== true
    && Number.isInteger(Number(model.maxVideoDuration))
    && Number(model.maxVideoDuration) >= 1
  )), [videoModels]);
  const incompleteVideoModels = useMemo(() => videoModels.filter(model => (
    model.requiresImageInput !== true
    && (!Number.isInteger(Number(model.maxVideoDuration)) || Number(model.maxVideoDuration) < 1)
  )), [videoModels]);
  const selectedVideoModel = useMemo(() => directVideoModels.find(model => Number(model.id) === Number(videoModelId)) || null, [directVideoModels, videoModelId]);
  const maxVideoDuration = Number(selectedVideoModel?.maxVideoDuration || 0);
  const advancedSettingCount = [
    fixedSingleVideo,
    prefixMode === 'manual',
    Boolean(customPrefix.trim()),
    style.trim() !== DEFAULT_STYLE,
    Boolean(quality.trim()),
    Boolean(restriction.trim()),
    Boolean(negative.trim())
  ].filter(Boolean).length;

  async function refreshHistory() {
    setHistoryLoading(true);
    try {
      const result = await listBatchFactoryBatches();
      setHistory(result.batches || []);
    } catch (error) {
      message.error(error.message || '读取批次失败');
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => { refreshHistory(); }, []);

  useEffect(() => {
    let active = true;
    setVideoModelsLoading(true);
    loadBatchFactoryVideoModels()
      .then(models => {
        if (!active) return;
        setVideoModels(models);
        const compatible = models.filter(model => (
          model.requiresImageInput !== true
          && Number.isInteger(Number(model.maxVideoDuration))
          && Number(model.maxVideoDuration) >= 1
        ));
        if (compatible.length) setVideoModelId(current => current || compatible[0].id);
      })
      .catch(error => { if (active) message.error(error.message || '读取视频模型失败'); })
      .finally(() => { if (active) setVideoModelsLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const intakeId = new URLSearchParams(window.location.search).get('intake') || '';
    if (!intakeId || intakeLoadedRef.current === intakeId) return;
    intakeLoadedRef.current = intakeId;
    getBatchFactoryIntake(intakeId)
      .then(result => {
        const intake = result.intake;
        if (intake?.batchId) {
          loadBatch(intake.batchId);
          message.info('这组小说获取任务已经建立批次，已为你打开。');
          return;
        }
        const items = Array.isArray(intake?.items) ? intake.items : [];
        setSourceIntakeId(intakeId);
        setDraftItems(items);
        if (items.length) message.success(`已从小说获取转入 ${items.length} 本小说，请统一选择生产设置。`);
      })
      .catch(error => message.error(error.message || '读取小说获取任务失败'));
  }, []);

  useEffect(() => {
    if (!activeBatch?.id || !hasActiveJobs) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const result = await getBatchFactoryBatch(activeBatch.id);
        setActiveBatch(result.batch);
        setHookEdits(current => {
          const next = { ...current };
          for (const item of result.batch?.items || []) {
            if (item.status === 'hook_review' && next[item.id] === undefined) next[item.id] = item.hookDraft || '';
          }
          return next;
        });
      } catch (_) {
        // Keep the current view; the next polling tick can recover transient failures.
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [activeBatch?.id, hasActiveJobs]);

  async function loadBatch(batchId) {
    try {
      const result = await getBatchFactoryBatch(batchId);
      setActiveBatch(result.batch);
      const edits = {};
      for (const item of result.batch?.items || []) if (item.hookDraft) edits[item.id] = item.approvedHookScript || item.hookDraft;
      setHookEdits(edits);
      setCompileIssues({});
    } catch (error) {
      message.error(error.message || '读取批次失败');
    }
  }

  async function refreshActiveBatch() {
    if (!activeBatch?.id) return;
    const result = await getBatchFactoryBatch(activeBatch.id);
    setActiveBatch(result.batch);
    await refreshHistory();
  }

  function addPasted() {
    const items = splitPastedText(pasted);
    if (!items.length) return message.warning('请先粘贴小说开篇');
    setDraftItems(current => [...current, ...items].slice(0, 200));
    setPasted('');
    message.success(`已加入 ${items.length} 篇开篇`);
  }

  async function addFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    const accepted = files.filter(file => /\.(txt|md)$/i.test(file.name));
    if (accepted.length !== files.length) message.warning('V1 导入先支持 TXT / MD；DOCX / ZIP 会在文件解析层继续接入。');
    try {
      const texts = await Promise.all(accepted.map(file => file.text()));
      const next = texts.map((sourceText, index) => ({
        title: accepted[index].name.replace(/\.(txt|md)$/i, ''),
        sourceText: sourceText.trim()
      })).filter(item => item.sourceText);
      setDraftItems(current => [...current, ...next].slice(0, 200));
      if (next.length) message.success(`已导入 ${next.length} 个文件`);
    } catch (_) {
      message.error('文件读取失败');
    }
  }

  async function createAndStart() {
    if (!draftItems.length) return message.warning('至少添加一篇小说开篇');
    if (!selectedVideoModel) return message.warning('请先选择已配置单次最大时长的文生视频模型');
    setCreating(true);
    try {
      const created = await createBatchFactoryBatch({
        mode,
        sourceIntakeId,
        items: draftItems,
        settings: {
          videoModelId: selectedVideoModel.id,
          videoModelVersionId: selectedVideoModel.versionId,
          videoModelName: selectedVideoModel.name,
          maxVideoDuration,
          fixedSingleVideo,
          aspectRatio,
          prefixMode,
          customPrefix,
          style,
          quality,
          restriction,
          negative
        }
      });
      const started = await startBatchFactoryBatch(created.batch.id);
      setActiveBatch(started.batch);
      setDraftItems([]);
      setSourceIntakeId('');
      setHookEdits({});
      setCompileIssues({});
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.delete('intake');
      window.history.replaceState({}, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
      await refreshHistory();
      message.success(mode === 'viral' ? '批次已进入爆款开头生成队列' : '批次已进入导演生成队列');
    } catch (error) {
      message.error(error.message || '创建批次失败');
    } finally {
      setCreating(false);
    }
  }

  async function approveHook(item) {
    const text = String(hookEdits[item.id] ?? item.hookDraft ?? '').trim();
    if (!text) return message.warning('爆款开头不能为空');
    try {
      await approveBatchFactoryHook(activeBatch.id, item.id, text);
      await refreshActiveBatch();
      message.success('已锁定爆款开头，开始导演生成');
    } catch (error) {
      message.error(error.message || '通过失败');
    }
  }

  async function rewriteHook(item) {
    try {
      await rewriteBatchFactoryHook(activeBatch.id, item.id);
      await refreshActiveBatch();
    } catch (error) {
      message.error(error.message || '重写失败');
    }
  }

  async function regenerateDirector(item) {
    try {
      await regenerateBatchFactoryDirector(activeBatch.id, item.id);
      await refreshActiveBatch();
    } catch (error) {
      message.error(error.message || '重新导演失败');
    }
  }

  function openDirectorEditor(item) {
    setDirectorEditor({
      open: true,
      saving: false,
      itemId: item.id,
      title: `${item.title} · 手动编辑导演结果`,
      value: JSON.stringify(item.directorResult, null, 2)
    });
  }

  async function saveDirectorEditor() {
    let directorResult;
    try {
      directorResult = JSON.parse(directorEditor.value);
    } catch (_) {
      return message.error('导演结果必须是合法 JSON');
    }
    setDirectorEditor(current => ({ ...current, saving: true }));
    try {
      await updateBatchFactoryDirectorResult(activeBatch.id, directorEditor.itemId, directorResult);
      await refreshActiveBatch();
      setDirectorEditor({ open: false, saving: false, itemId: '', title: '', value: '' });
      message.success('单书导演结果已修改；这本书会用不同颜色标记，不会额外调用 AI');
    } catch (error) {
      setDirectorEditor(current => ({ ...current, saving: false }));
      message.error(error.message || '导演结果保存失败');
    }
  }

  async function compileVideo(item, video) {
    const issueKey = String(video.id);
    setCompiled({ open: true, loading: true, title: `${item.title} · VIDEO ${video.id}`, prompt: '', payload: null, error: '' });
    try {
      const result = await compileBatchFactoryVideo(activeBatch.id, item.id, video.id);
      setCompileIssues(current => {
        const nextItem = { ...(current[item.id] || {}) };
        delete nextItem[issueKey];
        return { ...current, [item.id]: nextItem };
      });
      setCompiled({ open: true, loading: false, title: `${item.title} · VIDEO ${video.id}`, prompt: result.payload?.prompt || '', payload: result.payload, error: '' });
    } catch (error) {
      const detail = error.message || '编译视频提示词失败';
      setCompileIssues(current => ({
        ...current,
        [item.id]: { ...(current[item.id] || {}), [issueKey]: detail }
      }));
      reportClientError({
        kind: 'batch-factory.prompt-failed',
        message: detail,
        source: `/api/batch-factory/batches/${activeBatch.id}/items/${item.id}/videos/${video.id}/compile`,
        context: {
          batchId: activeBatch.id,
          itemId: item.id,
          bookTitle: item.title,
          bookId: item.bookId || '',
          videoId: video.id,
          modelName: activeBatch.settings?.videoModelName || ''
        }
      });
      setCompiled(current => ({ ...current, loading: false, error: detail }));
      message.error(detail);
    }
  }

  const reviewCount = activeBatch?.items?.filter(item => item.status === 'hook_review').length || 0;
  const directorCompleteCount = activeBatch?.items?.filter(item => item.status === 'complete').length || 0;
  const failedCount = activeBatch?.items?.filter(item => item.status === 'failed').length || 0;

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto', padding: '24px' }}>
      <Space direction="vertical" size={18} style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <Typography.Paragraph type="secondary" style={{ margin: 0, maxWidth: 920 }}>
            批量工厂默认使用整批统一设置；只有个别小说需要精细调整时再展开人物、场景、提示词或 VIDEO。低频设置默认收起，避免批量用户被参数淹没。
          </Typography.Paragraph>
          {activeBatch ? <Button onClick={() => { setActiveBatch(null); refreshHistory(); }}>新建批次</Button> : null}
        </div>

        {!activeBatch ? <>
          <Card title="1. 待制作小说">
            {sourceIntakeId ? <Alert type="success" showIcon message={`已接收小说获取任务 · ${draftItems.length} 本`} description="书ID、平台、来源任务ID和原始TXT会跟随每一本书一直保留；这里不重新获取小说，也不重新判断已有平台。" style={{ marginBottom: 14 }} /> : null}
            {draftItems.length ? <List
              size="small"
              style={{ marginTop: sourceIntakeId ? 0 : 8, maxHeight: 360, overflow: 'auto' }}
              bordered
              dataSource={draftItems}
              renderItem={(item, index) => <List.Item actions={[<Button key="delete" size="small" type="text" danger onClick={() => setDraftItems(current => current.filter((_, itemIndex) => itemIndex !== index))}>删除</Button>]}>
                <List.Item.Meta
                  title={`${String(index + 1).padStart(2, '0')} · ${item.title}`}
                  description={<Space wrap size={[4, 4]}>
                    {item.bookId ? <Tag>书ID {item.bookId}</Tag> : null}
                    {item.platform ? <Tag color="blue">{item.platform}</Tag> : null}
                    {item.sourceTaskId ? <Tag color="default">任务 #{item.sourceTaskId}</Tag> : null}
                    <Typography.Text type="secondary">{item.sourceText.length.toLocaleString()} 字符</Typography.Text>
                    {item.txtFileName ? <Typography.Text type="secondary">TXT：{item.txtFileName}</Typography.Text> : null}
                  </Space>}
                />
              </List.Item>}
            /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="等待小说获取转入，或使用下面的备用导入方式" />}
            <Collapse
              style={{ marginTop: 14 }}
              defaultActiveKey={sourceIntakeId || draftItems.length ? [] : ['manual-import']}
              items={[{
                key: 'manual-import',
                label: '其他导入方式（备用）',
                children: <>
                  <Input.TextArea rows={7} value={pasted} onChange={event => setPasted(event.target.value)} placeholder="手动粘贴一篇或多篇小说开篇，多篇之间用一行 --- 分隔。" />
                  <Space wrap style={{ marginTop: 12 }}>
                    <Button icon={<FilePlus2 size={16} />} onClick={addPasted}>加入文案</Button>
                    <Button icon={<UploadCloud size={16} />} onClick={() => fileInputRef.current?.click()}>上传 TXT / MD</Button>
                    <input ref={fileInputRef} type="file" multiple accept=".txt,.md,text/plain,text/markdown" hidden onChange={addFiles} />
                    <Typography.Text type="secondary">当前 {draftItems.length} / 200 本</Typography.Text>
                  </Space>
                </>
              }]}
            />
          </Card>

          <Card title="2. 生产统一设置" extra={<Tag color="blue">应用到全部 {draftItems.length} 本</Tag>}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <div>
                <Typography.Text strong>生产方式</Typography.Text>
                <div style={{ marginTop: 8 }}><Segmented value={mode} onChange={setMode} options={[{ value: 'original', label: '原文直转 · 1回AI' }, { value: 'viral', label: '爆款开头 · 2回AI' }]} /></div>
              </div>
              <div>
                <Typography.Text strong>视频模型</Typography.Text>
                <div style={{ marginTop: 8 }}>
                  <Select
                    loading={videoModelsLoading}
                    value={videoModelId}
                    onChange={setVideoModelId}
                    style={{ width: '100%', maxWidth: 620 }}
                    options={directVideoModels.map(model => ({
                      value: model.id,
                      label: `${model.name} · 文生视频 · 单次最大 ${model.maxVideoDuration}s`
                    }))}
                    placeholder="选择已配置时长能力的文生视频模型"
                  />
                </div>
                {selectedVideoModel ? <Typography.Text type="secondary">当前模型最大 {maxVideoDuration}s；统一设置会先锁定模型能力，再让 AI 按它拆分 VIDEO。</Typography.Text> : null}
                {!videoModelsLoading && !directVideoModels.length ? <Alert type="warning" showIcon style={{ marginTop: 10 }} message="暂无可用于批量工厂的文生视频模型" description="请管理员先在「水货生产模型」中启用文生视频模型，并配置单次最大生成时长。" /> : null}
                {incompleteVideoModels.length ? <Alert type="warning" showIcon style={{ marginTop: 10 }} message={`${incompleteVideoModels.length} 个文生视频模型缺少时长能力`} description={`未参与选择：${incompleteVideoModels.map(model => model.name).join('、')}。请先在模型中心补充“单次最大生成时长”。`} /> : null}
              </div>
              <div>
                <Typography.Text strong>视频画幅</Typography.Text>
                <div style={{ marginTop: 8 }}><Segmented value={aspectRatio} onChange={setAspectRatio} options={['9:16', '16:9']} /></div>
              </div>

              <Collapse items={[{
                key: 'advanced-settings',
                label: <Space wrap><span>高级设置</span>{advancedSettingCount ? <Tag color="purple">已修改 {advancedSettingCount} 项</Tag> : <Tag>使用默认值</Tag>}</Space>,
                children: <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Space align="center">
                    <Switch checked={fixedSingleVideo} onChange={setFixedSingleVideo} disabled={!selectedVideoModel} />
                    <div><Typography.Text strong>固定单 VIDEO</Typography.Text><br /><Typography.Text type="secondary">关闭时 AI 在 1-{maxVideoDuration || '—'}s 内自然选择；开启后每本只输出一个 {maxVideoDuration || '—'}s VIDEO。</Typography.Text></div>
                  </Space>
                  <div>
                    <Typography.Text strong>画面前缀</Typography.Text>
                    <div style={{ marginTop: 8 }}><Segmented value={prefixMode} onChange={setPrefixMode} options={[{ value: 'auto', label: 'AI自动判断' }, { value: 'manual', label: '统一手动前缀' }]} /></div>
                    <Input.TextArea style={{ marginTop: 8 }} rows={3} value={customPrefix} onChange={event => setCustomPrefix(event.target.value)} placeholder={prefixMode === 'auto' ? '可选：给整个批次追加要求，例如“禁止Q版，人物比例写实”' : '输入这一批每个 VIDEO 都携带的统一前缀词'} />
                  </div>
                  <div>
                    <Typography.Text strong>项目风格</Typography.Text>
                    <Input value={style} onChange={event => setStyle(event.target.value)} style={{ marginTop: 8, maxWidth: 700 }} />
                  </div>
                  <Collapse size="small" items={[{
                    key: 'professional-constraints',
                    label: '专业视频约束',
                    children: <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <div><Typography.Text strong>画质约束</Typography.Text><Input.TextArea rows={3} value={quality} onChange={event => setQuality(event.target.value)} placeholder="例如：4K超清、电影级细节与光影层次" style={{ marginTop: 6 }} /></div>
                      <div><Typography.Text strong>画面限制</Typography.Text><Input.TextArea rows={3} value={restriction} onChange={event => setRestriction(event.target.value)} placeholder="例如：禁止无关文字、横幅、漂浮UI、字幕、水印和Logo" style={{ marginTop: 6 }} /></div>
                      <div><Typography.Text strong>负面提示词</Typography.Text><Input.TextArea rows={3} value={negative} onChange={event => setNegative(event.target.value)} placeholder="填写每个 VIDEO 都要携带的负面提示词" style={{ marginTop: 6 }} /></div>
                      <Typography.Text type="secondary">这些内容会复制到整批每一个独立 VIDEO 的最终 Prompt。</Typography.Text>
                    </Space>
                  }]} />
                </Space>
              }]} />

              <Button type="primary" size="large" icon={<WandSparkles size={17} />} loading={creating} onClick={createAndStart} disabled={!draftItems.length || !selectedVideoModel} style={{ alignSelf: 'flex-start' }}>
                应用统一设置并开始制作 {draftItems.length} 本
              </Button>
            </Space>
          </Card>

          <Card title="历史批次" extra={<Button size="small" icon={<RefreshCw size={14} />} onClick={refreshHistory}>刷新</Button>}>
            {historyLoading ? <Spin /> : history.length ? <List dataSource={history} renderItem={batch => <List.Item actions={[<Button key="open" onClick={() => loadBatch(batch.id)}>打开</Button>]}>
              <List.Item.Meta title={batch.name} description={`${settingSummary(batch)} · 导演完成 ${batch.completed}/${batch.total} · 待审核 ${batch.review} · 失败 ${batch.failed}`} />
            </List.Item>} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无批次" />}
          </Card>
        </> : <>
          <Card>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Space wrap>
                <Typography.Title level={4} style={{ margin: 0 }}>{activeBatch.name}</Typography.Title>
                <Tag>{settingSummary(activeBatch)}</Tag>
                <Tag color="gold">待审核 {reviewCount}</Tag>
                <Tag color="green">导演完成 {directorCompleteCount}</Tag>
                {failedCount ? <Tag color="red">制作失败 {failedCount}</Tag> : null}
                {hasActiveJobs ? <Tag color="processing">服务端队列处理中</Tag> : null}
              </Space>
              <Collapse size="small" items={[{
                key: 'batch-settings',
                label: '查看本批次统一生产设置',
                children: <Space wrap>
                  <Tag color="blue">{activeBatch.settings?.videoModelName || '未记录模型'}</Tag>
                  <Tag>{activeBatch.settings?.aspectRatio || '9:16'}</Tag>
                  <Tag>{activeBatch.settings?.fixedSingleVideo ? `固定 ${activeBatch.settings?.maxVideoDuration}s` : `AI自动 1-${activeBatch.settings?.maxVideoDuration}s`}</Tag>
                  <Tag>{activeBatch.settings?.prefixMode === 'manual' ? '统一手动前缀' : 'AI自动前缀'}</Tag>
                  {activeBatch.settings?.customPrefix ? <Tag color="purple">已设置统一追加前缀</Tag> : null}
                  {activeBatch.settings?.quality || activeBatch.settings?.restriction || activeBatch.settings?.negative ? <Tag color="purple">已设置专业约束</Tag> : null}
                </Space>
              }]} />
            </Space>
          </Card>

          <BatchFactoryBulkProduction batch={activeBatch} onRefresh={refreshActiveBatch} />

          <Card title="单书精细调整" extra={<Typography.Text type="secondary">默认全部收起；只有特殊小说才需要打开</Typography.Text>}>
            <Collapse items={(activeBatch.items || []).map((item, index) => {
              const itemCompileIssues = compileIssues[item.id] || {};
              const promptIssueCount = Object.keys(itemCompileIssues).length;
              const logs = activityEntries(item);
              const director = item.directorResult;
              return {
                key: item.id,
                style: itemCardStyle(item),
                label: <Space wrap>
                  <Typography.Text strong>{String(index + 1).padStart(2, '0')} · {item.title}</Typography.Text>
                  {item.bookId ? <Tag>书ID {item.bookId}</Tag> : null}
                  {item.platform ? <Tag color="blue">{item.platform}</Tag> : null}
                  {statusTag(item.status)}
                  {item.manuallyEdited || item.settingOverrides ? <Tag color="purple">单书已调整</Tag> : null}
                  {promptIssueCount ? <Tag color="red">提示词问题 {promptIssueCount}</Tag> : null}
                  {item.production?.failed ? <Tag color="red">视频提交失败 {item.production.failed}</Tag> : null}
                  {item.production?.projectId ? <Tag color="cyan">视频已提交</Tag> : null}
                </Space>,
                children: <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {item.error ? <Alert type="error" showIcon message="当前制作阶段失败" description={item.error} /> : null}
                  {promptIssueCount ? <Alert type="error" showIcon message="存在 VIDEO 提示词编译失败" description={Object.entries(itemCompileIssues).map(([videoId, detail]) => `VIDEO ${videoId}：${detail}`).join('；')} /> : null}
                  {item.production?.failed ? <Alert type="warning" showIcon message="部分 VIDEO 没有成功进入生成队列" description={`已排队 ${item.production.queued}/${item.production.total}，失败 ${item.production.failed}。可在下方视频生产区查看并处理。`} /> : null}

                  <Collapse size="small" items={[{
                    key: 'source',
                    label: '来源与原文',
                    children: <Space direction="vertical" size={10} style={{ width: '100%' }}>
                      {item.sourceType === 'novel-fetch' ? <Space wrap><Tag>小说获取任务 #{item.sourceTaskId}</Tag><Tag>书ID {item.bookId}</Tag><Tag color="blue">{item.platform || '平台未提供'}</Tag><Tag>{item.txtFileName || `${item.bookId}.txt`}</Tag></Space> : <Tag>手动导入</Tag>}
                      <Input.TextArea rows={10} value={item.sourceText} readOnly />
                    </Space>
                  }]} />

                  {activeBatch.mode === 'viral' && item.hookDraft ? <Collapse defaultActiveKey={item.status === 'hook_review' ? ['hook-review'] : []} items={[{
                    key: 'hook-review',
                    label: <Space wrap><span>爆款开头</span>{item.status === 'hook_review' ? <Tag color="gold">需要审核</Tag> : <Tag>已处理</Tag>}</Space>,
                    children: <Card size="small" extra={item.status === 'hook_review' ? <Space><Button onClick={() => rewriteHook(item)}>重新改编</Button><Button type="primary" icon={<Check size={15} />} onClick={() => approveHook(item)}>通过并导演</Button></Space> : null}>
                      <Tabs items={[
                        { key: 'source', label: '原文', children: <Input.TextArea rows={10} value={item.sourceText} readOnly /> },
                        { key: 'hook', label: '爆款开头', children: <Input.TextArea rows={10} value={hookEdits[item.id] ?? item.approvedHookScript ?? item.hookDraft} readOnly={item.status !== 'hook_review'} onChange={event => setHookEdits(current => ({ ...current, [item.id]: event.target.value }))} /> }
                      ]} />
                    </Card>
                  }]} /> : null}

                  {director ? <>
                    <Collapse items={[{
                      key: 'director-detail',
                      label: <Space wrap><span>详细设定与提示词</span><Tag>人物 {director.characters?.length || 0}</Tag><Tag>场景 {director.scenes?.length || 0}</Tag><Tag>道具 {director.props?.length || 0}</Tag><Tag>VIDEO {director.storyboard?.length || 0}</Tag></Space>,
                      children: <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <Tabs items={[
                          { key: 'characters', label: `人物 ${director.characters?.length || 0}`, children: <List bordered size="small" dataSource={director.characters || []} renderItem={entry => <List.Item><List.Item.Meta title={entry.name} description={entry.prompt} /></List.Item>} /> },
                          { key: 'scenes', label: `场景 ${director.scenes?.length || 0}`, children: <List bordered size="small" dataSource={director.scenes || []} renderItem={entry => <List.Item><List.Item.Meta title={entry.name} description={entry.prompt} /></List.Item>} /> },
                          { key: 'props', label: `道具 ${director.props?.length || 0}`, children: <List bordered size="small" dataSource={director.props || []} renderItem={entry => <List.Item><List.Item.Meta title={entry.name} description={entry.prompt} /></List.Item>} /> },
                          { key: 'videos', label: `VIDEO ${director.storyboard?.length || 0}`, children: <Collapse size="small" items={(director.storyboard || []).map(video => ({
                            key: String(video.id),
                            label: <Space wrap><Typography.Text strong>VIDEO {video.id} · {video.duration_sec}秒</Typography.Text>{itemCompileIssues[String(video.id)] ? <Tag color="red">提示词失败</Tag> : null}</Space>,
                            children: <Space direction="vertical" size={10} style={{ width: '100%' }}>
                              <Space wrap><Tag>{video.scene || '未指定场景'}</Tag><Tag>{video.prefix_key || 'general_anime'}</Tag><Tag>{video.characters?.join('、') || '无人'}</Tag></Space>
                              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{video.video_desc}</Typography.Paragraph>
                              <Divider style={{ margin: '4px 0' }} />
                              {(video.shots || []).map((shot, shotIndex) => <div key={`${video.id}-${shotIndex}`}><Typography.Text strong>{shot.start_sec}-{shot.end_sec}秒 {shot.shot_type ? `· ${shot.shot_type}` : ''} {shot.camera ? `· ${shot.camera}` : ''}</Typography.Text><div>{shot.description}</div></div>)}
                              <Button icon={<Sparkles size={15} />} onClick={() => compileVideo(item, video)} style={{ alignSelf: 'flex-start' }}>查看 / 编译最终 Prompt</Button>
                            </Space>
                          }))} /> }
                        ]} />
                        <Space wrap>
                          <Button icon={<Pencil size={15} />} onClick={() => openDirectorEditor(item)}>单独修改导演结果</Button>
                          <Button onClick={() => regenerateDirector(item)}>使用当前预设重新导演</Button>
                          {item.promptVersions ? <Typography.Text type="secondary">已记录本次元提示词版本</Typography.Text> : null}
                        </Space>
                      </Space>
                    }]} />
                    <BatchFactoryProductionControls batch={activeBatch} item={item} onRefresh={refreshActiveBatch} />
                  </> : item.status === 'hook_review' ? null : <Spin tip={activeStatuses.has(item.status) ? '生成中' : '等待结果'} />}

                  <Collapse size="small" items={[{
                    key: 'activity-log',
                    label: <Space wrap><span>操作记录 / 日志</span>{logs.length ? <Tag>{logs.length} 条</Tag> : null}</Space>,
                    children: logs.length ? <List
                      size="small"
                      dataSource={logs}
                      renderItem={entry => <List.Item>
                        <Space direction="vertical" size={2}>
                          <Space wrap><Typography.Text strong>{entry.message || '状态更新'}</Typography.Text>{entry.videoId ? <Tag>VIDEO {entry.videoId}</Tag> : null}{entry.type === 'error' ? <Tag color="red">异常</Tag> : null}</Space>
                          <Typography.Text type="secondary">{formatTime(entry.at)}</Typography.Text>
                        </Space>
                      </List.Item>}
                    /> : <Typography.Text type="secondary">这个旧批次暂时没有阶段日志；后续状态变化会开始记录。</Typography.Text>
                  }]} />
                </Space>
              };
            })} />
          </Card>
        </>}
      </Space>

      <Modal title={compiled.title || '最终视频 Prompt'} open={compiled.open} onCancel={() => setCompiled({ open: false, loading: false, title: '', prompt: '', payload: null, error: '' })} footer={compiled.prompt ? <Button type="primary" onClick={async () => { await navigator.clipboard?.writeText(compiled.prompt); message.success('已复制最终 Prompt'); }}>复制 Prompt</Button> : null} width={900}>
        {compiled.loading ? <Spin /> : <>
          {compiled.error ? <Alert type="error" showIcon message="提示词编译失败" description={`${compiled.error}。问题已附带书ID和 VIDEO 上下文提交到问题日志。`} style={{ marginBottom: 12 }} /> : null}
          {compiled.payload ? <Alert type="info" showIcon message={`实际提交参数：duration=${compiled.payload.duration} · aspect_ratio=${compiled.payload.aspect_ratio}`} style={{ marginBottom: 12 }} /> : null}
          {compiled.prompt ? <Input.TextArea rows={24} value={compiled.prompt} readOnly /> : null}
        </>}
      </Modal>

      <Modal
        title={directorEditor.title || '手动编辑导演结果'}
        open={directorEditor.open}
        onCancel={() => setDirectorEditor({ open: false, saving: false, itemId: '', title: '', value: '' })}
        onOk={saveDirectorEditor}
        confirmLoading={directorEditor.saving}
        okText="校验并保存"
        width={1100}
      >
        <Alert type="info" showIcon message="单书修改不会调用 AI" description="保存时服务器仍会强制检查整数秒、固定单VIDEO、时间轴连续性，以及人物/场景/道具引用。修改后这本书会显示“单书已调整”，最终 Prompt 会重新编译。" style={{ marginBottom: 12 }} />
        <Input.TextArea rows={30} value={directorEditor.value} onChange={event => setDirectorEditor(current => ({ ...current, value: event.target.value }))} spellCheck={false} />
      </Modal>
    </div>
  );
}

export default BatchFactoryPage;
