export function nextStatusTarget(entries, label, currentLabel, position) {
  const matches = label === '全部'
    ? entries
    : entries.filter(item => item.displayStatus === label);
  if (!matches.length) return { matches, position: 0, item: null };
  const nextPosition = label === currentLabel
    ? (position + 1) % matches.length
    : 0;
  return { matches, position: nextPosition, item: matches[nextPosition] };
}

export function summarizeVideoProgress(items, byProjectId = {}, resolveVideo = () => null) {
  const summary = { total: 0, pending: 0, queued: 0, running: 0, succeeded: 0, failed: 0 };
  for (const item of items || []) {
    const projectStatus = byProjectId[String(item?.production?.projectId || '')] || null;
    for (const [index] of (item?.directorResult?.storyboard || []).entries()) {
      summary.total += 1;
      const status = resolveVideo(item, index, projectStatus)?.status || 'draft';
      if (status === 'succeeded') summary.succeeded += 1;
      else if (status === 'failed' || status === 'cancelled') summary.failed += 1;
      else if (status === 'running') summary.running += 1;
      else if (status === 'queued') summary.queued += 1;
      else summary.pending += 1;
    }
  }
  return summary;
}
