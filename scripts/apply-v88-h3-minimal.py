from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one exact match, found {count}: {old[:100]!r}')
    write(path, text.replace(old, new, 1))


def regex_once(path, pattern, replacement):
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{path}: expected one regex match, found {count}: {pattern[:100]!r}')
    write(path, updated)


# --- Go: unified catalog + provider normalization ---
replace_once(
    'backend/internal/batchfactoryv11/video_provider.go',
    '\tVideoProviderDoubaoLocal       = "doubao_local_executor"\n\tPersonalVideoProviderID',
    '\tVideoProviderDoubaoLocal       = "doubao_local_executor"\n\tVideoProviderAutoDLComfyUI     = "autodl_comfyui"\n\tPersonalVideoProviderID'
)
replace_once(
    'backend/internal/batchfactoryv11/video_provider.go',
    '\tcase "doubao", "doubao_local", "doubao_local_executor", "local-doubao-executor-video":\n\t\treturn VideoProviderDoubaoLocal\n\tdefault:',
    '\tcase "doubao", "doubao_local", "doubao_local_executor", "local-doubao-executor-video":\n\t\treturn VideoProviderDoubaoLocal\n\tcase "autodl", "autodl_comfyui":\n\t\treturn VideoProviderAutoDLComfyUI\n\tdefault:'
)

write('backend/internal/batchfactoryv11/video_model_catalog.go', '''package batchfactoryv11

const VideoModelMiniMaxH3 = "minimax-h3"

type VideoModelCatalogItem struct {
\tID          string `json:"id"`
\tLabel       string `json:"label"`
\tProvider    string `json:"provider"`
\tMaxDuration int    `json:"maxDuration"`
}

func VideoModelCatalog() []VideoModelCatalogItem {
\treturn []VideoModelCatalogItem{
\t\t{ID: DefaultPersonalVideoModel, Label: "YD2.0 Mini", Provider: VideoProviderPersonalAPI, MaxDuration: 15},
\t\t{ID: "doubao-seedance", Label: "豆包 Seedance", Provider: VideoProviderDoubaoLocal, MaxDuration: 15},
\t\t{ID: VideoModelMiniMaxH3, Label: "MiniMax H3", Provider: VideoProviderAutoDLComfyUI, MaxDuration: 15},
\t}
}
''')

write('backend/internal/batchfactoryv11/h3_workflow.go', '''package batchfactoryv11

import (
\t"encoding/json"
\t"fmt"
\t"net/url"
\t"strings"
)

const (
\tH3WorkflowNoPicture   = "minimax_h3_lightx2v_no_pic"
\tH3WorkflowWithPicture = "minimax_h3_lightx2v_v5_15s"
\tmaxH3ReferenceImages  = 3
)

func H3WorkflowForValidImages(imageURLs []string) string {
\tif len(imageURLs) == 0 { return H3WorkflowNoPicture }
\treturn H3WorkflowWithPicture
}

func h3ImageURLs(values SettingsPatch) ([]string, error) {
\traw, ok := values["imageUrls"]
\tif !ok || len(raw) == 0 || string(raw) == "null" { return []string{}, nil }
\tvar input []string
\tif err := json.Unmarshal(raw, &input); err != nil {
\t\treturn nil, fmt.Errorf("%w: H3 imageUrls must be an array", ErrInvalid)
\t}
\tif len(input) > maxH3ReferenceImages {
\t\treturn nil, fmt.Errorf("%w: H3 accepts at most %d reference images", ErrInvalid, maxH3ReferenceImages)
\t}
\tresult := make([]string, 0, len(input))
\tfor _, item := range input {
\t\tvalue := strings.TrimSpace(item)
\t\tif value == "" { return nil, fmt.Errorf("%w: H3 reference image URL is empty", ErrInvalid) }
\t\tparsed, err := url.Parse(value)
\t\tif err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
\t\t\treturn nil, fmt.Errorf("%w: H3 reference images must use absolute HTTPS URLs", ErrInvalid)
\t\t}
\t\tresult = append(result, parsed.String())
\t}
\treturn result, nil
}
''')

# Reuse the existing server-managed adapter. H3 is never resolved from the per-user registry.
replace_once(
    'backend/internal/batchfactoryv11/production.go',
    'func (s *ProductionService) resolveProvider(ctx context.Context, owner, provider string) (ProductionAdapter, FrozenVideoModel, error) {',
    '''func (s *ProductionService) HasServerManagedVideoProvider(provider string) bool {
\tif s == nil { return false }
\tprovider = normalizeVideoProvider(provider)
\treturn provider == VideoProviderAutoDLComfyUI && s.Adapter != nil && strings.TrimSpace(s.Model.ID) == VideoModelMiniMaxH3
}

func (s *ProductionService) resolveProvider(ctx context.Context, owner, provider string) (ProductionAdapter, FrozenVideoModel, error) {'''
)
replace_once(
    'backend/internal/batchfactoryv11/production.go',
    '''\tif provider != VideoProviderPersonalAPI {
\t\treturn nil, FrozenVideoModel{}, fmt.Errorf("%w: unsupported video provider", ErrInvalid)
\t}
''',
    '''\tif provider == VideoProviderAutoDLComfyUI {
\t\tif !s.HasServerManagedVideoProvider(provider) {
\t\t\treturn nil, FrozenVideoModel{}, fmt.Errorf("%w: MiniMax H3 server-managed provider is unavailable", ErrUnavailable)
\t\t}
\t\tmodel := s.Model
\t\tmodel.ID = VideoModelMiniMaxH3
\t\tif model.MaxDuration <= 0 { model.MaxDuration = 15 }
\t\treturn s.Adapter, model, nil
\t}
\tif provider != VideoProviderPersonalAPI {
\t\treturn nil, FrozenVideoModel{}, fmt.Errorf("%w: unsupported video provider", ErrInvalid)
\t}
'''
)

