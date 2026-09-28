const EMPTY_MATERIAL = {
  materialId: '',
  giantMaterialId: '',
  title: '',
  platformBookId: '',
  platformName: '',
  videoUrl: '',
  width: null,
  height: null,
  durationSeconds: null
};

function text(value) {
  return String(value ?? '').trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function normalizeGiantMaterialId(value) {
  const candidate = text(value);
  return /^\d{10,25}$/.test(candidate) ? candidate : '';
}

function responseData(payload) {
  if (payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload;
  return {};
}

export function normalizeGiantMaterialResponse(payload) {
  const source = responseData(payload);
  return {
    materialId: text(source.material_id ?? source.materialId ?? source.id),
    giantMaterialId: text(source.giant_material_id ?? source.giantMaterialId ?? source.ocean_material_id),
    title: text(source.title ?? source.book_title ?? source.bookTitle ?? source.name),
    platformBookId: text(source.book_id ?? source.bookId ?? source.platform_book_id ?? source.platformBookId),
    platformName: text(source.platform_name ?? source.platformName ?? source.platform_label ?? source.platformLabel),
    videoUrl: text(source.video_url ?? source.videoUrl ?? source.url ?? source.play_url ?? source.playUrl),
    width: numberOrNull(source.width ?? source.video_width ?? source.videoWidth),
    height: numberOrNull(source.height ?? source.video_height ?? source.videoHeight),
    durationSeconds: numberOrNull(source.duration ?? source.duration_seconds ?? source.durationSeconds)
  };
}

export function stageState(stage, value = '') {
  const code = text(value);
  if (stage === 'ocr' && code === 'QINGYU_AUTH_NOT_CONFIGURED') {
    return { tone: 'warning', label: '未执行', detail: '当前未配置青语服务令牌' };
  }
  if (code) return { tone: 'error', label: '失败', detail: code };
  if (stage === 'ocr') return { tone: 'muted', label: '未执行', detail: '第一阶段只验证素材调用，尚未执行 OCR' };
  return { tone: 'muted', label: '待执行', detail: '等待开始' };
}

export { EMPTY_MATERIAL };
