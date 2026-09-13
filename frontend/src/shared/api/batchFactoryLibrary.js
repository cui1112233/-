export function createBatchFactoryLibrary(api) {
  if (!api || typeof api.listBatches !== 'function' || typeof api.createBatch !== 'function') {
    throw new Error('Batch Factory V11 API is required');
  }

  return {
    async listDocuments() {
      const result = await api.listBatches();
      return Array.isArray(result?.batches) ? result.batches : [];
    },

    async createDocument({ title, sourceText, filename = '' } = {}) {
      const normalizedTitle = String(title || '').trim();
      const fullText = String(sourceText || '');
      const fileName = String(filename || '').trim();
      if (!normalizedTitle) throw new Error('请填写作品名称');
      if (!fullText.trim()) throw new Error('请粘贴小说原文或选择 TXT、MD 文件');

      const sourceMetadata = fileName
        ? { importSource: 'manual-file', fileName }
        : { importSource: 'manual-text' };
      const result = await api.createBatch({
        title: normalizedTitle,
        books: [{
          title: normalizedTitle,
          sourceText: fullText,
          ...(fileName ? { txtFileName: fileName } : {}),
          sourceMetadata
        }]
      });
      const batch = result?.batch || result;
      if (!batch?.id) throw new Error('批量工厂未返回新作品编号，请先刷新作品列表确认创建结果');
      return batch;
    }
  };
}