# H3-specific provider payload is selected server-side from validated settings.
replace_once(
    'backend/internal/batchfactoryv11/production_adapter.go',
    '''\tif resolution := rawString(values, "resolution", ""); resolution != "" {
\t\tpayload["resolution"] = resolution
\t}
\tbody, err := json.Marshal(payload)
''',
    '''\tif resolution := rawString(values, "resolution", ""); resolution != "" {
\t\tpayload["resolution"] = resolution
\t}
\tif model.ID == VideoModelMiniMaxH3 {
\t\timageURLs, imageErr := h3ImageURLs(values)
\t\tif imageErr != nil { return ProviderTaskRef{}, imageErr }
\t\tpayload["workflow"] = H3WorkflowForValidImages(imageURLs)
\t\tpayload["imageUrls"] = imageURLs
\t}
\tbody, err := json.Marshal(payload)
'''
)

# --- Go HTTP: unified model catalog and env-only H3 provider status ---
write('backend/internal/httpapi/batch_factory_v11_video_models.go', '''package httpapi

import (
\t"net/http"
\t"qiantie/backend/internal/batchfactoryv11"
)

func videoModelCatalogHandler(w http.ResponseWriter, _ *http.Request) {
\twriteJSON(w, http.StatusOK, map[string]any{"videoModels": batchfactoryv11.VideoModelCatalog()})
}
''')
replace_once(
    'backend/internal/httpapi/router.go',
    '\tv11.HandleFunc("GET /api/batch-factory/v11/capabilities", capabilityHandlerForRuntime(options.Slice, options.Production != nil && options.Production.Enabled, options.Merge != nil && options.Merge.Enabled, options.External != nil && options.External.Enabled[external.Provider121], options.External != nil && options.External.Enabled[external.ProviderYadi]))\n',
    '\tv11.HandleFunc("GET /api/batch-factory/v11/capabilities", capabilityHandlerForRuntime(options.Slice, options.Production != nil && options.Production.Enabled, options.Merge != nil && options.Merge.Enabled, options.External != nil && options.External.Enabled[external.Provider121], options.External != nil && options.External.Enabled[external.ProviderYadi]))\n\tv11.HandleFunc("GET /api/batch-factory/v11/video-models", videoModelCatalogHandler)\n'
)
replace_once(
    'backend/internal/httpapi/batch_factory_v11_production.go',
    '''\t\tvar input videoProviderConfigInput
\t\tif !decodeJSON(w, r, &input) { return }
\t\terr := service.ProviderRegistry.Put(r.Context(), owner, batchfactoryv11.VideoProviderConfig{
''',
    '''\t\tvar input videoProviderConfigInput
\t\tif !decodeJSON(w, r, &input) { return }
\t\tprovider := batchfactoryv11.NormalizeVideoProviderForHTTP(input.Provider)
\t\tif provider == batchfactoryv11.VideoProviderAutoDLComfyUI {
\t\t\twriteJSON(w, http.StatusBadRequest, map[string]string{"error":"MiniMax H3 使用服务端环境变量配置，浏览器不能写入凭据", "code":"H3_PROVIDER_CONFIG_SERVER_MANAGED"})
\t\t\treturn
\t\t}
\t\terr := service.ProviderRegistry.Put(r.Context(), owner, batchfactoryv11.VideoProviderConfig{
'''
)
replace_once(
    'backend/internal/httpapi/batch_factory_v11_production.go',
    '\t\tprovider := batchfactoryv11.NormalizeVideoProviderForHTTP(input.Provider)\n\t\tmodel := input.Model\n',
    '\t\tmodel := input.Model\n'
)
replace_once(
    'backend/internal/httpapi/batch_factory_v11_production.go',
    '''\t\tprovider := batchfactoryv11.NormalizeVideoProviderForHTTP(r.URL.Query().Get("provider"))
\t\tif service == nil || service.ProviderRegistry == nil { writeStoreError(w, batchfactoryv11.ErrUnavailable); return }
''',
    '''\t\tprovider := batchfactoryv11.NormalizeVideoProviderForHTTP(r.URL.Query().Get("provider"))
\t\tif provider == batchfactoryv11.VideoProviderAutoDLComfyUI {
\t\t\tconfigured := service != nil && service.HasServerManagedVideoProvider(provider)
\t\t\twriteJSON(w, http.StatusOK, batchfactoryv11.VideoProviderConfigView{Provider: provider, Model: batchfactoryv11.VideoModelMiniMaxH3, Configured: configured})
\t\t\treturn
\t\t}
\t\tif service == nil || service.ProviderRegistry == nil { writeStoreError(w, batchfactoryv11.ErrUnavailable); return }
'''
)

