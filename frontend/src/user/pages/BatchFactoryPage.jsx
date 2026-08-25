import { Alert, Button, Card, Collapse, Divider, Empty, Input, List, Modal, Segmented, Space, Spin, Switch, Tabs, Tag, Typography, message } from 'antd';
import { Check, FilePlus2, Pencil, RefreshCw, Sparkles, UploadCloud, WandSparkles, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  approveBatchFactoryHook,
  compileBatchFactoryVideo,
  createBatchFactoryBatch,
  getBatchFactoryBatch,
  listBatchFactoryBatches,
  regenerateBatchFactoryDirector,
  rewriteBatchFactoryHook,
  startBatchFactoryBatch,
  updateBatchFactoryDirectorResult
} from '../../shared/api/batchFactory';

const activeStatuses = new Set(['queued_hook', 'hook_generating', 'queued_director', 'director_generating']);

const statusLabels = {
  pending: ['待开始', 'default'],
  queued_hook: ['爆款排队', 'processing'],
  hook_generating: ['改编中', 'processing'],
  hook_review: ['待审核', 'gold'],
  queued_director: ['导演排队', 'processing'],
  director_generating: ['导演生成中', 'processing'],
  complete: ['已完成', 'green'],
  failed: ['失败', 'red']
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
  return `${batch.mode === 'viral' ? '爆款开头' : '原文直转'} · ${batch.settings?.fixedSingleVideo ? `固定单镜头 ${duration}s` : `单段最大 ${duration}s`} · ${batch.settings?.aspectRatio || '9:16'}`;
}

