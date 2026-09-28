const EMPTY_MATERIAL = {
  materialId: '',
  giantMaterialId: '',
  title: '',
  platformBookId: '',
  platformName: '',
  videoUrl: '',
  width: null,
  height: null,
  durationSeconds: null,
  materialTitle: '',
  books: []
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
  if (Array.isArray(payload?.data?.list)) return payload.data.list.length === 1 ? payload.data.list[0] : {};
  if (payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload;
  return {};
}

export function normalizeGiantMaterialResponse(payload) {
  const source = responseData(payload);
  const books = [];
  const seenBooks = new Set();
  for (const work of Array.isArray(source.works) ? source.works : []) {
    const platformBookId = text(work.cp_work_id);
    const platform = text(work.cp_type);
    const key = `${platform}:${platformBookId}`;
    if (!platformBookId || seenBooks.has(key)) continue;
    seenBooks.add(key);
    books.push({ platformBookId, platformName: platform === 'QM' ? '七猫' : platform, title: text(work.name) });
  }
  const platformNames = [...new Set(books.map(book => book.platformName).filter(Boolean))];
  return {
    materialId: text(source.id ?? source.material_id ?? source.materialId),
    giantMaterialId: text(source.giant_material_id ?? source.giantMaterialId ?? source.ocean_material_id),
    title: books.length ? books.map(book => book.title).join(' / ') : text(source.title ?? source.book_title ?? source.bookTitle ?? source.name),
    platformBookId: books.length ? (books.length === 1 ? books[0].platformBookId : '') : text(source.book_id ?? source.bookId ?? source.platform_book_id ?? source.platformBookId),
    platformName: platformNames.length ? platformNames.join(' / ') : text(source.platform_name ?? source.platformName ?? source.platform_label ?? source.platformLabel),
    videoUrl: text(source.video_url ?? source.videoUrl ?? source.url ?? source.play_url ?? source.playUrl ?? source.path),
    width: numberOrNull(source.width ?? source.video_width ?? source.videoWidth),
    height: numberOrNull(source.height ?? source.video_height ?? source.videoHeight),
    durationSeconds: numberOrNull(source.duration ?? source.duration_seconds ?? source.durationSeconds),
    materialTitle: Array.isArray(source.works) ? text(source.name) : '',
    books
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