# --- Node V11 proxy: H3 never enters personal credential sync ---
replace_once('routes/batch-factory-v11.js', "const LOCAL_PROVIDER = 'doubao_local_executor';\n", "const LOCAL_PROVIDER = 'doubao_local_executor';\nconst AUTODL_PROVIDER = 'autodl_comfyui';\n")
replace_once(
    'routes/batch-factory-v11.js',
    "  if (['doubao', 'doubao_local', 'doubao_local_executor'].includes(provider)) return LOCAL_PROVIDER;\n  return provider;",
    "  if (['doubao', 'doubao_local', 'doubao_local_executor'].includes(provider)) return LOCAL_PROVIDER;\n  if (['autodl', 'autodl_comfyui'].includes(provider)) return AUTODL_PROVIDER;\n  return provider;"
)
replace_once(
    'routes/batch-factory-v11.js',
    '''function needsPersonalConfigSync(req, pathname) {
  if (isProviderConfigPath(pathname)) return true;
  if (req.method === 'GET' && pathname === STATUS_PATH) return true;
  if (req.method === 'POST' && /\\/batches\\/[^/]+(?:\\/books\\/[^/]+)?\\/production$/.test(pathname)) return true;
  if (req.method === 'GET' && /\\/batches\\/[^/]+\\/status$/.test(pathname)) return true;
  return false;
}
''',
    '''function needsPersonalConfigSync(req, pathname) {
  const provider = providerFromRequest(req);
  if (provider === LOCAL_PROVIDER || provider === AUTODL_PROVIDER) return false;
  if (isProviderConfigPath(pathname)) return true;
  if (req.method === 'GET' && pathname === STATUS_PATH) return true;
  if (req.method === 'POST' && /\\/batches\\/[^/]+(?:\\/books\\/[^/]+)?\\/production$/.test(pathname)) return true;
  return false;
}
'''
)
replace_once(
    'routes/batch-factory-v11.js',
    '''async function prepareProviderRequest(req, options, pathname) {
  const provider = providerFromRequest(req);
  if (provider === LOCAL_PROVIDER) return;
''',
    '''async function prepareProviderRequest(req, options, pathname) {
  const provider = providerFromRequest(req);
  if (provider === AUTODL_PROVIDER && isProviderConfigPath(pathname)) {
    const error = new Error('MiniMax H3 使用服务端环境变量配置，浏览器不能写入凭据');
    error.status = 400;
    error.code = 'H3_PROVIDER_CONFIG_SERVER_MANAGED';
    throw error;
  }
  if (provider === LOCAL_PROVIDER || provider === AUTODL_PROVIDER) return;
'''
)
replace_once(
    'routes/batch-factory-v11.js',
    '''  PERSONAL_PROVIDER,
  LOCAL_PROVIDER,
  normalizedProvider,''',
    '''  PERSONAL_PROVIDER,
  LOCAL_PROVIDER,
  AUTODL_PROVIDER,
  normalizedProvider,'''
)

