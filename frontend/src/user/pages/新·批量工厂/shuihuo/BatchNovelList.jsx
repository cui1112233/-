import { ArrowLeftOutlined } from '@ant-design/icons';
import { Button, Tag } from 'antd';

export function BatchNovelList({ data, onBack }) {
  const runAt = data?.schedule?.runAt;
  return <section className="shuihuo-project-library">
    <div className="shuihuo-project-library-heading">
      <div className="shuihuo-project-library-title"><h1>批量工厂 · 小说列表</h1><p>{data?.project?.name || '批量作品'} · 内容范围 {data?.contentRangeLines} 条有效正文</p></div>
      <Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回个人作品</Button>
    </div>
    <div className="shuihuo-project-grid">
      {(data?.books || []).map(book => <article className="shuihuo-project-card" key={book.id || book.bookId}>
        <div className="shuihuo-project-card-cover"><span className="shuihuo-project-card-mode is-batch-factory">批量工厂</span><span>{book.bookstore}</span></div>
        <div className="shuihuo-project-card-meta"><strong>{book.bookName}</strong><span>ID：{book.bookId}</span><Tag color={book.queueStatus === 'scheduled_waiting' ? 'blue' : 'default'}>{book.queueStatus === 'scheduled_waiting' ? `定时待执行：${runAt || book.scheduledAt}` : '待手动处理'}</Tag></div>
      </article>)}
    </div>
  </section>;
}
