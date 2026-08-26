function firstLine(sourceText) {
  return String(sourceText || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
}

function draft(sourceText, bookId = '', title = '') {
  const text = String(sourceText || '').trim();
  return {
    title: title || firstLine(text),
    bookId,
    sourceText: text,
    txtText: text,
    sourceType: 'manual'
  };
}

function isSequenceMarker(line) {
  return /^(?:\d{1,2}[.、]?|[一二三四五六七八九十]+[.、]?)$/.test(line);
}

function parseManualNovels(value) {
  const groups = [];
  let current = [];
  let pendingBookId = '';
  for (const rawLine of String(value || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^\d{3,}$/.test(line) && !current.some(entry => entry.trim())) {
      pendingBookId = line;
      continue;
    }
    if (isSequenceMarker(line)) {
      if (current.join('\n').trim()) groups.push(draft(current.join('\n'), pendingBookId));
      current = [];
      pendingBookId = '';
      continue;
    }
    current.push(rawLine);
  }
  if (current.join('\n').trim()) groups.push(draft(current.join('\n'), pendingBookId));
  return groups;
}

function fileToDraft(fileName, sourceText) {
  const stem = String(fileName || '').replace(/\.(txt|md)$/i, '');
  return /^\d+$/.test(stem) ? draft(sourceText, stem) : draft(sourceText, '', stem);
}

function validateDraftItems(items) {
  const seenBooks = new Map();
  const seenTitles = new Map();
  const normalized = (items || []).map(item => ({ ...draft(item.sourceText, String(item.bookId || '').trim(), String(item.title || '').trim()), ...item, duplicateFields: [] }));
  for (const item of normalized) {
    if (!String(item.sourceText || '').trim()) throw new Error('正文不能为空');
    if (item.bookId && !/^\d+$/.test(item.bookId)) throw new Error('Book ID 只能填写数字');
    if (item.bookId) (seenBooks.get(item.bookId) || seenBooks.set(item.bookId, []).get(item.bookId)).push(item);
    if (item.title) (seenTitles.get(item.title) || seenTitles.set(item.title, []).get(item.title)).push(item);
  }
  for (const same of seenBooks.values()) if (same.length > 1) same.forEach(item => item.duplicateFields.push('bookId'));
  for (const same of seenTitles.values()) if (same.length > 1) same.forEach(item => item.duplicateFields.push('title'));
  return normalized;
}

export { parseManualNovels, fileToDraft, validateDraftItems };
