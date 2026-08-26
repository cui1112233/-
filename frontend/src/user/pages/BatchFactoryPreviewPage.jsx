import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Drawer, Input, Modal, Progress, Select, Tag, message } from 'antd';
import { AlertTriangle, ArrowLeft, ChevronDown, CircleCheck, Clock3, FileText, FolderOpen, Play, RotateCcw, Settings2, Sparkles, Upload, Video } from 'lucide-react';
import { createBatchFactoryBatch, getBatchFactoryBatch, listBatchFactoryBatches } from '../../shared/api/batchFactory';
import { loadBatchFactoryVideoModels } from './batch-factory/BatchFactoryProductionControls';
import { fileToDraft, parseManualNovels, validateDraftItems } from './batch-factory/intake';
import './batch-factory-preview.css';

const STATUS_ORDER = ['全部', '待开始', '待审核', 'AI处理中', '待生成', '排队中', '视频生成中', '异常', '待合并', '已合并'];
const samples = [
  ['余生不逢云', '207414171084...', '已合并'], ['她离开以后', '2072480890496...', '待生成'], ['春风不渡', '20764104100976...', '异常'],
  ['星沉大海', '2078234234556...', '待审核'], ['烟火人间', '2076232344556...', '排队中'], ['归去来兮', '207734455667...', '已合并'], ['长夜将尽', '207845566778...', '待生成']
].map(([title, bookId, displayStatus], index) => ({ id: `sample-${index}`, title, bookId, displayStatus, index: index + 1 }));

function itemStatus(item) {
  if (item.status === 'failed' || item.production?.failed) return '异常';
  if (item.production?.mergedAt || item.mergedAt) return '已合并';
  if (item.production?.status === 'running') return '视频生成中';
  if (item.production?.status === 'queued') return '排队中';
  if (item.production?.readyToMerge) return '待合并';
  if (item.status === 'hook_review') return '待审核';
  if (['queued_hook', 'hook_generating', 'queued_director', 'director_generating'].includes(item.status)) return 'AI处理中';
  return item.status === 'complete' || item.directorResult ? '待生成' : '待开始';
}
function tone(status) { return ({ 异常: 'red', 已合并: 'green', 待合并: 'green', 排队中: 'blue', 视频生成中: 'blue', 待生成: 'gold', AI处理中: 'blue' })[status]; }
function mapItems(batch) { return (batch?.items || []).map((item, index) => ({ ...item, id: item.id || `book-${index}`, title: item.title || '未命名小说', bookId: item.bookId || '', index: index + 1, displayStatus: itemStatus(item) })); }
function summarise(items) { return STATUS_ORDER.reduce((out, label) => ({ ...out, [label]: label === '全部' ? items.length : items.filter(item => item.displayStatus === label).length }), {}); }
function summaryText(batch) { const s = batch?.settings || {}; return `${batch?.mode === 'viral' ? '爆款开头' : '原著直出'} · ${s.videoModelName || '未选择模型'} · ${s.aspectRatio || '9:16'} · ${s.fixedSingleVideo ? `固定 ${s.maxVideoDuration || 10}s` : `AI 自动 1-${s.maxVideoDuration || 10}s`}`; }

