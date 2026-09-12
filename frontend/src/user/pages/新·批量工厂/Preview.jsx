import { AppstoreOutlined, BookOutlined, CheckCircleOutlined, ClockCircleOutlined, FileTextOutlined, SearchOutlined, ThunderboltOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Checkbox, Dropdown, Input, Progress, Select, Tag, Tooltip, message } from 'antd';
import { useMemo, useState } from 'react';
import './shuihuo-production.css';
import './new-batch-factory-preview.css';

const demoBooks = [
  { id: 'demo-1', bookId: 'DEMO-1001', title: '示例小说：重生之后重新开始', platform: '小说获取', status: '待开始', stage: '等待开始制作', progress: 0 },
  { id: 'demo-2', bookId: 'DEMO-1002', title: '示例小说：无名之城', platform: '小说获取', status: '处理中', stage: 'AI 推理中', progress: 48 },
  { id: 'demo-3', bookId: 'DEMO-1003', title: '示例小说：长夜之后', platform: '小说获取', status: '待上传', stage: '视频已合并', progress: 100 }
];

const batchOperations = [
  { key: 'assets', label: '人物场景图' },
  { key: 'frames', label: '画面图' },
  { key: 'video', label: '生视频' },
  { key: 'retry', label: '重试' },
  { key: 'merge', label: '合并' }
];

const publishOperations = [
  { key: 'selected', label: '提交选中' },
  { key: 'all', label: '提交全部' }
];

const mainViews = [
  { key: 'novels', label: '小说列表' },
  { key: 'engine', label: '引擎配置' },
  { key: 'reasoning', label: 'AI推理' }
];

function PreviewOnlyNotice() {
  return <div className="bf-preview-notice">
    <span className="bf-preview-notice-dot" />
    <strong>界面预览</strong>
    <span>以下为样例小说与交互；尚未连接真实数据、生成任务或上传服务。</span>
  </div>;
}

function PreviewSection({ title, description, children }) {
  return <section className="bf-preview-panel">
    <header className="bf-preview-panel-heading">
      <div><h2>{title}</h2><p>{description}</p></div>
    </header>
    {children}
  </section>;
}

function NovelList({ books, selectedIds, onToggle, onToggleVisible, keyword, onKeywordChange, statusFilter, onStatusFilterChange, onPreviewAction }) {
  const visibleBooks = useMemo(() => books.filter(book => {
    const matchesKeyword = `${book.title} ${book.bookId}`.toLowerCase().includes(keyword.trim().toLowerCase());
    return matchesKeyword && (statusFilter === '全部状态' || book.status === statusFilter);
  }), [books, keyword, statusFilter]);
  const allVisibleSelected = visibleBooks.length > 0 && visibleBooks.every(book => selectedIds.includes(book.id));
  const someVisibleSelected = visibleBooks.some(book => selectedIds.includes(book.id));

  return <>
    <div className="bf-preview-list-toolbar">
      <div className="bf-preview-list-count"><BookOutlined /> <strong>小说列表</strong><span>{books.length} 本</span></div>
      <div className="bf-preview-list-tools">
        <Input
          className="bf-preview-search"
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={event => onKeywordChange(event.target.value)}
          placeholder="搜索小说或 Book ID"
          allowClear
        />
        <Select
          value={statusFilter}
          onChange={onStatusFilterChange}
          options={['全部状态', '待开始', '处理中', '异常', '待上传', '上传中', '已完成', '已取消'].map(value => ({ value, label: value }))}
          aria-label="按小说状态筛选"
        />
        <Button type="text" icon={<AppstoreOutlined />} aria-label="列表视图" title="一行一本小说" />
      </div>
    </div>

    <div className="bf-preview-table" role="table" aria-label="小说列表">
      <div className="bf-preview-table-head" role="row">
        <span className="bf-preview-check-cell"><Checkbox
          checked={allVisibleSelected}
          indeterminate={someVisibleSelected && !allVisibleSelected}
          onChange={event => onToggleVisible(visibleBooks.map(book => book.id), event.target.checked)}
          aria-label="选择当前列表中的小说"
        /></span>
        <span>小说</span><span>主状态 / 当前阶段</span><span>生产进度</span><span>操作</span>
      </div>
      {visibleBooks.map(book => {
        const selected = selectedIds.includes(book.id);
        return <article className={`bf-preview-book-row${selected ? ' is-selected' : ''}`} key={book.id} role="row">
          <span className="bf-preview-check-cell"><Checkbox checked={selected} onChange={event => onToggle(book.id, event.target.checked)} aria-label={`选择${book.title}`} /></span>
          <div className="bf-preview-book-identity">
            <strong>{book.title}</strong>
            <span>Book ID {book.bookId}<i />来源：{book.platform}</span>
          </div>
          <div className="bf-preview-book-status">
            <Tag className={`bf-preview-status status-${book.status}`}>{book.status}</Tag>
            <span>{book.stage}</span>
          </div>
          <div className="bf-preview-book-progress">
            <Progress percent={book.progress} showInfo={false} size="small" />
            <span>{book.progress ? `${book.progress}%` : '尚未开始'}</span>
          </div>
          <div className="bf-preview-book-actions">
            <Button size="small" onClick={onPreviewAction}>预设</Button>
            <Button size="small" type="text" onClick={onPreviewAction}>查看</Button>
          </div>
        </article>;
      })}
      {!visibleBooks.length ? <div className="bf-preview-empty">没有匹配的小说</div> : null}
    </div>
  </>;
}

