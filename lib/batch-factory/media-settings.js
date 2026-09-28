const IMAGE_ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1']);
const VIDEO_ASPECT_RATIOS = new Set(['16:9', '9:16']);
const VIDEO_RESOLUTIONS = new Set(['480p', '720p', '1080p']);

function normalizeMediaSettings(value = {}) {
  const legacyAspectRatio = IMAGE_ASPECT_RATIOS.has(value.aspectRatio) ? value.aspectRatio : '9:16';
  return {
    imageAspectRatio: IMAGE_ASPECT_RATIOS.has(value.imageAspectRatio) ? value.imageAspectRatio : legacyAspectRatio,
    videoAspectRatio: VIDEO_ASPECT_RATIOS.has(value.videoAspectRatio)
      ? value.videoAspectRatio
      : (legacyAspectRatio === '16:9' ? '16:9' : '9:16'),
    videoResolution: VIDEO_RESOLUTIONS.has(value.videoResolution) ? value.videoResolution : '720p'
  };
}

module.exports = { IMAGE_ASPECT_RATIOS, VIDEO_ASPECT_RATIOS, VIDEO_RESOLUTIONS, normalizeMediaSettings };