export function BatchFactoryPage() {
  const [pasted, setPasted] = useState('');
  const [draftItems, setDraftItems] = useState([]);
  const [mode, setMode] = useState('original');
  const [maxVideoDuration, setMaxVideoDuration] = useState(10);
  const [fixedSingleVideo, setFixedSingleVideo] = useState(false);
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [prefixMode, setPrefixMode] = useState('auto');
  const [customPrefix, setCustomPrefix] = useState('');
  const [style, setStyle] = useState('高质量动漫短视频');
  const [quality, setQuality] = useState('');
  const [restriction, setRestriction] = useState('');
  const [negative, setNegative] = useState('');
  const [creating, setCreating] = useState(false);
  const [activeBatch, setActiveBatch] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hookEdits, setHookEdits] = useState({});
  const [compiled, setCompiled] = useState({ open: false, loading: false, title: '', prompt: '', payload: null });
  const [directorEditor, setDirectorEditor] = useState({ open: false, saving: false, itemId: '', title: '', value: '' });
  const fileInputRef = useRef(null);

  const hasActiveJobs = useMemo(() => activeBatch?.items?.some(item => activeStatuses.has(item.status)), [activeBatch]);

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
    } catch (error) {
      message.error(error.message || '读取批次失败');
    }
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
    setCreating(true);
    try {
      const created = await createBatchFactoryBatch({
        mode,
        items: draftItems,
        settings: {
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
      setHookEdits({});
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
      const result = await getBatchFactoryBatch(activeBatch.id);
      setActiveBatch(result.batch);
      message.success('已锁定爆款开头，开始导演生成');
    } catch (error) {
      message.error(error.message || '通过失败');
    }
  }

  async function rewriteHook(item) {
    try {
      await rewriteBatchFactoryHook(activeBatch.id, item.id);
      const result = await getBatchFactoryBatch(activeBatch.id);
      setActiveBatch(result.batch);
    } catch (error) {
      message.error(error.message || '重写失败');
    }
  }

  async function regenerateDirector(item) {
    try {
      await regenerateBatchFactoryDirector(activeBatch.id, item.id);
      const result = await getBatchFactoryBatch(activeBatch.id);
      setActiveBatch(result.batch);
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
      const refreshed = await getBatchFactoryBatch(activeBatch.id);
      setActiveBatch(refreshed.batch);
      setDirectorEditor({ open: false, saving: false, itemId: '', title: '', value: '' });
      message.success('人工修改已保存；不会额外调用 AI');
    } catch (error) {
      setDirectorEditor(current => ({ ...current, saving: false }));
      message.error(error.message || '导演结果保存失败');
    }
  }

  async function compileVideo(item, video) {
    setCompiled({ open: true, loading: true, title: `${item.title} · VIDEO ${video.id}`, prompt: '', payload: null });
    try {
      const result = await compileBatchFactoryVideo(activeBatch.id, item.id, video.id);
      setCompiled({ open: true, loading: false, title: `${item.title} · VIDEO ${video.id}`, prompt: result.payload?.prompt || '', payload: result.payload });
    } catch (error) {
      setCompiled(current => ({ ...current, loading: false }));
      message.error(error.message || '编译视频提示词失败');
    }
  }

  const reviewCount = activeBatch?.items?.filter(item => item.status === 'hook_review').length || 0;
  const completedCount = activeBatch?.items?.filter(item => item.status === 'complete').length || 0;
  const failedCount = activeBatch?.items?.filter(item => item.status === 'failed').length || 0;

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto', padding: '24px' }}>
      <Space direction="vertical" size={18} style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <Typography.Title level={2} style={{ marginBottom: 4 }}><Zap size={25} style={{ verticalAlign: -4, marginRight: 8 }} />批量工厂</Typography.Title>
            <Typography.Paragraph type="secondary">批量导入小说开篇；原文直转一回导演 AI，爆款模式先审核文案再进入第二回导演。</Typography.Paragraph>
          </div>
          {activeBatch ? <Button onClick={() => { setActiveBatch(null); refreshHistory(); }}>新建批次</Button> : null}
        </div>

        {!activeBatch ? <>
          <Card title="1. 导入小说开篇">
            <Input.TextArea
              rows={8}
              value={pasted}
              onChange={event => setPasted(event.target.value)}
              placeholder={'粘贴一篇或多篇小说开篇。多篇之间可以用一行 --- 分隔。'}
            />
            <Space wrap style={{ marginTop: 12 }}>
              <Button icon={<FilePlus2 size={16} />} onClick={addPasted}>加入文案</Button>
              <Button icon={<UploadCloud size={16} />} onClick={() => fileInputRef.current?.click()}>上传 TXT / MD</Button>
              <input ref={fileInputRef} type="file" multiple accept=".txt,.md,text/plain,text/markdown" hidden onChange={addFiles} />
              <Typography.Text type="secondary">当前 {draftItems.length} / 200 篇</Typography.Text>
            </Space>
            {draftItems.length ? <List
              size="small"
              style={{ marginTop: 14 }}
              bordered
              dataSource={draftItems}
              renderItem={(item, index) => <List.Item
                actions={[<Button key="delete" size="small" type="text" danger onClick={() => setDraftItems(current => current.filter((_, itemIndex) => itemIndex !== index))}>删除</Button>]}
              >
                <List.Item.Meta title={`${String(index + 1).padStart(2, '0')} · ${item.title}`} description={`${item.sourceText.length.toLocaleString()} 字符`} />
              </List.Item>}
            /> : null}
          </Card>

          <Card title="2. 生产设置">
            <Space direction="vertical" size={18} style={{ width: '100%' }}>
              <div>
                <Typography.Text strong>生产方式</Typography.Text>
                <div style={{ marginTop: 8 }}><Segmented value={mode} onChange={setMode} options={[{ value: 'original', label: '原文直转 · 1回AI' }, { value: 'viral', label: '爆款开头 · 2回AI' }]} /></div>
              </div>
              <div>
                <Typography.Text strong>视频模型单次时长能力</Typography.Text>
                <div style={{ marginTop: 8 }}><Segmented value={maxVideoDuration} onChange={setMaxVideoDuration} options={[{ value: 10, label: '10s' }, { value: 15, label: '15s' }]} /></div>
                <Typography.Text type="secondary">{fixedSingleVideo ? `固定单镜头开启后，只输出一个完整 ${maxVideoDuration}s Video。` : `普通模式中 ${maxVideoDuration}s 是单个 Video 的最大时长，AI 可在 1-${maxVideoDuration}s 内选择整数秒，并按内容拆成多个 Video。`}</Typography.Text>
              </div>
              <Space align="center">
                <Switch checked={fixedSingleVideo} onChange={setFixedSingleVideo} />
                <div><Typography.Text strong>固定单镜头</Typography.Text><br /><Typography.Text type="secondary">输入再多也只输出一个 Video；内部仍可有 3~5 个镜头切换。</Typography.Text></div>
              </Space>
              <div>
                <Typography.Text strong>视频画幅</Typography.Text>
                <div style={{ marginTop: 8 }}><Segmented value={aspectRatio} onChange={setAspectRatio} options={['9:16', '16:9']} /></div>
              </div>
              <div>
                <Typography.Text strong>画面前缀</Typography.Text>
                <div style={{ marginTop: 8 }}><Segmented value={prefixMode} onChange={setPrefixMode} options={[{ value: 'auto', label: 'AI按每个Video自动判断' }, { value: 'manual', label: '仅使用手动前缀' }]} /></div>
                <Input.TextArea style={{ marginTop: 8 }} rows={3} value={customPrefix} onChange={event => setCustomPrefix(event.target.value)} placeholder={prefixMode === 'auto' ? '可选：在自动前缀后追加你的要求，例如“禁止Q版，人物比例写实”' : '输入这一批每个 Video 都要携带的前缀词'} />
              </div>
              <div>
                <Typography.Text strong>项目风格</Typography.Text>
                <Input value={style} onChange={event => setStyle(event.target.value)} style={{ marginTop: 8, maxWidth: 700 }} />
              </div>
              <Collapse
                style={{ width: '100%' }}
                items={[{
                  key: 'advanced-video-constraints',
                  label: '高级视频约束（沿用剧本生成约束思路）',
                  children: <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <div><Typography.Text strong>画质约束</Typography.Text><Input.TextArea rows={3} value={quality} onChange={event => setQuality(event.target.value)} placeholder="例如：4K超清、电影级细节与光影层次" style={{ marginTop: 6 }} /></div>
                    <div><Typography.Text strong>画面限制</Typography.Text><Input.TextArea rows={3} value={restriction} onChange={event => setRestriction(event.target.value)} placeholder="例如：禁止无关文字、横幅、漂浮UI、字幕、水印和Logo" style={{ marginTop: 6 }} /></div>
                    <div><Typography.Text strong>负面提示词</Typography.Text><Input.TextArea rows={3} value={negative} onChange={event => setNegative(event.target.value)} placeholder="填写每个 Video 都要携带的负面提示词" style={{ marginTop: 6 }} /></div>
                    <Typography.Text type="secondary">这些内容会在视频生成前由服务器复制到每一个独立 VIDEO 的最终 Prompt，不会只写在整批开头。</Typography.Text>
                  </Space>
                }]}
              />
              <Button type="primary" size="large" icon={<WandSparkles size={17} />} loading={creating} onClick={createAndStart} disabled={!draftItems.length}>创建批次并开始</Button>
            </Space>
          </Card>

          <Card title="历史批次" extra={<Button size="small" icon={<RefreshCw size={14} />} onClick={refreshHistory}>刷新</Button>}>
            {historyLoading ? <Spin /> : history.length ? <List dataSource={history} renderItem={batch => <List.Item actions={[<Button key="open" onClick={() => loadBatch(batch.id)}>打开</Button>]}>
              <List.Item.Meta title={batch.name} description={`${settingSummary(batch)} · 完成 ${batch.completed}/${batch.total} · 待审核 ${batch.review} · 失败 ${batch.failed}`} />
            </List.Item>} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无批次" />}
          </Card>
        </> : <>
          <Card>
            <Space wrap>
              <Typography.Title level={4} style={{ margin: 0 }}>{activeBatch.name}</Typography.Title>
              <Tag>{settingSummary(activeBatch)}</Tag>
              <Tag color="gold">待审核 {reviewCount}</Tag>
              <Tag color="green">完成 {completedCount}</Tag>
              {failedCount ? <Tag color="red">失败 {failedCount}</Tag> : null}
              {hasActiveJobs ? <Tag color="processing">服务端队列处理中</Tag> : null}
            </Space>
          </Card>

          <Collapse items={(activeBatch.items || []).map((item, index) => ({
            key: item.id,
            label: <Space><Typography.Text strong>{String(index + 1).padStart(2, '0')} · {item.title}</Typography.Text>{statusTag(item.status)}{item.manuallyEdited ? <Tag color="blue">人工已修改</Tag> : null}</Space>,
            children: <Space direction="vertical" size={14} style={{ width: '100%' }}>
              {item.error ? <Alert type="error" showIcon message={item.error} /> : null}
              {activeBatch.mode === 'viral' && item.hookDraft ? <Card size="small" title="爆款开头审核" extra={item.status === 'hook_review' ? <Space><Button onClick={() => rewriteHook(item)}>重新改编</Button><Button type="primary" icon={<Check size={15} />} onClick={() => approveHook(item)}>通过并导演</Button></Space> : null}>
                <Tabs items={[
                  { key: 'source', label: '原文', children: <Input.TextArea rows={10} value={item.sourceText} readOnly /> },
                  { key: 'hook', label: '爆款开头', children: <Input.TextArea rows={10} value={hookEdits[item.id] ?? item.approvedHookScript ?? item.hookDraft} readOnly={item.status !== 'hook_review'} onChange={event => setHookEdits(current => ({ ...current, [item.id]: event.target.value }))} /> }
                ]} />
              </Card> : null}

              {item.directorResult ? <>
                <Tabs items={[
                  { key: 'characters', label: `人物 ${item.directorResult.characters?.length || 0}`, children: <List bordered size="small" dataSource={item.directorResult.characters || []} renderItem={entry => <List.Item><List.Item.Meta title={entry.name} description={entry.prompt} /></List.Item>} /> },
                  { key: 'scenes', label: `场景 ${item.directorResult.scenes?.length || 0}`, children: <List bordered size="small" dataSource={item.directorResult.scenes || []} renderItem={entry => <List.Item><List.Item.Meta title={entry.name} description={entry.prompt} /></List.Item>} /> },
                  { key: 'props', label: `道具 ${item.directorResult.props?.length || 0}`, children: <List bordered size="small" dataSource={item.directorResult.props || []} renderItem={entry => <List.Item><List.Item.Meta title={entry.name} description={entry.prompt} /></List.Item>} /> },
                  { key: 'videos', label: `视频方案 ${item.directorResult.storyboard?.length || 0}`, children: <Space direction="vertical" size={12} style={{ width: '100%' }}>{(item.directorResult.storyboard || []).map(video => <Card key={video.id} size="small" title={`VIDEO ${video.id} · ${video.duration_sec}秒`} extra={<Button icon={<Sparkles size={15} />} onClick={() => compileVideo(item, video)}>查看最终上传 Prompt</Button>}>
                    <Space wrap style={{ marginBottom: 8 }}><Tag>{video.scene || '未指定场景'}</Tag><Tag>{video.prefix_key || 'general_anime'}</Tag><Tag>{video.characters?.join('、') || '无人'}</Tag></Space>
                    <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{video.video_desc}</Typography.Paragraph>
                    <Divider style={{ margin: '12px 0' }} />
                    {(video.shots || []).map((shot, shotIndex) => <div key={`${video.id}-${shotIndex}`} style={{ marginBottom: 8 }}><Typography.Text strong>{shot.start_sec}-{shot.end_sec}秒 {shot.shot_type ? `· ${shot.shot_type}` : ''} {shot.camera ? `· ${shot.camera}` : ''}</Typography.Text><div>{shot.description}</div></div>)}
                  </Card>)}</Space> }
                ]} />
                <Space wrap>
                  <Button icon={<Pencil size={15} />} onClick={() => openDirectorEditor(item)}>手动编辑导演结果</Button>
                  <Button onClick={() => regenerateDirector(item)}>使用当前预设重新导演</Button>
                  {item.promptVersions ? <Typography.Text type="secondary">已记录本次元提示词版本</Typography.Text> : null}
                </Space>
              </> : item.status === 'hook_review' ? null : <Spin tip={activeStatuses.has(item.status) ? '生成中' : '等待结果'} />}
            </Space>
          }))} />
        </>}
      </Space>

      <Modal title={compiled.title || '最终视频 Prompt'} open={compiled.open} onCancel={() => setCompiled({ open: false, loading: false, title: '', prompt: '', payload: null })} footer={compiled.prompt ? <Button type="primary" onClick={async () => { await navigator.clipboard?.writeText(compiled.prompt); message.success('已复制最终 Prompt'); }}>复制 Prompt</Button> : null} width={900}>
        {compiled.loading ? <Spin /> : <>
          {compiled.payload ? <Alert type="info" showIcon message={`实际提交参数：duration=${compiled.payload.duration} · aspect_ratio=${compiled.payload.aspect_ratio}`} style={{ marginBottom: 12 }} /> : null}
          <Input.TextArea rows={24} value={compiled.prompt} readOnly />
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
        <Alert type="info" showIcon message="手动修改不会调用 AI" description="保存时服务器仍会强制检查整数秒、固定单镜头、时间轴连续性，以及人物/场景/道具引用。修改后最终上传 Prompt 会重新编译。" style={{ marginBottom: 12 }} />
        <Input.TextArea rows={30} value={directorEditor.value} onChange={event => setDirectorEditor(current => ({ ...current, value: event.target.value }))} spellCheck={false} />
      </Modal>
    </div>
  );
}

export default BatchFactoryPage;