# --- Node Script H3 route: server-side workflow selection + env-only credentials ---
replace_once(
    'routes/script-video.js',
    "const MAX_OPTIONAL_IMAGES = 3;\n",
    "const MAX_OPTIONAL_IMAGES = 3;\nconst H3_MODEL_KEY = 'minimax-h3';\nconst H3_TASK_PREFIX = 'h3:';\nconst H3_WORKFLOW_NO_PIC = 'minimax_h3_lightx2v_no_pic';\nconst H3_WORKFLOW_WITH_PIC = 'minimax_h3_lightx2v_v5_15s';\n"
)
replace_once(
    'routes/script-video.js',
    '''function resultURL(body) {
  const payload = payloadOf(body);
''',
    '''function h3WorkflowForImages(imageUrls) {
  return imageUrls.length ? H3_WORKFLOW_WITH_PIC : H3_WORKFLOW_NO_PIC;
}

function resultURL(body) {
  const payload = payloadOf(body);
'''
)
replace_once(
    'routes/script-video.js',
    '''function bridgeJSON(gateway, account, method, pathname, payload) {''',
    '''function h3ServerConfig() {
  const endpoint = String(process.env.QIANTIE_BATCH_FACTORY_V11_VIDEO_ENDPOINT || '').trim();
  const pollEndpoint = String(process.env.QIANTIE_BATCH_FACTORY_V11_VIDEO_POLL_ENDPOINT || '').trim();
  const apiKey = String(process.env.QIANTIE_BATCH_FACTORY_V11_VIDEO_API_KEY || '').trim();
  const model = String(process.env.QIANTIE_BATCH_FACTORY_V11_VIDEO_MODEL || '').trim();
  if (model !== H3_MODEL_KEY || !endpoint || !apiKey) return null;
  return { endpoint, pollEndpoint, apiKey };
}

function h3HTTPSRequest(rawURL, { method = 'GET', apiKey, payload } = {}) {
  let target;
  try { target = new URL(rawURL); } catch { throw Object.assign(new Error('MiniMax H3 服务地址无效'), { status: 503 }); }
  if (target.protocol !== 'https:') throw Object.assign(new Error('MiniMax H3 服务地址必须使用 HTTPS'), { status: 503 });
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const request = https.request(target, {
      method,
      timeout: method === 'POST' ? 120000 : 30000,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': String(body.length) } : {})
      }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ statusCode: response.statusCode || 500, text: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('MiniMax H3 服务响应超时')));
    request.on('error', () => reject(Object.assign(new Error('MiniMax H3 服务暂不可用'), { status: 503 })));
    if (body) request.write(body);
    request.end();
  });
}

async function defaultH3Submit({ prompt, imageUrls, workflow }) {
  const cfg = h3ServerConfig();
  if (!cfg) throw Object.assign(new Error('MiniMax H3 服务端尚未配置'), { status: 503, code: 'H3_SCRIPT_VIDEO_UNAVAILABLE' });
  const reply = await h3HTTPSRequest(cfg.endpoint, {
    method: 'POST', apiKey: cfg.apiKey,
    payload: { model: H3_MODEL_KEY, prompt, duration: 15, aspectRatio: '9:16', workflow, imageUrls }
  });
  if (reply.statusCode < 200 || reply.statusCode >= 300) throw Object.assign(new Error(`MiniMax H3 服务请求失败（HTTP ${reply.statusCode}）`), { status: 502 });
  let body;
  try { body = JSON.parse(reply.text || '{}'); } catch { throw Object.assign(new Error('MiniMax H3 服务返回了无法识别的响应'), { status: 502 }); }
  const providerTaskId = readTaskID(body);
  if (!providerTaskId) throw Object.assign(new Error('MiniMax H3 服务未返回任务 ID'), { status: 502 });
  return { providerTaskId, state: 'queued' };
}

async function defaultH3Poll({ providerTaskId }) {
  const cfg = h3ServerConfig();
  if (!cfg || !cfg.pollEndpoint) throw Object.assign(new Error('MiniMax H3 任务查询尚未配置'), { status: 503, code: 'H3_SCRIPT_VIDEO_UNAVAILABLE' });
  const target = cfg.pollEndpoint.replaceAll('{id}', encodeURIComponent(providerTaskId));
  const reply = await h3HTTPSRequest(target, { method: 'GET', apiKey: cfg.apiKey });
  if (reply.statusCode < 200 || reply.statusCode >= 300) throw Object.assign(new Error('MiniMax H3 任务状态查询失败'), { status: 502 });
  let body;
  try { body = JSON.parse(reply.text || '{}'); } catch { throw Object.assign(new Error('MiniMax H3 任务状态无法识别'), { status: 502 }); }
  const state = taskState(body).toLowerCase();
  return { providerTaskId, state, mediaUrl: resultURL(body), errorMessage: taskError(body) };
}

function bridgeJSON(gateway, account, method, pathname, payload) {'''
)
replace_once(
    'routes/script-video.js',
    '''function createScriptVideoRouter({ configReader = readConfig, submit = defaultSubmit, request = upstreamRequest, shuihuoGateway } = {}) {''',
    '''function createScriptVideoRouter({ configReader = readConfig, submit = defaultSubmit, request = upstreamRequest, shuihuoGateway, h3Submit = defaultH3Submit, h3Poll = defaultH3Poll } = {}) {'''
)
replace_once(
    'routes/script-video.js',
    '''    if (prompt.length > MAX_PROMPT_LENGTH) return res.status(400).json({ error: `分镜视频提示词不能超过 ${MAX_PROMPT_LENGTH} 个字符` });
    if (req.body?.modelKey === 'local-doubao-executor-video') {''',
    '''    if (prompt.length > MAX_PROMPT_LENGTH) return res.status(400).json({ error: `分镜视频提示词不能超过 ${MAX_PROMPT_LENGTH} 个字符` });
    const modelKey = String(req.body?.modelKey || '').trim();
    if (modelKey === H3_MODEL_KEY) {
      let imageUrls;
      try { imageUrls = validOptionalImageURLs(req.body?.imageUrls); } catch (error) { return res.status(400).json({ error: error.message || 'H3 参考图片参数不正确' }); }
      const workflow = h3WorkflowForImages(imageUrls);
      try {
        const ref = await h3Submit({ account: req.auth.account, modelKey: H3_MODEL_KEY, prompt, imageUrls, workflow });
        const providerTaskId = String(ref?.providerTaskId || ref?.provider_task_id || ref?.taskId || '').trim();
        if (!providerTaskId) return res.status(502).json({ error: 'MiniMax H3 服务未返回任务 ID' });
        return res.status(202).json({ ok: true, taskId: H3_TASK_PREFIX + providerTaskId, status: 'processing' });
      } catch (error) {
        return res.status(error?.status || 503).json({ error: error?.message || 'MiniMax H3 视频任务提交失败', ...(error?.code ? { code: error.code } : {}) });
      }
    }
    if (modelKey === 'local-doubao-executor-video' || modelKey === 'doubao-seedance') {'''
)
replace_once(
    'routes/script-video.js',
    '''    if (!taskId) return res.status(400).json({ error: '视频任务 ID 不能为空' });
    try {
      const local = await bridgeJSON''',
    '''    if (!taskId) return res.status(400).json({ error: '视频任务 ID 不能为空' });
    if (taskId.startsWith(H3_TASK_PREFIX)) {
      const providerTaskId = taskId.slice(H3_TASK_PREFIX.length).trim();
      if (!providerTaskId) return res.status(400).json({ error: 'MiniMax H3 任务 ID 不能为空' });
      try {
        const ref = await h3Poll({ account: req.auth.account, modelKey: H3_MODEL_KEY, providerTaskId });
        const state = String(ref?.state || '').trim().toLowerCase();
        if (['queued', 'submitted', 'running', 'pending', 'processing'].includes(state)) return res.json({ ok: true, taskId, status: 'processing' });
        if (['failed', 'error', 'cancelled', 'canceled'].includes(state)) return res.json({ ok: true, taskId, status: 'failed', error: String(ref?.errorMessage || 'MiniMax H3 视频生成失败') });
        if (['succeeded', 'success', 'completed', 'done'].includes(state)) {
          let mediaUrl = '';
          try { const parsed = new URL(String(ref?.mediaUrl || '').trim()); if (parsed.protocol === 'https:') mediaUrl = parsed.toString(); } catch { /* fail closed below */ }
          if (!mediaUrl) return res.status(502).json({ error: 'MiniMax H3 视频任务成功，但没有返回可播放的 HTTPS 结果 URL' });
          return res.json({ ok: true, taskId, status: 'succeeded', videoUrl: mediaUrl });
        }
        return res.json({ ok: true, taskId, status: 'processing' });
      } catch (error) {
        return res.status(error?.status || 503).json({ error: error?.message || 'MiniMax H3 任务状态查询失败', ...(error?.code ? { code: error.code } : {}) });
      }
    }
    try {
      const local = await bridgeJSON'''
)
replace_once(
    'routes/script-video.js',
    'module.exports = { createScriptVideoRouter, DEFAULT_FIRST_FRAME_URL, validOptionalImageURLs, readTaskID, taskState, resultURL };',
    'module.exports = { createScriptVideoRouter, DEFAULT_FIRST_FRAME_URL, H3_MODEL_KEY, h3WorkflowForImages, validOptionalImageURLs, readTaskID, taskState, resultURL };'
)

