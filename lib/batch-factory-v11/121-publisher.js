const target = require('../target-upload');
const { targetReceipt, summarizeRemoteBookRecord } = require('../novel-fetch-workshop/121-web-submit-service');

function text(value) { return String(value || '').trim(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

function sourcePlatformID(book) {
  const metadata = object(book?.sourceMetadata);
  const candidates = [book?.platform, metadata.platformId, metadata.platform_id, metadata.platformName, metadata.platformLabel];
  for (const candidate of candidates) {
    const value = text(candidate);
    if (target.VALID_PLATFORM_IDS.has(Number(value))) return value;
    if (target.PLATFORM_ID[value]) return String(target.PLATFORM_ID[value]);
  }
  return '';
}

function effectivePublishSettings(batch, book) {
  const settings = {
    ...object(batch?.settingsState?.patch?.publishSettings),
    ...object(book?.settingsState?.patch?.publishSettings)
  };
  // A 121 profile holds presentation options only. The source platform is
  // immutable per book and must never be overridden by a batch default.
  const sourcePlatform = sourcePlatformID(book);
  if (sourcePlatform) settings.platformId = sourcePlatform;
  return settings;
}

// Publishing has two scopes: the mapping lives under publishSettings, while
// content rewriting is a book/batch production choice.  Keep both scopes when
// making the request so the TXT reflects the exact current-book decision.
function effectiveBookSettings(batch, book) {
  return {
    ...object(batch?.settingsState?.patch),
    ...object(book?.settingsState?.patch),
    publishSettings: effectivePublishSettings(batch, book)
  };
}

function selectedProfile(settings) {
  const id = text(settings.websiteProfileId);
  return (Array.isArray(settings.websiteProfiles) ? settings.websiteProfiles : [])
    .find(profile => text(profile?.id) === id) || {};
}

function publishFields(settings, submission = {}, book = {}) {
  const metadata = object(book?.sourceMetadata);
  const platformId = sourcePlatformID(book);
  const gender = text(metadata.gender).replace('频', '');
  const style = text(metadata.style);
  if (!platformId) throw new Error('当前小说缺少来源书城，不能提交 121');
  if (!gender || !style) {
    throw new Error('当前小说尚未完成男女频和风格识别，请先完成 AI 判断或编辑列表信息');
  }
  const organization = text(submission.organization || settings.organization);
  const profile = selectedProfile(settings);
  if (!organization) throw new Error('请选择组织归属');
  const advanced = {
    ...object(profile.advanced),
    ...object(settings.advanced),
    // The selected V11 MP4 is sent as this book's custom AI head video.
    jieyaAiHead: 3
  };
  if (Number(advanced.jieyaNum) < 1) {
    throw new Error('请添加解压，才能上传 AI 前贴视频');
  }
  const fields = target.buildUploadFields({ platformId, gender, style, advanced });
  return {
    ...fields,
    organization,
    category: text(submission.category || settings.category || 'NEW_BOOK'),
    start_time: text(submission.startTime || settings.startTime || new Date().toISOString().slice(0, 19))
  };
}

function parseAssetPresign(value) {
  const payload = parseJSON(value, '121 AI 头部视频上传地址');
  if (payload?.success !== true) throw new Error(payload?.message || payload?.msg || '121 没有返回 AI 头部视频上传地址');
  const data = object(payload?.data);
  const item = Array.isArray(data.files) ? data.files[0] : null;
  if (!item?.upload_url || !item?.object_key) throw new Error('121 AI 头部视频上传地址不完整');
  return { item, bucketURL: text(item.bucket_url || data.bucket_url) };
}

async function uploadAiHeadVideo({ directClient, cookie, filename, bytes }) {
  const presign = await directClient.action({
    cookie,
    method: 'POST',
    path: target.TARGET_ASSET_PRESIGN_PATH,
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from(JSON.stringify({ files: [{ name: filename, md5: target.md5Buffer(bytes) }], kind: 'ai_head_video', source: 'zbooklist_upload_ai_head' }))
  });
  const { item, bucketURL } = parseAssetPresign(presign?.body);
  await directClient.uploadPresigned({ url: item.upload_url, headers: object(item.headers), body: bytes });
  return {
    name: text(item.name || filename),
    original_name: filename,
    url: bucketURL,
    object_key: text(item.object_key)
  };
}

function selectMergedMedia(jobs, bookId) {
  return (Array.isArray(jobs) ? jobs : [])
    .filter(job => text(job?.bookId) === text(bookId) && text(job?.status).toLowerCase() === 'succeeded' && text(job?.outputUrl))
    .sort((left, right) => String(right?.updatedAt || right?.createdAt || '').localeCompare(String(left?.updatedAt || left?.createdAt || '')))[0] || null;
}

function selectedSingleVideo(book, production) {
  const requested = object(book?.settingsState?.patch?.primaryUploadSource);
  const candidates = (Array.isArray(production?.jobs) ? production.jobs : [])
    .filter(job => text(job?.bookId) === text(book?.id))
    .flatMap(job => Array.isArray(job?.tasks) ? job.tasks : [])
    .filter(task => text(task?.status).toLowerCase() === 'succeeded' && text(task?.mediaUrl));
  const preferred = candidates.find(task => text(requested.taskId) === text(task?.id) && text(requested.videoId) === text(task?.videoId));
  return preferred || candidates.sort((left, right) => String(right?.updatedAt || '').localeCompare(String(left?.updatedAt || '')))[0] || null;
}

function toVideoFilename(bookId) { return `${text(bookId)}.mp4`; }

function contentToUpload(book, settings) {
  const source = String(book?.sourceText || '');
  if (settings?.publishRewriteEnabled !== true) return source;
  const rewritten = String(book?.workingFrontContent || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (!rewritten.length) return source;
  const configured = Number(book?.sourceMetadata?.contentRangeLines);
  const limit = Number.isInteger(configured) && configured > 0 ? Math.min(configured, 500) : 5;
  let cursor = 0;
  let nonblank = 0;
  return source.split(/\r?\n/).map(line => {
    if (!line.trim() || nonblank >= limit) return line;
    nonblank += 1;
    if (cursor >= rewritten.length) return line;
    const next = rewritten[cursor];
    cursor += 1;
    return next;
  }).join('\n');
}

function parseJSON(value, label) {
  try { return JSON.parse(String(value || '{}')); }
  catch (_) { throw new Error(`${label}返回了非 JSON 数据`); }
}

async function readBackTargetBook({ directClient, cookie, bookId, fields, advanced }) {
  try {
    const lookupURL = new URL(target.buildTargetBookListUrl(bookId));
    const response = await directClient.action({
      cookie,
      method: 'GET',
      path: `${lookupURL.pathname}${lookupURL.search}`
    });
    const payload = parseJSON(response?.body, '121 列表核验');
    if (payload?.success !== true) throw new Error(payload?.message || payload?.msg || '121 列表核验失败');
    return summarizeRemoteBookRecord(payload, bookId, fields, advanced);
  } catch (error) {
    return {
      status: '待确认',
      found: false,
      detail: error?.message || '121 后台记录暂时无法回读',
      mismatches: []
    };
  }
}

function createBatchFactory121Publisher({ loadBatch, loadMergeStatus, loadProductionStatus = async () => ({ jobs: [] }), fetchMedia, getSession, directClient, onProgress = async () => {}, now = () => new Date() } = {}) {
  if (typeof loadBatch !== 'function' || typeof loadMergeStatus !== 'function' || typeof loadProductionStatus !== 'function' || typeof fetchMedia !== 'function') throw new Error('V11 121 publisher requires batch and media readers');
  if (typeof getSession !== 'function' || !directClient?.verify || !directClient?.action || !directClient?.uploadPresigned) throw new Error('V11 121 publisher requires the shared direct 121 session');

  async function submit(owner, { batchId, bookId } = {}, submission = {}) {
    let phase = 'validation';
    try {
      const report = async (nextPhase, message) => {
        phase = nextPhase;
        await onProgress({ phase: nextPhase, status: 'running', message });
      };
      const loaded = await loadBatch(owner, batchId);
      const batch = loaded?.batch || loaded;
      const book = (batch?.books || []).find(item => text(item?.id) === text(bookId));
      if (!batch || !book) throw new Error('批量作品或单本书不存在');
      const sourceBookId = text(book.bookId);
      const filename = target.buildTargetUploadFilename(sourceBookId);
      const effective = effectiveBookSettings(batch, book);
      const settings = effective.publishSettings;
      await report('validation', '正在校验解压数量与上传主视频');
      const fields = publishFields(settings, submission, book);
      const selected = settings.uploadVideoType === 'individual'
        ? selectedSingleVideo(book, await loadProductionStatus(owner, batchId))
        : selectMergedMedia((await loadMergeStatus(owner, batchId))?.jobs, book.id);
      if (!selected) throw new Error(settings.uploadVideoType === 'individual' ? '当前书没有可上传的独立 VIDEO' : '当前书没有可上传的最终合成视频');
      const mediaURL = text(selected.outputUrl || selected.mediaUrl);
      const media = await fetchMedia(owner, mediaURL);
      const bytes = Buffer.isBuffer(media) ? media : Buffer.from(media || []);
      if (!bytes.length) throw new Error('当前书最终合成视频为空，不能上传 121');
      const session = getSession(owner);
      await report('session', '正在验证 121 登录会话');
      await directClient.verify({ cookie: session?.cookie });
      await report('ai_head', '正在上传 AI 前贴视频');
      const aiHeadVideo = await uploadAiHeadVideo({ directClient, cookie: session?.cookie, filename: toVideoFilename(sourceBookId), bytes });
      const multipart = target.buildMultipart({
        ...fields,
        jieya_ai_head_video: JSON.stringify([aiHeadVideo]),
        jieya_ai_head_video_mode: settings.materialReuse === true ? '1' : '0',
        jieya_ai_head_horizontal_flip: settings.horizontalFlip === true ? '1' : '0'
      }, { field: 'files[]', filename, content: contentToUpload(book, effective), contentType: 'text/plain; charset=utf-8' });
      await report('txt_submit', '正在提交小说 TXT 到 121');
      const response = await directClient.action({
        cookie: session?.cookie,
        method: 'POST',
        path: target.TARGET_UPLOAD_PATH,
        headers: { 'Content-Type': `multipart/form-data; boundary=${multipart.boundary}` },
        body: multipart.body,
        timeoutMs: 120000
      });
      let body = {};
      try { body = JSON.parse(String(response?.body || '{}')); }
      catch (_) { throw new Error('121 上传接口返回了非 JSON 数据'); }
      const receipt = targetReceipt(body);
      await report('readback', '正在回读 121 后台结果');
      receipt.remote_record = await readBackTargetBook({
        directClient,
        cookie: session?.cookie,
        bookId: sourceBookId,
        fields,
        advanced: { ...object(selectedProfile(settings).advanced), ...object(settings.advanced), jieyaAiHead: 3 }
      });
      return {
        status: 'accepted_pending',
        batchId: text(batch.id),
        bookId: sourceBookId,
        internalBookId: text(book.id),
        sourceTextFile: filename,
        aiHeadVideoFile: toVideoFilename(sourceBookId),
        uploadedAt: now().toISOString(),
        receipt
      };
    } catch (error) {
      error.publishPhase = error.publishPhase || phase;
      throw error;
    }
  }

  return { submit, effectivePublishSettings, effectiveBookSettings, publishFields, selectMergedMedia, selectedSingleVideo, contentToUpload, readBackTargetBook };
}

module.exports = { createBatchFactory121Publisher, sourcePlatformID, effectivePublishSettings, effectiveBookSettings, publishFields, parseAssetPresign, uploadAiHeadVideo, selectMergedMedia, selectedSingleVideo, contentToUpload, readBackTargetBook };
