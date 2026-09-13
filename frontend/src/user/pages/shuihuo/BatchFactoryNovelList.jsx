import { AppstoreOutlined, ArrowLeftOutlined, BarsOutlined, FileTextOutlined, PictureOutlined, SettingOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Checkbox, Modal, Tag, Tooltip } from 'antd';
import { useState } from 'react';
import { batchFactoryBookState, batchFactoryNovelTableRow } from './batchFactoryBookState';
import { batchFactoryWorkText, contentRangeLinesForBook } from './batchFactoryContentRange';

function value(metadata, key) { return String(metadata?.[key] || '').trim() || '—'; }

function NovelMetadata({ books, createdAt, onViewBook }) {
  return <div className="batch-factory-novel-list batch-factory-novel-fetch-list" role="table" aria-label="小说列表">
    <div className="batch-factory-novel-list-head" role="row"><span>推送日期</span><span><Checkbox disabled aria-label="全选小说" /></span><span>ID</span><span>书名</span><span>平台</span><span>风格</span><span>男女频</span><span>AI判断</span><span>原文</span><span>AI文案</span><span>网站提交</span><span>状态</span><span>操作</span></div>
    {books.map((book, index) => {
      const row = batchFactoryNovelTableRow(book, index, createdAt);
      const metadata = book.sourceMetadata || {};
      return <div className="batch-factory-novel-list-row" key={book.id} role="row">
        <span>{row.createdAt}</span><span><Checkbox disabled aria-label={`选择 ${row.title}`} /></span><span className="batch-factory-book-id">{row.bookId}</span><strong title={row.title}>{row.title}</strong><span>{metadata.platformName || book.platform || '—'}</span><span>{value(metadata, 'style')}</span><span>{value(metadata, 'gender')}</span><span>{metadata.classifyStatus || '—'}</span><span className={row.original === '✓' ? 'is-ready' : ''}>{row.original}</span><span>{row.ai1}</span><span>{row.websiteSubmit}</span><span className={row.status === '定时待执行' ? 'is-scheduled' : ''}>{row.status}</span><span><Button size="small" onClick={() => onViewBook(book)}>查看</Button></span>
      </div>;
    })}
  </div>;
}

