# 小说获取 AI 处理（诱导排查 / 爆款优化）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「小说获取」页结果列表为已获取成功的书籍新增「诱导排查 / 爆款优化」AI 处理：单选或批量选择后，通过后端复用模型配置逐本调用 AI，弹窗展示合规报告/优化说明与优化后全文，支持复制、单下载与全下载。

**Architecture:** 后端在现有 `routes/novel-fetch.js` 工厂内新增 `POST /process`（可注入 `processWithAI` 与 `presetStore`），从 `novel-fetch` 预设读取处理提示词，复用 `readConfig → ensureReadyConfig → requestUpstream` 逐本调用；前端 `NovelFetchPage` 在工具栏与每行增加处理入口，结果弹窗展示并支持下载。预设通过管理后台新增「小说获取」模块维护，并由系统种子预置两条已发布预设。

**Tech Stack:** Node.js + Express（后端）、React + Ant Design + lucide-react（前端）、node:test（测试）。

## Global Constraints

- 处理模式：`mode` 必须为 `induce`（诱导排查）或 `hook`（爆款优化）。
- 预设 id：`induce` → `novel-fetch-induce`，`hook` → `novel-fetch-hook`；须满足 `module === 'novel-fetch'` 且 `protocolLock.format === 'novel-fetch-process'` 且 `protocolLock.operation` 与 mode 一致。
- `items` 非空数组、上限 50；每项 `bookId` 为 1–20 位数字字符串；单本 `text` 截断上限 120000 字符。
- `publicPreset` 为 `novel-fetch-process` 新增暴露字段 `processOperation`（值为 `protocolLock.operation`）。
- 管理后台模块列表新增 `{ label: '小说获取', value: 'novel-fetch' }`。
- 界面文案与代码注释使用中文。
- 测试命令：`node --test tests/`；前端构建：`npm --prefix frontend run build`。
- 工作目录：`F:\脚本测试\chengming\qiantie`（主工作区，分支 `feature/script-production-workbench`）。

---

### Task 1: 后端小说获取 AI 处理路由

**Files:**
- Modify: `routes/novel-fetch.js`
- Test: `tests/novel-fetch-process-routes.test.js`

**Interfaces:**
- Consumes: `../middleware/auth` 的 `apiAuth`（已存在）；`../lib/shared` 的 `readConfig, ensureReadyConfig, requestUpstream, collectResponse`（已存在，参考 `routes/chat.js` 用法）。
- Produces: `createNovelFetchRouter({ fetchUpstream, auth, presetStore, processWithAI })` 新增 `POST /process`。请求体 `{ mode, items: [{ bookId, text }] }`；响应 `{ results: [{ bookId, status: 'ok'|'error', text, report, error }] }`。默认 `processWithAI(username, systemPrompt, novelText)` 走真实模型。

- [ ] **Step 1: 写失败测试**

