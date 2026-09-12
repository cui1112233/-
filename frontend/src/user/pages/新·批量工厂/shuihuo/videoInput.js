function isPrimaryImage(media, segmentId) {
  return media?.segmentId === segmentId && media?.kind === 'image' && media?.isPrimary === true;
}

export async function hasYDVideoSource({ readModel, segmentId, listAssetImages }) {
  if ((readModel?.media || []).some(item => isPrimaryImage(item?.media || item, segmentId))) {
    return true;
  }
  const assetIDs = readModel?.segmentAssetIDs?.[segmentId] || [];
  const sceneAssets = assetIDs
    .map(id => (readModel?.assets || []).find(asset => asset.id === id))
    .filter(asset => asset?.category === 'scene');
  if (sceneAssets.some(asset => String(asset.referenceObjectKey || '').trim())) {
    return true;
  }
  const results = await Promise.all(sceneAssets.map(asset => listAssetImages(asset.id)));
  return results.some(result => (result?.images || []).length > 0);
}
