const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { createBatchFactoryStore } = require('../lib/batch-factory/store');
const { createBatchFactory121Store } = require('../lib/batch-factory/121-store');
const { requestProductionBridge } = require('../lib/batch-factory/production-bridge');
const target = require('../lib/target-upload');

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clean(value) { return String(value ?? '').trim(); }
function htmlText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function attr(tag, name) {
  const pattern = new RegExp(`\\b${name}=["']([^"']*)["']`, 'i');
  return clean(String(tag || '').match(pattern)?.[1]);
}

function parseOptions(body) {
  const output = [];
  const seen = new Set();
  const pattern = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  for (let match; (match = pattern.exec(String(body || '')));) {
    const id = attr(match[1], 'value');
    const name = htmlText(match[2]);
    if (!id || !name || /请选择|全部/i.test(name) || seen.has(id)) continue;
    seen.add(id);
    output.push({ id, name });
  }
  return output;
}

function parseTargetStyleCatalog(html) {
  const select = String(html || '').match(/<select\b(?=[^>]*\bid=["']style["'])[^>]*>([\s\S]*?)<\/select>/i);
  if (!select) return [];
  return parseOptions(select[1]);
}

function parseOrganizationCatalog(html) {
  const source = String(html || '');
  const labels = [...source.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)];
  for (const label of labels) {
    if (!/组织归属/.test(htmlText(label[2]))) continue;
    const forId = attr(label[1], 'for');
    if (forId) {
      const escaped = forId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const select = source.match(new RegExp(`<select\\b([^>]*\\bid=["']${escaped}["'][^>]*)>([\\s\\S]*?)<\\/select>`, 'i'));
      if (select) {
        const fieldName = attr(select[1], 'name') || forId;
        const items = parseOptions(select[2]);
        if (fieldName && items.length) return { fieldName, items };
      }
    }
    const tail = source.slice((label.index || 0) + label[0].length, (label.index || 0) + label[0].length + 5000);
    const select = tail.match(/<select\b([^>]*)>([\s\S]*?)<\/select>/i);
    if (select) {
      const fieldName = attr(select[1], 'name') || attr(select[1], 'id');
      const items = parseOptions(select[2]);
      if (fieldName && items.length) return { fieldName, items };
    }
  }
  const nearby = source.match(/组织归属[\s\S]{0,1200}?<select\b([^>]*)>([\s\S]*?)<\/select>/i);
  if (nearby) {
    const fieldName = attr(nearby[1], 'name') || attr(nearby[1], 'id');
    const items = parseOptions(nearby[2]);
    if (fieldName && items.length) return { fieldName, items };
  }
  return { fieldName: '', items: [] };
}

function parseTargetConfigData(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '{}')); } catch (_) { return {}; }
}

function importedAdvancedFromTarget(raw) {
  const source = object(raw);
  const jieya = object(source.jieya);
  const gunping = object(source.gunping);
  return target.normalizeAdvanced({
    tl5: Number(source.tl5),
    ziti: source.ziti ?? gunping.ziti,
    zitidx: source.zitidx ?? gunping.zitidx,
    biaohong: source.biaohong ?? gunping.biaohong,
    biaohongReuse: source.biaohong_reuse ?? gunping.biaohong_reuse,
    keywords: source.keywords,
    jieyaNum: source.jieya_num ?? jieya.jieya_num,
    jieyaAiHead: source.jieya_ai_head ?? jieya.jieya_ai_head ?? jieya.ai_head,
    jieyaSpeed: source.jieya_speed ?? jieya.jieya_speed ?? jieya.speed,
    jieyaPitch: source.jieya_pitch ?? jieya.jieya_pitch ?? jieya.pitch,
    gunpingNum: source.gunping_num ?? gunping.gunping_num,
    gunpingSpeed: source.gunping_speed ?? gunping.gunping_speed ?? gunping.speed,
    fontColorStyles: source.font_color_styles ?? jieya.font_color_styles
  });
}