function EngineSettingsPreview({ onPreviewAction }) {
  const [tab, setTab] = useState('models');
  return <PreviewSection title="引擎配置" description="作品统一配置；单书和单个 VIDEO 的覆盖设置会按层级继承。">
    <div className="bf-preview-subtabs">
      <button type="button" className={tab === 'models' ? 'is-active' : ''} onClick={() => setTab('models')}>模型配置</button>
      <button type="button" className={tab === 'publishing' ? 'is-active' : ''} onClick={() => setTab('publishing')}>发布统一</button>
    </div>
    {tab === 'models' ? <div className="bf-preview-settings-grid">
      <div><span>视频模型</span><strong>跟随账号已授权模型</strong><Button size="small" onClick={onPreviewAction}>选择</Button></div>
      <div><span>VIDEO 时长 / 画幅</span><strong>≤15 秒 · 竖屏</strong><Button size="small" onClick={onPreviewAction}>设置</Button></div>
      <div><span>图片模型</span><strong>跟随账号已授权模型</strong><Button size="small" onClick={onPreviewAction}>选择</Button></div>
      <div><span>文本模型</span><strong>跟随账号已授权模型</strong><Button size="small" onClick={onPreviewAction}>选择</Button></div>
    </div> : <div className="bf-preview-publish-settings">
      <div><strong>版本对应配置档</strong><span>保留网站发布配置档入口</span><Button size="small" onClick={onPreviewAction}>选择配置档</Button></div>
      <div><strong>改文 / 不改文</strong><span>控制上传正文来源</span><Button size="small" onClick={onPreviewAction}>不改文</Button></div>
      <div><strong>网站配置与环境</strong><span>保存配置 · 环境自检 · 同步配置档 · 同步风格类型</span><Button size="small" onClick={onPreviewAction}>查看</Button></div>
    </div>}
  </PreviewSection>;
}

function ReasoningPreview({ onPreviewAction }) {
  const [tab, setTab] = useState('assets');
  const tabs = [
    { key: 'assets', label: '资产设置' },
    { key: 'constraints', label: '约束设置' },
    { key: 'video', label: '视频设置' },
    { key: 'visuals', label: '画面设置' }
  ];
  const current = tabs.find(item => item.key === tab);
  return <PreviewSection title="AI推理" description="只管理 Prompt 与 Prompt 规则；实际资源消耗由批量操作发起。">
    <div className="bf-preview-subtabs">
      {tabs.map(item => <button type="button" key={item.key} className={tab === item.key ? 'is-active' : ''} onClick={() => setTab(item.key)}>{item.label}</button>)}
    </div>
    <div className="bf-preview-reasoning-card">
      <div><strong>{current.label}</strong><span>{tab === 'assets' ? '人物、场景、道具 Prompt 与生成范围' : tab === 'constraints' ? '复用剧本生成的约束设置；只有启用项参与编译' : tab === 'video' ? '固定开头、视频提示词与生成范围' : '画面提示词与生成范围；默认可不生成'}</span></div>
      <Button type="primary" onClick={onPreviewAction}>编辑设置</Button>
    </div>
  </PreviewSection>;
}

