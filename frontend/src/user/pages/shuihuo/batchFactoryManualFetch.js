export function manualBookIDsFromInput(inputText = '') {
  const seen = new Set();
  const ids = [];
  for (const match of String(inputText).matchAll(/\d{10,25}/g)) {
    const id = match[0];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function hasFetchedManualSources(bookIds, sourceTextByBookId) {
  return bookIds.length > 0 && bookIds.every(bookId => String(sourceTextByBookId?.[bookId] || '').trim());
}

export function buildManualBatchSubmission({ title, scheduledAt = '', automationEnabled = false, autoPublishEnabled = false, ...input }) {
  return {
    ...input,
    title: String(title || '').trim(),
    scheduledAt: String(scheduledAt || ''),
    automationEnabled: automationEnabled === true,
    autoPublishEnabled: automationEnabled === true && autoPublishEnabled === true
  };
}