function normalizeProfiles(payload, styleCatalog = []) {
  const styleById = Object.fromEntries([
    ...styleCatalog.map(item => [String(item.id), item.name]),
    ...Object.entries(target.STYLE_ID).map(([name, id]) => [String(id), name])
  ]);
  return (Array.isArray(payload?.data) ? payload.data : []).map((item, index) => {
    const source = object(item);
    const data = parseTargetConfigData(source.config_data);
    const gender = clean(data.gender ?? source.gender);
    return {
      id: `121-${clean(source.id || index + 1)}`,
      name: clean(source.config_name || `121 配置档 ${index + 1}`),
      configId: clean(source.id),
      isDefault: Number(source.is_default) === 1,
      platformId: clean(data.platform_id ?? source.platform_id),
      gender: gender === '1' ? '男' : gender === '2' ? '女' : gender.replace('频', ''),
      style: styleById[clean(data.style ?? source.style)] || clean(data.style_name || source.style_name),
      advanced: importedAdvancedFromTarget(data)
    };
  }).filter(item => item.name && item.configId);
}

function styleMap(catalog) {
  return Object.fromEntries((Array.isArray(catalog) ? catalog : []).map(item => [item.name, Number(item.id)]).filter(([, id]) => Number.isFinite(id)));
}

function metadataForItem(item) {
  const meta = object(item?.sourceMetadata);
  const platformName = clean(item?.platform || meta.platformName || meta.platform);
  const platformId = Number(meta.platformId ?? meta.platform_id ?? target.PLATFORM_ID[platformName]);
  const gender = clean(meta.gender || meta.frequency || meta.sex).replace('频', '');
  const style = clean(meta.style || meta.styleName || meta.category);
  return { platformName, platformId, gender, style };
}

function selectProfile(config, publishSettings, meta) {
  const profiles = Array.isArray(config.profiles) ? config.profiles : [];
  const requested = clean(publishSettings?.configId || publishSettings?.profileId || config.selectedProfile);
  const direct = profiles.find(profile => profile.id === requested || profile.configId === requested || profile.name === requested);
  if (direct) return direct;
  const exact = profiles.find(profile => String(profile.platformId) === String(meta.platformId) && profile.gender === meta.gender && profile.style === meta.style);
  if (exact) return exact;
  const platformGender = profiles.find(profile => String(profile.platformId) === String(meta.platformId) && profile.gender === meta.gender);
  return platformGender || profiles.find(profile => profile.isDefault) || profiles[0] || null;
}

function publicationAdvanced(publishSettings, profile) {
  const jieyaNum = Math.max(0, Math.min(target.PER_BOOK_MATERIAL_LIMIT, Number(publishSettings?.jieyaVideoCount ?? profile?.advanced?.jieyaNum ?? 4)));
  return target.normalizeBookAdvanced({
    ...(profile?.advanced || {}),
    jieyaNum,
    jieyaAiHead: 0,
    jieyaSpeed: Number(profile?.advanced?.jieyaSpeed || 1.7)
  });
}

function organizationSelection(config, publishSettings) {
  const catalog = object(config.organizationCatalog);
  const requested = clean(publishSettings?.organizationId || config.selectedOrganization);
  const selected = (catalog.items || []).find(item => item.id === requested);
  if (!catalog.fieldName || !selected) throw new Error('请选择有效的 121 组织归属；如目录为空请先同步 121 配置');
  return { fieldName: catalog.fieldName, id: selected.id, name: selected.name };
}

function summarizeReceipt(data) {
  const result = object(data?.result);
  const success = object(result.success);
  const failed = object(result.failed);
  const successFiles = Array.isArray(success.files) ? success.files : [];
  const failedFiles = Array.isArray(failed.files) ? failed.files : [];
  const successCount = Math.max(0, Number(success.count) || successFiles.length);
  const failedCount = Math.max(0, Number(failed.count) || failedFiles.length);
  const failureReasons = failedFiles.map(item => clean(item?.reason || item?.message)).filter(Boolean);
  const uploadError = failedCount > 0 ? (failureReasons.join('；') || `有 ${failedCount} 个文件被拒绝`) : '';
  return {
    verified: !uploadError && data?.success === true && (successCount > 0 || !Object.keys(result).length),
    successCount,
    failedCount,
    uploadError,
    message: clean(data?.message || data?.msg),
    raw: JSON.stringify(data || {}).slice(0, 4000)
  };
}

