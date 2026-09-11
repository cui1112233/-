export function createEntityImagePreviewLoader(imageUrls, {
  loadImage,
  createObjectUrl = URL.createObjectURL,
  revokeObjectUrl = URL.revokeObjectURL
} = {}) {
  let active = true;
  const ownedUrls = new Set();
  const promise = Promise.allSettled(imageUrls.map(async url => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return [url, url];
    try {
      const blob = await loadImage(url);
      const objectUrl = createObjectUrl(blob);
      if (!active) { revokeObjectUrl(objectUrl); return null; }
      ownedUrls.add(objectUrl);
      return [url, objectUrl];
    } catch (_) { return null; }
  })).then(results => Object.fromEntries(results.filter(result => result.status === 'fulfilled' && result.value).map(result => result.value)));
  return {
    promise,
    cancel() {
      if (!active) return;
      active = false;
      ownedUrls.forEach(url => revokeObjectUrl(url));
      ownedUrls.clear();
    }
  };
}
