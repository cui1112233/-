const express = require('express');
const crypto = require('crypto');
const { getVideoApiKey, readConfig } = require('../lib/shared');
const { proxyV11Request, createSignedBridgeHeaders } = require('../lib/batch-factory-v11/go-proxy');
const { BATCH_FACTORY_PRESET_REQUIREMENTS, isPublishedPresetAllowed, resolveSystemPresetBody } = require('../lib/system-preset-catalog');
const { listVisibleModels, resolveRuntimeModel } = require('../lib/model-catalog-runtime');
const { buildSmartUnifiedStyleMessages } = require('../lib/script-smart-unified-route');
const { parseSmartUnifiedVisualStyle, SMART_UNIFIED_PREFIX_PRESET_ID } = require('../lib/script-generation-rules');
const { createBatchFactory121Publisher } = require('../lib/batch-factory-v11/121-publisher');
const { create121DirectClient } = require('../lib/novel-fetch-workshop/121-direct-client');
const targetUpload = require('../lib/target-upload');
const { createBatchFactoryAutomationController } = require('../lib/batch-factory-v11/automation-orchestrator');
const { createAutomationPresetStore } = require('../lib/batch-factory-v11/automation-presets');

const PERSONAL_PROVIDER = 'personal_api';
const LOCAL_PROVIDER = 'doubao_local_executor';
const H3_PROVIDER = 'autodl_comfyui';
const YFAI_PROVIDER = 'yfai_seedance';
const PERSONAL_MODEL = 'yd2.0-mini';
const H3_MODEL = 'minimax-h3-video';
const H3_CREATE_URL = 'https://autodl.art/api/v1/comfyui/comfyui_workflow/{workflow}';
const H3_TASKS_URL = 'https://autodl.art/api/v1/comfyui/comfyui_workflow/result/{id}';
const CONFIG_PATH = '/api/batch-factory/v11/video-provider/config';
const STATUS_PATH = '/api/batch-factory/v11/video-provider/status';
const AI_PROMPT_MODULES = ['assets', 'constraints', 'hook', 'originalDirector', 'viralDirector', 'video', 'visual'];
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

function resolveV11GoBaseUrl(env = process.env) {
  return String(env.QIANTIE_BATCH_FACTORY_V11_BASE_URL || env.QIANTIE_GO_BASE_URL || 'http://backend:4000').replace(/\/$/, '');
}

function requestError(message, status = 400, code = 'BATCH_FACTORY_IMAGE_GENERATION_FAILED') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function upstreamErrorMessage(error, status) {
  if (['BATCH_FACTORY_V11_UPSTREAM_FAILED', 'SMART_UNIFIED_PROVIDER_FAILED', 'SMART_UNIFIED_PROVIDER_INVALID_RESPONSE'].includes(error?.code) && String(error?.message || '').trim()) {
    return String(error.message).trim();
  }
  return status >= 400 && status < 500 ? error.message : 'Batch Factory V11 Go service unavailable';
}

function batchAssetImageGenerationPath(pathname) {
  const match = String(pathname || '').match(/^\/api\/batch-factory\/v11\/batches\/([^/]+)\/books\/([^/]+)\/assets\/images\/generate$/);
  if (!match) return null;
  try {
    return { batchId: decodeURIComponent(match[1]), bookId: decodeURIComponent(match[2]) };
  } catch (_) {
    return null;
  }
}

function imageGenerationEndpoint(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw requestError('图片模型没有配置服务地址', 422, 'IMAGE_MODEL_CONFIGURATION_REQUIRED');
  if (/\/images\/generations$/i.test(base)) return base;
  try {
    const parsed = new URL(base);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (!pathname) return `${base}/v1/images/generations`;
    if (pathname.endsWith('/v1')) return `${base}/images/generations`;
    return `${base}/images/generations`;
  } catch (_) {
    throw requestError('图片模型服务地址无效', 422, 'IMAGE_MODEL_CONFIGURATION_REQUIRED');
  }
}

function textCompletionEndpoint(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw requestError('文本模型没有配置服务地址', 422, 'TEXT_MODEL_CONFIGURATION_REQUIRED');
  if (/\/chat\/completions$/i.test(base)) return base;
  try {
    const parsed = new URL(base);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (!pathname) return `${base}/v1/chat/completions`;
    if (pathname.endsWith('/v1')) return `${base}/chat/completions`;
    return `${base}/chat/completions`;
  } catch (_) {
    throw requestError('文本模型服务地址无效', 422, 'TEXT_MODEL_CONFIGURATION_REQUIRED');
  }
}

function directorTextModelPath(req, pathname) {
  if (req.method !== 'POST') return false;
  return /\/batches\/[^/]+(?:\/books\/[^/]+\/(?:director|h3\/director|working-front\/viral|hook)|\/director)$/.test(pathname)
    || /\/batches\/[^/]+\/books\/[^/]+\/stages\/(?:assets|director|retry)$/.test(pathname);
}

function requestTextProvider(req, options, explicitModelId = '') {
  const modelId = String(explicitModelId || req.body?.textModelId || '').trim();
  if (!modelId) throw requestError('请先在单书配置或引擎配置中选择已启用的文本模型', 422, 'TEXT_MODEL_REQUIRED');
  const model = resolveRuntimeModel({
    username: req.username,
    kind: 'text',
    modelId,
    memberStore: options.memberStore,
    configReader: options.configReader || readConfig
  });
  if (!model?.baseUrl || !model?.modelId || !model?.credential) {
    throw requestError('请选择个人中心已启用的文本模型', 422, 'TEXT_MODEL_REQUIRED');
  }
  return {
    endpoint: textCompletionEndpoint(model.baseUrl),
    apiKey: model.credential,
    model: model.modelId,
    displayName: model.displayName || model.modelId || model.id
  };
}

function directorBookPath(pathname) {
  const match = String(pathname || '').match(/^\/api\/batch-factory\/v11\/batches\/([^/]+)\/books\/([^/]+)\/(?:director|stages\/director)$/);
  return match ? { batchId: decodeURIComponent(match[1]), bookId: decodeURIComponent(match[2]) } : null;
}

function styleSystemBookPath(pathname) {
  const match = String(pathname || '').match(/^\/api\/batch-factory\/v11\/batches\/([^/]+)\/books\/([^/]+)\/(?:assets|stages\/assets)$/);
  return match ? { batchId: decodeURIComponent(match[1]), bookId: decodeURIComponent(match[2]) } : null;
}

function batchFactorySmartUnifiedRefreshPath(pathname) {
  const match = String(pathname || '').match(/^\/api\/batch-factory\/v11\/batches\/([^/]+)\/books\/([^/]+)\/smart-unified\/refresh$/);
  if (!match) return null;
  try { return { batchId: decodeURIComponent(match[1]), bookId: decodeURIComponent(match[2]) }; } catch (_) { return null; }
}

function batchFactoryBookClassificationPath(pathname) {
  const match = String(pathname || '').match(/^\/api\/batch-factory\/v11\/batches\/([^/]+)\/books\/([^/]+)\/classify-publish-metadata$/);
  if (!match) return null;
  try { return { batchId: decodeURIComponent(match[1]), bookId: decodeURIComponent(match[2]) }; }
  catch (_) { return null; }
}

function batchFactory121PublishPath(pathname) {
  const match = String(pathname || '').match(/^\/api\/batch-factory\/v11\/batches\/([^/]+)\/books\/([^/]+)\/publish-121$/);
  if (!match) return null;
  try { return { batchId: decodeURIComponent(match[1]), bookId: decodeURIComponent(match[2]) }; }
  catch (_) { return null; }
}

function batchFactory121OrganizationsPath(pathname) {
  const path = String(pathname || '');
  // Express may expose a path relative to the mounted V11 router after an
  // earlier middleware has normalized the original request.  Accept both
  // forms so this Node-owned endpoint is never forwarded to Go as a 404.
  return path === '/api/batch-factory/v11/publish-121/organizations'
    || path === '/publish-121/organizations';
}

function organizationOptions(payload) {
  const source = payload?.data || payload?.organizations || payload?.items || payload;
  const values = Array.isArray(source) ? source : Array.isArray(source?.list) ? source.list : [];
  return values.map(item => ({
    id: String(item?.id ?? item?.organization_id ?? item?.value ?? '').trim(),
    name: String(item?.name ?? item?.organization_name ?? item?.label ?? '').trim(),
    level: String(item?.level ?? item?.level_name ?? '').trim()
  })).filter(item => item.id && item.name);
}

async function listBatchFactory121Organizations(req, options = {}) {
  const sessionStore = options.novelFetchStore || req.app?.locals?.novelFetchStore;
  if (!sessionStore?.getSession) throw requestError('121 登录会话存储未启用', 503, 'PUBLISH_121_SESSION_UNAVAILABLE');
  const webSubmit = options.webSubmit || req.app?.locals?.novelFetchV2WebSubmit;
  if (typeof webSubmit?.workerAction === 'function') {
    const response = await webSubmit.workerAction(req.username, 'organization_list');
    let payload = {};
    try { payload = JSON.parse(String(response?.body || '{}')); }
    catch (_) { throw requestError('121 组织目录返回了非 JSON 数据', 502, 'PUBLISH_121_ORGANIZATION_UNAVAILABLE'); }
    if (payload?.success === false) throw requestError(String(payload?.message || payload?.msg || '121 组织目录读取失败'), 502, 'PUBLISH_121_ORGANIZATION_UNAVAILABLE');
    return { organizations: organizationOptions(payload) };
  }
  const client = options.directClient || create121DirectClient();
  const session = await resolveBatchFactory121Session(req.username, {
    sessionStore,
    webSubmit
  });
  await client.verify({ cookie: session?.cookie });
  const response = await client.action({ cookie: session?.cookie, method: 'GET', path: '/tttadmin/api/organization.php' });
  let payload = {};
  try { payload = JSON.parse(String(response?.body || '{}')); }
  catch (_) { throw requestError('121 组织目录返回了非 JSON 数据', 502, 'PUBLISH_121_ORGANIZATION_UNAVAILABLE'); }
  if (payload?.success === false) throw requestError(String(payload?.message || payload?.msg || '121 组织目录读取失败'), 502, 'PUBLISH_121_ORGANIZATION_UNAVAILABLE');
  return { organizations: organizationOptions(payload) };
}

async function resolveBatchFactory121Session(owner, { sessionStore, webSubmit } = {}) {
  if (webSubmit?.ensureSession) {
    const ready = await webSubmit.ensureSession(owner);
    const cookie = String(ready?.request?.sessionKey || ready?.result?.sessionKey || '').trim();
    if (cookie) return { ...(sessionStore?.getSession?.(owner) || {}), cookie };
  }
  const browser = sessionStore?.getBrowserSession?.(owner);
  const cookie = String(browser?.sessionKey || sessionStore?.getSession?.(owner)?.cookie || '').trim();
  return cookie ? { ...(browser || {}), cookie } : null;
}

