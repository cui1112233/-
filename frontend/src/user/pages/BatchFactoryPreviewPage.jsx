import { useEffect, useState } from 'react';
import { Button, Card, Collapse, Progress, Select, Tag } from 'antd';
import { AlertTriangle, ArrowLeft, ChevronDown, CircleCheck, Clock3, FileText, FolderOpen, Play, RotateCcw, Settings2, Sparkles, Upload, Video, XCircle } from 'lucide-react';
import './batch-factory-preview.css';
import { getBatchFactoryBatch, listBatchFactoryBatches } from '../../shared/api/batchFactory';

const books = [
  ['01', '余生不逢云', '207414171084...', '已合并', 'success'],
  ['02', '她离开以后', '2072480890496...', '单书覆盖 3 项', 'purple'],
  ['03', '春风不渡', '20764104100976...', 'VIDEO 03 失败', 'danger'],
  ['04', '星沉大海', '2078234234556...', '待审核', 'default'],
  ['05', '烟火人间', '2076232344556...', '排队中', 'blue'],
  ['06', '归去来兮', '207734455667...', '已合并', 'success'],
  ['07', '长夜将尽', '207845566778...', '待生成', 'purple']
];

const statuses = [['全部', '100'], ['待开始', '2'], ['待审核', '5'], ['AI处理中', '8'], ['待生成', '18'], ['排队中', '12'], ['视频生成中', '9'], ['异常', '4'], ['待合并', '16'], ['已合并', '26']];

function BookList({ entries = books }) {
  const [selected, setSelected] = useState('01');
  return <aside className="bf-preview-books"><div className="bf-preview-section-title">小说列表</div><div className="bf-preview-book-tools"><input placeholder="搜索书名 / BookID" /><select defaultValue="all"><option value="all">全部状态</option></select><button aria-label="列表设置"><Settings2 size={15} /></button></div><div className="bf-preview-book-list">{entries.map(([id, title, bookId, status, tone]) => <button key={id} className={`bf-preview-book ${selected === id ? 'is-selected' : ''} tone-${tone}`} onClick={() => setSelected(id)}><span className="bf-preview-book-id">{id} ·</span><span className="bf-preview-book-copy"><strong>{title}</strong>{bookId ? <small>BookID {bookId}</small> : null}</span><Tag color={tone === 'danger' ? 'red' : tone === 'success' ? 'green' : tone === 'purple' ? 'purple' : tone === 'blue' ? 'blue' : undefined}>{status}</Tag></button>)}</div><div className="bf-preview-pagination">共 {entries.length} 本 <b>1</b></div></aside>;
}

function VideoSection() {
  const [open, setOpen] = useState('03');
  return <div className="bf-preview-video-section"><button className="bf-preview-fold-title is-active"><Video size={16} /> VIDEO <ChevronDown size={15} /></button>{['01', '02', '03'].map((id, index) => <div className={`bf-preview-video-row ${open === id ? 'is-open' : ''}`} key={id}><button onClick={() => setOpen(open === id ? '' : id)}><span>›</span><strong>VIDEO {id} · {index === 0 ? 13 : index === 1 ? 12 : 10}s</strong><Tag color={id === '03' ? 'red' : 'green'}>{id === '03' ? '失败' : '已完成'}</Tag><ChevronDown size={14} /></button>{open === id && id === '03' ? <div className="bf-preview-video-error"><div className="bf-preview-no-media"><AlertTriangle size={24} /><span>无可用预览</span></div><div><strong>视频生成失败</strong><small>原因：provider timeout（提供方超时）</small><small>提供方任务 abc123</small><div><Button danger size="small" icon={<RotateCcw size={14} />}>重试这个 VIDEO</Button><Button size="small">标记问题</Button><Button size="small">查看 Prompt</Button></div></div></div> : null}</div>)}</div>;
}

