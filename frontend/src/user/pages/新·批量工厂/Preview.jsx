import { AppstoreOutlined, ClockCircleOutlined, FileTextOutlined, ThunderboltOutlined, UserOutlined } from '@ant-design/icons';
import { Button, Checkbox, Input, Progress, Tag, message } from 'antd';
import { useMemo, useState } from 'react';
import './shuihuo-production.css';
import './new-batch-factory-preview.css';

const demoBooks = [
  { id: 'demo-1', name: '示例小说 A', updatedAt: '2026-09-13', shots: 18, status: '待开始', progress: 0 },
  { id: 'demo-2', name: '示例小说 B', updatedAt: '2026-09-12', shots: 26, status: '制作中', progress: 48 },
  { id: 'demo-3', name: '示例小说 C', updatedAt: '2026-09-11', shots: 12, status: '待审核', progress: 82 }
];

export function NewBatchFactoryPreview() {
  const [selectedIds, setSelectedIds] = useState(['demo-1']);
  const [keyword, setKeyword] = useState('');
  const visibleBooks = useMemo(() => demoBooks.filter(book => book.name.toLowerCase().includes(keyword.trim().toLowerCase())), [keyword]);
  const selectedCount = selectedIds.filter(id => visibleBooks.some(book => book.id === id)).length;

  function toggleBook(id, checked) {
    setSelectedIds(current => checked ? [...new Set([...current, id])] : current.filter(value => value !== id));
  }

  function previewAction() {
    message.info('这是新批量工厂的界面预览，当前按钮不会调用水货生产接口。');
  }

  return <main className="shuihuo-production new-batch-factory-preview">
    <section className="shuihuo-project-library">
      <header className="shuihuo-project-library-heading">
        <div className="shuihuo-project-library-title">
          <h1>新·批量工厂</h1>
          <p>从水货生产工作台复制出的独立设计预览</p>
        </div>
        <div className="shuihuo-create-actions">
          <Button className="shuihuo-create-project" type="primary" icon={<FileTextOutlined />} onClick={previewAction}>导入小说</Button>
          <Button className="shuihuo-create-batch" icon={<ThunderboltOutlined />} onClick={previewAction}>批量开始</Button>
        </div>
      </header>

      <div className="batch-factory-preview-summary" aria-label="批次概览">
        <div><span>小说</span><strong>{demoBooks.length}</strong></div>
        <div><span>已选择</span><strong>{selectedCount}</strong></div>
        <div><span>制作中</span><strong>1</strong></div>
        <div><span>待处理</span><strong>1</strong></div>
        <Tag bordered={false}>样例数据 · 仅供预览</Tag>
      </div>

      <div className="shuihuo-project-library-section-title"><UserOutlined /> <strong>小说批次</strong></div>
      <div className="shuihuo-project-library-toolbar">
        <Input className="shuihuo-project-search" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索小说..." allowClear />
        <button className="shuihuo-project-filter" type="button" onClick={previewAction}><span>全部状态</span><ClockCircleOutlined /></button>
        <Button className="shuihuo-project-view-toggle" type="text" icon={<AppstoreOutlined />} aria-label="网格视图" title="网格视图" />
      </div>

      <div className="batch-factory-preview-grid">
        {visibleBooks.map(book => {
          const checked = selectedIds.includes(book.id);
          return <article className={`batch-factory-preview-card${checked ? ' is-selected' : ''}`} key={book.id}>
            <div className="batch-factory-preview-card-top">
              <Checkbox checked={checked} onChange={event => toggleBook(book.id, event.target.checked)} aria-label={`选择${book.name}`} />
              <Tag className={`batch-factory-preview-status status-${book.status}`}>{book.status}</Tag>
            </div>
            <button type="button" className="batch-factory-preview-card-open" onClick={previewAction}>
              <div className="batch-factory-preview-cover"><span>{book.shots} 个分镜</span></div>
              <div className="batch-factory-preview-card-meta">
                <strong>{book.name}</strong>
                <span>最近更新 {book.updatedAt}</span>
                <Progress percent={book.progress} showInfo={false} size="small" />
                <span className="batch-factory-preview-progress-label">{book.progress ? `整体进度 ${book.progress}%` : '等待开始制作'}</span>
              </div>
            </button>
          </article>;
        })}
        {!visibleBooks.length ? <div className="shuihuo-empty"><FileTextOutlined /><p>没有匹配的小说</p></div> : null}
      </div>
    </section>
  </main>;
}