创建 `tests/novel-fetch-process-routes.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createNovelFetchRouter } = require('../routes/novel-fetch');

function request(app, { method = 'POST', requestPath, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = JSON.stringify(body);
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: requestPath,
        method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          server.close(() => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null });
          });
        });
      });
      req.once('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

function preset(id, operation) {
  return { id, module: 'novel-fetch', name: id === 'novel-fetch-induce' ? '诱导排查' : '爆款优化', kind: 'base', description: '', compatibleBaseIds: [], body: `提示词 ${operation}`, protocolLock: { format: 'novel-fetch-process', operation } };
}

function makeApp(overrides = {}) {
  const store = { getPublished: id => overrides.missingPreset ? null : (id === 'novel-fetch-induce' ? preset(id, 'induce') : preset(id, 'hook')) };
  const processWithAI = overrides.processWithAI || (async (username, systemPrompt, novelText) => `已处理：${systemPrompt}|${novelText.slice(0, 10)}`);
  return express()
    .use(express.json())
    .use('/api/novel-fetch', createNovelFetchRouter({
      presetStore: store,
      processWithAI,
      auth: (req, res, next) => { req.username = 'tester'; next(); }
    }));
}

test('process proxies per book with mode preset', async () => {
  const calls = [];
  const processWithAI = async (username, systemPrompt, novelText) => {
    calls.push({ username, systemPrompt, novelText });
    if (novelText.includes('FAIL')) throw new Error('模型返回错误');
    return '优化后文本';
  };
  const result = await request(makeApp({ processWithAI }), {
    requestPath: '/api/novel-fetch/process',
    body: { mode: 'induce', items: [{ bookId: '1', text: '正文A' }, { bookId: '2', text: 'FAIL' }] }
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.results.length, 2);
  assert.equal(result.body.results[0].status, 'ok');
  assert.equal(result.body.results[0].text, '优化后文本');
  assert.equal(result.body.results[1].status, 'error');
  assert.match(result.body.results[1].error, /模型返回错误/);
  assert.ok(calls[0].systemPrompt.includes('提示词 induce'));
  assert.equal(calls[0].username, 'tester');
});

test('process rejects invalid input', async () => {
  const cases = [
    { mode: 'other', items: [{ bookId: '1', text: 'x' }] },
    { mode: 'induce', items: [] },
    { mode: 'induce', items: [{ bookId: 'abc', text: 'x' }] },
    { mode: 'induce', items: [{ bookId: '1', text: '' }] },
    { mode: 'induce', items: Array.from({ length: 51 }, (_, i) => ({ bookId: String(i), text: 'x' })) }
  ];
  for (const body of cases) {
    const result = await request(makeApp(), { requestPath: '/api/novel-fetch/process', body });
    assert.equal(result.status, 400, JSON.stringify(body));
  }
});

test('process fails when processing preset is unpublished', async () => {
  const result = await request(makeApp({ missingPreset: true }), {
    requestPath: '/api/novel-fetch/process',
    body: { mode: 'induce', items: [{ bookId: '1', text: 'x' }] }
  });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /未发布该处理预设/);
});

test('process truncates long novel text to 120000 chars', async () => {
  let received = '';
  const processWithAI = async (username, systemPrompt, novelText) => { received = novelText; return 'ok'; };
  await request(makeApp({ processWithAI }), {
    requestPath: '/api/novel-fetch/process',
    body: { mode: 'hook', items: [{ bookId: '1', text: '长'.repeat(130000) }] }
  });
  assert.equal(received.length, 120000);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/novel-fetch-process-routes.test.js`
Expected: FAIL — `createNovelFetchRouter(...)` 无 `POST /process`，返回 404，或 `processWithAI`/`presetStore` 未接线。

- [ ] **Step 3: 最小实现**

在 `routes/novel-fetch.js` 顶部引入依赖：

```js
const { apiAuth } = require('../middleware/auth');
const { readConfig, ensureReadyConfig, requestUpstream, collectResponse } = require('../lib/shared');
```

在 `createNovelFetchRouter` 工厂签名中追加参数并新增默认 `processWithAI`，随后注册 `POST /process`：

