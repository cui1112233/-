export const SMART_UNIFIED_PREFIX_PRESET_ID = 'script-constraint-prefix-smart-unified';

export function shouldInjectSmartUnifiedStyle(constraints) {
  return constraints?.prefix?.enabled === true
    && constraints?.prefix?.presetId === SMART_UNIFIED_PREFIX_PRESET_ID;
}

export function normalizeAudioDurationSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 600) return null;
  return Math.round(parsed * 100) / 100;
}

export function readAudioDurationFromUrl(url, { AudioCtor = globalThis.Audio } = {}) {
  const source = String(url || '').trim();
  if (!source) return Promise.reject(new Error('音频地址为空'));
  if (typeof AudioCtor !== 'function') return Promise.reject(new Error('当前环境不支持读取音频时长'));

  return new Promise((resolve, reject) => {
    const audio = new AudioCtor();
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      audio.onloadedmetadata = null;
      audio.onerror = null;
      handler(value);
    };

    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = normalizeAudioDurationSeconds(audio.duration);
      if (duration === null) {
        finish(reject, new Error('无法读取有效的音频时长'));
        return;
      }
      finish(resolve, duration);
    };
    audio.onerror = () => finish(reject, new Error('音频时长读取失败'));
    try {
      audio.src = source;
      if (typeof audio.load === 'function') audio.load();
    } catch (error) {
      finish(reject, error);
    }
  });
}
