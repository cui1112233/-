function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

export function selectedBookIds(selection, books) {
  const valid = new Set((Array.isArray(books) ? books : []).map(book => String(book?.id || '')).filter(Boolean));
  return unique(selection).filter(id => valid.has(id));
}

export function toggleBookSelection(selection, bookId) {
  const current = unique(selection);
  const id = String(bookId || '').trim();
  if (!id) return current;
  return current.includes(id) ? current.filter(value => value !== id) : [...current, id];
}

export function toggleAllBooks(selection, books) {
  const ids = (Array.isArray(books) ? books : []).map(book => String(book?.id || '').trim()).filter(Boolean);
  const current = selectedBookIds(selection, books);
  return ids.length && ids.every(id => current.includes(id)) ? [] : ids;
}

export function selectionScopeLabel(selection, books) {
  const count = selectedBookIds(selection, books).length;
  return count ? `已选 ${count} 本` : '未选择，执行全部';
}