export function BatchFactoryPreviewPage() {
  const [liveBooks, setLiveBooks] = useState([]);
  const [liveBatch, setLiveBatch] = useState(null);
  useEffect(() => {
    listBatchFactoryBatches().then(async ({ batches }) => {
      const batch = batches?.[0];
      if (!batch) return;
      const detail = await getBatchFactoryBatch(batch.id);
      setLiveBatch(detail.batch);
      setLiveBooks((detail.batch?.items || []).map((item, index) => [String(index + 1).padStart(2, '0'), item.title || '未命名小说', item.bookId || '', item.status === 'failed' ? '异常' : item.status === 'complete' ? '待生成' : '待开始', item.status === 'failed' ? 'danger' : item.status === 'complete' ? 'purple' : 'default']));
    }).catch(() => {});
  }, []);
  const displayBooks = liveBooks.length ? liveBooks : books;
  return <div className="bf-preview-page"><header className="bf-preview-header"><div className="bf-preview-brand">一战晟铭</div><div className="bf-preview-heading"><div><Button type="text" icon={<ArrowLeft size={16} />}>返回水货生产</Button><h1>批量工厂 <small>统一设置一次，批量生产；只有特殊小说才单独展开调整。</small></h1></div><Button type="primary" icon={<Sparkles size={15} />}>新建批次</Button></div></header><main><section className="bf-preview-batch-bar"><div className="bf-preview-batch-meta"><strong>批次</strong><b>20260826-01</b><span>· 100 本小说</span><button aria-label="编辑批次"><FileText size={14} /></button><div className="bf-preview-tabs"><Button type="primary" icon={<Settings2 size={15} />}>生产统一设置</Button><Button icon={<Upload size={15} />}>发布统一设置</Button></div></div><div className="bf-preview-summaries"><div>生产： <b>爆款开头</b> · 模型 A · 9:16 · 固定 10s</div><div>发布： <b>合并 1.5x</b> · 混屏 3 · 生成 10</div></div><div className="bf-preview-actions"><Button icon={<Settings2 size={15} />}>高级设置 <small>已修改 3 项</small></Button><Button type="primary" icon={<Play size={15} />}>开始导演<small>导演结果处理</small></Button><Button icon={<Sparkles size={15} />}>生成待生成<small>18</small></Button><Button icon={<RotateCcw size={15} />}>合并待合并<small>16</small></Button><Button icon={<Upload size={15} />}>上传待上传<small>6</small></Button></div></section><section className="bf-preview-status"><div className="bf-preview-status-title"><strong>批次状态中心</strong><span>按小说计数 · 点击筛选</span></div><div className="bf-preview-status-grid">{statuses.map(([label, count]) => <button key={label} className={label === '异常' ? 'is-danger' : ''}><span>{label}</span><b>{count}</b></button>)}</div><div className="bf-preview-abnormal"><span>当前筛选：<b>异常</b> 4 本</span>{books.slice(2, 6).map(([id, title]) => <button key={id}>{id}　{title}　<span>BookID 20764104100976...</span><em>需要处理</em></button>)}</div></section><div className="bf-preview-grid"><BookList entries={displayBooks} /><section className="bf-preview-center"><div className="bf-preview-current"><div><h2>余生不逢云</h2><span>BookID　207414171084...</span><Tag>知乎付费</Tag><Tag color="green">当前状态：已合并</Tag><Tag color="purple">单书已调整</Tag></div><Button icon={<Settings2 size={15} />}>单书设置⌄</Button></div><div className="bf-preview-alert"><AlertTriangle size={22} /><div><strong>VIDEO 03　生成失败</strong><small>原因：provider timeout（提供方超时）</small></div><Button danger>重试</Button><Button>查看详情</Button><Button>标记问题</Button></div><div className="bf-preview-content-grid"><div className="bf-preview-folds"><button><FileText size={16} /> 原文 <ChevronDown size={15} /></button><button><Sparkles size={16} /> 爆款开头 <ChevronDown size={15} /></button><button><FolderOpen size={16} /> 人物 / 场景 / 道具 <ChevronDown size={15} /></button><VideoSection /><button><CircleCheck size={16} /> 合并 <ChevronDown size={15} /></button><button><Upload size={16} /> 发布 <ChevronDown size={15} /></button><button><Clock3 size={16} /> 操作记录 <ChevronDown size={15} /></button></div><section className="bf-preview-composer"><h3>合并成品 <ChevronDown size={15} /></h3><label>成品时长处理</label><div className="bf-preview-segment"><b>倍速</b><span>跟随音频时长 · 即将支持</span></div><select defaultValue="1.5"><option value="1.5">1.5x</option></select><div className="bf-preview-metrics"><span>原始总时长<strong>35s</strong></span><span>预计成品<strong>23.3s</strong></span><span>文件名<strong>2074141710842647315.mp4</strong></span></div><Button type="primary">重新合并</Button><h3>合并成品预览</h3><div className="bf-preview-player"><Play size={28} /><div>0:00 / 0:23</div></div></section></div></section><aside className="bf-preview-rail"><h3>视频生成进度 <ChevronDown size={15} /></h3><div className="bf-preview-ring"><Progress type="circle" percent={66} strokeColor="#4b7cff" trailColor="#20304b" format={() => <><b>VIDEO 24</b><small>当前显示</small></>} /></div><ul><li><i className="dot orange" />待生成 <b>3</b></li><li><i className="dot blue" />排队中 <b>6</b></li><li><i className="dot purple" />生成中 <b>4</b></li><li><i className="dot green" />已完成 <b>9</b></li><li><i className="dot red" />失败 <b>2</b></li></ul><p>活动任务每 3 秒整刷新一次；全部结束后自动停止。</p><div className="bf-preview-merge"><h3>批量合并 <ChevronDown size={15} /></h3><label>合并范围</label><Select value="全部已完成小说（26）" options={[{ value: '全部已完成小说（26）', label: '全部已完成小说（26）' }]} /><label>成品时长处理</label><div className="bf-preview-segment"><b>倍速</b><span>跟随音频时长 · 即将支持</span></div><Select value="1.5x" options={[{ value: '1.5x', label: '1.5x' }]} /><label>文件命名规则</label><Select value="保持原名 + BookID" options={[{ value: '保持原名 + BookID', label: '保持原名 + BookID' }]} /><Button type="primary" block>合并全部已完成小说</Button><p>预计生成 26 个合并文件</p></div></aside></div></main></div>;
}

export default BatchFactoryPreviewPage;
