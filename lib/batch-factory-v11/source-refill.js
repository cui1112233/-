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
  // Giant-material imports identify Yangguang as YG, while 121 exposes the
  // same bookstore as Dianzhong (platform 4). Resolve the verified alias before
  // passing the platform through unchanged, which would make 121 reject it.
  if (/^(?:YG|阳光)$/i.test(value)) {
    const dianzhong = list.find(item => String(item.id) === '4' || /点众/.test(String(item.name)));
    return dianzhong ? String(dianzhong.id) : '4';
  }
  // Qingyu identifies 常读 as CD; its confirmed 121 source platform is 2.
  if (/^(?:CD|常读)$/i.test(value)) return '2';
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
  // Imported giant-material books carry both a display name (book.platform)
  // and the authoritative numeric bookstore ID in sourceMetadata. Prefer the
  // numeric ID so labels such as 常读 are never sent to 121 as platform values.
  const rawPlatform = String(book?.sourceMetadata?.platformId || book?.sourceMetadata?.platformCode || book?.platform || '').trim();
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
      platformId,
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

// Historical manual imports may have already persisted their original text
// before the direct-fetch flow carried 121 bookinfo across the intake
// boundary. This intentionally touches metadata only: source text, title and
// revisions outside the metadata write remain untouched.
async function backfillBatchFactoryBook121Metadata({ book, fetchDirectOriginal, saveMetadata, platforms = [] } = {}) {
  const rawBookID = String(book?.bookId || '').trim();
  const bookId = rawBookID.match(/^[A-Za-z0-9_.-]+/)?.[0] || '';
  const rawPlatform = String(book?.sourceMetadata?.platformId || book?.sourceMetadata?.platformCode || book?.platform || '').trim();
  const platformId = resolveWorkshopPlatformId(rawPlatform, platforms);
  if (!bookId || !platformId) throw new Error('当前书缺少可用的书城或 Book ID');
  if (typeof fetchDirectOriginal !== 'function' || typeof saveMetadata !== 'function') throw new Error('121 元数据回填服务不可用');

  const fetched = await fetchDirectOriginal({ bookId, platformId, maxTxt: 100 });
  const metadata = book?.sourceMetadata && typeof book.sourceMetadata === 'object' && !Array.isArray(book.sourceMetadata)
    ? book.sourceMetadata
    : {};
  const nextMetadata = merge121BookInfoIntoMeta(metadata, fetched?.bookinfo || {});
  if (JSON.stringify(nextMetadata) === JSON.stringify(metadata)) {
    return { status: 'unchanged', book, fetched: { bookinfo: fetched?.bookinfo || {} } };
  }
  const response = await saveMetadata({
    metadata: nextMetadata,
    expectedRevision: Number(book?.revision || 0)
  });
  return { status: 'backfilled', book: response?.book || { ...book, sourceMetadata: nextMetadata }, fetched: { bookinfo: fetched?.bookinfo || {} } };
}

module.exports = { cleanBatchFactorySourceText, resolveWorkshopPlatformId, refillMissingBatchFactoryBookSource, backfillBatchFactoryBook121Metadata };
