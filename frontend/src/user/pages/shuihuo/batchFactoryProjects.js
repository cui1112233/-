const BATCH_FACTORY_V11_SOURCE = 'batch_factory_v11';

function text(value) {
  return String(value ?? '').trim();
}

export function batchFactoryBatchFromResponse(response) {
  const batch = response?.batch;
  if (!text(batch?.id)) throw new Error('批量工厂作品读取结果无效');
  return batch;
}

export function batchFactoryProjectsFrom(batches) {
  if (!Array.isArray(batches)) return [];
  return batches.flatMap(batch => {
    const batchId = text(batch?.id);
    if (!batchId) return [];
    return [{
      id: `batch:${batchId}`,
      batchId,
      name: text(batch.title) || '未命名批量',
      productionMode: 'batch_factory',
      source: BATCH_FACTORY_V11_SOURCE,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      batch
    }];
  });
}

export function batchFactoryCoverFrom(batch, productionStatus, imageURL = '') {
  const tasks = (productionStatus?.jobs || []).flatMap(job => job?.tasks || []);
  for (const book of batch?.books || []) for (const video of book?.videos || []) {
    const task = tasks.find(item => item?.videoId === video.id && item?.status === 'succeeded' && text(item?.mediaUrl));
    if (task) return { kind: 'video', url: text(task.mediaUrl) };
  }
  const image = text(imageURL);
  return image ? { kind: 'image', url: image } : null;
}

export function isBatchFactoryV11Project(project) {
  return project?.source === BATCH_FACTORY_V11_SOURCE && Boolean(text(project.batchId));
}
