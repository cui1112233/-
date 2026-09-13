import { AppstoreOutlined, ArrowLeftOutlined, BarsOutlined, FileTextOutlined, PictureOutlined, SettingOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Drawer, Tag, Tooltip } from 'antd';
import { useState } from 'react';
import { batchFactoryBookState } from './batchFactoryBookState';

function value(metadata, key) { return String(metadata?.[key] || '').trim() || '—'; }

function NovelMetadata({ books }) {
  return <div className="batch-factory-novel-list" role="table" aria-label="小说列表">
    <div className="batch-factory-novel-list-head" role="row"><span>序号</span><span>书名</span><span>bookId</span><span>书城</span><span>男女频</span><span>类型</span><span>来源</span></div>
    {books.map((book, index) => <div className="batch-factory-novel-list-row" key={book.id} role="row">
      <span>{index + 1}</span><strong>{book.title || `小说 ${index + 1}`}</strong><span>{book.bookId || '—'}</span><span>{book.platform || '—'}</span><span>{value(book.sourceMetadata, 'gender')}</span><span>{value(book.sourceMetadata, 'style')}</span><span>{value(book.sourceMetadata, 'sourceMode') === 'manual_original' ? '手动书单' : '小说获取'}</span>
    </div>)}
  </div>;
}

export function BatchFactoryNovelList({ batch, onBack }) {
  const [novelListOpen, setNovelListOpen] = useState(false);
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
        return <article className="shuihuo-workbench-row batch-factory-book-row" key={book.id} role="row">
          <div className="shuihuo-workbench-cell shuihuo-order-cell"><strong>{index + 1}</strong></div>
          <div className="shuihuo-workbench-cell batch-factory-book-content"><strong>{book.title || `小说 ${index + 1}`}</strong><span>bookId：{book.bookId || '—'} · 书城：{book.platform || '—'}</span><p>{String(book.sourceText || '').trim() || '原文尚未获取。手动书单会按保存的书城与 bookId 获取原文，获取完成后才开放制作。'}</p></div>
          <div className="shuihuo-workbench-cell batch-factory-placeholder"><strong>前贴工作文本</strong><span>原文获取后按内容范围生成，保留全文。</span></div>
          <div className="shuihuo-workbench-cell batch-factory-placeholder"><strong>人物 / 场景 / 道具</strong><span>等待该书原文就绪。</span></div>
          <div className="shuihuo-workbench-cell batch-factory-placeholder"><strong>画面 / 视频提示词</strong><span>AI 推理后在本行保存。</span></div>
          <div className="shuihuo-workbench-cell batch-factory-placeholder"><strong>分镜 / VIDEO</strong><span>书内生成结果会留在本行。</span></div>
          <div className="shuihuo-workbench-cell batch-factory-actions"><Tag color={state.tone}>{state.label}</Tag><span>{state.detail}</span></div>
        </article>;
      })}
    </div>
    <Drawer title={`小说列表 · ${books.length} 本`} placement="top" height="min(520px, 74vh)" open={novelListOpen} onClose={() => setNovelListOpen(false)} className="batch-factory-novel-drawer">
      <NovelMetadata books={books} />
    </Drawer>
  </section>;
}
