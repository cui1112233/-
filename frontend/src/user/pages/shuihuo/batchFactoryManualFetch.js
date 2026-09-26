export function manualBookIDsFromInput(inputText = '') {
  const seen = new Set();
  const ids = [];
  for (const match of String(inputText).matchAll(/\d{6,25}/g)) {
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

export function buildManualBatchSubmission({ title, scheduledAt = '', automationEnabled = false, autoPublishEnabled = false, automationConcurrency = 2, runMode = '', ...input }) {
  const enabled = automationEnabled === true;
  const normalizedRunMode = String(runMode || '').trim();
  return {
    ...input,
    title: String(title || '').trim(),
    scheduledAt: String(scheduledAt || ''),
    runMode: normalizedRunMode,
    automationEnabled: enabled,
    autoPublishEnabled: enabled && (autoPublishEnabled === true || normalizedRunMode === 'full_submit'),
    automationConcurrency: [1, 2, 4].includes(Number(automationConcurrency)) ? Number(automationConcurrency) : 2
  };
}
