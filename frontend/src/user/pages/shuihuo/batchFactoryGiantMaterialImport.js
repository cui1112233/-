import { normalizeGiantMaterialId } from '../giantMaterialTest.js';

function text(value) {
  return String(value ?? '').trim();
}

export function giantMaterialSourceLabel(value) {
  const id = normalizeGiantMaterialId(value);
  return id ? `巨量素材 · ${id}` : '巨量素材';
}

export function giantMaterialBookKey(book = {}) {
  return `${text(book.platformName || book.platform)}:${text(book.platformBookId || book.bookId)}`;
}

export function availableGiantMaterialBooks(material = {}) {
  const listed = Array.isArray(material.books) ? material.books : [];
  if (listed.length) return listed.filter(book => text(book.platformBookId || book.bookId) && text(book.title));
  const platformBookId = text(material.platformBookId);
  const title = text(material.title);
  if (!platformBookId || !title) return [];
  return [{ platformBookId, platformName: text(material.platformName), title }];
}

export function selectGiantMaterialBook(material, requestedKey = '') {
  const books = availableGiantMaterialBooks(material);
  if (books.length === 1) return books[0];
  const key = text(requestedKey);
  return books.find(book => giantMaterialBookKey(book) === key) || null;
}

export function findRegisteredGiantMaterialBook(books, giantMaterialId) {
  const id = normalizeGiantMaterialId(giantMaterialId);
  if (!id) return null;
  return (Array.isArray(books) ? books : []).find(book => text(book?.sourceMetadata?.giantMaterialId) === id) || null;
}

export function giantMaterialClassificationState(book = {}) {
  const metadata = book?.sourceMetadata || {};
  const status = text(metadata.classifyStatus).toLowerCase();
  if (status === 'classified' || status === 'manual') return { status: 'classified', label: 'AI 已判断', error: '' };
  if (status === 'failed') return { status: 'failed', label: 'AI 判断失败', error: text(metadata.classifyError) };
  return { status: 'pending', label: '待 AI 判断', error: '' };
}

export function buildGiantMaterialIntake({ giantMaterialId, material, extraction, book, contentRangeLines = 5, importedAt = new Date().toISOString() } = {}) {
  const normalizedID = normalizeGiantMaterialId(giantMaterialId);
  const selected = book || selectGiantMaterialBook(material);
  const sourceText = text(extraction?.text);
  const platformBookId = text(selected?.platformBookId || selected?.bookId);
  const title = text(selected?.title || material?.title);
  const platformName = text(selected?.platformName || selected?.platform || material?.platformName);
  if (!normalizedID) throw new Error('INVALID_GIANT_MATERIAL_ID');
  if (!selected || !platformBookId || !title) throw new Error('QINGYU_BOOK_METADATA_INCOMPLETE');
  if (!sourceText) throw new Error('GIANT_OCR_EMPTY');
  const sourceLabel = giantMaterialSourceLabel(normalizedID);
  const sourceContentVersion = `giant_material:${normalizedID}`;
  const rangeLines = Math.min(500, Math.max(1, Number(contentRangeLines) || 5));
  return {
    books: [{
      id: platformBookId,
      bookId: platformBookId,
      sourceTaskId: `giant-material:${normalizedID}`,
      title,
      platform: platformName,
      sourceText,
      txtText: sourceText,
      txtFileName: `${platformBookId}.txt`,
      sourceMetadata: {
        sourceMode: 'giant_material',
        sourceLabel,
        giantMaterialId: normalizedID,
        qingyuMaterialId: text(material?.materialId),
        videoUrl: text(material?.videoUrl),
        platformName,
        platformBookId,
        sourceBookTitle: title,
        sourceContentVersion,
        sourceImportedAt: text(importedAt) || new Date().toISOString(),
        sourceCompleteness: text(extraction?.sourceCompleteness || 'video_excerpt'),
        contentRangeLines: rangeLines,
        requiresProofreading: extraction?.requiresProofreading !== false
      }
    }],
    metadata: {
      sourceMode: 'giant_material',
      sourceLabel,
      giantMaterialId: normalizedID,
      qingyuMaterialId: text(material?.materialId),
      sourceContentVersion,
      contentRangeLines: rangeLines,
      sourceImportedAt: text(importedAt) || new Date().toISOString()
    }
  };
}
