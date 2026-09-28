const PROVIDER_BY_MODEL = {
  'minimax-h3-video': 'autodl_comfyui',
  'yd2-mini-video': 'personal_api',
  'yd2.0-mini': 'personal_api',
  'seedance-2-0-official': 'yfai_seedance',
  'local-doubao-executor-video': 'doubao_local_executor',
  'doubao-seedance': 'doubao_local_executor'
};

export function videoProviderForModel(modelId, fallback = 'personal_api') {
  return PROVIDER_BY_MODEL[String(modelId || '').trim().toLowerCase()] || fallback || 'personal_api';
}