# --- Frontend shared APIs ---
replace_once(
    'frontend/src/shared/api/batchFactoryV11.js',
    '''export function getCapabilities() {
  return apiRequest(bf11Path('capabilities'));
}
''',
    '''export function getCapabilities() {
  return apiRequest(bf11Path('capabilities'));
}

export function getVideoModels() {
  return apiRequest(bf11Path('video-models'));
}
'''
)
replace_once(
    'frontend/src/shared/api/batchFactoryV11.js',
    "export function submitBookProduction(batchId, bookId, requestId, provider = 'personal_api') {\n  return apiRequest",
    "export function submitBookProduction(batchId, bookId, requestId, provider) {\n  if (!provider) throw new Error('视频提供方未保存');\n  return apiRequest"
)
replace_once(
    'frontend/src/shared/api/batchFactoryV11.js',
    "export function submitBatchProduction(batchId, requestId, provider = 'personal_api') {\n  return apiRequest",
    "export function submitBatchProduction(batchId, requestId, provider) {\n  if (!provider) throw new Error('视频提供方未保存');\n  return apiRequest"
)
replace_once(
    'frontend/src/shared/api/batchFactoryV11.js',
    '''export default {
  getCapabilities,''',
    '''export default {
  getCapabilities,
  getVideoModels,'''
)

replace_once('frontend/src/shared/api/scriptVideo.js', "import { apiRequest } from './client';", "import { apiRequest } from './client.js';")
replace_once(
    'frontend/src/shared/api/scriptVideo.js',
    '''export function createScriptVideo(payload) {
  return apiRequest('/api/script-video', { method: 'POST', body: JSON.stringify(payload) });
}
''',
    '''export async function listScriptVideoModels() {
  const result = await apiRequest('/api/batch-factory/v11/video-models');
  return Array.isArray(result?.videoModels) ? result.videoModels.map(model => ({
    id: String(model?.id || ''),
    label: String(model?.label || model?.id || ''),
    provider: String(model?.provider || ''),
    maxDuration: Number(model?.maxDuration || 0)
  })).filter(model => model.id && model.provider) : [];
}

export function createScriptVideo(payload) {
  const body = {
    prompt: payload?.prompt,
    modelKey: payload?.modelKey,
    imageUrls: Array.isArray(payload?.imageUrls) ? payload.imageUrls : []
  };
  return apiRequest('/api/script-video', { method: 'POST', body: JSON.stringify(body) });
}
'''
)

