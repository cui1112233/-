function publicMedia(item) {
  return item?.media || item;
}

export function selectBatchSegmentIds({ segments = [], media = [], kind, scope = 'all', start, end, selectedIds = [] }) {
  const allMedia = media.map(publicMedia);
  const primaryImageIDs = new Set(
    allMedia
      .filter(item => item?.kind === 'image' && item.isPrimary && item.segmentId)
      .map(item => item.segmentId)
  );
  const completedIDs = new Set(
    allMedia.filter(item => item?.kind === kind && item.segmentId).map(item => item.segmentId)
  );
  const eligible = segments.filter(segment => segment.confirmed && (kind !== 'video' || primaryImageIDs.has(segment.id)));

  if (scope === 'incomplete') return eligible.filter(segment => !completedIDs.has(segment.id)).map(segment => segment.id);
  if (scope === 'range') {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    return eligible.filter(segment => segment.orderIndex >= start && segment.orderIndex <= end).map(segment => segment.id);
  }
  if (scope === 'selected') return eligible.filter(segment => selectedIds.includes(segment.id)).map(segment => segment.id);
  return eligible.map(segment => segment.id);
}
