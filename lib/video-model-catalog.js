const H3_MODEL_KEY = 'minimax-h3-video';
const H3_NO_IMAGE_WORKFLOW = 'minimax_h3_lightx2v_no_pic';
const H3_REFERENCE_WORKFLOW = 'minimax_h3_lightx2v_v5_15s';

const H3_MODEL = Object.freeze({
  id: 8803,
  key: H3_MODEL_KEY,
  versionId: 1,
  name: 'MiniMax H3 多图生视频',
  kind: 'video',
  provider: 'autodl_comfyui',
  adapterKind: 'autodl_comfyui_video',
  model: H3_REFERENCE_WORKFLOW,
  maxVideoDuration: 15,
  supportsReferenceImages: true,
  referenceImagesOptional: true,
  workflow: Object.freeze({ noImage: H3_NO_IMAGE_WORKFLOW, referenceImages: H3_REFERENCE_WORKFLOW })
});

function usableReferenceImages(value) {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
}

function selectH3Workflow(referenceImages) {
  return usableReferenceImages(referenceImages).length ? H3_REFERENCE_WORKFLOW : H3_NO_IMAGE_WORKFLOW;
}

function buildH3SubmitPayload({ prompt, duration, resolution, referenceImages } = {}) {
  const body = { prompt: String(prompt || '').trim(), duration: Number(duration) || 5, resolution: String(resolution || '480p竖').trim() };
  usableReferenceImages(referenceImages).forEach((url, index) => { body[`ref_image_${index}`] = url; });
  return body;
}

module.exports = { H3_MODEL_KEY, H3_NO_IMAGE_WORKFLOW, H3_REFERENCE_WORKFLOW, H3_MODEL, usableReferenceImages, selectH3Workflow, buildH3SubmitPayload };