# --- V11 adapter: catalog + explicit provider only ---
insert = '''\nasync function loadVideoModelCatalog(api) {
  if (typeof api.getVideoModels !== 'function') return { videoModels: [], videoModelsError: null };
  try {
    const result = await api.getVideoModels();
    const videoModels = Array.isArray(result?.videoModels) ? result.videoModels.map(model => ({
      id: String(model?.id || ''), label: String(model?.label || model?.id || ''),
      provider: String(model?.provider || ''), maxDuration: Number(model?.maxDuration || 0)
    })).filter(model => model.id && model.provider) : [];
    return { videoModels, videoModelsError: null };
  } catch (error) {
    return { videoModels: [], videoModelsError: { status: Number(error?.status || 0), message: error?.message || '读取视频模型目录失败' } };
  }
}
'''
replace_once('frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.js', "const PERSONAL_PROMPT_CATEGORIES = ['prefix', 'quality', 'restriction', 'negative'];\n", "const PERSONAL_PROMPT_CATEGORIES = ['prefix', 'quality', 'restriction', 'negative'];\n" + insert)
replace_once(
    'frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.js',
    '''    doubaoLocal: { provider: 'doubao_local_executor', model: 'doubao-seedance', configured: false }
  };
  const statusRequests = [
    typeof api.getVideoProviderStatus === 'function' ? api.getVideoProviderStatus('personal_api') : Promise.resolve(null),
    typeof api.getVideoProviderStatus === 'function' ? api.getVideoProviderStatus('doubao_local_executor') : Promise.resolve(null),
    typeof api.listLocalExecutors === 'function' ? api.listLocalExecutors() : Promise.resolve({ executors: [] })
  ];
  const [personal, doubao, executors] = await Promise.all(statusRequests.map(request => Promise.resolve(request).catch(() => null)));
''',
    '''    doubaoLocal: { provider: 'doubao_local_executor', model: 'doubao-seedance', configured: false },
    h3Server: { provider: 'autodl_comfyui', model: 'minimax-h3', configured: false }
  };
  const statusRequests = [
    typeof api.getVideoProviderStatus === 'function' ? api.getVideoProviderStatus('personal_api') : Promise.resolve(null),
    typeof api.getVideoProviderStatus === 'function' ? api.getVideoProviderStatus('doubao_local_executor') : Promise.resolve(null),
    typeof api.getVideoProviderStatus === 'function' ? api.getVideoProviderStatus('autodl_comfyui') : Promise.resolve(null),
    typeof api.listLocalExecutors === 'function' ? api.listLocalExecutors() : Promise.resolve({ executors: [] })
  ];
  const [personal, doubao, h3, executors] = await Promise.all(statusRequests.map(request => Promise.resolve(request).catch(() => null)));
'''
)
replace_once(
    'frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.js',
    '''      doubaoLocal: doubao?.provider ? { ...empty.doubaoLocal, ...doubao } : empty.doubaoLocal
    },''',
    '''      doubaoLocal: doubao?.provider ? { ...empty.doubaoLocal, ...doubao } : empty.doubaoLocal,
      h3Server: h3?.provider ? { ...empty.h3Server, ...h3 } : empty.h3Server
    },'''
)
replace_once(
    'frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.js',
    '''      const [batchResult, configVersionState, videoProviderState] = await Promise.all([
        api.listBatches(),
        configVersionRequest,
        loadVideoProviderState(api)
      ]);''',
    '''      const [batchResult, configVersionState, videoProviderState, videoModelState] = await Promise.all([
        api.listBatches(),
        configVersionRequest,
        loadVideoProviderState(api),
        loadVideoModelCatalog(api)
      ]);'''
)
replace_once(
    'frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.js',
    '''        videoProviders: videoProviderState.videoProviders,
        localExecutors: videoProviderState.localExecutors,''',
    '''        videoProviders: videoProviderState.videoProviders,
        localExecutors: videoProviderState.localExecutors,
        videoModels: videoModelState.videoModels,
        videoModelsError: videoModelState.videoModelsError,'''
)
replace_once(
    'frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.js',
    '''    async runProduction({ batchId, bookId = '', requestId, provider = 'personal_api' } = {}) {
      if (!batchId || !requestId) throw new Error('V11 batch and request ids are required');
''',
    '''    async runProduction({ batchId, bookId = '', requestId, provider } = {}) {
      if (!batchId || !requestId) throw new Error('V11 batch and request ids are required');
      if (!provider) throw new Error('视频提供方 / provider 未保存，请先保存视频模型');
'''
)

