import { Button, Empty, Input, Segmented, Space, Tag, Typography, message } from 'antd';
import {
  AlertTriangle,
  CheckCircle2,
  Film,
  LayoutGrid,
  RotateCcw,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Upload,
  Video
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WorkbenchCard } from './WorkbenchCard';
import {
  SHOWCASE_BATCH,
  SHOWCASE_BOOKS,
  SHOWCASE_STATUS_ORDER
} from './showcaseData';
import {
  DEFAULT_WORKSPACE_LAYOUT,
  GRID_COLUMNS,
  WORKSPACE_STORAGE_KEY,
  moveWorkspaceItem,
  normalizeLayout,
  resetWorkspaceLayout,
  resizeWorkspaceItem,
  setItemMaximized,
  setWorkspaceItemCollapsed,
  setWorkspaceItemHidden
} from './workspace-layout';
import './batch-factory-v11-workbench.css';

const statusTone = {
  待开始: 'default',
  待审核: 'gold',
  AI处理中: 'processing',
  待生成: 'purple',
  排队中: 'blue',
  生成中: 'processing',
  异常: 'red',
  待合并: 'cyan',
  已合并: 'green',
  待上传: 'geekblue',
  已发布: 'green',
  已完成: 'green'
};

function loadStoredLayout() {
  try {
    return normalizeLayout(JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) || 'null'));
  } catch (_) {
    return normalizeLayout(DEFAULT_WORKSPACE_LAYOUT);
  }
}

function ToolbarButton({ children, ...props }) {
  return <Button size="small" {...props}>{children}</Button>;
}

