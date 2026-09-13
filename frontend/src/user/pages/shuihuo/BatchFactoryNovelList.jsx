import { ArrowLeftOutlined, FileTextOutlined } from '@ant-design/icons';
import { Button, Tag } from 'antd';

function value(metadata, key) { return String(metadata?.[key] || '').trim() || '—'; }

export function BatchFactoryNovelList({ batch, onBack }) {
  const books = batch?.books || [];
  return <section className="shuihuo-project-library">
    <div className="shuihuo-project-library-heading">
      <div className="shuihuo-project-library-title"><h1>批量工厂 · 小说列表</h1><p>{batch?.title || '批量作品'} · {books.length} 本小说</p></div>
      <Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回个人作品</Button>
    </div>
    <div className="shuihuo-project-library-section-title"><FileTextOutlined /> <strong>上传信息</strong></div>
    <div className="shuihuo-project-grid">
      {books.map((book, index) => <article className="shuihuo-project-card" key={book.id}>
        <div className="shuihuo-project-card-cover"><span className="shuihuo-project-card-mode is-batch-factory">批量工厂</span><span>小说 {index + 1}</span></div>
        <div className="shuihuo-project-card-meta"><strong>{book.title}</strong><span>bookId：{book.bookId}</span><span>书城：{book.platform || '—'}</span><span>男女频：{value(book.sourceMetadata, 'gender')}</span><span>类型：{value(book.sourceMetadata, 'style')}</span><span>来源：{value(book.sourceMetadata, 'sourceMode') === 'manual_original' ? '手动书单' : '小说获取'}</span><Tag color={value(book.sourceMetadata, 'queueStatus') === 'scheduled_waiting' ? 'blue' : 'default'}>{value(book.sourceMetadata, 'queueStatus') === 'scheduled_waiting' ? '定时待执行' : '待手动处理'}</Tag></div>
      </article>)}
    </div>
  </section>;
}
