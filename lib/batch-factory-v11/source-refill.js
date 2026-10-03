const { merge121BookInfoIntoMeta } = require('../novel-fetch-workshop/121-bookinfo');

function normalizedBatchFactorySourceLine(value) {
  return String(value || '')
    .replace(/&nbsp;|\u00a0|　/g, ' ')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function isBatchFactoryLeadingPageStateLine(value) {
  return /^(?:修改中|加载中|正文加载中|请稍候)$/.test(value);
}

function isBatchFactoryPunctuationOnlyLine(value) {
  return /^[，。！？、；：…·—～~,.!?;:()（）【】\[\]{}「」『』“”"'\-]+$/.test(value);
}

function cleanBatchFactorySourceText(value) {
  const lines = String(value || '').split(/\r?\n/).map(normalizedBatchFactorySourceLine).filter(Boolean);
  let firstContent = 0;
  while (firstContent < lines.length && isBatchFactoryLeadingPageStateLine(lines[firstContent])) firstContent += 1;
  return lines.slice(firstContent).filter(line => !isBatchFactoryPunctuationOnlyLine(line)).join('\n');
}

function resolveWorkshopPlatformId(raw, platforms = []) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const list = (Array.isArray(platforms) ? platforms : []).filter(item => String(item?.id || '').trim() && String(item?.name || '').trim());
  if (list.some(item => String(item.id) === value)) return value;
  const short = value.split('/')[0].trim();
  const exact = list.find(item => String(item.name) === short);
  if (exact) return String(exact.id);
  const matches = list.filter(item => String(item.name).startsWith(short) && short);
  return matches.length === 1 ? String(matches[0].id) : value;
}

async function refillMissingBatchFactoryBookSource({ book, fetchDirectOriginal, captureSource, platforms = [], now = () => new Date() } = {}) {
  if (String(book?.sourceText || '').trim()) throw new Error('当前书已有正文，不能覆盖');
  const rawBookID = String(book?.bookId || '').trim();
  const bookId = rawBookID.match(/^[A-Za-z0-9_.-]+/)?.[0] || '';
  const rawPlatform = String(book?.platform || book?.sourceMetadata?.platformId || '').trim();
  const platformId = resolveWorkshopPlatformId(rawPlatform, platforms);
  const maxTxt = Number(book?.sourceMetadata?.contentCaptureCharacters || 4000);
  if (!bookId || !platformId || !Number.isInteger(maxTxt) || maxTxt < 100 || maxTxt > 100000) throw new Error('当前书缺少可用的书城、Book ID 或正文范围');
  const fetched = await fetchDirectOriginal({ bookId, platformId, maxTxt });
  const rawSourceText = String(fetched?.rawText || fetched?.text || '').trim();
  const sourceText = cleanBatchFactorySourceText(fetched?.text || '');
  if (!sourceText) throw new Error('没有返回正文');
  const existingMetadata = book?.sourceMetadata && typeof book.sourceMetadata === 'object' ? book.sourceMetadata : {};
  const sourceMetadata = merge121BookInfoIntoMeta(existingMetadata, fetched?.bookinfo || {});
  const sourceTitle = String(fetched?.bookinfo?.work_title || fetched?.bookinfo?.book_name || '').trim();
  const isGiantMaterial = existingMetadata.sourceMode === 'giant_material';
  const response = await captureSource({
    sourceText,
    ...(sourceTitle ? { sourceTitle } : {}),
    expectedRevision: Number(book?.revision || 0),
    sourceMetadata: {
      ...sourceMetadata,
      sourceMode: isGiantMaterial ? 'giant_material' : 'manual_refetched',
      sourceFetchedAt: now().toISOString(),
      sourceFetchAttempts: Number(fetched?.attempts || 0),
      sourceCaptureCharacters: maxTxt,
      sourceBookId: bookId,
      sourceOriginalRaw: rawSourceText,
      ...(isGiantMaterial ? { originalReadStage: 'completed', originalReadVia: 'bookstore', originalReadError: '', contentPending: false } : {}),
      ...(sourceTitle ? { sourceBookTitle: sourceTitle } : {})
    }
  });
  return { ...response, fetched: { length: sourceText.length, attempts: fetched?.attempts || 0, bookinfo: fetched?.bookinfo || {} } };
}

module.exports = { cleanBatchFactorySourceText, resolveWorkshopPlatformId, refillMissingBatchFactoryBookSource };
