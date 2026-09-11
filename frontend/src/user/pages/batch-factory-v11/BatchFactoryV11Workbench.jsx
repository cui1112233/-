import {
  Button,
  Collapse,
  Empty,
  Input,
  InputNumber,
  Progress,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
  message
} from 'antd';
import {
  AlertTriangle,
  Archive,
  Film,
  FolderPlus,
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
import { DirectorPanel } from './DirectorPanel';
import { HookReviewPanel } from './HookReviewPanel';
import { NovelSourceModule } from './NovelSourceModule.jsx';
import { WorkbenchCard } from './WorkbenchCard';
import { actionState } from './batchFactoryV11State.js';
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

const { TextArea } = Input;

const STATUS_ORDER = ['全部', '待开始', '待审核', 'AI处理中', '待生成', '排队中', '生成中', '异常', '待合并', '已合并', '待上传', '已发布'];

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

function assetName(item) {
  return typeof item === 'string' ? item : (item?.name || item?.label || item?.id || '未命名资产');
}

function assetPrompt(item) {
  return typeof item === 'string' ? '' : (item?.prompt || item?.visualPrompt || item?.description || '');
}

function AssetPromptGroup({ label, type, items, drafts, onChange, onRefresh, onSave }) {
  return <div className="bf11-asset-prompt-group">
    <div className="bf11-asset-prompt-title">
      <Typography.Text strong>{label}</Typography.Text>
      <Space>
        <Button size="small" disabled={!onRefresh} onClick={onRefresh}>重新获取</Button>
        <Button size="small" disabled={!onSave} onClick={() => onSave(type, items, drafts)}>保存</Button>
      </Space>
    </div>
    <div className="bf11-asset-prompt-list">
      {(items || []).map((item, index) => {
        const name = assetName(item);
        const key = `${type}:${item?.id || name}:${index}`;
        return <div className="bf11-asset-prompt-row" key={key}>
          <Input value={name} disabled />
          <TextArea
            rows={3}
            value={drafts[key] ?? assetPrompt(item)}
            placeholder="等待 V11 资产 Prompt 数据"
            onChange={event => onChange(key, event.target.value)}
          />
        </div>;
      })}
      {!(items || []).length ? <Typography.Text type="secondary">当前没有服务端资产数据。</Typography.Text> : null}
    </div>
  </div>;
}

export function BatchFactoryV11Workbench({
  batch = null,
  books = [],
  productionStatus = null,
  mergeStatus = null,
  capabilities = {},
  onOpenBatchManager,
  onOpenHistory,
  onOpenBatchSettings,
  onOpenPublishSettings,
  onOpenBookSettings,
  onOpenVideoSettings,
  onRunHook,
  onApproveHook,
  onRunDirector,
  onRunBatchDirector,
  onPreviewFinalPrompt,
  onRunProduction,
  onSaveSource,
  onSaveVideoPrompt,
  onRefreshAssets,
  onSaveAssetPrompts,
  onRunMerge,
  onRunUpload
}) {
  const [selectedBookId, setSelectedBookId] = useState(books[0]?.id || '');
  const [selectedVideoId, setSelectedVideoId] = useState(books[0]?.videos?.[0]?.id || '');
  const [statusFilter, setStatusFilter] = useState('全部');
  const [bookSearch, setBookSearch] = useState('');
  const [previewTarget, setPreviewTarget] = useState('merged');
  const [editMode, setEditMode] = useState(false);
  const [layout, setLayout] = useState(loadStoredLayout);
  const [assetDrafts, setAssetDrafts] = useState({});
  const [videoPromptDrafts, setVideoPromptDrafts] = useState({});
  const [mergeTimingMode, setMergeTimingMode] = useState('speed');
  const [mergeSpeed, setMergeSpeed] = useState('1.0');
  const [ttsSpeed, setTtsSpeed] = useState(1.7);
  const gridRef = useRef(null);
  const [gridWidth, setGridWidth] = useState(1200);

  const batchCreateAction = actionState(capabilities, 'batch.create');
  const batchReadAction = actionState(capabilities, 'batch.read');
  const settingsAction = actionState(capabilities, 'settings.edit');
  const overrideAction = actionState(capabilities, 'override.edit');
  const productionAction = actionState(capabilities, 'production.submit');
  const mergeAction = actionState(capabilities, 'merge.run');
  const compilerAction = actionState(capabilities, 'compiler.preview');

  const selectedBook = useMemo(
    () => books.find(book => book.id === selectedBookId) || books[0] || null,
    [books, selectedBookId]
  );

  const selectedVideo = useMemo(() => {
    const videos = selectedBook?.videos || [];
    return videos.find(video => video.id === selectedVideoId) || videos[0] || null;
  }, [selectedBook, selectedVideoId]);

  useEffect(() => {
    if (!books.length) {
      setSelectedBookId('');
      setSelectedVideoId('');
      return;
    }
    if (!books.some(book => book.id === selectedBookId)) {
      setSelectedBookId(books[0].id);
      setSelectedVideoId(books[0]?.videos?.[0]?.id || '');
      setPreviewTarget('merged');
    }
  }, [books, selectedBookId]);

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

  const statusCounts = useMemo(() => STATUS_ORDER.reduce((out, status) => {
    out[status] = status === '全部' ? books.length : books.filter(book => book.status === status).length;
    return out;
  }, {}), [books]);

  const filteredBooks = useMemo(() => {
    const query = bookSearch.trim().toLowerCase();
    return books.filter(book => !query || `${book.title || ''} ${book.bookId || ''} ${book.platform || ''}`.toLowerCase().includes(query));
  }, [books, bookSearch]);

  const filterResults = useMemo(
    () => statusFilter === '全部' ? books : books.filter(book => book.status === statusFilter),
    [books, statusFilter]
  );

  const videoProgress = useMemo(() => {
    const all = books.flatMap(book => book.videos || []);
    const taskStatus = new Map();
    for (const job of productionStatus?.jobs || []) {
      for (const task of job.tasks || []) taskStatus.set(task.videoId, task.status);
    }
    const summary = { total: all.length, completed: 0, pending: 0, queued: 0, generating: 0, failed: 0 };
    for (const video of all) {
      const durableStatus = taskStatus.get(video.id);
      if (durableStatus === 'succeeded' || video.status === '已完成') summary.completed += 1;
      else if (durableStatus === 'failed' || video.status === '异常') summary.failed += 1;
      else if (durableStatus === 'queued' || video.status === '排队中') summary.queued += 1;
      else if (durableStatus === 'running' || video.status === '生成中') summary.generating += 1;
      else summary.pending += 1;
    }
    summary.percent = summary.total ? Math.round(((summary.completed + summary.failed) / summary.total) * 100) : 0;
    return summary;
  }, [books, productionStatus]);

  const productionTaskByVideoId = useMemo(() => {
    const map = new Map();
    for (const job of productionStatus?.jobs || []) {
      for (const task of job.tasks || []) {
        if (task?.videoId) map.set(task.videoId, task);
      }
    }
    return map;
  }, [productionStatus]);

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

  function setAssetDraft(key, value) {
    setAssetDrafts(current => ({ ...current, [key]: value }));
  }

  const bookAssets = selectedBook?.assets || {};
  const selectedVideos = selectedBook?.videos || [];
  const selectedHook = selectedBook?.hook || selectedBook?.hookRevision || null;

  const bookCollapseItems = selectedBook ? [
    {
      key: 'source',
      label: <span className="bf11-fold-label"><strong>原文</strong><small>来源内容</small></span>,
      children: <NovelSourceModule
        book={selectedBook}
        onSave={onSaveSource}
        hookContent={<HookReviewPanel book={selectedBook} capabilities={capabilities} onRunHook={onRunHook} onApproveHook={onApproveHook} />}
      />
    },
    {
      key: 'director',
      label: <span className="bf11-fold-label"><strong>Director</strong><small>{selectedBook?.directorRevision?.id || selectedBook?.director?.id ? '已有 revision' : '等待导演'}</small></span>,
      children: <DirectorPanel
        book={selectedBook}
        capabilities={capabilities}
        onRunDirector={onRunDirector}
      />
    },
    {
      key: 'assets',
      label: <span className="bf11-fold-label"><strong>人物 / 场景 / 道具</strong><small>Prompt 直接编辑</small></span>,
      children: <div className="bf11-asset-editor-stack">
        <AssetPromptGroup label="人物 Prompt" type="character" items={bookAssets.characters || []} drafts={assetDrafts} onChange={setAssetDraft} onRefresh={() => onRefreshAssets?.(selectedBook)} onSave={(type, items, drafts) => onSaveAssetPrompts?.(selectedBook, type, items, drafts)} />
        <AssetPromptGroup label="场景 Prompt" type="scene" items={bookAssets.scenes || []} drafts={assetDrafts} onChange={setAssetDraft} onRefresh={() => onRefreshAssets?.(selectedBook)} onSave={(type, items, drafts) => onSaveAssetPrompts?.(selectedBook, type, items, drafts)} />
        <AssetPromptGroup label="道具 Prompt" type="prop" items={bookAssets.props || []} drafts={assetDrafts} onChange={setAssetDraft} onRefresh={() => onRefreshAssets?.(selectedBook)} onSave={(type, items, drafts) => onSaveAssetPrompts?.(selectedBook, type, items, drafts)} />
      </div>
    },
    {
      key: 'videos',
      label: <span className="bf11-fold-label"><strong>VIDEO 方案</strong><small>{selectedVideos.length} 个 VIDEO · 画面提示词</small></span>,
      children: <div className="bf11-video-plan">
        <div className="bf11-video-list">
          {selectedVideos.map((video, index) => <button
            key={video.id}
            className={selectedVideo?.id === video.id ? 'is-selected' : ''}
            onClick={() => { setSelectedVideoId(video.id); setPreviewTarget(video.id); }}
          >
            <span><Video size={14} /> {video.label || `VIDEO ${String(index + 1).padStart(2, '0')}`}</span>
            <small>{video.duration ? `${video.duration}s` : '—'}</small>
            <Tag color={statusTone[video.status]}>{video.status || '未返回状态'}</Tag>
          </button>)}
        </div>
        {selectedVideo ? <div className="bf11-video-detail">
          <div className="bf11-video-detail-head">
            <Space wrap>
              <strong>{selectedVideo.label || '当前 VIDEO'}</strong>
              {selectedVideo.duration ? <Tag>{selectedVideo.duration}s</Tag> : null}
              <Tag color={statusTone[selectedVideo.status]}>{selectedVideo.status || '未返回状态'}</Tag>
            </Space>
            <Button
              size="small"
              icon={<SlidersHorizontal size={14} />}
              disabled={overrideAction.disabled || !onOpenVideoSettings}
              title={overrideAction.disabled ? overrideAction.reason : ''}
              onClick={() => onOpenVideoSettings?.(selectedBook, selectedVideo)}
            >VIDEO 设置</Button>
          </div>
          <div className="bf11-inline-editor">
            <div className="bf11-inline-editor-title"><Typography.Text strong>画面提示词</Typography.Text><Tag>visualPrompt</Tag></div>
            <TextArea
              rows={6}
              value={videoPromptDrafts[selectedVideo.id] ?? selectedVideo.visualPrompt ?? ''}
              placeholder="当前服务端未返回 visualPrompt"
              onChange={event => setVideoPromptDrafts(current => ({ ...current, [selectedVideo.id]: event.target.value }))}
            />
            <Space wrap>
              <Button disabled={!onSaveVideoPrompt} onClick={() => onSaveVideoPrompt?.(selectedBook, selectedVideo, videoPromptDrafts[selectedVideo.id] ?? selectedVideo.visualPrompt ?? '')}>保存画面提示词</Button>
              <Button
                disabled={compilerAction.disabled || !onPreviewFinalPrompt}
                title={compilerAction.disabled ? compilerAction.reason : ''}
                onClick={() => onPreviewFinalPrompt?.(selectedBook, selectedVideo)}
              >本次提交预览</Button>
              <Typography.Text type="secondary">Go 会展示每项设置来源、Director revision 和最终 compiledPrompt。</Typography.Text>
            </Space>
          </div>
          <div className="bf11-assets compact">
            <div><b>人物</b>{(selectedVideo.characters || []).map(item => <Tag key={assetName(item)}>{assetName(item)}</Tag>)}</div>
            <div><b>场景</b>{(selectedVideo.scenes || []).map(item => <Tag key={assetName(item)}>{assetName(item)}</Tag>)}</div>
            <div><b>道具</b>{(selectedVideo.props || []).map(item => <Tag key={assetName(item)}>{assetName(item)}</Tag>)}</div>
          </div>
        </div> : <Typography.Text type="secondary">当前小说没有 VIDEO 数据。</Typography.Text>}
      </div>
    }
  ] : [];

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
          {filteredBooks.map(book => <button
            key={book.id}
            className={`bf11-book-row ${selectedBook?.id === book.id ? 'is-selected' : ''} ${book.status === '异常' ? 'is-error' : ''}`}
            onClick={() => selectBook(book)}
          >
            <span className="bf11-book-index">{String(books.indexOf(book) + 1).padStart(2, '0')}</span>
            <span className="bf11-book-copy">
              <strong>{book.title || book.bookId || book.id}</strong>
              <small>{book.platform || '未知来源'} · {book.bookId || book.id}</small>
            </span>
            <span className="bf11-book-meta">
              {book.overrideCount ? <Tag color="purple">已调整 {book.overrideCount}</Tag> : null}
              <Tag color={statusTone[book.status]}>{book.status || '未返回状态'}</Tag>
            </span>
          </button>)}
          {!filteredBooks.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的小说" /> : null}
        </div>
      </div>
    },
    {
      id: 'book-workbench',
      title: '当前小说工作台',
      subtitle: selectedBook ? `${selectedBook.platform || '未知来源'} · Book ID ${selectedBook.bookId || selectedBook.id}` : '请选择小说',
      content: <div data-bf-card="book-workbench" className="bf11-book-workbench-body">
        {selectedBook ? <>
          <div className="bf11-current-book-head">
            <div>
              <Space wrap size={6}>
                <Typography.Title level={4}>{selectedBook.title || selectedBook.bookId || selectedBook.id}</Typography.Title>
                <Tag color={statusTone[selectedBook.status]}>{selectedBook.status || '未返回状态'}</Tag>
                {selectedBook.overrideCount ? <Tag color="purple">当前小说已覆盖 {selectedBook.overrideCount} 项</Tag> : <Tag>当前层无覆盖</Tag>}
              </Space>
            </div>
            <Button
              icon={<Settings2 size={15} />}
              disabled={overrideAction.disabled || !onOpenBookSettings}
              title={overrideAction.disabled ? overrideAction.reason : ''}
              onClick={() => onOpenBookSettings?.(selectedBook)}
            >当前小说设置</Button>
          </div>
          <Collapse
            className="bf11-book-collapse"
            defaultActiveKey={['source', 'videos']}
            items={bookCollapseItems}
          />
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
          {selectedVideos.map((video, index) => <button key={video.id} className={previewTarget === video.id ? 'is-active' : ''} onClick={() => { setPreviewTarget(video.id); setSelectedVideoId(video.id); }}>{video.label || `VIDEO ${String(index + 1).padStart(2, '0')}`}</button>)}
        </div>
        <div className="bf11-unified-player" data-bf-player="unified">
          {(() => {
            const latestMerge = (mergeStatus?.jobs || []).slice(-1)[0];
            const selectedPreviewVideo = selectedVideos.find(video => video.id === previewTarget);
            const previewTask = selectedPreviewVideo ? productionTaskByVideoId.get(selectedPreviewVideo.id) : null;
            const mediaURL = previewTarget === 'merged'
              ? (selectedBook?.mergedUrl || latestMerge?.outputUrl || '')
              : (selectedPreviewVideo?.url || selectedPreviewVideo?.mediaUrl || previewTask?.mediaUrl || '');
            return mediaURL ? <video controls preload="metadata" src={mediaURL} style={{ width: '100%', maxHeight: 360 }} /> : <Film size={42} />;
          })()}
          <strong>{previewTarget === 'merged'
            ? (selectedBook?.mergedFileName || '暂无合并成品')
            : (selectedVideos.find(video => video.id === previewTarget)?.label || '当前 VIDEO')}</strong>
          <span>{previewTarget === 'merged' ? '最终合并成品统一在这里预览' : '原始 VIDEO 统一切换到同一个播放器预览'}</span>
          <div className="bf11-player-track"><i /></div>
          <small>{selectedBook?.mergedUrl
            || (mergeStatus?.jobs || []).some(job => job.outputUrl)
            || selectedVideos.find(video => video.id === previewTarget)?.url
            || selectedVideos.find(video => video.id === previewTarget)?.mediaUrl
            || productionTaskByVideoId.get(previewTarget)?.mediaUrl
            ? '媒体地址已返回，可直接播放'
            : '当前暂无可播放媒体地址'}</small>
        </div>
      </div>
    },
    {
      id: 'batch-tools',
      title: '批量工具',
      subtitle: '批量优先 · 异常优先',
      content: <div data-bf-card="batch-tools" className="bf11-batch-tools-body">
        <section className="bf11-tool-section">
          <div className="bf11-tool-section-head"><strong>视频生成进度</strong><Tag>{videoProgress.completed + videoProgress.failed}/{videoProgress.total}</Tag></div>
          <Progress percent={videoProgress.percent} status={videoProgress.failed ? 'exception' : 'active'} />
          <Space wrap size={[4, 4]}>
            <Tag>待生成 {videoProgress.pending}</Tag>
            <Tag color="blue">排队中 {videoProgress.queued}</Tag>
            <Tag color="processing">生成中 {videoProgress.generating}</Tag>
            <Tag color="green">已完成 {videoProgress.completed}</Tag>
            <Tag color="red">失败 {videoProgress.failed}</Tag>
          </Space>
          <div className="bf11-tool-buttons">
            <Button disabled={!onRunBatchDirector} onClick={() => onRunBatchDirector?.(batch)} title={!onRunBatchDirector ? '等待 Director 批量接线' : ''}>批量 Director</Button>
            <Button
              disabled={productionAction.disabled || !onRunProduction}
              title={productionAction.disabled ? productionAction.reason : ''}
              onClick={() => onRunProduction?.(batch)}
            >生成待生成</Button>
          </div>
        </section>

        <section className="bf11-tool-section">
          <div className="bf11-tool-section-head"><strong>批量合并</strong><Tag color="cyan">按导演顺序</Tag></div>
          <Segmented
            block
            value={mergeTimingMode}
            onChange={setMergeTimingMode}
            options={[
              { value: 'speed', label: '固定倍率' },
              { value: 'audio', label: '跟随音频时长' }
            ]}
          />
          {mergeTimingMode === 'speed' ? <Select
            value={mergeSpeed}
            onChange={setMergeSpeed}
            options={[
              { value: '1.0', label: '1.0x' },
              { value: '1.2', label: '1.2x' },
              { value: '1.5', label: '1.5x' },
              { value: '2.0', label: '2.0x' }
            ]}
          /> : <div className="bf11-tts-timing">
            <div><Typography.Text strong>TTS 测时语速</Typography.Text><InputNumber min={0.5} max={3} step={0.1} value={ttsSpeed} onChange={value => setTtsSpeed(Number(value || 1.7))} addonAfter="x" /></div>
            <Typography.Text type="secondary">TTS 只测时，不合入成片；默认 1.7 是 TTS 参数，不是固定视频倍率。</Typography.Text>
          </div>}
          <Button
            disabled={mergeAction.disabled || !onRunMerge}
            title={mergeAction.disabled ? mergeAction.reason : ''}
            onClick={() => onRunMerge?.(batch, { timingMode: mergeTimingMode, speed: mergeSpeed, ttsSpeed })}
          >合并待合并</Button>
        </section>

        <section className="bf11-tool-section">
          <div className="bf11-tool-section-head"><strong>批量上传</strong><Tag>确认后外发</Tag></div>
          <Button icon={<Upload size={14} />} disabled={!onRunUpload} onClick={() => onRunUpload?.(batch)}>上传待上传</Button>
          <Typography.Text type="secondary">点击后选择 121/Yadi；先保存加密账号，再生成确认单，最后由你明确确认提交。</Typography.Text>
        </section>
      </div>
    }
  ];

  const batchPatch = batch?.settingsState?.patch || {};
  const mode = batch?.mode || batchPatch.productionMode;
  const modeLabel = mode ? (mode === 'viral' || mode === 'viral_hook' ? '爆款开头' : '原文直转') : '生产方式未覆盖';
  const provider = batchPatch.videoProvider || 'personal_api';
  const providerLabel = provider === 'doubao_local_executor'
    ? '豆包本地执行器'
    : provider === 'autodl_comfyui' ? 'AutoDL · MiniMax H3' : '个人中心 API · yd2.0-mini';
  const batchSubtitle = [modeLabel, providerLabel, batchPatch.videoModelId, batchPatch.aspectRatio, batchPatch.versionConfigId].filter(Boolean).join(' · ');

  return <div className="batch-factory-workbench bf11-workbench">
    <section className="bf11-batch-header" data-bf-region="batch-header">
      <div className="bf11-batch-title">
        <Space wrap size={8}>
          <Typography.Title level={3}>{batch?.title || 'Batch Factory V11'}</Typography.Title>
          <Tag>{Number(batch?.count ?? books.length)} 本</Tag>
          {batch?.status ? <Tag color="processing">{batch.status}</Tag> : null}
        </Space>
        <Typography.Text type="secondary">{batchSubtitle || '等待服务端生产配置'}</Typography.Text>
      </div>
      <Space wrap>
        <Button
          icon={<FolderPlus size={15} />}
          disabled={batchCreateAction.disabled || !onOpenBatchManager}
          title={batchCreateAction.disabled ? batchCreateAction.reason : ''}
          onClick={() => onOpenBatchManager?.('new')}
        >+ 新建批次</Button>
        <Button
          icon={<Archive size={15} />}
          disabled={batchReadAction.disabled || !onOpenHistory}
          title={batchReadAction.disabled ? batchReadAction.reason : ''}
          onClick={() => onOpenHistory?.()}
        >历史批次</Button>
        <Button
          icon={<Settings2 size={15} />}
          disabled={settingsAction.disabled || !batch || !onOpenBatchSettings}
          title={settingsAction.disabled ? settingsAction.reason : ''}
          onClick={() => onOpenBatchSettings?.(batch)}
        >生产统一设置</Button>
        <Button disabled={!onOpenPublishSettings} onClick={() => onOpenPublishSettings?.(batch)}>发布统一设置</Button>
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
          {STATUS_ORDER.map(status => <button key={status} className={statusFilter === status ? 'is-active' : ''} onClick={() => setStatusFilter(status)}>
            <span>{status}</span><strong>{statusCounts[status] || 0}</strong>
          </button>)}
        </div>
      </div>
      <div className="bf11-current-filter" data-bf-region="current-filter">
        <div className="bf11-region-heading"><strong>当前筛选</strong><span>{statusFilter} · {filterResults.length} 本</span></div>
        <div className="bf11-filter-results">
          {filterResults.slice(0, 5).map(book => <button key={book.id} onClick={() => selectBook(book)}>
            {book.status === '异常' ? <AlertTriangle size={14} /> : <span className="bf11-filter-dot" />}
            <span>{book.title || book.bookId || book.id}</span>
            <Tag color={statusTone[book.status]}>{book.status || '未返回状态'}</Tag>
          </button>)}
          {filterResults.length > 5 ? <small>还有 {filterResults.length - 5} 本；小说总列表保持完整，点击这里只切换当前小说。</small> : null}
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
