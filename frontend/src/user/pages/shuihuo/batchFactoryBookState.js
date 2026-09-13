export function batchFactoryBookState(book) {
  const sourceText = String(book?.sourceText || '').trim();
  const queueStatus = String(book?.sourceMetadata?.queueStatus || '').trim();
  if (queueStatus === 'scheduled_waiting') return { label: '定时待执行', detail: '等待设定时间释放', tone: 'blue' };
  if (sourceText) return { label: '待开始', detail: '原文已就绪', tone: 'default' };
  return { label: '待开始', detail: '等待按书城与 bookId 获取原文', tone: 'default' };
}