export function BatchFactoryNovelList({ batch, onBack }) {
  const [novelListOpen, setNovelListOpen] = useState(false);
  const [viewingBook, setViewingBook] = useState(null);
  const books = Array.isArray(batch?.books) ? batch.books : [];
  const readyBooks = books.filter(book => String(book?.sourceText || '').trim()).length;
  const progress = books.length ? Math.round((readyBooks / books.length) * 100) : 0;

  return <section className="shuihuo-workbench batch-factory-workbench">
    <header className="shuihuo-workbench-header">
      <div className="shuihuo-workbench-heading"><button className="shuihuo-back-link" type="button" title="返回个人作品" aria-label="返回个人作品" onClick={onBack}><ArrowLeftOutlined /></button><strong>批量工厂 · {batch?.title || '未命名批量'}</strong><div className="shuihuo-workbench-progress" aria-label={`原文就绪 ${progress}%`}><div className="shuihuo-workbench-progress-track"><i style={{ width: `${progress}%` }} /></div><span>{progress}%</span></div></div>
      <div className="shuihuo-workbench-toolbar" role="toolbar" aria-label="批量工厂工具栏">
        <Button type="text" icon={<BarsOutlined />} onClick={() => setNovelListOpen(true)}>小说列表</Button>
        <Tooltip title="原文就绪后开放小说级人物、场景与道具设置"><Button type="text" icon={<AppstoreOutlined />} disabled>人物场景预设</Button></Tooltip>
        <Tooltip title="批量工厂作品级配置正在接入当前工作台"><Button type="text" icon={<SettingOutlined />} disabled>引擎配置</Button></Tooltip>
        <Tooltip title="原文就绪后开放 AI 推理"><Button type="text" icon={<FileTextOutlined />} disabled>AI 推理</Button></Tooltip>
        <Tooltip title="需要至少一本原文就绪的小说"><Button className="shuihuo-batch-button" type="text" icon={<PictureOutlined />} disabled>批量操作</Button></Tooltip>
        <Tooltip title="当前没有可取消的批量操作"><Button className="shuihuo-cancel-button" type="text" disabled>取消操作</Button></Tooltip>
      </div>
      <div className="shuihuo-workbench-export"><Tooltip title="任务产生后在这里查看"><Button type="text" icon={<BarsOutlined />} disabled>任务/日志</Button></Tooltip><Tooltip title="完成媒体生产后可提交 121"><Button icon={<UploadOutlined />} disabled>上传网络</Button></Tooltip></div>
      <div className="shuihuo-project-stats"><span><b>{books.length}</b> 本小说</span><span><b>{readyBooks}</b> 原文就绪</span><span><b>0</b> 视频</span></div>
    </header>
    <div className="shuihuo-workbench-table batch-factory-workbench-table" role="table" aria-label="批量工厂小说生产表">
      <div className="shuihuo-workbench-head" role="row">{['序号', '小说正文', '前贴工作文本', '预设', '提示词', '片段库', '操作'].map(item => <div role="columnheader" key={item}>{item}</div>)}</div>
      {books.map((book, index) => {
        const state = batchFactoryBookState(book);
        const rangeLines = contentRangeLinesForBook(book);
        const workText = batchFactoryWorkText(book.sourceText, book);
        return <article className="shuihuo-workbench-row batch-factory-book-row" key={book.id} role="row">
          <div className="shuihuo-workbench-cell shuihuo-order-cell"><strong>{index + 1}</strong></div>
          <div className="shuihuo-workbench-cell batch-factory-book-content"><strong>{book.title || `小说 ${index + 1}`}</strong><span>bookId：{book.bookId || '—'} · 书城：{book.platform || '—'}</span><p>{String(book.sourceText || '').trim() || '原文尚未获取。手动书单会按保存的书城与 bookId 获取原文，获取完成后才开放制作。'}</p></div>
          <div className="shuihuo-workbench-cell batch-factory-work-text"><strong>前贴工作文本 · 前 {rangeLines} 条有效正文</strong><p>{workText || '原文尚未获取。获取完成后会按内容范围生成前贴工作文本。'}</p></div>
          <div className="shuihuo-workbench-cell batch-factory-placeholder"><strong>人物 / 场景 / 道具</strong><span>等待该书原文就绪。</span></div>
          <div className="shuihuo-workbench-cell batch-factory-placeholder"><strong>画面 / 视频提示词</strong><span>AI 推理后在本行保存。</span></div>
          <div className="shuihuo-workbench-cell batch-factory-placeholder"><strong>分镜 / VIDEO</strong><span>书内生成结果会留在本行。</span></div>
          <div className="shuihuo-workbench-cell batch-factory-actions"><Tag color={state.tone}>{state.label}</Tag><span>{state.detail}</span></div>
        </article>;
      })}
    </div>
    <Modal title={`小说列表 · ${books.length} 本`} open={novelListOpen} onCancel={() => setNovelListOpen(false)} footer={null} width="min(1480px, calc(100vw - 48px))" className="batch-factory-novel-modal">
      <NovelMetadata books={books} createdAt={batch?.createdAt} onViewBook={setViewingBook} />
    </Modal>
    <Modal title={viewingBook?.title || '小说详情'} open={Boolean(viewingBook)} onCancel={() => setViewingBook(null)} footer={null} width={720} className="batch-factory-book-detail-modal">
      {viewingBook ? <div className="batch-factory-book-detail"><p><b>Book ID</b>{viewingBook.bookId || '—'}</p><p><b>书城</b>{viewingBook.platform || '—'}</p><p><b>男女频</b>{value(viewingBook.sourceMetadata, 'gender')}</p><p><b>类型</b>{value(viewingBook.sourceMetadata, 'style')}</p><p><b>来源</b>{value(viewingBook.sourceMetadata, 'sourceMode') === 'manual_original' ? '手动书单' : '小说获取'}</p><p><b>原文状态</b>{batchFactoryBookState(viewingBook).detail}</p></div> : null}
    </Modal>
  </section>;
}