function BookList({ entries, selectedId, onSelect }) {
  const [search, setSearch] = useState('');
  const shown = entries.filter(item => `${item.title} ${item.bookId}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <aside className="bf-preview-books"><div className="bf-preview-section-title"><span>小说列表</span><small>{shown.length}/{entries.length}</small></div><div className="bf-preview-book-tools"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索书名 / Book ID" /><select defaultValue="all"><option value="all">全部状态</option></select><button aria-label="列表设置"><Settings2 size={15} /></button></div><div className="bf-preview-book-list">{shown.map(item => <button data-batch-item-id={item.id} key={item.id} className={`bf-preview-book ${selectedId === item.id ? 'is-selected' : ''}`} onClick={() => onSelect(item.id)}><span className="bf-preview-book-id">{String(item.index).padStart(2, '0')} ·</span><span className="bf-preview-book-copy"><strong>{item.title}</strong>{item.bookId ? <small>Book ID {item.bookId}</small> : null}</span><Tag color={tone(item.displayStatus)}>{item.displayStatus}</Tag></button>)}</div><div className="bf-preview-pagination">共 {entries.length} 本 <b>1</b></div></aside>;
}

function CurrentBook({ item }) {
  const failed = item?.displayStatus === '异常';
  return <section className="bf-preview-center"><div className="bf-preview-current"><div><h2>{item?.title || '请选择小说'}</h2>{item?.bookId ? <span>Book ID {item.bookId}</span> : null}<Tag color={tone(item?.displayStatus)}>{item?.displayStatus || '待开始'}</Tag>{item?.settingOverrides ? <Tag color="purple">单书已调整</Tag> : null}</div><Button icon={<Settings2 size={15} />}>单书设置</Button></div>{failed ? <div className="bf-preview-alert"><AlertTriangle size={22} /><div><strong>存在异常 VIDEO</strong><small>{item.error || '视频生成失败，请检查后重试。'}</small></div><Button danger>重试</Button></div> : null}<div className="bf-preview-content-grid"><div className="bf-preview-folds"><button><FileText size={16} /> 原文 <ChevronDown size={15} /></button><div className="bf-preview-readonly">{item?.sourceText || '选择小说后在此查看原文、编辑记录和锁定状态。'}</div><button><Sparkles size={16} /> 爆款钩子 <ChevronDown size={15} /></button><button><FolderOpen size={16} /> 人物 / 场景 / 道具 <ChevronDown size={15} /></button><button><Video size={16} /> VIDEO 提示词 <ChevronDown size={15} /></button><button><Clock3 size={16} /> 操作记录 <ChevronDown size={15} /></button></div></div></section>;
}

function VideoOperations({ item }) {
  const [choice, setChoice] = useState('merged');
  const videos = item?.directorResult?.storyboard || [{ id: '01', duration_sec: 13 }, { id: '02', duration_sec: 12 }, { id: '03', duration_sec: 10 }];
  return <aside className="bf-preview-video-operations"><div className="bf-preview-section-title"><span>当前书 VIDEO</span><small>唯一播放框</small></div><div className="bf-preview-video-section">{videos.map((video, index) => { const id = String(video.id || index + 1).padStart(2, '0'); const failed = item?.displayStatus === '异常' && index === videos.length - 1; return <button key={id} className={`bf-preview-video-card ${choice === id ? 'is-open' : ''}`} onClick={() => setChoice(id)}><Video size={15} /><strong>VIDEO {id}</strong><span>{video.duration_sec || 10}s</span><Tag color={failed ? 'red' : 'gold'}>{failed ? '失败' : '待生成'}</Tag></button>; })}<button className={`bf-preview-video-card ${choice === 'merged' ? 'is-open' : ''}`} onClick={() => setChoice('merged')}><CircleCheck size={15} /><strong>合并成片</strong><span>当前书</span><Tag>未合并</Tag></button></div><section className="bf-preview-player-panel"><div className="bf-preview-player"><Play size={28} /><div>{choice === 'merged' ? '合并成片预览' : `VIDEO ${choice} 预览`}</div></div><div className="bf-preview-player-actions"><Button size="small" icon={<RotateCcw size={14} />}>重试</Button><Button size="small">查看 Prompt</Button></div></section><section className="bf-preview-composer"><h3>合并设置 <ChevronDown size={15} /></h3><label>成品时长处理</label><div className="bf-preview-segment"><b>倍速</b><span>跟随音频时长</span></div><select defaultValue="1.5"><option value="1.5">1.5x</option></select><Button type="primary" block>合并当前小说</Button></section></aside>;
}

function BatchIntakeDrawer({ open, onClose, onCreated }) {
  const [pasted, setPasted] = useState('');
  const [items, setItems] = useState([]);
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState(null);
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    loadBatchFactoryVideoModels().then(result => {
      if (!active) return;
      const compatible = result.filter(model => model.requiresImageInput !== true && Number(model.maxVideoDuration) >= 1);
      setModels(compatible);
      if (compatible.length) setModelId(current => current || compatible[0].id);
    }).catch(error => active && message.error(error.message || '读取视频模型失败'));
    return () => { active = false; };
  }, [open]);

  function addPasted() {
    const next = parseManualNovels(pasted);
    if (!next.length) return message.warning('请先粘贴小说正文');
    setItems(current => [...current, ...next].slice(0, 200));
    setPasted('');
  }

  async function addFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    const supported = files.filter(file => /\.(txt|md)$/i.test(file.name));
    if (supported.length !== files.length) message.warning('只支持 TXT / MD 文件');
    const next = await Promise.all(supported.map(async file => fileToDraft(file.name, await file.text())));
    setItems(current => [...current, ...next.filter(item => item.sourceText)].slice(0, 200));
  }

  async function submit(drafts) {
    const selectedModel = models.find(model => Number(model.id) === Number(modelId));
    if (!drafts.length) return message.warning('至少导入一篇小说');
    if (!selectedModel) return message.warning('请选择可用的视频模型');
    setCreating(true);
    try {
      const created = await createBatchFactoryBatch({
        mode: 'original',
        items: drafts,
        settings: {
          videoModelId: selectedModel.id,
          videoModelVersionId: selectedModel.versionId,
          videoModelName: selectedModel.name,
          maxVideoDuration: selectedModel.maxVideoDuration,
          fixedSingleVideo: false,
          aspectRatio: '9:16',
          prefixMode: 'auto',
          style: '高质量动漫短视频'
        }
      });
      onCreated(created.batch);
      setItems([]);
      onClose();
      message.success(`已创建批次，包含 ${drafts.length} 本小说`);
    } catch (error) {
      message.error(error.message || '创建批次失败');
    } finally {
      setCreating(false);
    }
  }

  function create() {
    try {
      const drafts = validateDraftItems(items);
      const duplicates = drafts.some(item => item.duplicateFields?.length);
      if (!duplicates) return submit(drafts);
      Modal.confirm({
        title: '检测到重复书名或 Book ID',
        content: '继续创建会保留重复标记，不会自动修改书名或 Book ID。',
        okText: '继续创建',
        cancelText: '返回修改',
        onOk: () => submit(drafts)
      });
    } catch (error) {
      message.error(error.message || '导入内容不符合要求');
    }
  }

  return <Drawer title="新建批次" placement="right" width={560} open={open} onClose={onClose} destroyOnClose>
    <div className="bf-intake-drawer">
      <label>粘贴小说正文</label>
      <Input.TextArea rows={9} value={pasted} onChange={event => setPasted(event.target.value)} placeholder={'支持多篇粘贴：\n1\n第一篇标题\n正文\n\n2\n第二篇标题\n正文'} />
      <div className="bf-intake-actions"><Button onClick={addPasted}>加入列表</Button><input ref={fileInputRef} type="file" accept=".txt,.md,text/plain,text/markdown" multiple hidden onChange={addFiles} /><Button onClick={() => fileInputRef.current?.click()}>上传 TXT / MD</Button></div>
      <label>视频模型</label>
      <Select value={modelId} onChange={setModelId} placeholder="选择视频模型" options={models.map(model => ({ value: model.id, label: `${model.name} · 最长 ${model.maxVideoDuration}s` }))} />
      <div className="bf-intake-list"><strong>待导入小说 {items.length}/200</strong>{items.map((item, index) => <div key={`${item.title}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><b>{item.title || '未命名小说'}</b>{item.bookId ? <small>Book ID {item.bookId}</small> : null}<Button type="text" danger size="small" onClick={() => setItems(current => current.filter((_, itemIndex) => itemIndex !== index))}>移除</Button></div>)}</div>
      <Button type="primary" block loading={creating} onClick={create}>创建批次</Button>
    </div>
  </Drawer>;
}