# --- V11 settings drawer: catalog is authoritative, provider follows model ---
replace_once(
    'frontend/src/user/pages/batch-factory-v11/BatchFactoryV11SettingsDrawers.jsx',
    '''const VIDEO_PROVIDERS = [
  { value: 'personal_api', label: '个人中心 API · yd2.0-mini' },
  { value: 'doubao_local_executor', label: '豆包本地执行器' }
];

const VIDEO_MODELS = [
  { value: 'yd2.0-mini', label: '个人中心 API · yd2.0-mini · 最大 15s' },
  { value: 'doubao-seedance', label: '豆包本地执行器 · Seedance' },
  { value: 'seedance-pro', label: 'Seedance Video Pro · 最大 15s' },
  { value: 'seedance-fast', label: 'Seedance Video Fast · 最大 10s' },
  { value: 'video-model-c', label: 'Video Model C · 最大 12s' }
];
''',
    '''const PROVIDER_LABELS = {
  personal_api: '个人中心 API',
  doubao_local_executor: '豆包本地执行器',
  autodl_comfyui: 'MiniMax H3 · 服务端托管'
};
'''
)
replace_once(
    'frontend/src/user/pages/batch-factory-v11/BatchFactoryV11SettingsDrawers.jsx',
    '''  videoProviders = {},
  localExecutors = [],
  onCreateLocalExecutorPairing
}) {''',
    '''  videoProviders = {},
  localExecutors = [],
  videoModels = [],
  videoModelsError = null,
  onCreateLocalExecutorPairing
}) {'''
)
replace_once(
    'frontend/src/user/pages/batch-factory-v11/BatchFactoryV11SettingsDrawers.jsx',
    "    setForm({ videoProvider: 'personal_api', ...initialValue });",
    "    setForm({ ...initialValue });"
)
replace_once(
    'frontend/src/user/pages/batch-factory-v11/BatchFactoryV11SettingsDrawers.jsx',
    '''  const configOptions = useMemo(() => configVersionOptions(configVersions), [configVersions]);
''',
    '''  const configOptions = useMemo(() => configVersionOptions(configVersions), [configVersions]);
  const videoModelOptions = useMemo(() => (Array.isArray(videoModels) ? videoModels : []).map(model => ({
    value: model.id,
    provider: model.provider,
    label: `${model.label || model.id}${model.maxDuration ? ` · 最大 ${model.maxDuration}s` : ''}`
  })), [videoModels]);
  const videoProviderOptions = useMemo(() => {
    const seen = new Set();
    return videoModelOptions.filter(option => option.provider && !seen.has(option.provider) && seen.add(option.provider))
      .map(option => ({ value: option.provider, label: PROVIDER_LABELS[option.provider] || option.provider }));
  }, [videoModelOptions]);
'''
)
regex_once(
    'frontend/src/user/pages/batch-factory-v11/BatchFactoryV11SettingsDrawers.jsx',
    r'''        <SettingField label="视频生成通道".*?</SettingField>\n\n        <SettingField label="视频模型".*?</SettingField>''',
    '''        <SettingField label="视频生成通道" description="通道由统一视频模型目录约束；MiniMax H3 凭据只在服务端环境变量中读取。">
          <Space direction="vertical" style={full} size={8}>
            <Select
              placeholder="先选择服务端视频通道"
              value={form.videoProvider || undefined}
              onChange={videoProvider => {
                const firstModel = videoModelOptions.find(option => option.provider === videoProvider);
                patch({ videoProvider, videoModelId: firstModel?.value || '' });
              }}
              options={videoProviderOptions}
              disabled={!videoProviderOptions.length}
              style={full}
            />
            <Space wrap>
              <Tag color={videoProviders.personalAPI?.configured ? 'green' : 'default'}>个人 API {videoProviders.personalAPI?.configured ? '已配置' : '未配置'}</Tag>
              <Tag color={localExecutors.some(item => item.online) ? 'green' : 'default'}>豆包执行器 {localExecutors.some(item => item.online) ? '在线' : '未在线'}</Tag>
              <Tag color={videoProviders.h3Server?.configured ? 'green' : 'default'}>MiniMax H3 {videoProviders.h3Server?.configured ? '服务端已配置' : '服务端未配置'}</Tag>
            </Space>
            {form.videoProvider === 'doubao_local_executor' ? <div className="bf11-provider-pairing">
              <Button size="small" loading={pairingBusy} disabled={!onCreateLocalExecutorPairing} onClick={createPairing}>生成豆包配对码</Button>
              {pairingSecret?.code ? <Typography.Text copyable={{ text: pairingSecret.code }}>配对码：{pairingSecret.code}（10 分钟内有效）</Typography.Text> : null}
              {pairingSecret?.error ? <Typography.Text type="danger">{pairingSecret.error}</Typography.Text> : null}
              <Typography.Text type="secondary">在你的 Mac 执行器中输入配对码并保持豆包账号已登录；本页面不会保存或读取豆包密码。</Typography.Text>
            </div> : null}
          </Space>
        </SettingField>

        <SettingField label="视频模型" description="统一目录由 V11 服务端返回；选择模型时会同时绑定正确 provider。">
          <Space direction="vertical" style={full} size={6}>
            <Select
              allowClear
              placeholder={videoModelsError ? '视频模型目录读取失败' : '选择视频模型'}
              value={form.videoModelId || undefined}
              onChange={videoModelId => {
                const selected = videoModelOptions.find(option => option.value === videoModelId);
                patch({ videoModelId, videoProvider: selected?.provider || '' });
              }}
              options={videoModelOptions.filter(option => !form.videoProvider || option.provider === form.videoProvider)}
              disabled={Boolean(videoModelsError) || !videoModelOptions.length}
              style={full}
            />
            {videoModelsError ? <Typography.Text type="danger">{videoModelsError.message || '视频模型目录不可用'}；不会回退到个人 API。</Typography.Text> : null}
            {form.videoModelId === 'minimax-h3' ? <Typography.Text type="secondary">MiniMax H3 会自动判断：无有效参考图使用文生视频，有有效参考图使用图生视频；无需手动选择模式。</Typography.Text> : null}
          </Space>
        </SettingField>'''
)