async function fetchBatchFactory121Media({ username, isOwner = false, mediaURL, goBaseUrl, bridgeSecret, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const pathname = String(mediaURL || '').trim();
  if (!pathname.startsWith('/api/batch-factory/v11/')) {
    throw requestError('当前书上传视频不是受管的 V11 媒体，不能提交 121', 409, 'UNTRUSTED_UPLOAD_MEDIA');
  }
  const base = String(goBaseUrl || resolveV11GoBaseUrl()).replace(/\/$/, '');
  const response = await fetchImpl(`${base}${pathname}`, {
    method: 'GET',
    headers: createSignedBridgeHeaders({ username, isOwner, method: 'GET', pathname, secret: bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET || '', now: now() }),
    redirect: 'manual'
  });
  if (!response?.ok) throw requestError(`读取当前书上传视频失败：HTTP ${response?.status || 0}`, 502, 'V11_UPLOAD_MEDIA_UNAVAILABLE');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw requestError('读取到的当前书上传视频为空', 502, 'V11_UPLOAD_MEDIA_UNAVAILABLE');
  return bytes;
}

function persisted121PublicationMetadata(sourceMetadata, result) {
  const remote = result?.receipt?.remote_record && typeof result.receipt.remote_record === 'object' && !Array.isArray(result.receipt.remote_record)
    ? result.receipt.remote_record
    : {};
  const source = sourceMetadata && typeof sourceMetadata === 'object' && !Array.isArray(sourceMetadata) ? sourceMetadata : {};
  const confirmed = result?.receipt?.verified === true && remote?.found === true && Array.isArray(remote?.mismatches) && remote.mismatches.length === 0;
  const submittedAt = String(result?.uploadedAt || new Date().toISOString()).trim();
  const detail = String(remote?.detail || '121 上传接口已接收文件，等待后台列表回读').trim();
  const history = Array.isArray(source.websiteSubmitHistory) ? source.websiteSubmitHistory : [];
  const receiptStatus = confirmed ? 'confirmed' : 'accepted_pending';
  const metadata = {
    ...source,
    publishStatus: confirmed ? 'uploaded' : 'submitted',
    websiteSubmitStatus: confirmed ? 'uploaded' : 'submitted',
    websiteSubmitProgress: {
      phase: 'readback',
      status: confirmed ? 'succeeded' : 'waiting',
      message: detail,
      updatedAt: submittedAt
    },
    websiteSubmitReceipt: {
      status: receiptStatus,
      remoteId: String(remote?.remote_id || '').trim(),
      remoteTime: String(remote?.remote_time || '').trim(),
      detail
    },
    websiteSubmitHistory: [...history, {
      submittedAt,
      status: receiptStatus,
      sourceTextFile: String(result?.sourceTextFile || '').trim(),
      aiHeadVideoFile: String(result?.aiHeadVideoFile || '').trim(),
      remoteId: String(remote?.remote_id || '').trim(),
      detail
    }].slice(-20)
  };
  delete metadata.publishError;
  return metadata;
}

function ensureBatchFactory121ResubmissionAllowed(book, submission = {}) {
  const metadata = object(book?.sourceMetadata);
  if (String(metadata.websiteSubmitStatus || '').trim() === 'uploaded' && submission?.reupload !== true) {
    throw requestError('当前书已上传，请使用重新上传', 409, 'BATCH_BOOK_ALREADY_UPLOADED');
  }
}

function publicationProgressMetadata(sourceMetadata, progress = {}) {
  const source = object(sourceMetadata);
  const status = String(progress.status || 'running').trim();
  const failed = status === 'failed';
  const metadata = {
    ...source,
    publishStatus: failed ? 'failed' : 'uploading',
    websiteSubmitStatus: failed ? 'failed' : 'uploading',
    websiteSubmitProgress: {
      phase: String(progress.phase || 'validation').trim(),
      status,
      message: String(progress.message || '').trim(),
      updatedAt: String(progress.updatedAt || new Date().toISOString()).trim()
    }
  };
  if (failed) metadata.publishError = String(progress.message || '121 上传失败').trim();
  else delete metadata.publishError;
  return metadata;
}

async function persistBatchFactory121Progress(req, route, progress, goOptions) {
  const pathname = `/api/batch-factory/v11/batches/${encodeURIComponent(route.batchId)}`;
  const request = ({ method, pathname: requestPath, payload }) => v11JSONRequest({
    username: req.username,
    isOwner: req.auth?.account?.isOwner === true,
    method,
    pathname: requestPath,
    payload,
    ...goOptions
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const loaded = await request({ method: 'GET', pathname });
    const book = (loaded?.batch?.books || []).find(item => String(item?.id) === String(route.bookId));
    if (!book) throw requestError('当前小说不存在，无法更新 121 上传状态', 404, 'BATCH_BOOK_NOT_FOUND');
    try {
      const saved = await request({
        method: 'PUT',
        pathname: `${pathname}/books/${encodeURIComponent(book.id)}/metadata`,
        payload: {
          metadata: publicationProgressMetadata(book.sourceMetadata, progress),
          expectedRevision: Number(book.revision || 0)
        }
      });
      return saved?.book || { ...book, sourceMetadata: publicationProgressMetadata(book.sourceMetadata, progress) };
    } catch (error) {
      if (Number(error?.status) !== 409 || attempt === 1) throw error;
    }
  }
  throw requestError('121 上传状态保存冲突，请刷新后重试', 409, 'BATCH_BOOK_METADATA_CONFLICT');
}

async function persistBatchFactory121Publication(req, route, result, goOptions) {
  const pathname = `/api/batch-factory/v11/batches/${encodeURIComponent(route.batchId)}`;
  const request = ({ method, pathname: requestPath, payload }) => v11JSONRequest({
    username: req.username,
    isOwner: req.auth?.account?.isOwner === true,
    method,
    pathname: requestPath,
    payload,
    ...goOptions
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const loaded = await request({ method: 'GET', pathname });
    const book = (loaded?.batch?.books || []).find(item => String(item?.id) === String(route.bookId));
    if (!book) throw requestError('121 提交后未找到当前小说，无法保存回执', 404, 'BATCH_BOOK_NOT_FOUND');
    try {
      const saved = await request({
        method: 'PUT',
        pathname: `${pathname}/books/${encodeURIComponent(book.id)}/metadata`,
        payload: {
          metadata: persisted121PublicationMetadata(book.sourceMetadata, result),
          expectedRevision: Number(book.revision || 0)
        }
      });
      return saved?.book || { ...book, sourceMetadata: persisted121PublicationMetadata(book.sourceMetadata, result) };
    } catch (error) {
      if (Number(error?.status) !== 409 || attempt === 1) throw error;
    }
  }
  throw requestError('121 回执保存失败', 409, 'BATCH_BOOK_METADATA_CONFLICT');
}

function batchBookTextModelId(batch, book, requestBody = {}) {
  return String(
    requestBody?.textModelId
    || book?.settingsState?.patch?.textModelId
    || batch?.settingsState?.patch?.textModelId
    || ''
  ).trim();
}

// A manually imported batch has no engine settings yet.  Classification is
// part of that import flow, so use the account's first usable text model when
// neither the request nor the new batch selected one explicitly.
function resolveBatchFactoryBookClassificationTextProvider(req, batch, book, options = {}) {
  const selectedModelID = batchBookTextModelId(batch, book, req.body);
  if (selectedModelID) return requestTextProvider(req, options, selectedModelID);
  const candidates = listVisibleModels({
    username: req.username,
    kind: 'text',
    memberStore: options.memberStore,
    accountStore: options.accountStore,
    account: { isOwner: req.auth?.account?.isOwner === true },
    configReader: options.configReader || readConfig
  });
  let lastError;
  for (const candidate of candidates) {
    try { return requestTextProvider(req, options, String(candidate?.id || '').trim()); }
    catch (error) { lastError = error; }
  }
  if (lastError) throw lastError;
  return requestTextProvider(req, options, '');
}

function normalizedBookGender(value) {
  const input = String(value || '').trim();
  if (input === '男' || input === '男频') return '男频';
  if (input === '女' || input === '女频') return '女频';
  return '';
}

function normalizedBookStyle(value) {
  const style = String(value || '').trim();
  return targetUpload.VALID_STYLE_NAMES.includes(style) ? style : '';
}

function parseBatchBookClassification(content) {
  const raw = String(content || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw requestError('AI 判断没有返回 JSON 结果', 502, 'BOOK_CLASSIFICATION_INVALID_RESPONSE');
  let parsed = {};
  try { parsed = JSON.parse(raw.slice(start, end + 1)); }
  catch (_) { throw requestError('AI 判断返回的 JSON 无法解析', 502, 'BOOK_CLASSIFICATION_INVALID_RESPONSE'); }
  const gender = normalizedBookGender(parsed.gender || parsed.genderFrequency || parsed.gender_frequency);
  const style = normalizedBookStyle(parsed.style || parsed.styleType || parsed.style_type);
  if (!gender || !style) {
    throw requestError(`AI 判断结果无效：必须返回男女频和下列风格之一（${targetUpload.VALID_STYLE_NAMES.join('、')}）`, 502, 'BOOK_CLASSIFICATION_INVALID_RESPONSE');
  }
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.map(item => String(item || '').trim()).filter(Boolean).slice(0, 5).join('、')
    : String(parsed.tags || '').trim();
  return { gender, style, tags, reason: String(parsed.reason || parsed.basis || '').trim() };
}

function batchBookClassificationMessages(book) {
  const source = String(book?.sourceText || '').trim().slice(0, 12000);
  return [
    {
      role: 'system',
      content: `你是网文发布分类助手。仅基于小说内容判断，不得编造。只返回 JSON：{"gender":"男频或女频","style":"风格名","tags":["标签1","标签2"],"reason":"不超过40字的依据"}。style 必须严格选择其一：${targetUpload.VALID_STYLE_NAMES.join('、')}。`
    },
    {
      role: 'user',
      content: `书名：${String(book?.title || '').trim()}\n原始书城：${String(book?.platform || book?.sourceMetadata?.platformName || '').trim()}\n小说正文：\n${source}`
    }
  ];
}

function classificationFailureMetadata(metadata, error, now = Date.now) {
  return {
    ...object(metadata),
    classifyStatus: 'failed',
    classifyError: String(error?.message || '男女频和风格识别失败'),
    classifyAt: new Date(now()).toISOString()
  };
}

async function persistBatchFactoryBookClassificationFailure({ username, isOwner = false, batchId, bookId, error, goBaseUrl, bridgeSecret, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const basePath = `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}`;
  const loaded = await v11JSONRequest({ username, isOwner, method: 'GET', pathname: basePath, goBaseUrl, bridgeSecret, fetchImpl, now });
  const batch = loaded?.batch;
  const book = (batch?.books || []).find(item => String(item?.id) === String(bookId));
  if (!batch || !book) throw requestError('批量作品或单本书不存在', 404, 'BATCH_BOOK_NOT_FOUND');
  const metadata = classificationFailureMetadata(book.sourceMetadata, error, now);
  const saved = await v11JSONRequest({
    username, isOwner, method: 'PUT',
    pathname: `${basePath}/books/${encodeURIComponent(book.id)}/metadata`,
    payload: { metadata, expectedRevision: Number(book.revision || 0) },
    goBaseUrl, bridgeSecret, fetchImpl, now
  });
  return saved?.book || { ...book, sourceMetadata: metadata };
}

async function classifyBatchFactoryBookFor121({ username, isOwner = false, batchId, bookId, textProvider, force = false, goBaseUrl, bridgeSecret, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (!textProvider?.endpoint || !textProvider?.apiKey || !textProvider?.model) throw requestError('请先在当前书或引擎配置中选择已启用的文本模型，才能识别男女频和风格', 422, 'TEXT_MODEL_REQUIRED');
  const basePath = `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}`;
  const loaded = await v11JSONRequest({ username, isOwner, method: 'GET', pathname: basePath, goBaseUrl, bridgeSecret, fetchImpl, now });
  const batch = loaded?.batch;
  const book = (batch?.books || []).find(item => String(item?.id) === String(bookId));
  if (!batch || !book) throw requestError('批量作品或单本书不存在', 404, 'BATCH_BOOK_NOT_FOUND');
  const metadata = object(book.sourceMetadata);
  const existingGender = normalizedBookGender(metadata.gender);
  const existingStyle = normalizedBookStyle(metadata.style);
  if (!force && existingGender && existingStyle) {
    return { book, classification: { gender: existingGender, style: existingStyle, tags: String(metadata.tags || '').trim(), reason: String(metadata.classifyReason || '').trim() }, reused: true };
  }
  if (!String(book.sourceText || '').trim()) throw requestError('当前小说没有正文，无法识别男女频和风格', 422, 'SOURCE_TEXT_REQUIRED');
  const response = await fetchImpl(textProvider.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${textProvider.apiKey}` },
    body: JSON.stringify({ model: textProvider.model, messages: batchBookClassificationMessages(book), max_tokens: 700, temperature: 0.1, stream: false }),
    redirect: 'manual'
  });
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch (_) { /* parser below explains invalid output */ }
  const modelName = String(textProvider.displayName || textProvider.model || '当前文本模型').trim();
  if (!response.ok) throw requestError(`小说分类模型“${modelName}”请求失败：${payload?.error?.message || payload?.message || `HTTP ${response.status}`}`, 502, 'BOOK_CLASSIFICATION_PROVIDER_FAILED');
  const classification = parseBatchBookClassification(payload?.choices?.[0]?.message?.content);
  const nextMetadata = {
    ...metadata,
    gender: classification.gender,
    style: classification.style,
    tags: classification.tags || String(metadata.tags || '').trim(),
    classifyStatus: 'classified',
    classifyReason: classification.reason,
    classifyModel: modelName,
    classifyAt: new Date(now()).toISOString()
  };
  let saved;
  try {
    saved = await v11JSONRequest({
      username, isOwner, method: 'PUT', pathname: `${basePath}/books/${encodeURIComponent(book.id)}/metadata`,
      payload: { metadata: nextMetadata, expectedRevision: Number(book.revision || 0) }, goBaseUrl, bridgeSecret, fetchImpl, now
    });
  } catch (error) {
    if (Number(error?.status) === 409) throw requestError('小说分类结果保存冲突，请刷新后重新提交', 409, 'BATCH_BOOK_METADATA_CONFLICT');
    throw error;
  }
  return { book: saved?.book || { ...book, sourceMetadata: nextMetadata }, classification, reused: false };
}

async function prepareBatchFactoryBookClassification(req, route, options = {}) {
  const goOptions = { goBaseUrl: options.goBaseUrl || resolveV11GoBaseUrl(), bridgeSecret: options.bridgeSecret, fetchImpl: options.fetchImpl, now: options.now };
  const batchPath = `/api/batch-factory/v11/batches/${encodeURIComponent(route.batchId)}`;
  const loaded = await v11JSONRequest({ username: req.username, isOwner: req.auth?.account?.isOwner === true, method: 'GET', pathname: batchPath, ...goOptions });
  const batch = loaded?.batch;
  const book = (batch?.books || []).find(item => String(item?.id) === String(route.bookId));
  if (!batch || !book) throw requestError('批量作品或单本书不存在', 404, 'BATCH_BOOK_NOT_FOUND');
  const metadata = object(book.sourceMetadata);
  if (options.blockUploaded === true) ensureBatchFactory121ResubmissionAllowed(book, req.body);
  const gender = normalizedBookGender(metadata.gender);
  const style = normalizedBookStyle(metadata.style);
  const force = req.body?.force === true;
  if (!force && gender && style) {
    return { book, classification: { gender, style, tags: String(metadata.tags || '').trim(), reason: String(metadata.classifyReason || '').trim() }, reused: true };
  }
  try {
    const textProvider = resolveBatchFactoryBookClassificationTextProvider(req, batch, book, options);
    return await classifyBatchFactoryBookFor121({
      username: req.username, isOwner: req.auth?.account?.isOwner === true, batchId: route.batchId, bookId: route.bookId,
      textProvider, force, ...goOptions
    });
  } catch (error) {
    // The result must remain visible on the book even when no model is
    // configured or the provider rejects the call.  Failing to write this
    // diagnostic must not hide the original, actionable classification error.
    try {
      await persistBatchFactoryBookClassificationFailure({
        username: req.username,
        isOwner: req.auth?.account?.isOwner === true,
        batchId: route.batchId,
        bookId: route.bookId,
        error,
        ...goOptions
      });
    } catch (_) { /* preserve the original classification error */ }
    throw error;
  }
}

async function submitBatchFactoryBookTo121(req, route, options = {}) {
  const sessionStore = options.novelFetchStore || req.app?.locals?.novelFetchStore;
  if (!sessionStore?.getSession) throw requestError('121 登录会话存储未启用', 503, 'PUBLISH_121_SESSION_UNAVAILABLE');
  const goOptions = { goBaseUrl: options.goBaseUrl || resolveV11GoBaseUrl(), bridgeSecret: options.bridgeSecret, fetchImpl: options.fetchImpl, now: options.now };
  const batchPath = `/api/batch-factory/v11/batches/${encodeURIComponent(route.batchId)}`;
  const initial = await v11JSONRequest({ username: req.username, isOwner: req.auth?.account?.isOwner === true, method: 'GET', pathname: batchPath, ...goOptions });
  const initialBook = (initial?.batch?.books || []).find(item => String(item?.id) === String(route.bookId));
  if (!initialBook) throw requestError('批量作品或单本书不存在', 404, 'BATCH_BOOK_NOT_FOUND');
  ensureBatchFactory121ResubmissionAllowed(initialBook, req.body);
  const reportProgress = progress => persistBatchFactory121Progress(req, route, progress, goOptions);
  const webSubmit = options.webSubmit || req.app?.locals?.novelFetchV2WebSubmit;
  const publisher = createBatchFactory121Publisher({
    loadBatch: async (owner, batchId) => v11JSONRequest({ username: owner, isOwner: req.auth?.account?.isOwner === true, method: 'GET', pathname: `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}`, ...goOptions }),
    loadMergeStatus: async (owner, batchId) => v11JSONRequest({ username: owner, isOwner: req.auth?.account?.isOwner === true, method: 'GET', pathname: `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}/merge-status`, ...goOptions }),
    loadProductionStatus: async (owner, batchId) => v11JSONRequest({ username: owner, isOwner: req.auth?.account?.isOwner === true, method: 'GET', pathname: `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}/status`, ...goOptions }),
    fetchMedia: (owner, mediaURL) => fetchBatchFactory121Media({ username: owner, isOwner: req.auth?.account?.isOwner === true, mediaURL, ...goOptions }),
    getSession: owner => resolveBatchFactory121Session(owner, {
      sessionStore,
      webSubmit
    }),
    directClient: options.directClient || create121DirectClient(),
    workerAction: typeof webSubmit?.workerAction === 'function' ? (owner, action, payload) => webSubmit.workerAction(owner, action, payload) : undefined,
    onProgress: reportProgress,
    now: options.clock || (() => new Date())
  });
  try {
    await reportProgress({ phase: 'classification', status: 'running', message: '正在核对本书男女频与 121 风格' });
    await prepareBatchFactoryBookClassification(req, route, { ...options, blockUploaded: true });
    const result = await publisher.submit(req.username, route, {
      organization: req.body?.organization,
      category: req.body?.category,
      startTime: req.body?.startTime,
      reupload: req.body?.reupload === true
    });
    const book = await persistBatchFactory121Publication(req, route, result, goOptions);
    return {
      ...result,
      status: String(book?.sourceMetadata?.websiteSubmitStatus || '') === 'uploaded' ? 'confirmed' : 'accepted_pending',
      book
    };
  } catch (error) {
    try {
      await reportProgress({ phase: error?.publishPhase || 'classification', status: 'failed', message: error?.message || '121 上传失败' });
    } catch (_) { /* retain the original upstream failure */ }
    if (error?.code || Number.isInteger(error?.status)) throw error;
    throw requestError(error?.message || '121 提交失败', 422, 'PUBLISH_121_FAILED');
  }
}

function effectivePromptConfig(batch, book) {
  const batchConfig = plainObject(batch?.settingsState?.patch?.aiPromptConfig) ? batch.settingsState.patch.aiPromptConfig : {};
  const bookConfig = plainObject(book?.settingsState?.patch?.aiPromptConfig) ? book.settingsState.patch.aiPromptConfig : {};
  return { ...batchConfig, ...bookConfig, constraints: { ...(plainObject(batchConfig.constraints) ? batchConfig.constraints : {}), ...(plainObject(bookConfig.constraints) ? bookConfig.constraints : {}) } };
}

function smartUnifiedSelected(batch, book) {
  const constraints = effectivePromptConfig(batch, book)?.constraints || {};
  const selections = Array.isArray(constraints.selections) ? constraints.selections : [];
  if (selections.some(item => String(item?.presetId || '') === SMART_UNIFIED_PREFIX_PRESET_ID && String(item?.constraintCategory || '') === 'prefix')) return true;
  // Single-book settings created before the typed five-layer editor store the
  // prefix separately. Accept it until the trusted snapshot refresh below
  // migrates it into selections.
  return constraints?.prefix?.enabled === true && String(constraints?.prefix?.presetId || '') === SMART_UNIFIED_PREFIX_PRESET_ID;
}

function h3VideoSelected(batch, book) {
  const video = effectivePromptConfig(batch, book)?.video || {};
  return video?.enabled !== false && (String(video?.presetKey || '') === 'h3-video-normal' || String(video?.presetId || '') === 'batch-video-h3-director');
}

function directorVisualBaselineRequired(batch, book) {
  // This legacy/director guard intentionally stays independent of whether the
  // baseline is rendered in the editable prompt. The new production refresh
  // path below is opt-in and non-blocking; historical H3 analyses remain
  // readable and testable for existing books.
  return Boolean(String(book?.sourceText || '').trim());
}

function smartUnifiedStyleSystemPreset(batch, book, presetStore) {
  const config = effectivePromptConfig(batch, book);
  const selections = Array.isArray(config?.constraints?.selections) ? config.constraints.selections : [];
  const selected = selections.find(item => String(item?.presetId || '') === SMART_UNIFIED_PREFIX_PRESET_ID && String(item?.constraintCategory || '') === 'prefix') || {};
  const published = presetStore?.getPublished?.(SMART_UNIFIED_PREFIX_PRESET_ID) || null;
  const body = String(selected?.body || resolveSystemPresetBody(presetStore, SMART_UNIFIED_PREFIX_PRESET_ID) || '').trim();
  if (!body) throw requestError('智能统一系统预设词没有可用规则正文', 422, 'SMART_UNIFIED_PRESET_REQUIRED');
  return {
    id: SMART_UNIFIED_PREFIX_PRESET_ID,
    name: String(selected?.presetName || published?.name || '智能统一').trim(),
    version: Number(selected?.presetVersion || published?.version || 1),
    body
  };
}

function serializeSmartUnifiedStyleAnalysis(style, preset) {
  return JSON.stringify({
    schema_version: 'h3-style-system/v1',
    prompt: style.prompt,
    fields: style.fields,
    preset: { id: preset.id, name: preset.name, version: preset.version }
  });
}

function styleSystemSourceHash(sourceText) {
  return crypto.createHash('sha256').update(String(sourceText || '').trim(), 'utf8').digest('hex');
}

function savedSmartUnifiedStyleAnalysis(book, sourceText, preset) {
  const patch = object(book?.settingsState?.patch);
  const saved = String(patch.h3StyleAnalysis || '').trim();
  if (!saved || String(patch.h3StyleSourceHash || '') !== styleSystemSourceHash(sourceText)) return '';
  if (Number(patch.h3StylePresetVersion || 0) !== Number(preset?.version || 0)) return '';
  try {
    const parsed = JSON.parse(saved);
    if (parsed?.schema_version !== 'h3-style-system/v1' || !String(parsed?.prompt || '').trim()) return '';
    return saved;
  } catch (_) {
    return '';
  }
}

async function freezeSmartUnifiedStyleAnalysis({ username, isOwner, batchId, book, sourceText, preset, analysis, runtime, goBaseUrl, bridgeSecret, fetchImpl, now }) {
  const patch = {
    ...object(book?.settingsState?.patch),
    h3StyleAnalysis: analysis,
    h3StyleSourceHash: styleSystemSourceHash(sourceText),
    h3StylePresetVersion: Number(preset?.version || 0),
    ...(runtime ? { h3SmartUnifiedRuntime: runtime } : {})
  };
  await v11JSONRequest({
    username, isOwner, method: 'PUT',
    pathname: `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}/books/${encodeURIComponent(book.id)}/override`,
    payload: { patch, expectedRevision: Number(book?.revision || 0) },
    goBaseUrl, bridgeSecret, fetchImpl, now
  });
}

function h3StyleSystemFieldObject(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 4) return null;
  const required = ['final_genre', 'trailer_style', 'story_era'];
  if (required.every(key => typeof value[key] === 'string' && value[key].trim())) return value;
  for (const nested of Object.values(value)) {
    const result = h3StyleSystemFieldObject(nested, depth + 1);
    if (result) return result;
  }
  return null;
}

// Some OpenAI-compatible providers preserve the H3 payload in one or more
// result envelopes. The H3 system preset still owns the same seven fields;
// unwrap only a nested object that contains the required H3 field signature.
function unwrapH3StyleSystemFields(content) {
  const raw = String(content || '').trim();
  // Compatible providers sometimes prepend a short explanation before placing
  // the required H3 object in a fenced JSON block. The model payload is still
  // validated by parseSmartUnifiedVisualStyle; this only removes the wrapper.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? String(fenced[1] || '').trim() : raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch (_) {
    // A few OpenAI-compatible models ignore the “JSON only” suffix but still
    // return one complete H3 object between a leading and trailing sentence.
    // Recover only that single outer object; the signature check below remains
    // the authority for accepting it.
    const firstObject = candidate.indexOf('{');
    const lastObject = candidate.lastIndexOf('}');
    if (firstObject < 0 || lastObject <= firstObject) return content;
    try { parsed = JSON.parse(candidate.slice(firstObject, lastObject + 1)); } catch (_) { return content; }
  }
  const fields = h3StyleSystemFieldObject(parsed);
  if (!fields) return content;
  return JSON.stringify(fields);
}

function responseMessageText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.map(part => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    if (typeof part.text === 'string') return part.text;
    if (typeof part.content === 'string') return part.content;
    return '';
  }).join('\n').trim();
}

async function analyzeBatchFactorySmartUnifiedStyle({ username, isOwner = false, batchId, bookId, textProvider, presetStore, goBaseUrl, bridgeSecret, fetchImpl = globalThis.fetch, now = Date.now, persist = false, force = false, loadedBatch = null, runtime = null } = {}) {
  if (!fetchImpl || !textProvider?.endpoint || !textProvider?.apiKey || !textProvider?.model) throw requestError('智能统一需要当前书可用的文本模型', 422, 'TEXT_MODEL_REQUIRED');
  const basePath = `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}`;
  const loaded = loadedBatch || await v11JSONRequest({ username, isOwner, method: 'GET', pathname: basePath, goBaseUrl, bridgeSecret, fetchImpl, now });
  const batch = loaded?.batch;
  const book = (batch?.books || []).find(item => String(item?.id) === String(bookId));
  if (!batch || !book) throw requestError('批量作品或小说不存在', 404, 'BATCH_BOOK_NOT_FOUND');
  // This endpoint is also used by the direct director route, so keep the H3
  // / smart-unified eligibility guard here as well as in batch/retry runs.
  if (!directorVisualBaselineRequired(batch, book)) return '';
  const sourceText = batchFactoryProductionText(book);
  if (!sourceText) throw requestError('智能统一需要当前书完整原文', 422, 'SOURCE_TEXT_REQUIRED');
  const stylePreset = smartUnifiedStyleSystemPreset(batch, book, presetStore);
  const cached = force ? '' : savedSmartUnifiedStyleAnalysis(book, sourceText, stylePreset);
  if (cached) return cached;
  const assets = Array.isArray(book?.assetRecords) ? book.assetRecords : [];
  const messages = buildSmartUnifiedStyleMessages({
    novelText: sourceText,
    systemPrompt: stylePreset.body,
    characters: assets.filter(item => item?.kind === 'character').map(item => ({ name: item.name, prompt: item.prompt })),
    scenes: assets.filter(item => item?.kind === 'scene').map(item => ({ name: item.name, prompt: item.prompt }))
  });
  // Transport contract for OpenAI-compatible JSON mode. This deliberately
  // does not alter the editable style.system rules above.
  messages.push({ role: 'system', content: 'Output exactly one valid JSON object. Do not add prose or Markdown.' });
  const response = await fetchImpl(textProvider.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${textProvider.apiKey}` },
    body: JSON.stringify({
      model: textProvider.model,
      messages,
      max_tokens: 2600,
      temperature: 0.25,
      stream: false,
      response_format: { type: 'json_object' }
    }),
    redirect: 'manual'
  });
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch (_) { /* handled below */ }
  const modelName = String(textProvider.displayName || textProvider.model || '当前文本模型').trim();
  if (!response.ok) throw requestError(`智能统一视觉分析模型“${modelName}”请求失败：${payload?.error?.message || payload?.message || `HTTP ${response.status}`}`, 502, 'SMART_UNIFIED_PROVIDER_FAILED');
  const content = responseMessageText(payload?.choices?.[0]?.message?.content);
  if (!content) throw requestError('智能统一视觉分析模型没有返回内容', 502, 'SMART_UNIFIED_PROVIDER_INVALID_RESPONSE');
  try {
    const analysis = serializeSmartUnifiedStyleAnalysis(parseSmartUnifiedVisualStyle(unwrapH3StyleSystemFields(content)), stylePreset);
    if (persist) await freezeSmartUnifiedStyleAnalysis({ username, isOwner, batchId, book, sourceText, preset: stylePreset, analysis, runtime, goBaseUrl, bridgeSecret, fetchImpl, now });
    return analysis;
  } catch (error) { throw requestError(error?.message || '智能统一视觉分析结果无效', 422, 'SMART_UNIFIED_INVALID_RESPONSE'); }
}

