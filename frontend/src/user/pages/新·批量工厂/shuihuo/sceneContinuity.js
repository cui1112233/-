function sceneAssetIds(segmentId, bindings, assets) {
  const assetById = new Map((assets || []).map(asset => [asset.id, asset]));
  return (bindings?.[segmentId] || [])
    .filter(id => assetById.get(id)?.category === 'scene')
    .map(Number)
    .sort((left, right) => left - right);
}

export function sameAssetSet(left = [], right = []) {
  return left.length === right.length && left.every((id, index) => Number(id) === Number(right[index]));
}

export function contiguousFollowingSceneSegments(segments, bindings, assets, segmentId) {
  const index = (segments || []).findIndex(segment => segment.id === segmentId);
  if (index < 0) return [];
  const currentSceneIds = sceneAssetIds(segmentId, bindings, assets);
  const following = [];
  for (const segment of segments.slice(index + 1)) {
    const nextSceneIds = sceneAssetIds(segment.id, bindings, assets);
    if (nextSceneIds.length && !sameAssetSet(nextSceneIds, currentSceneIds)) break;
    following.push(segment);
  }
  return following;
}

export function sceneAssetIdsForSegment(segmentId, bindings, assets) {
  return sceneAssetIds(segmentId, bindings, assets);
}
