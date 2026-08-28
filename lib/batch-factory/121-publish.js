const crypto = require('node:crypto');

const BOOK_ID_PATTERN = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function isValid121BookId(value) {
  return BOOK_ID_PATTERN.test(String(value || '').trim());
}

function buildBatchFactoryPublishPlan(settings = {}, items = []) {
  const organizationId = String(settings.organizationId || settings.organization_id || '').trim();
  if (!organizationId) throw new Error('请选择组织归属');
  const profileId = String(settings.profileId || settings.profile_id || '').trim();
  if (!profileId) throw new Error('请选择 121 版本配置');
  if (!Array.isArray(items) || !items.length) throw new Error('没有可发布的小说');
  return items.map((item, index) => {
    const bookId = String(item?.bookId || item?.book_id || '').trim();
    if (!isValid121BookId(bookId)) throw new Error(`第 ${index + 1} 本小说的书号无效：121 只支持纯数字书号或 UUID`);
    const txtText = String(item?.txtText || item?.txtContent || item?.sourceText || '').trim();
    if (!txtText) throw new Error(`第 ${index + 1} 本小说缺少 TXT 正文`);
    const videoUrl = String(item?.videoUrl || item?.video_url || '').trim();
    if (!videoUrl) throw new Error(`第 ${index + 1} 本小说缺少合并成片`);
    return {
      itemId: String(item?.id || '').trim(),
      bookId,
      title: String(item?.title || '').trim(),
      organizationId,
      profileId,
      videoUrl,
      txtText,
      videoFilename: `${bookId}.mp4`,
      txtFilename: `${bookId}.txt`
    };
  });
}

function normalizeBatchFactoryPublishResult(result = {}) {
  if (result?.success !== true) return { status: 'failed', error: String(result?.error || result?.message || '121 发布失败') };
  if (result?.verified === true) return { status: 'submitted', remoteReceipt: result };
  return { status: 'accepted_pending', remoteReceipt: result };
}

function buildBatchFactoryMultipart(fields = {}, files = []) {
  const boundary = `----qiantie-batch-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const chunks = [];
  for (const [key, value] of Object.entries(fields || {})) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  for (const file of files) {
    const filename = String(file?.filename || '').trim();
    if (!filename) throw new Error('发布文件名不能为空');
    const content = Buffer.isBuffer(file?.content) ? file.content : Buffer.from(String(file?.content || ''), 'utf8');
    const contentType = String(file?.contentType || 'application/octet-stream');
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`));
    chunks.push(content, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

module.exports = {
  BOOK_ID_PATTERN,
  isValid121BookId,
  buildBatchFactoryPublishPlan,
  normalizeBatchFactoryPublishResult,
  buildBatchFactoryMultipart
};