// Smart-unified is a visual baseline enhancement. It must be refreshed before
// asset work and retries, but upstream instability must never stop production.
// The caller supplies the enabled candidates in user-visible priority order.
async function persistSmartUnifiedRuntime({ username, isOwner, batchId, book, runtime, goBaseUrl, bridgeSecret, fetchImpl, now }) {
  return v11JSONRequest({
    username, isOwner, method: 'PUT',
    pathname: `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}/books/${encodeURIComponent(book.id)}/override`,
    payload: { patch: { ...object(book?.settingsState?.patch), h3SmartUnifiedRuntime: runtime }, expectedRevision: Number(book?.revision || 0) },
    goBaseUrl, bridgeSecret, fetchImpl, now
  });
}

async function acquireBatchFactorySmartUnifiedBaseline({ username, isOwner = false, batchId, bookId, textProviders = [], presetStore, goBaseUrl, bridgeSecret, fetchImpl = globalThis.fetch, now = Date.now, force = true, persist = false } = {}) {
  const basePath = `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}`;
  const loaded = await v11JSONRequest({ username, isOwner, method: 'GET', pathname: basePath, goBaseUrl, bridgeSecret, fetchImpl, now });
  const batch = loaded?.batch;
  const book = (batch?.books || []).find(item => String(item?.id) === String(bookId));
  if (!batch || !book) throw requestError('批量作品或小说不存在', 404, 'BATCH_BOOK_NOT_FOUND');
  if (!smartUnifiedSelected(batch, book)) return { style: '', attempts: [], skipped: true, nonBlocking: true, reason: '智能统一未开启' };

  const attempts = [];
  for (const provider of textProviders) {
    if (!provider?.endpoint || !provider?.apiKey || !provider?.model) continue;
    try {
      const runtime = { status: 'succeeded', attempts: [...attempts, { id: String(provider.id || provider.model), name: String(provider.displayName || provider.model), status: 'succeeded' }], modelId: String(provider.id || provider.model), modelName: String(provider.displayName || provider.model), updatedAt: new Date(now()).toISOString() };
      const style = await analyzeBatchFactorySmartUnifiedStyle({
        username, isOwner, batchId, bookId, textProvider: provider, presetStore,
        goBaseUrl, bridgeSecret, fetchImpl, now, force, persist, loadedBatch: loaded, runtime
      });
      attempts.push({ id: String(provider.id || provider.model), name: String(provider.displayName || provider.model), status: 'succeeded' });
      return { style, provider, attempts, skipped: false, nonBlocking: true };
    } catch (error) {
      attempts.push({ id: String(provider.id || provider.model), name: String(provider.displayName || provider.model), status: 'failed', message: String(error?.message || '智能统一请求失败'), code: String(error?.code || '') });
    }
  }
  const reason = attempts.length ? '所有已启用文本模型均未完成智能统一分析' : '没有可用于智能统一的文本模型';
  if (persist) {
    try {
      await persistSmartUnifiedRuntime({ username, isOwner, batchId, book, runtime: { status: 'failed', attempts, updatedAt: new Date(now()).toISOString(), reason }, goBaseUrl, bridgeSecret, fetchImpl, now });
    } catch (_) {
      // A status write must not turn an optional visual baseline into a blocker.
    }
  }
  return { style: '', attempts, skipped: false, nonBlocking: true, reason };
}