async function verifyRemoteBook(httpClient, cookie, bookId) {
  const response = await httpClient({ method: 'GET', url: target.buildTargetBookListUrl(bookId), headers: { Cookie: cookie } });
  if (target.isLoginPage(response.body)) throw new Error('121 登录会话已失效');
  let data = {};
  try { data = JSON.parse(response.body); } catch (_) { throw new Error('121 列表接口返回非 JSON 数据'); }
  if (data.success !== true) throw new Error(data.message || data.msg || '121 列表核验失败');
  const row = (Array.isArray(data.data) ? data.data : []).find(entry => clean(entry?.bookid) === clean(bookId));
  return row ? { found: true, remoteId: clean(row.id), addtime: clean(row.addtime) } : { found: false, remoteId: '', addtime: '' };
}

async function productionStatus(req, item, shuihuoGateway) {
  const projectId = Number(item?.production?.projectId || 0);
  if (!projectId) return { projectId: 0, merged: null };
  const upstream = await requestProductionBridge({
    username: req.auth.account.username,
    isOwner: req.auth.account.isOwner === true,
    pathname: '/api/shuihuo-production/batch-factory/status',
    body: { projectIds: [projectId] },
    targetBaseUrl: shuihuoGateway?.targetBaseUrl,
    bridgeSecret: shuihuoGateway?.bridgeSecret
  });
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) throw new Error(upstream.payload?.error || '无法读取合并视频状态');
  const project = (upstream.payload?.projects || []).find(entry => Number(entry.projectId) === projectId);
  const merged = [...(project?.media || [])].reverse().find(media => media.source === 'batch_merge') || null;
  return { projectId, merged };
}

function planItem(config, batch, item, mediaStatus) {
  const meta = metadataForItem(item);
  const profile = selectProfile(config, batch.publishSettings || {}, meta);
  const organization = organizationSelection(config, batch.publishSettings || {});
  if (!Number.isInteger(meta.platformId) || !target.VALID_PLATFORM_IDS.has(meta.platformId)) throw new Error(`小说 ${item.title} 缺少可映射的 121 平台`);
  if (!['男', '女'].includes(meta.gender)) throw new Error(`小说 ${item.title} 缺少男/女频信息`);
  if (!meta.style) throw new Error(`小说 ${item.title} 缺少风格信息`);
  if (!clean(item.txtText)) throw new Error(`小说 ${item.title} 的完整 TXT 为空`);
  target.buildTargetUploadFilename(item.bookId);
  if (!mediaStatus?.merged) throw new Error(`小说 ${item.title} 尚未完成视频合并`);
  const advanced = publicationAdvanced(batch.publishSettings || {}, profile);
  const fields = target.buildUploadFields({ platformId: meta.platformId, gender: meta.gender, style: meta.style, advanced, styleMap: styleMap(config.styleCatalog) });
  fields[organization.fieldName] = organization.id;
  return {
    itemId: item.id,
    bookId: item.bookId,
    title: item.title,
    txtFileName: target.buildTargetUploadFilename(item.bookId),
    txtBytes: Buffer.byteLength(item.txtText),
    mergedMediaId: mediaStatus.merged.id,
    profile: profile ? { id: profile.id, name: profile.name, configId: profile.configId } : null,
    organization,
    meta,
    advanced,
    fields,
    localOnlySettings: {
      materialReuse: batch.publishSettings?.materialReuse === true,
      horizontalFlip: batch.publishSettings?.horizontalFlip === true
    },
    remoteCapability: {
      txtUpload: true,
      mergedVideoUpload: false,
      note: '当前已验证的 121 自定义文案接口只接收 TXT；未发现可验证的 MP4 上传字段，因此不会伪造视频上传。合并 MP4 已在本地生产项目中校验存在。'
    }
  };
}