# --- V11 page: saved model/provider are mandatory; no personal fallback ---
replace_once(
    'frontend/src/user/pages/batch-factory-v11/BatchFactoryV11UiPage.jsx',
    '''    const provider = batchSettingsState.patch.videoProvider || 'personal_api';
    if (provider === 'doubao_local_executor' && !runtimeState.localExecutors.some(item => item.online)) {''',
    '''    const provider = String(batchSettingsState.patch.videoProvider || '').trim();
    const videoModelId = String(batchSettingsState.patch.videoModelId || '').trim();
    if (!provider || !videoModelId) {
      message.error('当前批次尚未保存视频模型，请先打开生产统一设置并保存。');
      return false;
    }
    const selectedModel = (runtimeState.videoModels || []).find(model => model.id === videoModelId);
    if (!selectedModel || selectedModel.provider !== provider) {
      message.error('当前批次的视频模型与 provider 不一致，请重新保存生产统一设置。');
      return false;
    }
    if (provider === 'autodl_comfyui' && runtimeState.videoProviders?.h3Server?.configured === false) {
      message.error('MiniMax H3 服务端尚未配置，任务不会回退到个人 API。');
      return false;
    }
    if (provider === 'doubao_local_executor' && !runtimeState.localExecutors.some(item => item.online)) {'''
)
replace_once(
    'frontend/src/user/pages/batch-factory-v11/BatchFactoryV11UiPage.jsx',
    '''        videoProviders={runtimeState.videoProviders || {}}
        localExecutors={runtimeState.localExecutors || []}
''',
    '''        videoProviders={runtimeState.videoProviders || {}}
        localExecutors={runtimeState.localExecutors || []}
        videoModels={runtimeState.videoModels || []}
        videoModelsError={runtimeState.videoModelsError || null}
'''
)

# --- Script page: unified catalog drives dropdown; no hardcoded H3 mode ---
replace_once(
    'frontend/src/user/pages/ScriptPage.jsx',
    "import { createScriptVideo, getScriptVideoTask } from '../../shared/api/scriptVideo';",
    "import { createScriptVideo, getScriptVideoTask, listScriptVideoModels } from '../../shared/api/scriptVideo.js';"
)
replace_once(
    'frontend/src/user/pages/ScriptPage.jsx',
    '''  const [scriptVideoModelKey, setScriptVideoModelKey] = useState('yd2-mini-video');
  const [previewVideoTask, setPreviewVideoTask] = useState(null);''',
    '''  const [scriptVideoModelKey, setScriptVideoModelKey] = useState('');
  const [scriptVideoModels, setScriptVideoModels] = useState([]);
  const [scriptVideoModelsError, setScriptVideoModelsError] = useState('');
  const [previewVideoTask, setPreviewVideoTask] = useState(null);'''
)
replace_once(
    'frontend/src/user/pages/ScriptPage.jsx',
    '''  const [currentHistoryId, setCurrentHistoryId] = useState('');
''',
    '''  const [currentHistoryId, setCurrentHistoryId] = useState('');

  useEffect(() => {
    let cancelled = false;
    listScriptVideoModels().then(models => {
      if (cancelled) return;
      setScriptVideoModels(models);
      setScriptVideoModelsError('');
      setScriptVideoModelKey(current => models.some(model => model.id === current) ? current : (models[0]?.id || ''));
    }).catch(error => {
      if (cancelled) return;
      setScriptVideoModels([]);
      setScriptVideoModelKey('');
      setScriptVideoModelsError(error?.message || '视频模型目录读取失败');
    });
    return () => { cancelled = true; };
  }, []);
'''
)
replace_once(
    'frontend/src/user/pages/ScriptPage.jsx',
    '''    if (!prompt) return message.warning('该分镜没有可生成的视频提示词');
    if (scriptVideoModelKey === 'local-doubao-executor-video') {''',
    '''    if (!prompt) return message.warning('该分镜没有可生成的视频提示词');
    if (!scriptVideoModelKey) return message.error(scriptVideoModelsError || '视频模型目录不可用，请稍后重试');
    if (scriptVideoModelKey === 'local-doubao-executor-video' || scriptVideoModelKey === 'doubao-seedance') {'''
)
replace_once(
    'frontend/src/user/pages/ScriptPage.jsx',
    'const result = await createScriptVideo({ prompt, modelKey: scriptVideoModelKey });',
    'const result = await createScriptVideo({ prompt, modelKey: scriptVideoModelKey, imageUrls: [] });'
)
replace_once(
    'frontend/src/user/pages/ScriptPage.jsx',
    '''            options={[{ label: 'YD2.0 Mini（图生）', value: 'yd2-mini-video' }, { label: '本地豆包执行器', value: 'local-doubao-executor-video' }]}
            title="单分镜视频模型"
''',
    '''            options={scriptVideoModels.map(model => ({ label: `${model.label}${model.maxDuration ? ` · 最大 ${model.maxDuration}s` : ''}`, value: model.id }))}
            loading={!scriptVideoModels.length && !scriptVideoModelsError}
            disabled={!scriptVideoModels.length}
            title={scriptVideoModelsError || '单分镜视频模型；MiniMax H3 自动判断文生/图生'}
'''
)

print('H3_MINIMAL_PATCH_APPLIED')