export function BatchFactoryV11Workbench({
  batch = SHOWCASE_BATCH,
  books = SHOWCASE_BOOKS,
  onOpenBatchSettings,
  onOpenPublishSettings,
  onOpenBookSettings,
  onOpenVideoSettings
}) {
  const [selectedBookId, setSelectedBookId] = useState(books[0]?.id || '');
  const [selectedVideoId, setSelectedVideoId] = useState(books[0]?.videos?.[0]?.id || '');
  const [statusFilter, setStatusFilter] = useState('全部');
  const [bookSearch, setBookSearch] = useState('');
  const [previewTarget, setPreviewTarget] = useState('merged');
  const [editMode, setEditMode] = useState(false);
  const [layout, setLayout] = useState(loadStoredLayout);
  const gridRef = useRef(null);
  const [gridWidth, setGridWidth] = useState(1200);

  const selectedBook = useMemo(
    () => books.find(book => book.id === selectedBookId) || books[0] || null,
    [books, selectedBookId]
  );

  const selectedVideo = useMemo(() => {
    const videos = selectedBook?.videos || [];
    return videos.find(video => video.id === selectedVideoId) || videos[0] || null;
  }, [selectedBook, selectedVideoId]);

  useEffect(() => {
    if (!selectedBook) return;
    if (!(selectedBook.videos || []).some(video => video.id === selectedVideoId)) {
      setSelectedVideoId(selectedBook.videos?.[0]?.id || '');
      setPreviewTarget('merged');
    }
  }, [selectedBook?.id, selectedVideoId]);

  useEffect(() => {
    const node = gridRef.current;
    if (!node) return undefined;
    const update = () => setGridWidth(node.clientWidth || 1200);
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const statusCounts = useMemo(() => SHOWCASE_STATUS_ORDER.reduce((out, status) => {
    out[status] = status === '全部' ? books.length : books.filter(book => book.status === status).length;
    return out;
  }, {}), [books]);

  const filteredBooks = useMemo(() => {
    const query = bookSearch.trim().toLowerCase();
    return books.filter(book => {
      const statusMatch = statusFilter === '全部' || book.status === statusFilter;
      const queryMatch = !query || `${book.title} ${book.bookId} ${book.platform}`.toLowerCase().includes(query);
      return statusMatch && queryMatch;
    });
  }, [books, bookSearch, statusFilter]);

  const filterResults = useMemo(
    () => statusFilter === '全部' ? books : books.filter(book => book.status === statusFilter),
    [books, statusFilter]
  );

  const metrics = useMemo(() => ({
    columnWidth: Math.max(20, (gridWidth - ((GRID_COLUMNS - 1) * layout.gap)) / GRID_COLUMNS),
    rowHeight: layout.rowHeight,
    gap: layout.gap
  }), [gridWidth, layout.gap, layout.rowHeight]);

  function selectBook(book) {
    setSelectedBookId(book.id);
    setSelectedVideoId(book.videos?.[0]?.id || '');
    setPreviewTarget('merged');
  }

  function updateCard(id, updater) {
    setLayout(current => updater(current, id));
  }

  function saveLayout() {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(layout));
    setEditMode(false);
    message.success('布局已保存');
  }

  function restoreDefault() {
    const next = resetWorkspaceLayout();
    setLayout(next);
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(next));
    message.success('已恢复默认布局');
  }

  function restoreHiddenCards() {
    setLayout(current => {
      let next = normalizeLayout(current);
      for (const id of Object.keys(next.items)) next = setWorkspaceItemHidden(next, id, false);
      return next;
    });
  }

  const cards = [
    {
      id: 'book-list',
      title: '小说列表',
      subtitle: `${filteredBooks.length}/${books.length} 本`,
      content: <div data-bf-card="book-list" className="bf11-book-list-body">
        <Input
          allowClear
          prefix={<Search size={14} />}
          value={bookSearch}
          onChange={event => setBookSearch(event.target.value)}
          placeholder="搜索书名 / Book ID / 平台"
        />
        <div className="bf11-book-list">
          {filteredBooks.map((book, index) => <button
            key={book.id}
            className={`bf11-book-row ${selectedBook?.id === book.id ? 'is-selected' : ''} ${book.status === '异常' ? 'is-error' : ''}`}
            onClick={() => selectBook(book)}
          >
            <span className="bf11-book-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="bf11-book-copy">
              <strong>{book.title}</strong>
              <small>{book.platform} · {book.bookId}</small>
            </span>
            <span className="bf11-book-meta">
              {book.overrideCount ? <Tag color="purple">已调整 {book.overrideCount}</Tag> : null}
              <Tag color={statusTone[book.status]}>{book.status}</Tag>
            </span>
          </button>)}
          {!filteredBooks.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选没有小说" /> : null}
        </div>
      </div>
    },
    {
      id: 'book-workbench',
      title: '当前小说工作台',
      subtitle: selectedBook ? `${selectedBook.platform} · Book ID ${selectedBook.bookId}` : '请选择小说',
      content: <div data-bf-card="book-workbench" className="bf11-book-workbench-body">
        {selectedBook ? <>
          <div className="bf11-current-book-head">
            <div>
              <Space wrap size={6}>
                <Typography.Title level={4}>{selectedBook.title}</Typography.Title>
                <Tag color={statusTone[selectedBook.status]}>{selectedBook.status}</Tag>
                {selectedBook.overrideCount ? <Tag color="purple">当前小说已覆盖 {selectedBook.overrideCount} 项</Tag> : <Tag>跟随生产统一设置</Tag>}
              </Space>
            </div>
            <Button icon={<Settings2 size={15} />} onClick={() => onOpenBookSettings?.(selectedBook)}>当前小说设置</Button>
          </div>

          <section className="bf11-content-section">
            <header><strong>原文</strong><span>来源内容</span></header>
            <p>{selectedBook.sourceText}</p>
          </section>

          <section className="bf11-content-section">
            <header><strong>爆款 Hook</strong><span>{selectedBook.hookText ? '已生成 / 可审核' : '原文直转或尚未生成'}</span></header>
            <p>{selectedBook.hookText || '当前没有爆款 Hook。'}</p>
          </section>

          <section className="bf11-content-section">
            <header><strong>人物 / 场景 / 道具</strong><span>基础资产</span></header>
            <div className="bf11-assets">
              <div><b>人物</b>{selectedBook.assets.characters.map(name => <Tag key={name}>{name}</Tag>)}</div>
              <div><b>场景</b>{selectedBook.assets.scenes.map(name => <Tag key={name}>{name}</Tag>)}</div>
              <div><b>道具</b>{selectedBook.assets.props.map(name => <Tag key={name}>{name}</Tag>)}</div>
            </div>
          </section>

          <section className="bf11-content-section bf11-video-plan">
            <header><strong>VIDEO 方案</strong><span>{selectedBook.videos.length} 个 VIDEO</span></header>
            <div className="bf11-video-list">
              {selectedBook.videos.map(video => <button
                key={video.id}
                className={selectedVideo?.id === video.id ? 'is-selected' : ''}
                onClick={() => { setSelectedVideoId(video.id); setPreviewTarget(video.id); }}
              >
                <span><Video size={14} /> {video.label}</span>
                <small>{video.duration}s</small>
                <Tag color={statusTone[video.status]}>{video.status}</Tag>
              </button>)}
            </div>
            {selectedVideo ? <div className="bf11-video-detail">
              <div className="bf11-video-detail-head">
                <Space wrap><strong>{selectedVideo.label}</strong><Tag>{selectedVideo.duration}s</Tag><Tag color={statusTone[selectedVideo.status]}>{selectedVideo.status}</Tag></Space>
                <Button size="small" icon={<SlidersHorizontal size={14} />} onClick={() => onOpenVideoSettings?.(selectedBook, selectedVideo)}>VIDEO 设置</Button>
              </div>
              <Typography.Paragraph>{selectedVideo.visualPrompt}</Typography.Paragraph>
              <div className="bf11-assets compact">
                <div><b>人物</b>{selectedVideo.characters.map(name => <Tag key={name}>{name}</Tag>)}</div>
                <div><b>场景</b>{selectedVideo.scenes.map(name => <Tag key={name}>{name}</Tag>)}</div>
                <div><b>道具</b>{selectedVideo.props.map(name => <Tag key={name}>{name}</Tag>)}</div>
              </div>
            </div> : null}
          </section>
        </> : <Empty description="请选择小说" />}
      </div>
    },
    {
      id: 'preview',
      title: '成片预览 / 合并成品',
      subtitle: '全工作台共用一个播放器',
      content: <div data-bf-card="preview" className="bf11-preview-body">
        <div className="bf11-preview-tabs">
          <button className={previewTarget === 'merged' ? 'is-active' : ''} onClick={() => setPreviewTarget('merged')}>最终合并</button>
          {(selectedBook?.videos || []).map(video => <button key={video.id} className={previewTarget === video.id ? 'is-active' : ''} onClick={() => { setPreviewTarget(video.id); setSelectedVideoId(video.id); }}>{video.label}</button>)}
        </div>
        <div className="bf11-unified-player" data-bf-player="unified">
          <Film size={42} />
          <strong>{previewTarget === 'merged' ? `${selectedBook?.bookId || 'BookID'}.mp4` : selectedBook?.videos?.find(video => video.id === previewTarget)?.label || 'VIDEO 01'}</strong>
          <span>{previewTarget === 'merged' ? '最终合并成品统一在这里预览' : '原始 VIDEO 统一切换到同一个播放器预览'}</span>
          <div className="bf11-player-track"><i /></div>
          <small>00:00 / 00:23</small>
        </div>
      </div>
    },
    {
      id: 'batch-tools',
      title: '批量工具',
      subtitle: '正常任务尽量通过批量操作完成',
      content: <div data-bf-card="batch-tools" className="bf11-batch-tools-body">
        <div className="bf11-tool-status"><CheckCircle2 size={18} /><span><strong>统一生产流程</strong><small>UI 已落位 · 业务动作第二阶段接入</small></span></div>
        <div className="bf11-tool-buttons">
          <Button type="primary" disabled>开始导演</Button>
          <Button disabled>生成待生成</Button>
          <Button disabled>合并待合并</Button>
          <Button icon={<Upload size={14} />} disabled>上传待上传</Button>
        </div>
        <Typography.Text type="secondary">未接入的生产动作保持禁用，不调用旧 Batch Factory 逻辑。</Typography.Text>
      </div>
    }
  ];

  return <div className="batch-factory-workbench bf11-workbench">
    <section className="bf11-batch-header" data-bf-region="batch-header">
      <div className="bf11-batch-title">
        <Space wrap size={8}>
          <Typography.Title level={3}>{batch.title}</Typography.Title>
          <Tag>{batch.count} 本</Tag>
          <Tag color="processing">{batch.status}</Tag>
        </Space>
        <Typography.Text type="secondary">{batch.mode === 'viral' ? '爆款开头' : '原文直转'} · {batch.videoModel} · {batch.aspectRatio} · {batch.configVersion}</Typography.Text>
      </div>
      <Space wrap>
        <Button icon={<Settings2 size={15} />} onClick={() => onOpenBatchSettings?.(batch)}>生产统一设置</Button>
        <Button onClick={() => onOpenPublishSettings?.(batch)}>发布统一设置</Button>
        {!editMode ? <Button icon={<LayoutGrid size={15} />} onClick={() => setEditMode(true)}>编辑布局</Button> : <>
          <Button type="primary" icon={<Save size={15} />} onClick={saveLayout}>保存布局</Button>
          <Button icon={<RotateCcw size={15} />} onClick={restoreDefault}>恢复默认布局</Button>
          <Button onClick={restoreHiddenCards}>显示隐藏卡片</Button>
        </>}
      </Space>
    </section>

    <section className="bf11-status-row">
      <div className="bf11-status-center" data-bf-region="status-center">
        <div className="bf11-region-heading"><strong>批次状态中心</strong><span>只负责筛选入口</span></div>
        <div className="bf11-status-cards">
          {SHOWCASE_STATUS_ORDER.map(status => <button key={status} className={statusFilter === status ? 'is-active' : ''} onClick={() => setStatusFilter(status)}>
            <span>{status}</span><strong>{statusCounts[status] || 0}</strong>
          </button>)}
        </div>
      </div>
      <div className="bf11-current-filter" data-bf-region="current-filter">
        <div className="bf11-region-heading"><strong>当前筛选</strong><span>{statusFilter} · {filterResults.length} 本</span></div>
        <div className="bf11-filter-results">
          {filterResults.slice(0, 5).map(book => <button key={book.id} onClick={() => selectBook(book)}>
            {book.status === '异常' ? <AlertTriangle size={14} /> : <span className="bf11-filter-dot" />}
            <span>{book.title}</span>
            <Tag color={statusTone[book.status]}>{book.status}</Tag>
          </button>)}
          {filterResults.length > 5 ? <small>还有 {filterResults.length - 5} 本，点击状态后可在小说列表继续查看</small> : null}
          {!filterResults.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合状态的小说" /> : null}
        </div>
      </div>
    </section>

    <div
      className={`bf11-workspace-grid ${editMode ? 'is-editing' : ''}`}
      ref={gridRef}
      style={{
        '--bf11-row-height': `${layout.rowHeight}px`,
        '--bf11-grid-gap': `${layout.gap}px`
      }}
    >
      {cards.map(card => <WorkbenchCard
        key={card.id}
        id={card.id}
        title={card.title}
        subtitle={card.subtitle}
        item={layout.items[card.id]}
        editMode={editMode}
        maximized={layout.maximizedId === card.id}
        gridMetrics={metrics}
        onMove={(x, y) => updateCard(card.id, (current, id) => moveWorkspaceItem(current, id, x, y))}
        onResize={(w, h) => updateCard(card.id, (current, id) => resizeWorkspaceItem(current, id, w, h))}
        onCollapse={collapsed => updateCard(card.id, (current, id) => setWorkspaceItemCollapsed(current, id, collapsed))}
        onHide={() => updateCard(card.id, (current, id) => setWorkspaceItemHidden(current, id, true))}
        onMaximize={maximized => updateCard(card.id, (current, id) => setItemMaximized(current, id, maximized))}
      >{card.content}</WorkbenchCard>)}
    </div>
  </div>;
}

export default BatchFactoryV11Workbench;