function TaskLogPreview({ onPreviewAction }) {
  return <PreviewSection title="任务 / 日志" description="每次媒体批量操作独立记录；取消只作用于当前操作。">
    <div className="bf-preview-log-row"><ClockCircleOutlined /><div><strong>示例 operation · AI 推理</strong><span>样例记录，不对应真实任务</span></div><Tag>预览</Tag><Button size="small" onClick={onPreviewAction}>查看详情</Button></div>
  </PreviewSection>;
}

export function NewBatchFactoryPreview() {
  const [selectedIds, setSelectedIds] = useState(['demo-1']);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('全部状态');
  const [activeView, setActiveView] = useState('novels');
  const selectedCount = selectedIds.length;

  function previewAction() {
    message.info('这是界面预览操作，当前不会调用真实生产、存储或发布接口。');
  }

  function toggleBook(id, checked) {
    setSelectedIds(current => checked ? [...new Set([...current, id])] : current.filter(value => value !== id));
  }

  function publishAction({ key }) {
    if (key === 'selected' && !selectedCount) {
      message.info('请先选择要提交的小说。');
      return;
    }
    message.info(key === 'all' ? `预览：提交全部 ${demoBooks.length} 本` : `预览：提交选中的 ${selectedCount} 本`);
  }

  return <main className="shuihuo-production new-batch-factory-preview">
    <section className="bf-preview-workspace">
      <header className="bf-preview-heading">
        <div className="bf-preview-document-title">
          <Tag bordered={false}>批量工厂</Tag>
          <h1>2026-09-13-001</h1>
          <span>个人作品 · 小说前贴批量生产</span>
        </div>
        <div className="bf-preview-document-meta">
          <span><FileTextOutlined /> 当前作品 3 本小说</span>
          <span><CheckCircleOutlined /> 来源：小说获取</span>
        </div>
      </header>

      <nav className="bf-preview-main-nav" aria-label="批量工厂工作区">
        {mainViews.map(item => <button type="button" key={item.key} className={activeView === item.key ? 'is-active' : ''} onClick={() => setActiveView(item.key)}>{item.label}</button>)}
        <Dropdown menu={{ items: batchOperations, onClick: previewAction }} trigger={['click']}>
          <button type="button" className="bf-preview-nav-action"><ThunderboltOutlined /> 批量操作 <span>⌄</span></button>
        </Dropdown>
        <Tooltip title="当前没有运行中的批量操作">
          <Button className="bf-preview-cancel" disabled>取消操作</Button>
        </Tooltip>
        <button type="button" className={activeView === 'tasks' ? 'is-active' : ''} onClick={() => setActiveView('tasks')}>任务 / 日志</button>
        <Dropdown menu={{ items: publishOperations, onClick: publishAction }} trigger={['click']}>
          <Button className="bf-preview-upload" type="primary" icon={<UploadOutlined />}>上传网络 <span>⌄</span></Button>
        </Dropdown>
      </nav>

      <PreviewOnlyNotice />

      {activeView === 'novels' ? <>
        <div className="bf-preview-summary" aria-label="批次概览">
          <div><span>小说总数</span><strong>{demoBooks.length}</strong></div>
          <div><span>已选择</span><strong>{selectedCount}</strong></div>
          <div><span>处理中</span><strong>1</strong></div>
          <div><span>待上传</span><strong>1</strong></div>
          <Tag bordered={false}>默认每 30 本拆分为一个作品</Tag>
        </div>
        <NovelList
          books={demoBooks}
          selectedIds={selectedIds}
          onToggle={toggleBook}
          onToggleVisible={(bookIds, checked) => setSelectedIds(current => checked
            ? [...new Set([...current, ...bookIds])]
            : current.filter(id => !bookIds.includes(id)))}
          keyword={keyword}
          onKeywordChange={setKeyword}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          onPreviewAction={previewAction}
        />
      </> : null}
      {activeView === 'engine' ? <EngineSettingsPreview onPreviewAction={previewAction} /> : null}
      {activeView === 'reasoning' ? <ReasoningPreview onPreviewAction={previewAction} /> : null}
      {activeView === 'tasks' ? <TaskLogPreview onPreviewAction={previewAction} /> : null}
    </section>
  </main>;
}

export default NewBatchFactoryPreview;