export function BatchFactoryPreviewPage() {
  const [batch, setBatch] = useState(null); const [selectedId, setSelectedId] = useState(''); const [currentFilter, setCurrentFilter] = useState('全部'); const [filterPosition, setFilterPosition] = useState(0); const [intakeOpen, setIntakeOpen] = useState(false); const listRef = useRef(null);
  useEffect(() => { let disposed = false; (async () => { try { const { batches } = await listBatchFactoryBatches(); if (!batches?.[0]) return; const detail = await getBatchFactoryBatch(batches[0].id); if (!disposed) setBatch(detail.batch || null); } catch (_) { /* Empty-state frame remains usable. */ } })(); return () => { disposed = true; }; }, []);
  const entries = useMemo(() => { const items = mapItems(batch); return items.length ? items : samples; }, [batch]);
  const summary = summarise(entries); const selected = entries.find(item => item.id === selectedId) || entries[0]; const currentItems = currentFilter === '全部' ? entries : entries.filter(item => item.displayStatus === currentFilter);
  useEffect(() => { if (!selectedId && entries[0]) setSelectedId(entries[0].id); }, [entries, selectedId]);
  function locateStatus(label) { const matching = label === '全部' ? entries : entries.filter(item => item.displayStatus === label); const next = label === currentFilter ? (filterPosition + 1) % Math.max(1, matching.length) : 0; setCurrentFilter(label); setFilterPosition(next); if (!matching[next]) return; setSelectedId(matching[next].id); requestAnimationFrame(() => listRef.current?.querySelector(`[data-batch-item-id="${matching[next].id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })); }
  function selectBook(id) { setSelectedId(id); const index = currentItems.findIndex(item => item.id === id); if (index >= 0) setFilterPosition(index); }
  return <div className="bf-preview-page"><header className="bf-preview-header"><div className="bf-preview-brand">一战晟铭</div><div className="bf-preview-heading"><div><Button type="text" icon={<ArrowLeft size={16} />} onClick={() => { window.history.pushState({}, '', '/shuihuo-production'); window.dispatchEvent(new PopStateEvent('popstate')); }}>返回水货生产</Button><h1>批量工厂 <small>统一设置一次，批量生产；特殊小说再单独调整。</small></h1></div><Button type="primary" icon={<Sparkles size={15} />} onClick={() => setIntakeOpen(true)}>新建批次</Button></div></header><main><section className="bf-preview-batch-bar"><div className="bf-preview-batch-meta"><strong>批次</strong><b>{batch?.name || '待创建批次'}</b><span>· {entries.length} 本小说</span><button aria-label="编辑批次"><FileText size={14} /></button><div className="bf-preview-tabs"><Button type="primary" icon={<Settings2 size={15} />}>生产统一设置</Button><Button icon={<Upload size={15} />} disabled>发布统一设置</Button></div></div><div className="bf-preview-summaries"><div>生产： <b>{summaryText(batch)}</b></div><div>发布： <b>本期暂不支持上传发布</b></div></div><div className="bf-preview-actions"><Button icon={<Settings2 size={15} />}>高级设置</Button><Button type="primary" icon={<Play size={15} />}>开始导演</Button><Button icon={<Sparkles size={15} />}>生成待生成 <small>{summary['待生成']}</small></Button><Button icon={<RotateCcw size={15} />}>合并待合并 <small>{summary['待合并']}</small></Button></div></section><section className="bf-preview-status"><div className="bf-preview-status-title"><strong>批次状态中心</strong><span>按小说计数 · 点击连续定位</span></div><div className="bf-preview-status-grid">{STATUS_ORDER.map(label => <button key={label} className={`${label === '异常' ? 'is-danger' : ''} ${currentFilter === label ? 'is-active' : ''}`} onClick={() => locateStatus(label)}><span>{label}</span><b>{summary[label]}</b></button>)}</div><div className="bf-preview-abnormal"><span>当前筛选：<b>{currentFilter}</b> {currentItems.length} 本 {currentItems.length ? `· ${Math.min(filterPosition + 1, currentItems.length)}/${currentItems.length}` : ''}</span>{currentItems.map(item => <button key={item.id} onClick={() => selectBook(item.id)}>{String(item.index).padStart(2, '0')}　{item.title}　{item.bookId ? <span>Book ID {item.bookId}</span> : null}{item.displayStatus === '异常' ? <em>需要处理</em> : null}</button>)}</div></section><div className="bf-preview-grid" ref={listRef}><BookList entries={entries} selectedId={selected?.id} onSelect={selectBook} /><CurrentBook item={selected} /><VideoOperations item={selected} /><aside className="bf-preview-rail"><h3>视频生成进度 <ChevronDown size={15} /></h3><div className="bf-preview-ring"><Progress type="circle" percent={entries.length ? Math.round(((summary['待合并'] + summary['已合并']) / entries.length) * 100) : 0} strokeColor="#4b7cff" trailColor="#20304b" format={() => <><b>VIDEO</b><small>全批次进度</small></>} /></div><ul><li><i className="dot orange" />待生成 <b>{summary['待生成']}</b></li><li><i className="dot blue" />排队中 <b>{summary['排队中']}</b></li><li><i className="dot purple" />生成中 <b>{summary['视频生成中']}</b></li><li><i className="dot green" />已合并 <b>{summary['已合并']}</b></li><li><i className="dot red" />异常 <b>{summary['异常']}</b></li></ul><p>这里始终显示全批次进度，不随当前书切换。</p><div className="bf-preview-merge"><h3>批量合并 <ChevronDown size={15} /></h3><label>合并范围</label><Select value="全部已完成小说" options={[{ value: '全部已完成小说', label: `全部已完成小说（${summary['已合并'] + summary['待合并']}）` }]} /><label>成品时长处理</label><div className="bf-preview-segment"><b>倍速</b><span>跟随音频时长</span></div><Select value="1.5x" options={[{ value: '1.5x', label: '1.5x' }]} /><Button type="primary" block>合并全部已完成小说</Button></div></aside></div></main><BatchIntakeDrawer open={intakeOpen} onClose={() => setIntakeOpen(false)} onCreated={created => { setBatch(created); setSelectedId(created.items?.[0]?.id || ''); setCurrentFilter('全部'); setFilterPosition(0); }} /></div>;
}
export default BatchFactoryPreviewPage;
