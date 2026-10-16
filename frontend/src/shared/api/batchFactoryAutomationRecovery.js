const refusal = () => new Error('此任务已有生产记录或失败原因已变化，已停止整批重启以避免重复生成。');
const value = (response, key) => response?.[key] ?? response?.data?.[key];

// Narrow recovery for the Go runtime's failed-job lookup defect. Never restart
// a batch with completed assets, stage runs or media; those need native retry.
export async function recoverInitialSourceFailure(batchId, selectedIDs, io) {
  const validate = async () => {
  const response = await io.loadAutomation();
  const automation = value(response, 'automation');
  if (automation?.batchId !== batchId) throw refusal();
  if (['running', 'scheduled'].includes(automation.state)) return response;
  const batch = value(await io.loadBatch(), 'batch');
  const books = batch?.books;
  const rows = automation?.books;
  const selected = new Set(selectedIDs);
  if (batch?.id !== batchId || automation?.state !== 'failed' || !automation?.id || !automation?.preset?.id
      || !['full_submit', 'video_no_submit', 'storyboard_only'].includes(automation.runMode)
      || ![1, 2, 4].includes(automation.concurrency)
      || !Array.isArray(books) || !books.length || !Array.isArray(rows)
      || rows.length !== books.length || selected.size !== books.length
      || new Set(rows.map(row => row.bookId)).size !== books.length) throw refusal();
  for (const book of books) {
    const row = rows.find(item => item.bookId === book.id);
    if (!selected.has(book.id) || row?.status !== 'failed' || row.stage !== 'audio_planning'
        || row.error !== '正文没有可测量的生产行' || !String(book.sourceText || '').trim()
        || !Array.isArray(book.videos) || book.videos.length || book.directorRevision
        || Object.values(book.assets || {}).some(items => items?.length)
        || book.sourceMetadata?.websiteSubmitReceipt || book.sourceMetadata?.websiteSubmitStatus) throw refusal();
    const summary = await io.loadStages(book.id);
    const runs = summary?.runs ?? summary?.data?.runs;
    if (!Array.isArray(runs) || runs.length) throw refusal();
  }
  for (const load of [io.loadProduction, io.loadMerges]) {
    const result = await load();
    const status = result?.data ?? result;
    if (status?.batchId !== batchId || !Array.isArray(status.jobs) || status.jobs.length) throw refusal();
  }
  return { response, automation, snapshot: JSON.stringify({ automation, batch }) };
  };
  const first = await validate();
  if (!first.snapshot) return first;
  const latest = await validate();
  if (!latest.snapshot) return latest;
  if (first.snapshot !== latest.snapshot) throw refusal();
  const { automation } = latest;
  const finalResponse = await io.loadAutomation();
  const finalAutomation = value(finalResponse, 'automation');
  if (finalAutomation?.batchId !== batchId) throw refusal();
  if (['running', 'scheduled'].includes(finalAutomation.state)) return finalResponse;
  if (JSON.stringify(finalAutomation) !== JSON.stringify(automation)) throw refusal();
  return io.start({ presetId: automation.preset.id, runMode: automation.runMode,
    concurrency: automation.concurrency, autoPublish: automation.autoPublish === true });
}
