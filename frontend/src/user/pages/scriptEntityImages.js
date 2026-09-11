function normalizeUrl(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeEntityImages(entity = {}) {
  const imageUrls = [];
  const seen = new Set();
  for (const value of Array.isArray(entity.imageUrls) ? entity.imageUrls : []) {
    const url = normalizeUrl(value);
    if (url && !seen.has(url)) {
      seen.add(url);
      imageUrls.push(url);
    }
  }

  const requestedMain = normalizeUrl(entity.mainImageUrl);
  const mainImageUrl = imageUrls.includes(requestedMain)
    ? requestedMain
    : imageUrls.length === 1 ? imageUrls[0] : '';

  return { imageUrls, mainImageUrl };
}

export function appendEntityImage(state, url) {
  const normalized = normalizeEntityImages(state);
  const nextUrl = normalizeUrl(url);
  if (!nextUrl || normalized.imageUrls.includes(nextUrl)) return normalized;
  return normalizeEntityImages({
    imageUrls: [...normalized.imageUrls, nextUrl],
    mainImageUrl: normalized.mainImageUrl
  });
}

export function selectEntityImage(state, url) {
  const normalized = normalizeEntityImages(state);
  const nextMain = normalizeUrl(url);
  return {
    imageUrls: normalized.imageUrls,
    mainImageUrl: normalized.imageUrls.includes(nextMain) ? nextMain : normalized.mainImageUrl
  };
}

export function removeEntityImage(state, url) {
  const normalized = normalizeEntityImages(state);
  const removedUrl = normalizeUrl(url);
  const imageUrls = normalized.imageUrls.filter(imageUrl => imageUrl !== removedUrl);
  const mainImageUrl = normalized.mainImageUrl === removedUrl
    ? imageUrls[0] || ''
    : imageUrls.includes(normalized.mainImageUrl) ? normalized.mainImageUrl : '';
  return { imageUrls, mainImageUrl };
}
