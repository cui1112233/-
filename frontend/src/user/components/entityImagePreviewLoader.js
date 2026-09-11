export function createEntityImagePreviewLoader(imageUrls, {
  loadImage,
  createObjectUrl = URL.createObjectURL,
  revokeObjectUrl = URL.revokeObjectURL
} = {}) {
  let active = true;
  const ownedObjectUrls = new Set();

  const promise = Promise.allSettled(imageUrls.map(async url => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return [url, url];

    try {
      const blob = await loadImage(url);
      const objectUrl = createObjectUrl(blob);
      if (!active) {
        revokeObjectUrl(objectUrl);
        return null;
      }
      ownedObjectUrls.add(objectUrl);
      return [url, objectUrl];
    } catch (_) {
      return null;
    }
  })).then(results => Object.fromEntries(
    results
      .filter(result => result.status === 'fulfilled' && result.value)
      .map(result => result.value)
  ));

  function cancel() {
    if (!active) return;
    active = false;
    ownedObjectUrls.forEach(url => revokeObjectUrl(url));
    ownedObjectUrls.clear();
  }

  return { promise, cancel };
}