async function submitItem(req, batch, item, config, store121, shuihuoGateway, httpClient) {
  const session = store121.getSession(req.username);
  if (!session?.cookie) throw new Error('请先登录 121');
  const mediaStatus = await productionStatus(req, item, shuihuoGateway);
  const plan = planItem(config, batch, item, mediaStatus);
  const upload = target.buildMultipart(plan.fields, { filename: plan.txtFileName, content: item.txtText });
  let data = {};
  let lastError = null;
  const retryTimes = Math.max(0, Math.min(Number(config.retryTimes) || 1, 5));
  for (let attempt = 0; attempt <= retryTimes; attempt += 1) {
    try {
      const response = await httpClient({
        method: 'POST',
        url: `http://${target.TARGET_HOST}${target.TARGET_UPLOAD_PATH}`,
        headers: { 'Content-Type': `multipart/form-data; boundary=${upload.boundary}`, Cookie: session.cookie },
        body: upload.body
      });
      if (target.isLoginPage(response.body)) throw new Error('121 登录会话已失效，请重新登录');
      try { data = JSON.parse(response.body); } catch (_) { data = {}; }
      if (data.success === true) { lastError = null; break; }
      lastError = new Error(data.message || data.msg || '121 上传失败');
    } catch (error) { lastError = error; }
  }
  if (lastError) throw lastError;
  const receipt = summarizeReceipt(data);
  if (receipt.uploadError) throw new Error(receipt.uploadError);
  let remoteRecord = { found: false, remoteId: '', addtime: '' };
  try { remoteRecord = await verifyRemoteBook(httpClient, session.cookie, item.bookId); } catch (_) {}
  const record = store121.appendHistory(req.username, {
    batchId: batch.id,
    itemId: item.id,
    bookId: item.bookId,
    title: item.title,
    status: receipt.verified ? 'txt_submitted' : 'accepted_pending',
    txtFileName: plan.txtFileName,
    mergedMediaId: plan.mergedMediaId,
    receipt,
    remoteRecord,
    organization: plan.organization,
    profile: plan.profile,
    remoteCapability: plan.remoteCapability
  });
  return { plan, receipt, remoteRecord, record };
}

function publicConfig(config, session) {
  return {
    ...config,
    password: '',
    sessionReady: Boolean(session?.cookie),
    sessionVerifiedAt: session?.verifiedAt || '',
    target: target.TARGET_HOST,
    capabilities: {
      login: true,
      syncProfiles: true,
      syncStyles: true,
      syncOrganizations: true,
      txtUpload: true,
      mergedVideoUpload: false
    }
  };
}

