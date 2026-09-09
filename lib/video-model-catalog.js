const H3_MODEL_KEY = 'minimax-h3-video';
const H3_MODEL_ID = 8803;
const H3_NO_IMAGE_WORKFLOW = 'minimax_h3_lightx2v_no_pic';
const H3_REFERENCE_WORKFLOW = 'minimax_h3_lightx2v_v5_15s';

const H3_MODEL = Object.freeze({
  id: H3_MODEL_ID,
  key: H3_MODEL_KEY,
  versionId: 1,
  name: 'MiniMax H3 多图生视频',
  kind: 'video',
  provider: 'autodl_comfyui',
  adapterKind: 'autodl_comfyui_video',
  model: H3_REFERENCE_WORKFLOW,
  maxVideoDuration: 15,
  requiresImageInput: false,
  supportsReferenceImages: true,
  referenceImagesOptional: true,
  supportedResolutions: Object.freeze(['480p', '768p']),
  supportedAspectRatios: Object.freeze(['9:16', '16:9']),
  workflow: Object.freeze({
    noImage: H3_NO_IMAGE_WORKFLOW,
    referenceImages: H3_REFERENCE_WORKFLOW
  })
});

const DEFAULT_VIDEO_MODELS = Object.freeze([
  Object.freeze({
    id: 8801,
    key: 'yd2-mini-video',
    versionId: 1,
    name: 'YD2.0 Mini（图生）',
    kind: 'video',
    provider: 'yd_video',
    adapterKind: 'yd_video',
    model: 'yd2.0-mini',
    maxVideoDuration: 1,
    requiresImageInput: false,
    supportsReferenceImages: false,
    referenceImagesOptional: false
  }),
  Object.freeze({
    id: 8802,
    key: 'local-doubao-executor-video',
    versionId: 1,
    name: '本地豆包执行器',
    kind: 'video',
    provider: 'doubao_local_executor',
    adapterKind: 'local_executor_video',
    model: 'doubao-seedance',
    maxVideoDuration: 10,
    requiresImageInput: false,
    supportsReferenceImages: false,
    referenceImagesOptional: false
  })
]);

function usableReferenceImages(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || '').trim()).filter(Boolean);
}

function selectH3Workflow(referenceImages) {
  return usableReferenceImages(referenceImages).length > 0
    ? H3_REFERENCE_WORKFLOW
    : H3_NO_IMAGE_WORKFLOW;
}

function configuredFromEnvironment() {
  return Boolean(String(
    process.env.QIANTIE_AUTODL_H3_API_KEY
      || process.env.QIANTIE_H3_API_KEY
      || ''
  ).trim());
}

function publicH3Model(configured = configuredFromEnvironment()) {
  return { ...H3_MODEL, configured: Boolean(configured) };
}

function getUnifiedVideoModels({ models = [], h3Configured = configuredFromEnvironment() } = {}) {
  const existing = Array.isArray(models) ? models : [];
  const withoutH3 = existing.filter(model => (
    model?.key !== H3_MODEL_KEY
      && model?.modelKey !== H3_MODEL_KEY
      && !(model?.adapterKind === H3_MODEL.adapterKind && String(model?.name || '').includes('H3'))
  ));
  return [...withoutH3, publicH3Model(h3Configured)];
}

function getDefaultVideoModels({ h3Configured = configuredFromEnvironment() } = {}) {
  return getUnifiedVideoModels({ models: DEFAULT_VIDEO_MODELS, h3Configured });
}

function buildH3SubmitPayload({ prompt, duration, resolution, referenceImages } = {}) {
  const body = {
    prompt: String(prompt || '').trim(),
    duration: Number.isInteger(Number(duration)) ? Number(duration) : 5,
    resolution: String(resolution || '480p竖').trim()
  };
  const images = usableReferenceImages(referenceImages);
  images.forEach((imageURL, index) => {
    body[`ref_image_${index}`] = imageURL;
  });
  return body;
}

module.exports = {
  H3_MODEL,
  H3_MODEL_ID,
  H3_MODEL_KEY,
  H3_NO_IMAGE_WORKFLOW,
  H3_REFERENCE_WORKFLOW,
  DEFAULT_VIDEO_MODELS,
  buildH3SubmitPayload,
  getDefaultVideoModels,
  getUnifiedVideoModels,
  selectH3Workflow,
  usableReferenceImages
};