```js
const PROCESS_PRESET_IDS = { induce: 'novel-fetch-induce', hook: 'novel-fetch-hook' };
const PROCESS_TEXT_LIMIT = 120000;
const MAX_PROCESS_ITEMS = 50;

function isProcessMode(value) {
  return Object.hasOwn(PROCESS_PRESET_IDS, value);
}

async function defaultProcessWithAI(username, systemPrompt, novelText) {
  const config = readConfig(username);
  ensureReadyConfig(config);
  const payload = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: novelText }
    ],
    max_tokens: 4096,
    temperature: 0.4
  };
  const data = await requestUpstream(config, payload, collectResponse, { timeoutMs: 120000 });
  return typeof data === 'string' ? data : '';
}

function createNovelFetchRouter({ fetchUpstream: customFetch, auth = apiAuth, presetStore, processWithAI } = {}) {
  const fetchOne = customFetch || fetchUpstream;
  const processOne = processWithAI || defaultProcessWithAI;
  const router = express.Router();
  router.use(auth);

  // ……（保留现有 POST / 抓取逻辑不动）……

  router.post('/process', async (req, res) => {
    try {
      const { mode, items } = req.body || {};
      if (!isProcessMode(mode)) return res.status(400).json({ error: '无效的处理类型' });
      if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: '请选择要处理的书籍' });
      if (items.length > MAX_PROCESS_ITEMS) return res.status(400).json({ error: `一次最多处理 ${MAX_PROCESS_ITEMS} 本` });
      const normalized = [];
      for (const item of items) {
        const bookId = String(item && item.bookId || '').trim();
        const text = String(item && item.text || '');
        if (!isValidBookId(bookId)) return res.status(400).json({ error: `书籍 ID 格式不正确：${bookId}` });
        if (!text) return res.status(400).json({ error: `书籍 ${bookId} 缺少正文` });
        normalized.push({ bookId, text: text.slice(0, PROCESS_TEXT_LIMIT) });
      }
      const presetId = PROCESS_PRESET_IDS[mode];
      const preset = presetStore && presetStore.getPublished(presetId);
      if (!preset || preset.module !== 'novel-fetch' || preset.protocolLock?.format !== 'novel-fetch-process' || preset.protocolLock?.operation !== mode) {
        return res.status(400).json({ error: '未发布该处理预设' });
      }
      const results = await Promise.all(normalized.map(async ({ bookId, text }) => {
        try {
          const processed = await processOne(req.username, preset.body, text);
          const { report, rest } = splitReportAndText(processed);
          return { bookId, status: 'ok', text: rest, report, error: null };
        } catch (error) {
          return { bookId, status: 'error', text: null, report: null, error: error.message || '处理失败' };
        }
      }));
      return res.json({ results });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  return router;
}
```

其中 `splitReportAndText` 用于把 AI 返回的“报告 + 优化后全文”拆成两部分：

```js
function splitReportAndText(content) {
  const text = String(content || '');
  const reportMarkers = ['### 一、合规检测报告', '### 一、优化说明', '## 合规检测报告', '## 优化说明', '一、合规检测报告', '一、优化说明'];
  const marker = reportMarkers.find(m => text.includes(m));
  if (!marker) return { report: '', rest: text };
  const index = text.indexOf(marker);
  const secondSection = text.indexOf('### 二、优化后全文', index);
  if (secondSection === -1) return { report: text.slice(0, index).trim(), rest: text.slice(index).trim() };
  return { report: text.slice(0, secondSection).trim(), rest: text.slice(secondSection + '### 二、优化后全文'.length).trim() };
}
```

导出保持不变：`module.exports = { createNovelFetchRouter, PLATFORMS }`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/novel-fetch-process-routes.test.js`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 提交**

```bash
git add routes/novel-fetch.js tests/novel-fetch-process-routes.test.js
git commit -m "feat: add novel fetch AI process route"
```

---

### Task 2: 系统预设种子、processOperation 暴露与管理后台模块

**Files:**
- Modify: `lib/system-preset-catalog.js`
- Modify: `lib/preset-store.js`（`publicPreset`）
- Modify: `frontend/src/admin/pages/PresetLibraryPage.jsx`
- Modify: `app.js`（注入 `presetStore` 到 `createNovelFetchRouter`）
- Test: `tests/novel-fetch-process-preset-contract.test.js`

**Interfaces:**
- Consumes: Task 1 预设 id `novel-fetch-induce` / `novel-fetch-hook`；`presetStore.getPublished` 返回含 `body`、`module`、`protocolLock` 的对象。
- Produces: 系统种子新增两条已发布预设；`publicPreset` 新增字段 `processOperation`；管理后台 `modules` 新增 `novel-fetch`；`app.js` 的 `createNovelFetchRouter` 注入 `presetStore: resolvedPresetStore`。前端可调用 `GET /api/presets?module=novel-fetch` 获得含 `id`、`name`、`processOperation` 的目录。

- [ ] **Step 1: 写失败契约测试**

创建 `tests/novel-fetch-process-preset-contract.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('system preset catalog seeds novel-fetch process presets', () => {
  const catalog = read('lib/system-preset-catalog.js');
  assert.match(catalog, /id: 'novel-fetch-induce'/);
  assert.match(catalog, /operation: 'induce'/);
  assert.match(catalog, /id: 'novel-fetch-hook'/);
  assert.match(catalog, /operation: 'hook'/);
  assert.match(catalog, /format: 'novel-fetch-process'/);
});

