export function createEntityImagePreviewLoader(imageUrls, {
  loadImage,
  createObjectUrl = URL.createObjectURL,
  revokeObjectUrl = URL.revokeObjectURL
} = {}) {
  let active = true;
  const ownedUrls = new Set();
  const promise = Promise.allSettled(imageUrls.map(async url => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return { url, preview: url };
    try {
      const blob = await loadImage(url);
      const objectUrl = createObjectUrl(blob);
      if (!active) { revokeObjectUrl(objectUrl); return null; }
      ownedUrls.add(objectUrl);
      return { url, preview: objectUrl };
    } catch (_) { return { url, failed: true }; }
  })).then(results => {
    const previews = {};
    const failed = [];
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      if (result.value.failed) failed.push(result.value.url);
      else previews[result.value.url] = result.value.preview;
    }
    return { previews, failed };
  });
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