function createBatchFactoryPublishRouter({
  store = createBatchFactoryStore(),
  store121 = createBatchFactory121Store(),
  shuihuoGateway,
  httpClient = target.requestHttp
} = {}) {
  const router = express.Router();
  router.use(apiAuth);

  router.get('/121/config', (req, res) => res.json({ config: publicConfig(store121.getConfig(req.username), store121.getSession(req.username)) }));
  router.get('/121/history', (req, res) => res.json({ history: store121.listHistory(req.username) }));

  router.post('/121/login', async (req, res) => {
    const username = clean(req.body?.username);
    const password = String(req.body?.password || '');
    if (!username || !password) return res.status(400).json({ error: '请输入 121 账号和密码' });
    try {
      const loginPage = await httpClient({ method: 'GET', url: target.buildLoginPageUrl() });
      const initialCookie = target.cookieHeaderFromSetCookie(loginPage.headers);
      const login = await httpClient(target.buildLoginRequest(username, password, initialCookie));
      let data = {};
      try { data = JSON.parse(login.body); } catch (_) {}
      if (data.success !== true) throw new Error(data.message || '121 登录失败');
      const cookie = target.mergeCookieHeaders(initialCookie, target.cookieHeaderFromSetCookie(login.headers));
      if (!cookie) throw new Error('121 登录未返回会话 Cookie');
      store121.setSession(req.username, cookie);
      const config = store121.patchConfig(req.username, { username, passwordMasked: true, enabled: true });
      return res.json({ ok: true, config: publicConfig(config, store121.getSession(req.username)) });
    } catch (error) {
      store121.clearSession(req.username);
      return res.status(400).json({ error: error.message || '121 登录失败' });
    }
  });

  router.post('/121/logout', (req, res) => {
    store121.clearSession(req.username);
    return res.json({ ok: true });
  });

  router.post('/121/config', (req, res) => {
    try {
      const current = store121.getConfig(req.username);
      const next = store121.saveConfig(req.username, { ...current, ...object(req.body?.config || req.body) });
      return res.json({ ok: true, config: publicConfig(next, store121.getSession(req.username)) });
    } catch (error) { return res.status(400).json({ error: error.message || '保存 121 设置失败' }); }
  });

  router.post('/121/sync', async (req, res) => {
    const session = store121.getSession(req.username);
    if (!session?.cookie) return res.status(409).json({ error: '请先登录 121' });
    try {
      const [page, configResponse] = await Promise.all([
        httpClient({ method: 'GET', url: `http://${target.TARGET_HOST}${target.TARGET_CHECK_PATH}`, headers: { Cookie: session.cookie } }),
        httpClient({ method: 'GET', url: `http://${target.TARGET_HOST}${target.TARGET_CONFIG_LIST_PATH}`, headers: { Cookie: session.cookie } })
      ]);
      if (target.isLoginPage(page.body) || target.isLoginPage(configResponse.body)) throw new Error('121 登录会话已失效，请重新登录');
      const styleCatalog = parseTargetStyleCatalog(page.body);
      const organizationCatalog = parseOrganizationCatalog(page.body);
      if (!organizationCatalog.fieldName || !organizationCatalog.items.length) throw new Error('121 页面未找到“组织归属”下拉，请确认账号权限或页面结构');
      let configPayload = {};
      try { configPayload = JSON.parse(configResponse.body); } catch (_) { throw new Error('121 配置档接口返回非 JSON 数据'); }
      if (configPayload.success !== true || !Array.isArray(configPayload.data)) throw new Error(configPayload.message || configPayload.msg || '121 配置档同步失败');
      const profiles = normalizeProfiles(configPayload, styleCatalog);
      const current = store121.getConfig(req.username);
      const selectedOrganization = organizationCatalog.items.some(item => item.id === current.selectedOrganization) ? current.selectedOrganization : '';
      const next = store121.saveConfig(req.username, { ...current, profiles, styleCatalog, organizationCatalog, selectedOrganization });
      return res.json({ ok: true, config: publicConfig(next, session), counts: { profiles: profiles.length, styles: styleCatalog.length, organizations: organizationCatalog.items.length } });
    } catch (error) { return res.status(400).json({ error: error.message || '同步 121 配置失败' }); }
  });

  router.get('/121/environment', async (req, res) => {
    const session = store121.getSession(req.username);
    const config = store121.getConfig(req.username);
    const checks = [
      { name: '121 登录会话', ok: Boolean(session?.cookie), detail: session?.cookie ? '已登录' : '未登录' },
      { name: '配置档目录', ok: config.profiles.length > 0, detail: `${config.profiles.length} 个` },
      { name: '组织归属目录', ok: config.organizationCatalog.items.length > 0, detail: `${config.organizationCatalog.items.length} 个` },
      { name: '已选择组织', ok: Boolean(config.selectedOrganization), detail: config.organizationCatalog.items.find(item => item.id === config.selectedOrganization)?.name || '未选择' },
      { name: 'TXT 上传接口', ok: true, detail: target.TARGET_UPLOAD_PATH },
      { name: 'MP4 上传接口', ok: false, detail: '当前仓库已验证的 121 协议未发现 MP4 上传字段；不会伪造。' }
    ];
    return res.json({ ok: checks.filter(check => check.name !== 'MP4 上传接口').every(check => check.ok), checks });
  });

  router.post('/121/batches/:batchId/preview', async (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    const config = store121.getConfig(req.username);
    const ids = Array.isArray(req.body?.itemIds) && req.body.itemIds.length ? new Set(req.body.itemIds.map(String)) : null;
    const plans = [];
    const errors = [];
    for (const item of batch.items) {
      if (ids && !ids.has(String(item.id))) continue;
      try {
        const media = await productionStatus(req, item, shuihuoGateway);
        plans.push(planItem(config, batch, item, media));
      } catch (error) { errors.push({ itemId: item.id, bookId: item.bookId, title: item.title, error: error.message }); }
    }
    return res.json({ batchId: batch.id, ready: plans.length, failed: errors.length, plans, errors });
  });

  router.post('/121/batches/:batchId/items/:itemId/submit', async (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或小说不存在' });
    try {
      const result = await submitItem(req, batch, item, store121.getConfig(req.username), store121, shuihuoGateway, httpClient);
      store.updateItem(req.username, batch.id, item.id, targetItem => {
        targetItem.publishState = {
          status: result.receipt.verified ? 'txt_submitted' : 'accepted_pending',
          submittedAt: new Date().toISOString(),
          txtFileName: result.plan.txtFileName,
          mergedMediaId: result.plan.mergedMediaId,
          remoteRecord: result.remoteRecord,
          note: result.plan.remoteCapability.note
        };
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      store.updateItem(req.username, batch.id, item.id, targetItem => {
        targetItem.publishState = { status: 'failed', submittedAt: new Date().toISOString(), error: error.message || '121 提交失败' };
      });
      return res.status(400).json({ error: error.message || '121 提交失败' });
    }
  });

  router.post('/121/batches/:batchId/submit', async (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    const config = store121.getConfig(req.username);
    const ids = Array.isArray(req.body?.itemIds) && req.body.itemIds.length ? new Set(req.body.itemIds.map(String)) : null;
    const results = [];
    for (const item of batch.items) {
      if (ids && !ids.has(String(item.id))) continue;
      try {
        const result = await submitItem(req, batch, item, config, store121, shuihuoGateway, httpClient);
        store.updateItem(req.username, batch.id, item.id, targetItem => {
          targetItem.publishState = { status: result.receipt.verified ? 'txt_submitted' : 'accepted_pending', submittedAt: new Date().toISOString(), txtFileName: result.plan.txtFileName, mergedMediaId: result.plan.mergedMediaId, remoteRecord: result.remoteRecord, note: result.plan.remoteCapability.note };
        });
        results.push({ ok: true, itemId: item.id, bookId: item.bookId, title: item.title, result });
      } catch (error) {
        store.updateItem(req.username, batch.id, item.id, targetItem => { targetItem.publishState = { status: 'failed', submittedAt: new Date().toISOString(), error: error.message || '121 提交失败' }; });
        results.push({ ok: false, itemId: item.id, bookId: item.bookId, title: item.title, error: error.message || '121 提交失败' });
      }
    }
    const succeeded = results.filter(result => result.ok).length;
    return res.status(succeeded === results.length ? 200 : 207).json({ batchId: batch.id, total: results.length, succeeded, failed: results.length - succeeded, results });
  });

  router._private = {
    parseTargetStyleCatalog,
    parseOrganizationCatalog,
    normalizeProfiles,
    metadataForItem,
    selectProfile,
    publicationAdvanced,
    organizationSelection,
    summarizeReceipt,
    planItem
  };

  return router;
}

module.exports = {
  createBatchFactoryPublishRouter,
  parseTargetStyleCatalog,
  parseOrganizationCatalog,
  normalizeProfiles,
  metadataForItem,
  selectProfile,
  publicationAdvanced,
  organizationSelection,
  summarizeReceipt,
  planItem
};
