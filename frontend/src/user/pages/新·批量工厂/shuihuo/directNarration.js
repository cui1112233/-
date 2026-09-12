const fallbackVoice = 'zh-CN-XiaoxiaoNeural';

function isTtsVoiceId(value) {
  return /^[a-z]{2,3}-[A-Z]{2,3}-[A-Za-z0-9]+(?:Neural)?$/.test(String(value || '').trim());
}

export function resolveNarrationSettings({ voiceAsset, settings = {}, defaults = {} } = {}) {
  const assetVoice = String(voiceAsset?.prompt || '').trim();
  return {
    voice: isTtsVoiceId(assetVoice) ? assetVoice : String(defaults.voice || fallbackVoice),
    speed: Number(settings.speechRate) || 1,
    pitch: Number(settings.pitch) || 0,
    style: String(defaults.style || 'general')
  };
}

export function resolveSpeakerVoiceAsset({ speaker, assets = [], narratorVoiceAssetId } = {}) {
  const narratorVoice = assets.find(asset => asset.id === narratorVoiceAssetId && asset.category === 'voice');
  const name = String(speaker || '').trim() || '旁白';
  if (name === '旁白') return narratorVoice;

  const character = assets.find(asset => asset.category === 'character' && asset.name === name);
  if (!character?.voiceAssetId) return undefined;
  return assets.find(asset => asset.id === character.voiceAssetId && asset.category === 'voice');
}

function base64FromBytes(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function audioBlobToDataUrl(blob) {
  if (!blob || typeof blob.arrayBuffer !== 'function' || blob.size === 0) {
    throw new Error('配音服务没有返回可保存的音频');
  }
  const mime = String(blob.type || '').startsWith('audio/') ? blob.type : 'audio/mpeg';
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${mime};base64,${base64FromBytes(bytes)}`;
}

export function narrationFilename(segmentId, suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`) {
  return `segment-${segmentId}-narration-${suffix}.mp3`;
}