test('publicPreset exposes processOperation for novel-fetch-process', () => {
  const store = read('lib/preset-store.js');
  assert.match(store, /protocolLock\?\.format === 'novel-fetch-process'/);
  assert.match(store, /processOperation: preset\.protocolLock\.operation/);
});

test('admin preset library includes novel-fetch module', () => {
  const page = read('frontend/src/admin/pages/PresetLibraryPage.jsx');
  assert.match(page, /label: '小说获取'/);
  assert.match(page, /value: 'novel-fetch'/);
});

test('app wires novel-fetch router with presetStore', () => {
  const app = read('app.js');
  assert.match(app, /createNovelFetchRouter\(\{ presetStore: resolvedPresetStore \}\)/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/novel-fetch-process-preset-contract.test.js`
Expected: FAIL（三处断言均不匹配）。

- [ ] **Step 3: 最小实现**

**3a. `lib/system-preset-catalog.js`：** 在 `NOVEL_PRESETS` 之后新增 `NOVEL_FETCH_PRESETS`，并加入 `SYSTEM_PRESETS`：

```js
const INDUCE_PRESET_BODY = `# 小说内容合规检测与柔化优化提示词

## 角色设定
你是一名专业的网文内容合规审核师与文本优化师，精通网络文学平台的内容审核标准。你的核心职责是：对用户上传的小说原文进行违规风险检测，在**最大程度保留原文剧情、人物设定、叙事风格和语句结构**的前提下，仅对敏感词、擦边描写、低俗表述进行最小幅度的替换与柔化处理，绝不擅自改动原文的情节走向和核心表达。

## 核心工作原则
1. **最小改动原则**：能替换单个词语就不改动整句，能改写单句就不调整段落，非必要不增删原文情节与对话。
2. **谐音优先原则**：对于轻度脏话、辱骂类词汇，优先采用同音/近音谐音字替换，保留原句语气与人物性格，例如“贱人”替换为“剑人”、“傻逼”替换为“傻哔”等。
3. **擦边柔化原则**：对于低俗身体描写、露骨性暗示等擦边内容，采用委婉化、留白化处理，用概括性描述替代具象低俗描写，保留场景上下文的叙事逻辑。
4. **分级处理原则**：根据违规程度分为三级处理，不同级别采用不同优化策略。

## 分级处理细则
### 一级：轻度敏感（谐音替换即可）
适用场景：日常脏话、辱骂性口语、轻微不雅词汇
处理方式：直接谐音替换，不改变句式和语气
- 辱骂类：贱人→剑人，傻逼→傻哔，操→艹，他妈→特么，婊子→表子
- 粗俗口语：靠→靠（保留）/ 艹，屌→吊，逼→哔
- 规则：所有替换严格遵循同音原则，确保读者一眼能理解原意，同时规避平台关键词拦截

### 二级：中度擦边（委婉改写，保留情节）
适用场景：直白的身体部位描写、性暗示动作、露骨挑逗对话
处理方式：替换具象低俗词汇为中性/文雅表述，删减过度细节，保留场景与人物互动逻辑
- 身体描写类：
  - “露出大奶子” → “露出大片雪白肌肤” / “领口滑下露出肩头”
  - “丰满的胸部” → “起伏的胸口” / “窈窕的身段”
  - “大腿根部” → “腿侧” / “裙摆下的肌肤”
- 动作暗示类：
  - 直白抚摸描写 → 简化为“指尖划过”、“轻轻触碰”
  - 露骨对话 → 改为语意含糊的挑逗、点到为止的对白
- 规则：必须保留原场景的功能（如调情、羞辱、亲密互动等），只剥离低俗具象的形容词，不改变人物关系和剧情推进。

### 三级：重度违规（整段重构或删除）
适用场景：直接性描写、极端暴力血腥、违法违规情节
处理方式：整段概括化改写，用侧写、留白、时间跳转等方式跳过违规片段，确保前后文衔接自然
- 规则：若原文存在明确违法违规、平台零容忍内容，必须标注并给出重构方案；无法通过柔化规避的，明确告知风险。

## 输出格式要求
请严格按照以下结构输出结果：

### 一、合规检测报告
1. **整体风险等级**：低风险 / 中风险 / 高风险
2. **违规点统计**：共检测出 X 处敏感内容，其中一级 X 处，二级 X 处，三级 X 处
3. **主要问题类型**：（如：低俗辱骂词汇、身体描写擦边、暴力描写等）

### 二、优化后全文
（直接输出完整的优化后小说文本，修改处无需单独标注，确保文本流畅可读，可直接复制使用）

### 三、关键修改说明（可选）
若存在二级及以上修改，列出主要修改位置及修改思路，便于你确认是否符合预期。

## 执行指令
现在，请接收我上传的小说原文，严格按照以上规则进行检测与优化。处理过程中如有多处同类敏感词，统一按对应规则批量替换，确保全文风格以及排版一致。务必保证修改后的小说读起来自然流畅，没有生硬的修改痕迹，最大程度还原原作的叙事节奏与人物口吻。`;

const HOOK_PRESET_BODY = `# 小说爆款优化提示词

## 角色设定
你是一名资深短剧/网文爆款策划与文本优化师，精通下沉市场短视频平台和网络文学的高留存叙事手法。你的核心职责是：在**最大程度保留原文剧情、人物设定、叙事风格和核心情节**的前提下，对小说原文做爆款化优化，让开头更抓人、节奏更紧凑、卡点更清晰、情绪与爽点更密集，同时保持全文自然流畅、可直接阅读和后续制作使用。

## 核心工作原则
1. **忠实原文**：禁止改变人物关系、核心动机、剧情走向和结局；禁止凭空新增关键角色、关键道具或剧情结果。
2. **开头抓人**：把最强烈的情绪冲突、信息悬念或身份反差前置到开头三句以内，快速建立“非看不可”的期待。
3. **节奏紧凑**：删减冗长的环境铺陈和无关细节，缩短铺垫，加快事件推进；对话尽量短促有力，一句顶三句。
4. **卡点清晰**：自然段结尾或事件转折处制造悬念、反转或情绪峰值，便于后续拆分为短视频单元。
5. **爽点密集**：强化打脸、反转、反差、身份揭露、误会引爆等高能节点，保留人物个性与台词口吻，不写成机械模板。

## 优化方向（按需执行）
- 开篇：3 秒内给出冲突/悬念/反差钩子，并自然衔接原文起点。
- 段落：合并碎句、精简描写，每段承载一个明确信息或情绪。
- 对话：精炼台词，突出人物性格，避免冗余客套。
- 情绪：放大可见的情绪张力（表情、动作、语气），让读者“上瘾”。
- 结尾：每段制造小型卡点，为持续阅读和分镜制作留足抓手。

## 输出格式要求
### 一、优化说明
用 2-4 句话说明本次优化的核心手段（如：开头钩子前置、压缩铺垫、加强卡点、强化打脸节点），以及主要改动位置。

### 二、优化后全文
直接输出完整优化后的小说文本，无需标注修改处，确保流畅可读、可直接复制使用。

## 执行指令
现在，请接收用户上传的小说原文，按以上规则进行爆款化优化。务必保证改动后读起来自然、节奏明快、情绪饱满，最大程度还原原作人物口吻与叙事逻辑。`;

const NOVEL_FETCH_PRESETS = [
  {
    id: 'novel-fetch-induce',
    module: 'novel-fetch',
    name: '诱导排查',
    description: '小说合规检测与柔化优化规则',
    body: INDUCE_PRESET_BODY,
    protocolLock: { format: 'novel-fetch-process', operation: 'induce' }
  },
  {
    id: 'novel-fetch-hook',
    module: 'novel-fetch',
    name: '爆款优化',
    description: '小说爆款化文本优化规则',
    body: HOOK_PRESET_BODY,
    protocolLock: { format: 'novel-fetch-process', operation: 'hook' }
  }
];
```

将 `SYSTEM_PRESETS` 的组合改为：

```js
const SYSTEM_PRESETS = Object.freeze([
  ...SCRIPT_PRESETS.map(item => ({ ...item, body: fs.readFileSync(path.join(promptsDir, item.source), 'utf8'), protocolLock: { ...item.protocolLock, source: item.source } })),
  ...SCRIPT_CONSTRAINT_PRESETS,
  ...NOVEL_PRESETS,
  ...NOVEL_FETCH_PRESETS
].map(item => Object.freeze({
  ...item,
  kind: item.kind || 'base',
  compatibleBaseIds: item.compatibleBaseIds || []
})));
```

**3b. `lib/preset-store.js`（`publicPreset`）：** 在 `extractionPreset` 行后追加：

```js
    ...(preset.protocolLock?.format === 'novel-fetch-process' ? { processOperation: preset.protocolLock.operation } : {})
```

**3c. `frontend/src/admin/pages/PresetLibraryPage.jsx`：** `modules` 数组追加：

```js
  { label: '小说获取', value: 'novel-fetch' }
```

**3d. `app.js`：** 将第 125 行的挂载改为注入预设存储（`resolvedPresetStore` 在本文件第 55 行已定义于 `app.locals.presetStore`）：

```js
  app.use('/api/novel-fetch', createNovelFetchRouter({ presetStore: resolvedPresetStore }));
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/novel-fetch-process-preset-contract.test.js`
Expected: PASS。同时跑 `node --test tests/` 确认无既有回归。

- [ ] **Step 5: 提交**

```bash
git add lib/system-preset-catalog.js lib/preset-store.js frontend/src/admin/pages/PresetLibraryPage.jsx tests/novel-fetch-process-preset-contract.test.js
git commit -m "feat: add novel fetch process presets and module"
```

---

### Task 3: 前端 API 与小说获取页交互

**Files:**
- Modify: `frontend/src/shared/api/novelFetch.js`
- Modify: `frontend/src/user/pages/NovelFetchPage.jsx`
- Test: `tests/novel-fetch-process-ui-contract.test.js`

**Interfaces:**
- Consumes: Task 1 的 `POST /api/novel-fetch/process`；Task 2 的 `GET /api/presets?module=novel-fetch`（返回含 `processOperation`、`name`）。
- Produces: `fetchNovelContent`（已存在）；新增 `listNovelFetchProcessPresets()` 与 `processNovelContent({ mode, items })`；页面新增处理类型下拉、单本/批量处理按钮、结果弹窗（报告+全文+复制/单下载/全下载）。

- [ ] **Step 1: 写失败契约测试**

创建 `tests/novel-fetch-process-ui-contract.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('novel fetch api exposes process helpers', () => {
  const api = read('frontend/src/shared/api/novelFetch.js');
  assert.match(api, /listNovelFetchProcessPresets/);
  assert.match(api, /\/api\/presets\?module=novel-fetch/);
  assert.match(api, /processNovelContent/);
  assert.match(api, /\/api\/novel-fetch\/process/);
});

test('novel fetch page renders process controls and results dialog', () => {
  const page = read('frontend/src/user/pages/NovelFetchPage.jsx');
  assert.match(page, /诱导排查/);
  assert.match(page, /爆款优化/);
  assert.match(page, /listNovelFetchProcessPresets/);
  assert.match(page, /processNovelContent/);
  assert.match(page, /AI 处理/);
  assert.match(page, /processModal|resultDialog/);
  assert.match(page, /全选下载/);
  assert.match(page, /processOperation/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/novel-fetch-process-ui-contract.test.js`
Expected: FAIL（断言均不匹配）。

- [ ] **Step 3: 最小实现**

**3a. `frontend/src/shared/api/novelFetch.js`** 追加：

```js
export function listNovelFetchProcessPresets() {
  return apiRequest('/api/presets?module=novel-fetch');
}

export function processNovelContent({ mode, items }) {
  return apiRequest('/api/novel-fetch/process', {
    method: 'POST',
    body: JSON.stringify({ mode, items })
  });
}
```

**3b. `frontend/src/user/pages/NovelFetchPage.jsx`**：

- 顶部 import 追加 `lucide-react` 的 `Wand2`、`Check`，以及 API 函数：

```js
import { processNovelContent, listNovelFetchProcessPresets } from '../../shared/api/novelFetch';
```

- 组件内新增状态：

```js
const [processPresets, setProcessPresets] = useState([]);
const [processMode, setProcessMode] = useState('');
const [processing, setProcessing] = useState(false);
const [processDialog, setProcessDialog] = useState(null); // { mode, results: [{bookId, status, report, text, error}] }
```

- 新增预设加载 effect（进入页面即读取）：

```js
useEffect(() => {
  let active = true;
  listNovelFetchProcessPresets()
    .then(data => {
      if (!active) return;
      const available = (data && data.catalog || []).filter(item => item.processOperation === 'induce' || item.processOperation === 'hook');
      const options = available.map(item => ({ value: item.processOperation, label: item.name }));
      setProcessPresets(options);
      if (options.length > 0) setProcessMode(options[0].value);
    })
    .catch(() => {});
  return () => { active = false; };
}, []);
```

- 处理逻辑（单本与批量共用）：

```js
async function handleProcess() {
  const chosen = okRows().filter(row => selected.includes(row.bookId));
  if (chosen.length === 0) { message.warning('请先选择要处理的书籍'); return; }
  if (!processMode) { message.warning('暂无可用的处理类型'); return; }
  setProcessing(true);
  try {
    const data = await processNovelContent({
      mode: processMode,
      items: chosen.map(row => ({ bookId: row.bookId, text: row.data }))
    });
    const results = data.results || [];
    setRows(current => current.map(row => {
      const result = results.find(item => item.bookId === row.bookId);
      return result ? { ...row, induced: result.status === 'ok' ? { mode: processMode, report: result.report, text: result.text } : null, processError: result.status === 'ok' ? null : result.error } : row;
    }));
    setProcessDialog({ mode: processMode, results });
    const failed = results.filter(item => item.status === 'error').length;
    if (failed) message.error(`${failed} 本处理失败`);
    else message.success('处理完成');
  } catch (error) {
    message.error(error.message || '处理失败');
  } finally {
    setProcessing(false);
  }
}

async function handleProcessOne(row) {
  if (!processMode) { message.warning('暂无可用的处理类型'); return; }
  if (row.induced && row.induced.mode === processMode) {
    setProcessDialog({ mode: processMode, results: [{ bookId: row.bookId, status: 'ok', text: row.induced.text, report: row.induced.report, error: null }] });
    return;
  }
  setProcessing(true);
  try {
    const data = await processNovelContent({ mode: processMode, items: [{ bookId: row.bookId, text: row.data }] });
    const result = (data.results || [])[0];
    setRows(current => current.map(item => item.bookId === row.bookId
      ? { ...item, induced: result && result.status === 'ok' ? { mode: processMode, report: result.report, text: result.text } : null, processError: result && result.status === 'ok' ? null : (result ? result.error : '处理失败') }
      : item));
    if (result && result.status === 'ok') setProcessDialog({ mode: processMode, results: [result] });
    else message.error((result && result.error) || '处理失败');
  } catch (error) {
    message.error(error.message || '处理失败');
  } finally {
    setProcessing(false);
  }
}
```

- 工具栏在「批量下载」后追加：

```jsx
<Select
  size="small"
  style={{ width: 120 }}
  value={processMode}
  onChange={setProcessMode}
  options={processPresets}
  placeholder="处理类型"
  disabled={processPresets.length === 0 || processing}
/>
<Button
  size="small"
  type="primary"
  icon={<Wand2 size={14} aria-hidden="true" />}
  loading={processing}
  disabled={okRows().length === 0 || !processMode}
  onClick={handleProcess}
>AI 处理</Button>
```

- 每行操作区（`row.status === 'ok'` 分支内、「下载」之后）追加：

```jsx
<Button size="small" icon={<Wand2 size={14} aria-hidden="true" />} loading={processing} onClick={() => handleProcessOne(row)}>
  {row.induced ? '查看处理结果' : '诱导排查'}
</Button>
```

- 结果弹窗（在现有 preview Modal 之后追加一个 Modal）：

```jsx
<Modal
  title="AI 处理结果"
  open={Boolean(processDialog)}
  width={880}
  onCancel={() => setProcessDialog(null)}
  footer={[
    <Button key="all" icon={<Download size={14} aria-hidden="true" />} onClick={() => {
      (processDialog?.results || []).filter(item => item.status === 'ok').forEach(item => downloadText(`${item.bookId}.txt`, item.text));
    }}>全选下载</Button>,
    <Button key="close" onClick={() => setProcessDialog(null)}>关闭</Button>
  ]}
>
  <Space direction="vertical" size={12} style={{ width: '100%', maxHeight: '60vh', overflow: 'auto' }}>
    {(processDialog?.results || []).map(item => (
      <div key={item.bookId} className="novel-fetch-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="novel-fetch-bookid">{item.bookId}</span>
          {item.status === 'ok'
            ? <span style={{ color: '#389e0d' }}><Check size={14} /> 成功</span>
            : <span style={{ color: '#cf1322' }}>失败：{item.error}</span>}
          {item.status === 'ok' ? (
            <>
              <Button size="small" icon={<Copy size={14} aria-hidden="true" />} onClick={async () => { await copyText(item.text); message.success('已复制'); }}>复制</Button>
              <Button size="small" icon={<Download size={14} aria-hidden="true" />} onClick={() => downloadText(`${item.bookId}.txt`, item.text)}>下载</Button>
            </>
          ) : null}
        </div>
        {item.status === 'ok' && item.report ? (
          <Typography.Paragraph type="secondary" style={{ margin: '4px 0' }}>{item.report}</Typography.Paragraph>
        ) : null}
        {item.status === 'ok' ? (
          <Input.TextArea value={item.text} rows={10} readOnly className="novel-fetch-preview" />
        ) : null}
      </div>
    ))}
  </Space>
</Modal>
```

- 顶部 import 补充：`import { useEffect, useState } from 'react';`（原仅 `useState`）。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/novel-fetch-process-ui-contract.test.js`
Expected: PASS。再跑 `node --test tests/` 确认无回归。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/shared/api/novelFetch.js frontend/src/user/pages/NovelFetchPage.jsx tests/novel-fetch-process-ui-contract.test.js
git commit -m "feat: add novel fetch AI process UI"
```

---

### Task 4: 全量回归与前端构建

**Files:**
- 无新增/修改。

**Interfaces:**
- 依赖 Task 1–3 全部落地。

- [ ] **Step 1: 全量测试**

Run: `node --test tests/`
Expected: 全部通过（含既有与新增用例）。

- [ ] **Step 2: 前端生产构建**

Run: `npm --prefix frontend run build`
Expected: 构建成功，退出码 0；仅允许既有的大分包警告。

- [ ] **Step 3: 冒烟验证（可选，手动）**

启动 `npm start`，登录后打开 `http://localhost:3000/novel-fetch`，获取几本书并验证：工具栏出现「诱导排查/爆款优化」下拉与「AI 处理」按钮；选中单本或多本后点「AI 处理」，弹窗展示报告与优化后全文；可复制、单下载、全选下载。

- [ ] **Step 4: 提交**

无代码改动则无需提交。若发现并修复了回归问题，单独提交并说明。