function smartUnifiedTextProviders({ username, isOwner = false, textModelId, textProvider = null, memberStore, accountStore, configReader } = {}) {
  const preferred = textProvider?.endpoint && textProvider?.apiKey && textProvider?.model
    ? [{ id: String(textModelId || textProvider.model || '').trim(), ...textProvider }]
    : [];
  const ids = [String(textModelId || '').trim()];
  try {
    for (const model of listVisibleModels({ username, kind: 'text', memberStore, accountStore, account: { isOwner }, configReader })) ids.push(String(model?.id || '').trim());
  } catch (_) {
    // The selected model remains the primary candidate if the catalog cannot
    // be listed; stage execution will still report a normal model error.
  }
  const unique = [...new Set(ids.filter(Boolean))];
  const resolved = unique.map(id => {
    try { return { id, ...requestTextProvider({ username, body: { textModelId: id } }, { memberStore, accountStore, configReader }, id) }; } catch (_) { return null; }
  }).filter(Boolean);
  const seen = new Set();
  return [...preferred, ...resolved].filter(provider => {
    const key = String(provider?.id || provider?.model || '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function refreshSmartUnifiedNonBlocking({ username, isOwner = false, batchId, bookId, textModelId, textProvider = null, presetStore, goBaseUrl, bridgeSecret, fetchImpl, now, memberStore, accountStore, configReader, persist = true } = {}) {
  try {
    return await acquireBatchFactorySmartUnifiedBaseline({
      username, isOwner, batchId, bookId,
      textProviders: smartUnifiedTextProviders({ username, isOwner, textModelId, textProvider, memberStore, accountStore, configReader }),
      presetStore, goBaseUrl, bridgeSecret, fetchImpl, now, force: true, persist
    });
  } catch (error) {
    return { style: '', attempts: [{ id: String(textModelId || ''), name: '当前文本模型', status: 'failed', message: String(error?.message || '智能统一请求失败'), code: String(error?.code || '') }], skipped: false, nonBlocking: true, reason: '智能统一暂不可用，已跳过，不影响当前步骤' };
  }
}

function batchFactoryProductionText(book) {
  const source = String(book?.workingFrontContent || book?.sourceText || '');
  const configured = Number(book?.sourceMetadata?.contentRangeLines);
  const limit = Number.isInteger(configured) && configured > 0 ? Math.min(configured, 500) : 5;
  const lines = [];
  for (const line of source.split(/\r?\n/)) {
    const value = line.trim();
    if (!value) continue;
    lines.push(value);
    if (lines.length >= limit) break;
  }
  return lines.join('\n');
}

function imageSizeForAspectRatio(aspectRatio) {
  if (aspectRatio === '9:16') return '1024x1536';
  if (aspectRatio === '16:9') return '1536x1024';
  return '1024x1024';
}

function imageMediaType(bytes, fallback = 'image/png') {
  const value = Buffer.from(bytes || []);
  if (value.length >= 8 && value.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) return 'image/jpeg';
  if (value.length >= 12 && value.subarray(0, 4).toString('ascii') === 'RIFF' && value.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return fallback;
}

async function v11JSONRequest({ username, isOwner, method, pathname, payload, goBaseUrl, bridgeSecret, fetchImpl = globalThis.fetch, now = Date.now }) {
  if (typeof fetchImpl !== 'function') throw requestError('批量工厂服务请求不可用', 503, 'BATCH_FACTORY_V11_UPSTREAM_UNAVAILABLE');
  const base = String(goBaseUrl || resolveV11GoBaseUrl()).replace(/\/$/, '');
  const secret = bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET || '';
  const response = await fetchImpl(`${base}${pathname}`, {
    method,
    headers: {
      ...createSignedBridgeHeaders({ username, isOwner, method, pathname, secret, now: now() }),
      Accept: 'application/json',
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    redirect: 'manual'
  });
  const raw = await response.text();
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
  if (!response.ok) throw requestError(String(body?.error || `批量工厂服务返回 HTTP ${response.status}`), response.status >= 400 && response.status < 500 ? response.status : 502, 'BATCH_FACTORY_V11_UPSTREAM_FAILED');
  return body;
}

async function imageBytesFromProvider({ asset, model, aspectRatio, fetchImpl }) {
  const endpoint = imageGenerationEndpoint(model.baseUrl);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.credential}` },
    body: JSON.stringify({ model: model.modelId, prompt: String(asset.prompt || asset.name || '').trim(), n: 1, size: imageSizeForAspectRatio(aspectRatio), response_format: 'b64_json' })
  });
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch (_) { payload = {}; }
  if (!response.ok) throw requestError(`图片模型请求失败：${payload?.error?.message || payload?.message || payload?.error || `HTTP ${response.status}`}`, 502, 'IMAGE_PROVIDER_FAILED');
  const candidate = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (candidate?.b64_json) {
    const bytes = Buffer.from(String(candidate.b64_json), 'base64');
    if (bytes.length) return { bytes, mediaType: imageMediaType(bytes) };
  }
  if (candidate?.url) {
    const imageResponse = await fetchImpl(String(candidate.url), { redirect: 'manual' });
    if (!imageResponse.ok) throw requestError(`图片模型返回的图片下载失败：HTTP ${imageResponse.status}`, 502, 'IMAGE_PROVIDER_FAILED');
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    if (bytes.length) return { bytes, mediaType: imageMediaType(bytes, String(imageResponse.headers.get('content-type') || 'image/png').split(';')[0]) };
  }
  throw requestError('图片模型没有返回可保存的图片内容', 502, 'IMAGE_PROVIDER_INVALID_RESPONSE');
}

async function generateBatchFactoryAssetImages({ username, isOwner = false, batchId, bookId, assetIds, modelId, aspectRatio = '9:16', goBaseUrl, bridgeSecret, fetchImpl = globalThis.fetch, now = Date.now, resolveImageModel } = {}) {
  if (!fetchImpl) throw requestError('图片服务不可用', 503, 'IMAGE_PROVIDER_UNAVAILABLE');
  const uniqueAssetIds = [...new Set((Array.isArray(assetIds) ? assetIds : []).map(value => String(value || '').trim()).filter(Boolean))];
  if (!username || !batchId || !bookId || !uniqueAssetIds.length) throw requestError('请选择至少一个当前书资产', 400, 'ASSET_SELECTION_REQUIRED');
  const model = typeof resolveImageModel === 'function' ? resolveImageModel(modelId) : null;
  if (!model?.baseUrl || !model?.modelId || !model?.credential) throw requestError('请选择个人中心已启用的图片模型', 422, 'IMAGE_MODEL_REQUIRED');
  const basePath = `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}/books/${encodeURIComponent(bookId)}/assets`;
  const assetsResponse = await v11JSONRequest({ username, isOwner, method: 'GET', pathname: basePath, goBaseUrl, bridgeSecret, fetchImpl, now });
  const assets = Array.isArray(assetsResponse?.assets) ? assetsResponse.assets : [];
  const selected = uniqueAssetIds.map(id => assets.find(asset => String(asset?.id) === id)).filter(Boolean);
  if (selected.length !== uniqueAssetIds.length) throw requestError('所选资产不存在或不属于当前小说', 404, 'ASSET_NOT_FOUND');
  const images = [];
  for (const asset of selected) {
    const prompt = String(asset?.prompt || '').trim();
    if (!prompt) throw requestError(`资产“${asset?.name || asset?.id}”尚未填写提示词`, 422, 'ASSET_PROMPT_REQUIRED');
    const generated = await imageBytesFromProvider({ asset, model, aspectRatio, fetchImpl });
    const uploadPath = `${basePath}/${encodeURIComponent(asset.id)}/images/upload`;
    const uploaded = await v11JSONRequest({
      username,
      isOwner,
      method: 'POST',
      pathname: uploadPath,
      payload: { dataUrl: `data:${generated.mediaType};base64,${generated.bytes.toString('base64')}` },
      goBaseUrl,
      bridgeSecret,
      fetchImpl,
      now
    });
    if (uploaded?.image) images.push(uploaded.image);
  }
  return { images };
}

function normalizedProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (!provider || ['personal', 'personal_api', 'yd_video', 'yadi'].includes(provider)) return PERSONAL_PROVIDER;
  if (['doubao', 'doubao_local', 'doubao_local_executor'].includes(provider)) return LOCAL_PROVIDER;
  if (['h3', 'minimax_h3', 'minimax-h3-video', 'autodl', 'autodl_comfyui', 'autodl_comfyui_video'].includes(provider)) return H3_PROVIDER;
  if (['yfai', 'yfai_seedance', 'seedance-2-0-official'].includes(provider)) return YFAI_PROVIDER;
  return provider;
}

function providerFromRequest(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return normalizedProvider(req.body.provider);
  }
  const parsed = new URL(req.originalUrl || req.url, 'http://qiantie.local');
  return normalizedProvider(parsed.searchParams.get('provider'));
}

function isProviderConfigPath(pathname) {
  return pathname === CONFIG_PATH;
}

function needsPersonalConfigSync(req, pathname) {
  if (isProviderConfigPath(pathname)) return true;
  if (req.method === 'GET' && pathname === STATUS_PATH) return true;
  // Status is a read-only recovery path. Its task poller uses the durable
  // provider configuration saved when work was submitted; re-synchronizing a
  // personal secret here turns a transient bridge/config failure into an
  // inability to open the production page.
  if (req.method === 'POST' && /\/batches\/[^/]+(?:\/books\/[^/]+)?\/production$/.test(pathname)) return true;
  if (req.method === 'POST' && /\/batches\/[^/]+\/books\/[^/]+\/stages\/video$/.test(pathname)) return true;
  return false;
}

function needsH3ConfigSync(req, pathname) {
  if (pathname === CONFIG_PATH) return true;
  if (req.method === 'GET' && pathname === STATUS_PATH) return true;
  if (req.method === 'POST' && /\/batches\/[^/]+(?:\/books\/[^/]+)?\/production$/.test(pathname)) return true;
  if (req.method === 'POST' && /\/batches\/[^/]+\/books\/[^/]+\/stages\/video$/.test(pathname)) return true;
  return false;
}

function isPromptConfigPath(req, pathname) {
  if (req.method !== 'PUT') return false;
  return /^\/api\/batch-factory\/v11\/batches\/[^/]+(?:\/settings|\/books\/[^/]+\/override|\/books\/[^/]+\/videos\/[^/]+\/override)$/.test(pathname);
}

function promptConfigError(message) {
  const error = new Error(message);
  error.status = 422;
  error.code = 'BATCH_FACTORY_SYSTEM_PRESET_INVALID';
  return error;
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

const PROMPT_SELECTION_FIELDS = ['presetId', 'presetName', 'presetSlot', 'presetVersion', 'body', 'prompt'];
const ASSET_REQUIREMENTS = [
  ['extraction', 'assets.extraction', '人物场景道具提示词'],
  ['character', 'assets.character', '人物提示词'],
  ['scene', 'assets.scene', '场景提示词']
];
const DEFAULT_ASSET_EXTRACTION_PRESET_ID = 'script-extract-assets';
const LEGACY_ASSET_SELECTION_KEYS = ['prop'];
const PUBLIC_SCRIPT_STORYBOARD_PRESETS = Object.freeze([
  ['segmented', 'script-segmented', 'script.segmented', '分段开头'],
  ['shotlist', 'script-format-shotlist', 'script.format.shotlist', '分镜模式'],
  ['general', 'script-general', 'script.general', '通用规则'],
  ['characterFocus', 'script-character-focus', 'script.character-focus', '星标人物聚焦规则'],
  ['audioMatch', 'script-audio-match', 'script.audio-match', '匹配音频规则'],
  ['cardProtocol', 'script-card-protocol', 'script.card.protocol', '统一外层分镜卡片协议'],
  ['constraintWrapper', 'script-constraint-wrapper', 'script.constraint.wrapper', '约束设置规则']
]);

function removeSelectionFields(target) {
  for (const field of PROMPT_SELECTION_FIELDS) delete target[field];
}

function resolvePromptSelection(value, requirementKey, label, presetStore, resolveBody) {
  const raw = plainObject(value) ? value : {};
  const presetId = String(raw.presetId || '').trim();
  if (!presetId) return null;
  const preset = presetStore.getPublished(presetId);
  const requirement = BATCH_FACTORY_PRESET_REQUIREMENTS[requirementKey];
  if (!preset || !isPublishedPresetAllowed(preset, requirement)) {
    throw promptConfigError(`请选择个人中心已发布且匹配“${label}”的预设词`);
  }
  const body = String(resolveBody(presetStore, preset.id) || '').trim();
  if (!body) throw promptConfigError(`预设词“${preset.name || preset.id}”没有可用正文`);
  const constraintSlot = String(preset.protocolLock?.slot || '');
  const constraintCategory = requirementKey === 'constraints'
    ? String(preset.constraintCategory || preset.protocolLock?.constraintCategory || (constraintSlot.startsWith('script.constraint.') ? constraintSlot.slice('script.constraint.'.length) : '')).trim()
    : '';
  return {
    presetId: preset.id,
    presetName: preset.name,
    presetSlot: preset.protocolLock?.slot || null,
    presetVersion: preset.version,
    ...(preset.protocolLock?.key ? { presetKey: preset.protocolLock.key } : {}),
    ...(constraintCategory ? { constraintCategory } : {}),
    body
  };
}

function resolveAssetSelections(assets, presetStore, resolveBody) {
  const legacy = { presetId: assets.presetId };
  removeSelectionFields(assets);
  for (const [key, requirementKey, label] of ASSET_REQUIREMENTS) {
    let raw = assets[key];
    // Transitional support for the former one-select asset form: classify its
    // server-side preset into exactly one typed asset slot.
    if (!plainObject(raw) && legacy.presetId) {
      const legacyPreset = presetStore.getPublished(String(legacy.presetId));
      if (legacyPreset && isPublishedPresetAllowed(legacyPreset, BATCH_FACTORY_PRESET_REQUIREMENTS[requirementKey])) raw = legacy;
    }
    // A batch created before the AI-reasoning selector existed has no
    // extraction selection at all.  Use the same combined script preset that
    // a newly created batch receives, then freeze its published body here.
    // This remains a trusted Node-side decision; browser supplied prompt text
    // is still ignored.
    if (!plainObject(raw) && key === 'extraction') raw = { presetId: DEFAULT_ASSET_EXTRACTION_PRESET_ID };
    const selection = resolvePromptSelection(raw, requirementKey, label, presetStore, resolveBody);
    if (selection) assets[key] = selection;
    else delete assets[key];
  }
  // Character and scene rendering are first-class V12 output choices. Props
  // remain part of the combined extraction contract for now.
  for (const key of LEGACY_ASSET_SELECTION_KEYS) delete assets[key];
}

function resolveConstraintSelections(constraints, presetStore, resolveBody) {
  const legacy = { presetId: constraints.presetId };
  const typed = Array.isArray(constraints.selections)
    ? constraints.selections
    : (legacy.presetId ? [legacy] : []);
  // Legacy single-book configuration stored one object per layer, e.g.
  // constraints.prefix. Convert those entries before resolving the trusted
  // published preset body. Without this migration, smart unified appears
  // selected in the UI but is invisible to the execution contract.
  const legacyLayers = ['prefix', 'quality', 'restriction', 'negative']
    .map(constraintCategory => ({ ...constraints[constraintCategory], constraintCategory }))
    .filter(value => value?.enabled === true && String(value?.presetId || '').trim());
  const values = typed.length ? typed : legacyLayers;
  removeSelectionFields(constraints);
  constraints.selections = values
    .map(value => resolvePromptSelection(value, 'constraints', '生产约束预设词', presetStore, resolveBody))
    .filter(Boolean);
  for (const category of ['prefix', 'quality', 'restriction', 'negative']) delete constraints[category];
}

function resolveModuleSelection(module, requirementKey, label, presetStore, resolveBody) {
  if (!plainObject(module)) return;
  const selection = resolvePromptSelection(module, requirementKey, label, presetStore, resolveBody);
  removeSelectionFields(module);
  if (selection) Object.assign(module, selection);
}

function resolvePublicScriptStoryboardComposition(presetStore, resolveBody) {
  const composition = {};
  for (const [key, presetId, slot, label] of PUBLIC_SCRIPT_STORYBOARD_PRESETS) {
    const preset = presetStore.getPublished(presetId);
    if (!preset || preset.module !== 'script' || preset.kind !== 'base' || preset.protocolLock?.slot !== slot) {
      throw promptConfigError(`公网剧本生成的“${label}”预设词未发布或归属不正确`);
    }
    const body = String(resolveBody(presetStore, presetId) || '').trim();
    if (!body) throw promptConfigError(`公网剧本生成的“${label}”预设词没有可用正文`);
    composition[key] = {
      presetId,
      presetName: preset.name,
      presetSlot: slot,
      presetVersion: preset.version,
      body
    };
  }
  return composition;
}

const DERIVED_OPENING_PRESETS = Object.freeze([
  ['batch-hook-adaptation', 'hook', '爆款开头改编'],
  ['batch-original-director', 'director.original', '原文直转导演'],
  ['batch-viral-director', 'director.viral', '爆款开头导演']
]);

function resolveDerivedOpeningPrompt(presetId, presetStore, resolveBody = resolveSystemPresetBody) {
  const selected = String(presetId || '').trim();
  const definition = DERIVED_OPENING_PRESETS.find(([id]) => id === selected);
  if (!definition) throw promptConfigError('请选择“衍生开篇”中的已发布提示词');
  return resolvePromptSelection({ presetId: selected }, definition[1], definition[2], presetStore, resolveBody);
}

function isDerivedOpeningRequest(req, pathname) {
  return req.method === 'POST' && /^\/api\/batch-factory\/v11\/batches\/[^/]+\/books\/[^/]+\/working-front\/viral$/.test(pathname);
}

function enrichBatchFactorySystemPresetConfig(input, presetStore, resolveBody = resolveSystemPresetBody) {
  if (!plainObject(input) || !plainObject(input.patch)) return input;
  if (!presetStore || typeof presetStore.getPublished !== 'function') {
    throw promptConfigError('批量工厂系统预设词服务暂不可用');
  }
  const next = JSON.parse(JSON.stringify(input));
  const config = plainObject(next.patch.aiPromptConfig) ? next.patch.aiPromptConfig : {};
  next.patch.aiPromptConfig = config;
  config.scriptComposition = resolvePublicScriptStoryboardComposition(presetStore, resolveBody);
  if (plainObject(config.assets)) resolveAssetSelections(config.assets, presetStore, resolveBody);
  if (plainObject(config.constraints)) {
    delete config.constraints.wrapper;
    resolveConstraintSelections(config.constraints, presetStore, resolveBody);
  }
  if (plainObject(config.hook)) resolveModuleSelection(config.hook, 'hook', '爆款开头改编预设词', presetStore, resolveBody);
  if (plainObject(config.originalDirector)) resolveModuleSelection(config.originalDirector, 'director.original', '原文直转导演预设词', presetStore, resolveBody);
  if (plainObject(config.viralDirector)) resolveModuleSelection(config.viralDirector, 'director.viral', '爆款开头导演预设词', presetStore, resolveBody);
  // 视频提示词是导演分镜的必需输入；“分镜元提示词（自动组合）”只是
  // batch.video-meta 槽位中的默认选项，管理员可发布其它视频提示词供选择。
  if (plainObject(config.video)) resolveModuleSelection(config.video, 'video', '视频提示词预设词', presetStore, resolveBody);
  if (plainObject(config.visual)) resolveModuleSelection(config.visual, 'visual', '画面提示词预设词', presetStore, resolveBody);
  // Retired: historical video-style-prefix choices must not be copied into a
  // new settings revision or reach the V11 runtime.
  delete config.prefix;
  return next;
}

function promptConfigRefreshInput(patch, expectedRevision) {
  const config = plainObject(patch?.aiPromptConfig) ? patch.aiPromptConfig : {};
  return { patch: { aiPromptConfig: config }, expectedRevision: Number(expectedRevision || 0) };
}

function samePromptConfig(left, right) {
  return JSON.stringify(left?.patch?.aiPromptConfig || {}) === JSON.stringify(right?.patch?.aiPromptConfig || {});
}

// A preset ID is the user's stable choice. Name, version and body are refreshed
// from the published catalog at each execution boundary, then saved as the
// auditable snapshot used by this run. This lets an administrator publish a new
// version without requiring every batch or book to be opened and saved again.
async function refreshBatchFactoryPresetSnapshot({ username, isOwner = false, batchId, bookId = '', goBaseUrl, bridgeSecret, presetStore, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (!presetStore || !batchId) return { batchRefreshed: false, bookRefreshed: false };
  const basePath = `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}`;
  const loaded = await v11JSONRequest({ username, isOwner, method: 'GET', pathname: basePath, goBaseUrl, bridgeSecret, fetchImpl, now });
  const batch = loaded?.batch;
  if (!batch) throw requestError('批量作品不存在', 404, 'BATCH_NOT_FOUND');
  let batchRefreshed = false;
  let bookRefreshed = false;
  const currentBatch = promptConfigRefreshInput(batch?.settingsState?.patch, batch?.revision);
  if (currentBatch) {
    const refreshed = enrichBatchFactorySystemPresetConfig(currentBatch, presetStore);
    if (!samePromptConfig(currentBatch, refreshed)) {
      await v11JSONRequest({ username, isOwner, method: 'PUT', pathname: `${basePath}/settings`, payload: refreshed, goBaseUrl, bridgeSecret, fetchImpl, now });
      batchRefreshed = true;
    }
  }
  const book = (batch?.books || []).find(item => String(item?.id) === String(bookId));
  const currentBook = plainObject(book?.settingsState?.patch?.aiPromptConfig)
    ? promptConfigRefreshInput(book.settingsState.patch, book.revision)
    : null;
  if (book && currentBook) {
    const refreshed = enrichBatchFactorySystemPresetConfig(currentBook, presetStore);
    if (!samePromptConfig(currentBook, refreshed)) {
      await v11JSONRequest({ username, isOwner, method: 'PUT', pathname: `${basePath}/books/${encodeURIComponent(book.id)}/override`, payload: refreshed, goBaseUrl, bridgeSecret, fetchImpl, now });
      bookRefreshed = true;
    }
  }
  return { batchRefreshed, bookRefreshed };
}

function presetDrivenExecutionPath(req, pathname) {
  if (!['GET', 'POST'].includes(req.method)) return null;
  // Final-prompt is a read-only card preview. Refreshing its preset snapshot
  // would turn parallel card reads into concurrent settings writes and cause
  // revision conflicts. Executable stages below still refresh immediately
  // before their own server-side work begins.
  const match = pathname.match(/^\/api\/batch-factory\/v11\/batches\/([^/]+)(?:\/director|\/books\/([^/]+)\/(?:director|hook|working-front\/viral|production|stages\/(?:assets|director|video|retry)))$/);
  return match ? { batchId: decodeURIComponent(match[1]), bookId: decodeURIComponent(match[2] || '') } : null;
}

function redactBatchFactorySystemPromptBodies(value, inPromptConfig = false) {
  if (Array.isArray(value)) return value.map(item => redactBatchFactorySystemPromptBodies(item, inPromptConfig));
  if (!plainObject(value)) return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    const protectedConfig = inPromptConfig || key === 'aiPromptConfig';
    if (protectedConfig && (key === 'body' || key === 'prompt')) continue;
    next[key] = redactBatchFactorySystemPromptBodies(item, protectedConfig);
  }
  return next;
}

function personalApiKeyForUser(req) {
  const config = readConfig(req.username);
  return getVideoApiKey(config, 'yd');
}

function resolveBatchVideoProviderConfig(username, modelId, options = {}) {
  const selected = String(modelId || '').trim();
  const catalogModelId = selected || 'yd2-mini-video';
  let model = null;
  try {
    model = resolveRuntimeModel({
      username,
      kind: 'video',
      modelId: catalogModelId,
      memberStore: options.memberStore,
      accountStore: options.accountStore,
      configReader: options.configReader || readConfig
    });
  } catch (_) {
    // Keep the legacy owner-only YD configuration working while old batches
    // migrate to the model catalog.
  }
  if (selected === 'seedance-2-0-official') {
    if (!model?.credential) return null;
    return { provider: YFAI_PROVIDER, model: model.modelId || selected, apiKey: model.credential, baseUrl: model.baseUrl || 'https://yf.token6688.com' };
  }
  if (model?.credential) return { provider: PERSONAL_PROVIDER, model: PERSONAL_MODEL, apiKey: model.credential };
  const apiKey = getVideoApiKey((options.configReader || readConfig)(username), 'yd');
  return apiKey ? { provider: PERSONAL_PROVIDER, model: PERSONAL_MODEL, apiKey } : null;
}

async function syncPersonalProviderConfig(req, options, { allowMissing = false } = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch implementation is required');
  const base = String(options.goBaseUrl || resolveV11GoBaseUrl()).replace(/\/$/, '');
  const secret = options.bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET || '';
  const selectedModel = String(req.body?.modelId || req.body?.videoModelId || '').trim();
  const providerConfig = resolveBatchVideoProviderConfig(req.username, selectedModel, options);
  if (!providerConfig) {
    if (allowMissing) return false;
    const error = new Error('请先在个人中心配置视频 API Key');
    error.status = 400;
    error.code = 'VIDEO_API_KEY_REQUIRED';
    throw error;
  }
  const headers = {
    ...createSignedBridgeHeaders({
      username: req.username,
      isOwner: req.auth?.account?.isOwner === true,
      method: 'PUT',
      pathname: CONFIG_PATH,
      secret,
      now: (options.now || Date.now)()
    }),
    'Content-Type': 'application/json'
  };
  const response = await fetchImpl(base + CONFIG_PATH, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      provider: providerConfig.provider,
      model: providerConfig.model,
      apiKey: providerConfig.apiKey,
      ...(providerConfig.baseUrl ? { createUrl: providerConfig.baseUrl } : {})
    }),
    redirect: 'manual'
  });
  if (!response || response.status < 200 || response.status >= 300) {
    const error = new Error('个人中心视频 API 配置同步失败');
    error.status = response?.status === 401 ? 401 : 503;
    error.code = 'VIDEO_PROVIDER_SYNC_FAILED';
    throw error;
  }
  return true;
}

function h3ApiKeyForRequest(req, configReader = readConfig) {
  const personalKey = getVideoApiKey(configReader(req.username), 'h3');
  return personalKey || String(process.env.QIANTIE_AUTODL_H3_API_KEY || process.env.QIANTIE_H3_API_KEY || '').trim();
}

async function syncH3ProviderConfig(req, options, { allowMissing = false } = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch implementation is required');
  const apiKey = h3ApiKeyForRequest(req, options.configReader);
  if (!apiKey) {
    if (allowMissing) return false;
    const error = new Error('服务端尚未配置 AutoDL H3 API Key');
    error.status = 400;
    error.code = 'H3_API_KEY_REQUIRED';
    throw error;
  }
  const base = String(options.goBaseUrl || resolveV11GoBaseUrl()).replace(/\/$/, '');
  const secret = options.bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET || '';
  const headers = {
    ...createSignedBridgeHeaders({
      username: req.username,
      isOwner: req.auth?.account?.isOwner === true,
      method: 'PUT',
      pathname: CONFIG_PATH,
      secret,
      now: (options.now || Date.now)()
    }),
    'Content-Type': 'application/json'
  };
  const response = await fetchImpl(base + CONFIG_PATH, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ provider: H3_PROVIDER, model: H3_MODEL, apiKey, createUrl: H3_CREATE_URL, tasksUrl: H3_TASKS_URL }),
    redirect: 'manual'
  });
  if (!response || response.status < 200 || response.status >= 300) {
    const error = new Error('AutoDL H3 视频配置同步失败');
    error.status = response?.status === 401 ? 401 : 503;
    error.code = 'H3_PROVIDER_SYNC_FAILED';
    throw error;
  }
  return true;
}

async function prepareProviderRequest(req, options, pathname) {
  const provider = providerFromRequest(req);
  if (provider === LOCAL_PROVIDER) return;
  if (provider === H3_PROVIDER) {
    if (!needsH3ConfigSync(req, pathname)) return;
    const allowMissing = req.method === 'GET' && pathname !== CONFIG_PATH;
    if (pathname === CONFIG_PATH) {
      const apiKey = h3ApiKeyForRequest(req, options.configReader);
      if (!apiKey) {
        const error = new Error('服务端尚未配置 AutoDL H3 API Key');
        error.status = 400;
        error.code = 'H3_API_KEY_REQUIRED';
        throw error;
      }
      req.body = {
        ...(req.body || {}),
        provider: H3_PROVIDER,
        model: req.body?.model || H3_MODEL,
        apiKey,
        createUrl: req.body?.createUrl || H3_CREATE_URL,
        tasksUrl: req.body?.tasksUrl || H3_TASKS_URL
      };
      return;
    }
    await syncH3ProviderConfig(req, options, { allowMissing });
    return;
  }
  if (!needsPersonalConfigSync(req, pathname)) return;
  const allowMissing = req.method === 'GET' || isProviderConfigPath(pathname) === false && req.method !== 'POST';
  if (isProviderConfigPath(pathname)) {
    // The browser never sends the secret directly. Inject the personal-center
    // key only on the trusted Node -> Go hop, and never echo it to the client.
    if (provider === PERSONAL_PROVIDER) {
      const apiKey = personalApiKeyForUser(req);
      if (!apiKey) {
        const error = new Error('请先在个人中心配置视频 API Key');
        error.status = 400;
        error.code = 'VIDEO_API_KEY_REQUIRED';
        throw error;
      }
      req.body = { ...(req.body || {}), provider: PERSONAL_PROVIDER, model: req.body?.model || PERSONAL_MODEL, apiKey };
    } else if (req.body && typeof req.body === 'object') {
      req.body = { ...req.body, provider: LOCAL_PROVIDER, apiKey: '' };
    }
    return;
  }
  await syncPersonalProviderConfig(req, options, { allowMissing });
}

function automationVideoProvider(settings = {}) {
  const model = String(settings.videoModelId || '').trim().toLowerCase();
  if (model.includes('h3') || model.includes('minimax-h3') || model.includes('autodl')) return H3_PROVIDER;
  if (model.includes('doubao') || model.includes('local-executor')) return LOCAL_PROVIDER;
  if (model === 'seedance-2-0-official') return YFAI_PROVIDER;
  return normalizedProvider(settings.videoProvider);
}

function automationEffectiveSettings(batch, book) {
  const batchPatch = object(batch?.settingsState?.patch);
  const bookPatch = object(book?.settingsState?.patch);
  return {
    ...batchPatch,
    ...bookPatch,
    publishSettings: {
      ...object(batchPatch.publishSettings),
      ...object(bookPatch.publishSettings)
    }
  };
}

function automationPublishSettings(batch, book, frozenSettings) {
  if (frozenSettings && typeof frozenSettings === 'object' && !Array.isArray(frozenSettings)) {
    return object(frozenSettings.publishSettings);
  }
  return automationEffectiveSettings(batch, book).publishSettings || {};
}

const EMPTY_AUTOMATION_COUNTS = Object.freeze({ total: 0, ready: 0, running: 0, pending: 0, failed: 0, blocked: 0 });

function safeAutomationStatus(automation, context, logger = console) {
  try {
    const status = automation.status(context);
    if (!status || typeof status !== 'object' || Array.isArray(status)) throw new Error('自动化状态不是对象');
    return status;
  } catch (error) {
    logger.error?.('[batch-factory-automation] status read failed', {
      batchId: context?.batchId || '',
      owner: context?.owner || '',
      message: String(error?.message || '')
    });
    return {
      state: 'unavailable',
      diagnosticCode: 'AUTOMATION_STATUS_UNAVAILABLE',
      counts: { ...EMPTY_AUTOMATION_COUNTS },
      books: []
    };
  }
}

function automationH3Document(book) {
  const output = object(book?.directorRevision?.output);
  return object(output.h3_director || output.h3Director);
}

function automationTTSFingerprint(tts = {}) {
  const normalized = Object.keys(object(tts)).sort().map(key => [key, tts[key]]);
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

async function synthesizeAutomationTTSBytes(input, tts = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl('http://tts3.121w.com/v1/audio/speech', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: '*/*' },
    body: JSON.stringify({ input, voice: tts.voice || 'zh-CN-XiaoxiaoNeural', speed: Number(tts.speed || 1.8), pitch: String(tts.pitch ?? 10), style: tts.style || 'general' })
  });
  if (!response?.ok) throw requestError(`配音实测失败（${Number(response?.status || 502)}）`, 502, 'AUTOMATION_TTS_FAILED');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw requestError('配音实测返回空音频', 502, 'AUTOMATION_TTS_FAILED');
  return bytes;
}

async function synthesizeAutomationTTS(input, tts = {}, fetchImpl = globalThis.fetch) {
  return (await synthesizeAutomationTTSBytes(input, tts, fetchImpl)).toString('base64');
}

function mpegAudioDurationSeconds(bytes) {
  const data = Buffer.from(bytes || []);
  const bitrateV1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const bitrateV2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const sampleRates = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let offset = data.subarray(0, 3).toString('ascii') === 'ID3' && data.length >= 10
    ? 10 + (((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) | ((data[8] & 0x7f) << 7) | (data[9] & 0x7f))
    : 0;
  let seconds = 0;
  let frames = 0;
  while (offset + 4 <= data.length) {
    const header = data.readUInt32BE(offset);
    if (((header & 0xffe00000) >>> 0) !== 0xffe00000) { offset += 1; continue; }
    const version = (header >>> 19) & 3;
    const layer = (header >>> 17) & 3;
    const bitrateIndex = (header >>> 12) & 15;
    const sampleRateIndex = (header >>> 10) & 3;
    const padding = (header >>> 9) & 1;
    const sampleRate = sampleRates[version]?.[sampleRateIndex];
    const bitrate = (version === 3 ? bitrateV1L3 : bitrateV2L3)[bitrateIndex];
    if (layer !== 1 || !sampleRate || !bitrate) { offset += 1; continue; }
    const samples = version === 3 ? 1152 : 576;
    const frameLength = Math.floor(((version === 3 ? 144000 : 72000) * bitrate) / sampleRate) + padding;
    if (frameLength < 4 || offset + frameLength > data.length) break;
    seconds += samples / sampleRate;
    frames += 1;
    offset += frameLength;
  }
  if (!frames || !Number.isFinite(seconds) || seconds <= 0) throw requestError('无法读取配音真实时长', 502, 'AUTOMATION_TTS_DURATION_INVALID');
  return Number(seconds.toFixed(3));
}

function splitVideoPresetBody(body) {
  const value = String(body || '').trim();
  for (const marker of ['【批量工厂最终 Prompt 模板】', '## 最终 Prompt 模板']) {
    const index = value.indexOf(marker);
    if (index >= 0) {
      return {
        directorRules: value.slice(0, index).trim(),
        finalTemplate: value.slice(index + marker.length).trim()
      };
    }
  }
  return { directorRules: value, finalTemplate: '' };
}

function automationCompilePayload(book, settings, audioAssetID = '', semantic = false) {
  const promptConfig = object(settings.aiPromptConfig);
  const video = object(promptConfig.video);
  const constraints = object(promptConfig.constraints);
  const selections = Array.isArray(constraints.selections) ? constraints.selections : [];
  const enabled = constraints.enabled !== false;
  const enabledCategories = Array.isArray(constraints.enabledCategories)
    ? new Set(constraints.enabledCategories.map(String))
    : new Set(['prefix', 'quality', 'restriction', 'negative']);
  const layer = category => enabled && enabledCategories.has(category)
    ? selections.find(item => item?.constraintCategory === category) || null
    : null;
  const prefix = layer('prefix');
  const quality = layer('quality');
  const restriction = layer('restriction');
  const negative = layer('negative');
  const smartUnified = prefix?.presetId === SMART_UNIFIED_PREFIX_PRESET_ID;
  const presetBody = splitVideoPresetBody(video.body);
  const template = presetBody.finalTemplate.includes('{{storyboard}}') ? presetBody.finalTemplate : '';
  return {
    director_revision_id: String(book?.directorRevision?.id || ''),
    audio_asset_id: audioAssetID,
    allow_semantic_timeline: semantic,
    preset: {
      key: String(video.presetKey || video.presetId || video.id || 'h3-video-normal'),
      revision: Math.max(1, Number(video.presetVersion || video.version || 1)),
      format: 'h3-structured-v1',
      max_segment_ms: Number(settings.storyboardDurationLimit) === 15 ? 15000 : 10000,
      request_duration_mode: 'ceil-second',
      prompt_template: template,
      output_constraints: template
        ? '按冻结导演数据和所选最终模板生成当前 VIDEO 提示词。'
        : (presetBody.directorRules || '按结构化时间线输出当前 VIDEO，保持人物、动作、机位和场景连续性。')
    },
    prefix_text: smartUnified ? '' : String(prefix?.body || ''),
    quality_text: String(quality?.body || ''),
    visual_restriction_text: String(restriction?.body || ''),
    negative_text: String(negative?.body || ''),
    switches: {
      smart_unified: smartUnified,
      base_setup: enabled && constraints.baseSetup?.enabled !== false,
      prefix: Boolean(prefix && !smartUnified && String(prefix.body || '').trim()),
      quality: Boolean(quality && String(quality.body || '').trim()),
      visual_restriction: Boolean(restriction && String(restriction.body || '').trim()),
      negative: Boolean(negative && String(negative.body || '').trim())
    }
  };
}

function createBatchFactoryV11Router(options = {}) {
  const upstreamOptions = { ...options, goBaseUrl: options.goBaseUrl || resolveV11GoBaseUrl() };
  const automationPresets = options.automationPresetStore || createAutomationPresetStore({ statePath: options.automationPresetStatePath });
  const automation = createBatchFactoryAutomationController({
    statePath: options.automationStatePath,
    pollMs: options.automationPollMs,
    logger: options.logger || console,
    adapter: {
      loadBatch: async (username, isOwner, batchId) => {
        const result = await v11JSONRequest({
          username, isOwner, method: 'GET',
          pathname: `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}`,
          goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret,
          fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now
        });
        return result?.batch || result;
      },
      getStageSummary: async (username, isOwner, batchId, bookId) => {
        const result = await v11JSONRequest({
          username, isOwner, method: 'GET',
          pathname: `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}/books/${encodeURIComponent(bookId)}/stages`,
          goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret,
          fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now
        });
        return result?.summary || result;
      },
      applyExecutionSnapshot: async ({ owner: username, isOwner, batch, book, configSnapshot }) => {
        const currentBook = (Array.isArray(batch?.books) ? batch.books : []).find(item => item?.id === book?.id) || book;
        const base = object(configSnapshot);
        const override = object(currentBook?.settingsState?.patch);
        const effective = {
          ...base,
          ...override,
          publishSettings: { ...object(base.publishSettings), ...object(override.publishSettings) }
        };
        return v11JSONRequest({
          username, isOwner, method: 'PUT',
          pathname: `/api/batch-factory/v11/batches/${encodeURIComponent(batch.id)}/books/${encodeURIComponent(book.id)}/override`,
          payload: { patch: effective, expectedRevision: Number(currentBook?.revision || 0) },
          goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret,
          fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now
        });
      },
      runStage: async ({ owner: username, isOwner, batch, book, stage, mode, videoId = '', requestId, settings: frozenSettings }) => {
        const batchId = batch.id;
        const bookId = book.id;
        const pathname = `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}/books/${encodeURIComponent(bookId)}/stages/${encodeURIComponent(stage)}`;
        if (!frozenSettings) {
          await refreshBatchFactoryPresetSnapshot({
            username, isOwner, batchId, bookId,
            goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret,
            presetStore: upstreamOptions.presetStore, fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now
          });
        }
        const settings = frozenSettings || automationEffectiveSettings(batch, book);
        const payload = { mode, requestId, ...(videoId ? { videoId } : {}) };
        if (['assets', 'director', 'visual'].includes(stage)) {
          const textModelId = String(settings.textModelId || '').trim();
          payload.textProvider = requestTextProvider({ username, body: { textModelId } }, upstreamOptions, textModelId);
        }
        if (stage === 'video') {
          const provider = automationVideoProvider(settings);
          payload.provider = provider;
          const syntheticRequest = {
            username,
            auth: { account: { isOwner } },
            method: 'POST',
            body: { provider, videoModelId: settings.videoModelId },
            originalUrl: pathname,
            url: pathname
          };
          await prepareProviderRequest(syntheticRequest, upstreamOptions, pathname);
        }
        return v11JSONRequest({
          username, isOwner, method: 'POST', pathname, payload,
          goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret,
          fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now
        });
      },
      prepareAudioPlanning: async ({ owner: username, isOwner, batch, book, settings }) => {
        const input = batchFactoryProductionText(book);
        if (!input) throw requestError('当前书没有可用于配音的生产内容', 422, 'AUTOMATION_TTS_SOURCE_REQUIRED');
        const tts = { voice: 'zh-CN-XiaoxiaoNeural', style: 'general', speed: 1.8, pitch: 10, ...object(settings.tts) };
        const bytes = await synthesizeAutomationTTSBytes(input, tts, upstreamOptions.fetchImpl || globalThis.fetch);
        const patch = {
          audioDurationSeconds: mpegAudioDurationSeconds(bytes),
          audioDurationFingerprint: `server-a1-${crypto.createHash('sha256').update(input).update(JSON.stringify(tts)).digest('hex')}`,
          audioDurationManual: false
        };
        const pathname = `/api/batch-factory/v11/batches/${encodeURIComponent(batch.id)}/books/${encodeURIComponent(book.id)}/override`;
        return v11JSONRequest({
          username, isOwner, method: 'PUT', pathname,
          payload: { patch, expectedRevision: Number(book.revision || 0) },
          goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret,
          fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now
        });
      },
      retryStage: async ({ owner: username, isOwner, batch, book, lastFailed, requestId, settings: frozenSettings }) => {
        const batchId = batch.id;
        const bookId = book.id;
        const stage = String(lastFailed?.stage || '').trim();
        const pathname = `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}/books/${encodeURIComponent(bookId)}/stages/retry`;
        await refreshBatchFactoryPresetSnapshot({
          username, isOwner, batchId, bookId,
          goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret,
          presetStore: upstreamOptions.presetStore, fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now
        });
        const settings = frozenSettings || automationEffectiveSettings(batch, book);
        const textModelId = String(settings.textModelId || '').trim();
        const payload = {
          requestId,
          textProvider: requestTextProvider({ username, body: { textModelId } }, upstreamOptions, textModelId)
        };
        // An asset retry obtains its baseline inside that one combined asset
        // request. Other retries retain the explicit non-blocking refresh.
        if (stage !== 'assets') {
          const smartUnified = await refreshSmartUnifiedNonBlocking({
              username, isOwner, batchId, bookId, textModelId, textProvider: payload.textProvider,
              presetStore: upstreamOptions.presetStore,
              goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret,
              fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now,
              memberStore: upstreamOptions.memberStore, accountStore: upstreamOptions.accountStore,
              configReader: upstreamOptions.configReader || readConfig, persist: true
          });
          if (smartUnified.style) payload.smartUnifiedStyle = smartUnified.style;
        }
        if (stage === 'video') {
          const provider = automationVideoProvider(settings);
          payload.provider = provider;
          const syntheticRequest = {
            username,
            auth: { account: { isOwner } },
            method: 'POST',
            body: { provider, videoModelId: settings.videoModelId },
            originalUrl: pathname,
            url: pathname
          };
          // The public retry endpoint is intentionally generic, but provider
          // credentials must be synchronized exactly as for a VIDEO stage.
          await prepareProviderRequest(syntheticRequest, upstreamOptions, `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}/books/${encodeURIComponent(bookId)}/stages/video`);
        }
        return v11JSONRequest({
          username, isOwner, method: 'POST', pathname, payload,
          goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret,
          fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now
        });
      },
      compileDirector: async ({ owner: username, isOwner, batch, book, settings }) => {
        const document = automationH3Document(book);
        if (!Array.isArray(document?.director_cards) || !document.director_cards.length) return null;
        const payload = automationCompilePayload(book, settings, '', settings.audioPlanningEnabled !== true);
        if (settings.audioPlanningEnabled === true) {
          const tts = { voice: 'zh-CN-XiaoxiaoNeural', style: 'general', speed: 1.8, pitch: 10, ...object(settings.tts) };
          const fingerprint = automationTTSFingerprint(tts);
          let measurement = null;
          try {
            const trace = await v11JSONRequest({ username, isOwner, method: 'GET', pathname: `/api/batch-factory/v12/batches/${encodeURIComponent(batch.id)}/books/${encodeURIComponent(book.id)}/h3/trace`, goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret, fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now });
            measurement = trace?.timeline?.timeline?.audio_measurement || null;
          } catch (error) {
            if (Number(error?.status) !== 404) throw error;
          }
          const reusable = measurement?.method === 'per_line_tts_probe' && measurement?.asset_id && measurement?.tts_fingerprint === fingerprint && measurement?.video_source_hash === document.video_source_hash && measurement?.video_source_revision === document.video_source_revision && Array.isArray(measurement?.lines) && measurement.lines.length === document.director_cards.length && measurement.lines.every((line, index) => line?.source_key === document.director_cards[index]?.source_key && line?.source_text_hash === document.director_cards[index]?.source_text_hash && Number(line?.duration_ms) > 0);
          if (reusable) {
            payload.audio_asset_id = measurement.asset_id;
          } else {
            const lines = [];
            for (const card of document.director_cards) {
              const sourceText = String(card?.source_text || '').trim();
              if (!sourceText || !card?.source_key) throw requestError('缺少冻结的视频原文行', 422, 'AUTOMATION_H3_SOURCE_INVALID');
              lines.push({ source_key: card.source_key, source_text: sourceText, audio_base64: await synthesizeAutomationTTS(sourceText, tts) });
            }
            const measured = await v11JSONRequest({
              username, isOwner, method: 'POST',
              pathname: `/api/batch-factory/v12/batches/${encodeURIComponent(batch.id)}/books/${encodeURIComponent(book.id)}/h3/audio-measurement`,
              payload: { director_revision_id: book.directorRevision.id, tts_fingerprint: fingerprint, lines },
              goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret,
              fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now
            });
            payload.audio_asset_id = String(measured?.audio_asset_id || measured?.audio_measurement?.measurement?.asset_id || '');
          }
          payload.allow_semantic_timeline = false;
        }
        return v11JSONRequest({
          username, isOwner, method: 'POST',
          pathname: `/api/batch-factory/v12/batches/${encodeURIComponent(batch.id)}/books/${encodeURIComponent(book.id)}/h3/compile`,
          payload, goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret,
          fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now
        });
      },
      getProductionStatus: (username, isOwner, batchId) => v11JSONRequest({
        username, isOwner, method: 'GET',
        pathname: `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}/status`,
        goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret,
        fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now
      }),
      getMergeStatus: async (username, isOwner, batchId) => {
        try {
          return await v11JSONRequest({
            username, isOwner, method: 'GET',
            pathname: `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}/merge-status`,
            goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret,
            fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now
          });
        } catch (error) {
          if ([404, 405, 501, 503].includes(Number(error?.status || 0))) {
            return { batchId, jobs: [], unavailable: true, reason: String(error?.message || '合并服务未启用') };
          }
          throw error;
        }
      },
      submitBookMerge: ({ owner: username, isOwner, batchId, bookId, payload }) => v11JSONRequest({
        username, isOwner, method: 'POST',
        pathname: `/api/batch-factory/v11/batches/${encodeURIComponent(batchId)}/books/${encodeURIComponent(bookId)}/merge`,
        payload, goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret,
        fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now
      }),
      publishBook: async ({ owner: username, isOwner, batchId, bookId, batch, book, settings: frozenSettings }) => {
        const settings = automationPublishSettings(batch, book, frozenSettings);
        const request = {
          username,
          auth: { account: { isOwner } },
          body: {
            organization: settings.organization,
            category: settings.category || 'NEW_BOOK',
            startTime: settings.startTime || '',
            reupload: false
          },
          app: { locals: { novelFetchStore: options.novelFetchStore } }
        };
        return submitBatchFactoryBookTo121(request, { batchId, bookId }, {
          ...upstreamOptions,
          novelFetchStore: options.novelFetchStore,
          directClient: options.directClient,
          clock: options.clock
        });
      }
    }
  });
  const router = express.Router();

  const automationContext = req => ({
    owner: req.username,
    isOwner: req.auth?.account?.isOwner === true,
    batchId: req.params.batchId
  });
  const sendAutomationError = (res, error) => {
    const status = Number.isInteger(error?.status) ? error.status : 422;
    return res.status(status).json({ error: String(error?.message || '批量工厂自动化操作失败'), code: error?.code || 'BATCH_FACTORY_AUTOMATION_FAILED' });
  };

  router.get('/automation-presets', async (req, res) => {
    try { return res.json({ presets: await automationPresets.list(req.username) }); }
    catch (error) { return sendAutomationError(res, error); }
  });
  router.post('/automation-presets', async (req, res) => {
    try { return res.status(201).json({ preset: await automationPresets.create(req.username, req.body) }); }
    catch (error) { return sendAutomationError(res, error); }
  });
  router.put('/automation-presets/:presetId', async (req, res) => {
    try { return res.json({ preset: await automationPresets.update(req.username, req.params.presetId, req.body) }); }
    catch (error) { return sendAutomationError(res, error); }
  });
  router.delete('/automation-presets/:presetId', async (req, res) => {
    try { await automationPresets.remove(req.username, req.params.presetId); return res.status(204).end(); }
    catch (error) { return sendAutomationError(res, error); }
  });
  router.post('/batches/:batchId/automation-presets', async (req, res) => {
    try {
      const batch = await v11JSONRequest({
        username: req.username, isOwner: req.auth?.account?.isOwner === true, method: 'GET',
        pathname: `/api/batch-factory/v11/batches/${encodeURIComponent(req.params.batchId)}`,
        goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret,
        fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now
      });
      const value = batch?.batch || batch;
      return res.status(201).json({ preset: await automationPresets.create(req.username, { name: req.body?.name, config: value?.settingsState?.patch || {} }) });
    } catch (error) { return sendAutomationError(res, error); }
  });

  router.get('/batches/:batchId/automation', (req, res) => {
    res.json({ automation: safeAutomationStatus(automation, automationContext(req), upstreamOptions.logger || console) });
  });
  router.post('/batches/:batchId/automation/start', async (req, res) => {
    try {
      const presetId = String(req.body?.presetId || '').trim();
      if (!presetId) throw requestError('请先选择自动化预设', 400, 'AUTOMATION_PRESET_REQUIRED');
      const preset = presetId ? await automationPresets.get(req.username, presetId) : null;
      if (presetId && !preset) throw requestError('自动化预设不存在或不属于当前账号', 404, 'AUTOMATION_PRESET_NOT_FOUND');
      const current = await v11JSONRequest({
        username: req.username, isOwner: req.auth?.account?.isOwner === true, method: 'GET',
        pathname: `/api/batch-factory/v11/batches/${encodeURIComponent(req.params.batchId)}`,
        goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret,
        fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now
      });
      const batch = current?.batch || current;
      const result = await automation.start({
        ...automationContext(req), scheduledAt: req.body?.scheduledAt,
        runMode: req.body?.runMode, concurrency: req.body?.concurrency,
        preset: preset ? { id: preset.id, name: preset.name, version: preset.version } : {},
        configSnapshot: preset?.config || object(batch?.settingsState?.patch)
      });
      return res.status(201).json({ automation: result });
    } catch (error) { return sendAutomationError(res, error); }
  });
  router.post('/batches/:batchId/automation/pause', async (req, res) => {
    try { return res.json({ automation: await automation.pause(automationContext(req)) }); }
    catch (error) { return sendAutomationError(res, error); }
  });
  router.post('/batches/:batchId/automation/resume', async (req, res) => {
    try { return res.json({ automation: await automation.resume(automationContext(req)) }); }
    catch (error) { return sendAutomationError(res, error); }
  });
  router.post('/batches/:batchId/automation/retry', async (req, res) => {
    try { return res.json({ automation: await automation.retry({ ...automationContext(req), bookIds: req.body?.bookIds }) }); }
    catch (error) { return sendAutomationError(res, error); }
  });
  router.post('/batches/:batchId/automation/cancel', async (req, res) => {
    try { return res.json({ automation: await automation.cancel(automationContext(req)) }); }
    catch (error) { return sendAutomationError(res, error); }
  });

  router.use(async (req, res, next) => {
    try {
      const parsed = new URL(req.originalUrl || req.url, 'http://qiantie.local');
      const imageGeneration = batchAssetImageGenerationPath(parsed.pathname);
      if (req.method === 'POST' && imageGeneration) {
        const result = await generateBatchFactoryAssetImages({
          username: req.username,
          isOwner: req.auth?.account?.isOwner === true,
          batchId: imageGeneration.batchId,
          bookId: imageGeneration.bookId,
          assetIds: req.body?.assetIds,
          modelId: req.body?.modelId,
          aspectRatio: req.body?.imageAspectRatio || req.body?.aspectRatio,
          goBaseUrl: upstreamOptions.goBaseUrl,
          bridgeSecret: upstreamOptions.bridgeSecret,
          resolveImageModel: modelId => resolveRuntimeModel({
            username: req.username,
            kind: 'image',
            modelId,
            memberStore: upstreamOptions.memberStore,
            configReader: upstreamOptions.configReader || readConfig
          })
        });
        return res.status(201).json(result);
      }
      const classification = batchFactoryBookClassificationPath(parsed.pathname);
      if (req.method === 'POST' && classification) {
        const result = await prepareBatchFactoryBookClassification(req, classification, upstreamOptions);
        return res.json(result);
      }
      const smartUnifiedRefresh = batchFactorySmartUnifiedRefreshPath(parsed.pathname);
      if (req.method === 'POST' && smartUnifiedRefresh) {
        const smartUnified = await refreshSmartUnifiedNonBlocking({
          username: req.username,
          isOwner: req.auth?.account?.isOwner === true,
          ...smartUnifiedRefresh,
          textModelId: String(req.body?.textModelId || '').trim(),
          presetStore: upstreamOptions.presetStore,
          goBaseUrl: upstreamOptions.goBaseUrl,
          bridgeSecret: upstreamOptions.bridgeSecret,
          fetchImpl: upstreamOptions.fetchImpl,
          now: upstreamOptions.now,
          memberStore: upstreamOptions.memberStore,
          accountStore: upstreamOptions.accountStore,
          configReader: upstreamOptions.configReader || readConfig,
          persist: true
        });
        return res.json({ smartUnified: {
          available: Boolean(smartUnified.style), skipped: Boolean(smartUnified.skipped),
          reason: smartUnified.reason || '', attempts: smartUnified.attempts || [],
          provider: smartUnified.provider ? { id: smartUnified.provider.id || smartUnified.provider.model, name: smartUnified.provider.displayName || smartUnified.provider.model } : null
        } });
      }
      const publish121 = batchFactory121PublishPath(parsed.pathname);
      if (req.method === 'POST' && publish121) {
        const result = await submitBatchFactoryBookTo121(req, publish121, upstreamOptions);
        return res.status(202).json(result);
      }
      if (req.method === 'GET' && batchFactory121OrganizationsPath(parsed.pathname)) {
        return res.json(await listBatchFactory121Organizations(req, upstreamOptions));
      }
      if (isDerivedOpeningRequest(req, parsed.pathname)) {
        const { promptPresetId, derivedOpening: _ignoredDerivedOpening, ...payload } = req.body || {};
        req.body = { ...payload, derivedOpening: resolveDerivedOpeningPrompt(promptPresetId, upstreamOptions.presetStore) };
      }
      if (directorTextModelPath(req, parsed.pathname)) {
        req.body = { ...(req.body || {}), textProvider: requestTextProvider(req, upstreamOptions) };
      }
      await prepareProviderRequest(req, upstreamOptions, parsed.pathname);
      if (isPromptConfigPath(req, parsed.pathname)) {
        req.body = enrichBatchFactorySystemPresetConfig(req.body, upstreamOptions.presetStore);
      }
      const execution = presetDrivenExecutionPath(req, parsed.pathname);
      if (execution) {
        await refreshBatchFactoryPresetSnapshot({ username: req.username, isOwner: req.auth?.account?.isOwner === true, ...execution, goBaseUrl: upstreamOptions.goBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret, presetStore: upstreamOptions.presetStore, fetchImpl: upstreamOptions.fetchImpl, now: upstreamOptions.now });
      }
      return await proxyV11Request(req, res, {
        ...upstreamOptions,
        transformJSONResponse: redactBatchFactorySystemPromptBodies
      });
    } catch (error) {
      if (res.headersSent) return next(error);
      const status = Number.isInteger(error?.status) ? error.status : 502;
      const code = error?.code || 'BFV11_UPSTREAM_UNAVAILABLE';
      console.error('[batch-factory-v11] upstream request failed', {
        method: req.method,
        pathname: req.originalUrl || req.url,
        status,
        code,
        message: String(error?.message || ''),
        cause: String(error?.cause?.message || '')
      });
      const message = upstreamErrorMessage(error, status);
      return res.status(status).json({ error: message, code });
    }
  });
  return router;
}

module.exports = {
  H3_PROVIDER,
  PERSONAL_PROVIDER,
  LOCAL_PROVIDER,
  YFAI_PROVIDER,
  resolveBatchVideoProviderConfig,
  h3ApiKeyForRequest,
  normalizedProvider,
  needsH3ConfigSync,
  needsPersonalConfigSync,
  resolveV11GoBaseUrl,
  isPromptConfigPath,
  enrichBatchFactorySystemPresetConfig,
  resolveDerivedOpeningPrompt,
  refreshBatchFactoryPresetSnapshot,
  presetDrivenExecutionPath,
  redactBatchFactorySystemPromptBodies,
  batchAssetImageGenerationPath,
  generateBatchFactoryAssetImages,
  imageGenerationEndpoint,
  textCompletionEndpoint,
  directorBookPath,
  styleSystemBookPath,
  batchFactory121PublishPath,
  batchFactoryBookClassificationPath,
  batchFactory121OrganizationsPath,
  organizationOptions,
  resolveBatchFactory121Session,
  mpegAudioDurationSeconds,
  automationPublishSettings,
  automationCompilePayload,
  safeAutomationStatus,
  splitVideoPresetBody,
  listBatchFactory121Organizations,
  fetchBatchFactory121Media,
  submitBatchFactoryBookTo121,
  batchBookTextModelId,
  resolveBatchFactoryBookClassificationTextProvider,
  normalizedBookGender,
  normalizedBookStyle,
  classificationFailureMetadata,
  persistBatchFactoryBookClassificationFailure,
  parseBatchBookClassification,
  classifyBatchFactoryBookFor121,
  prepareBatchFactoryBookClassification,
  ensureBatchFactory121ResubmissionAllowed,
  persisted121PublicationMetadata,
  persistBatchFactory121Publication,
  v11JSONRequest,
  smartUnifiedSelected,
  directorVisualBaselineRequired,
  analyzeBatchFactorySmartUnifiedStyle,
  acquireBatchFactorySmartUnifiedBaseline,
  upstreamErrorMessage,
  createBatchFactoryV11Router
};
