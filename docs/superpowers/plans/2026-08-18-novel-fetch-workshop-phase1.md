# 改文工作台（一期：核心链路）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"批量原文改文系统"的核心链路（批量清单导入 → AI 分类 → 抓原文 → 三方案改文多版本 → 任务管理 → 上传集成）以 Node 重写集成进 qiantie，作为独立"改文工作台"页面。

**Architecture:** 新增 `lib/novel-fetch-workshop/` 一组纯函数模块 + 一个路由工厂 `routes/novel-fetch-workshop.js`（挂载 `/api/novel-fetch-workshop/*`），任务数据落 `data/users/<用户名>/novel-fetch-workshop/`，系统配置落 `data/system/novel-fetch-workshop/`。前端新增 `NovelFetchWorkshopPage.jsx`（处理/任务/配置 三个 Tab，一期范围），并在现有小说获取页加入口。上传路由向后兼容扩展支持 `{source:'workshop', version}`。

**Tech Stack:** Node.js + Express、React + Antd、node:test、OpenAI 兼容上游（复用 `lib/shared.js` 的 `requestUpstream`/`collectResponse`）。

**Design spec:** `docs/superpowers/specs/2026-08-18-novel-fetch-workshop-design.md`（已批准）。

## Global Constraints

- 语言：代码注释、UI 文案、测试用中文（与项目一致）。
- 复用 `lib/shared.js` 的 `requestUpstream(config, payload, onResponse, {timeoutMs, signal})` 与 `collectResponse`，不新写 HTTP 客户端。
- 复用 `lib/system-store.js` 的 `withJsonLock`/`writeJsonAtomic`/`readJsonOrMissing` 做落盘。
- 鉴权用 `middleware/auth.js` 的 `apiAuth`。
- 现有 novel-fetch / 诱导排查 / 爆款优化 / 上传登录逻辑不改动；上传路由只做向后兼容扩展。
- 不迁移 zip 的 API Key；ai-config.json 初始不带 key。
- meta/API 字段一律 camelCase；**配置文件键沿用 zip 的 snake_case**（配置是 zip 迁移物，键名照搬，便于二期迁移脚本对齐）。
- 测试命令：`node --test "tests/<file>.test.js"`（Windows 下目录不自动展开）。
- 每 Task 结束要能独立通过测试并 commit。

---
## 文件结构

```
lib/novel-fetch-workshop/
  config.js        系统级配置读写（platforms/styles/ai-config + 默认初始化）
  parse.js         批量清单解析（7 种 parse mode、表头别名、列预设、智能推断、规范化）
  ai.js            独立 AI 客户端与配置（预设库、三用途分配、payload 构造）
  classifier.js    AI 男女频/风格分类
  tasks.js         任务状态机与落盘（meta/original_raw/original/logs/index + 抓原文）
  rewrite.js       改文引擎（行切分、三方案消息、method_sequence 轮换、回拼、AI 返回解析、多版本）
routes/novel-fetch-workshop.js   路由工厂（process/tasks/config/task-detail/fetch/generate-ai）
frontend/src/shared/api/novelFetchWorkshop.js  前端 API 封装
frontend/src/user/pages/NovelFetchWorkshopPage.jsx  工作台页面（处理/任务/配置 Tab）
tests/workshop-*.test.js  对应测试
```

---

### Task 1: 系统级配置存储（config.js）

**Files:**
- Create: `lib/novel-fetch-workshop/config.js`
- Test: `tests/workshop-config.test.js`

**Interfaces:**
- Consumes: `../system-store` 的 `readJsonOrMissing`/`writeJsonAtomic`、`withJsonLock`
- Produces:
  - `DEFAULT_WORKSHOP_CONFIG`（常量，含 fetch/ai/ai_assignments/ai_presets/rewrite 默认值，取 spec 与 zip app.json 默认值，apiKey 为空）
  - `createWorkshopConfigStore({ systemDir })` → `{ getConfig(), saveConfig(patch), getPlatforms(), getStyles(), getAiConfig(), saveAiConfig(patch) }`
  - `systemWorkshopDir = path.join(systemDir, 'novel-fetch-workshop')`
  - `getWorkshopConfigStore(systemDir)` 单例缓存

- [ ] **Step 1: 写失败测试**

```js
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createWorkshopConfigStore } = require('../lib/novel-fetch-workshop/config');
const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-workshop-'));
test('workshop config initializes defaults and persists patches', t => {
  const dir = makeTempDir();
  const store = createWorkshopConfigStore({ systemDir: dir });
  const cfg = store.getConfig();
  assert.equal(cfg.fetch.default_max_txt, 4000);
  assert.equal(cfg.ai.api_key, '');          // 不迁移 key
  assert.equal(cfg.rewrite.process_line_count, 5);
  store.saveConfig({ rewrite: { process_line_count: 8 } });
  assert.equal(createWorkshopConfigStore({ systemDir: dir }).getConfig().rewrite.process_line_count, 8);
});
test('platforms and styles seed from constants', t => {
  const store = createWorkshopConfigStore({ systemDir: makeTempDir() });
  assert.ok(store.getPlatforms().length >= 10);
  assert.ok(store.getStyles().includes('现代女主'));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test "tests/workshop-config.test.js"` — 预期 FAIL（模块不存在）。

- [ ] **Step 3: 实现 config.js**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('../system-store');

const DEFAULT_WORKSHOP_CONFIG = {
  workflow: { auto_classify_missing: true, auto_fetch_original: true, auto_rewrite_after_fetch: false },
  fetch: { endpoint: 'https://txt.121w.com/api.php', default_max_txt: 4000, timeout_seconds: 30, concurrency: 4, retries: 1 },
  ai: { base_url: '', api_key: '', model: '', timeout_seconds: 180, max_concurrency: 6, retry_times: 2,
        stream: false, json_mode: false, max_tokens: 1200, temperature: 0.45, top_p: 0.9,
        presence_penalty: 0, frequency_penalty: 0, enable_thinking: false, disable_thinking: false,
        force_serial_batch: false, extra_body_json: '' },
  ai_presets: [],
  ai_assignments: { classifier: '__current__', rewrite: '__current__', sensitive_fix: '__current__' },
  rewrite: { default_ai_count: 1, max_ai_count: 5, process_line_count: 5, anchor_line_count: 5,
             temperature: 0.45, strategy: 'instruction',
             method_sequence: ['high_imitation', 'opening_instruction', 'instruction'],
             default_template_id: 'rewrite_008', opening_phrase_mode: 'auto', high_imitation_mode: 'auto',
             prompt: '你是短视频小说正文改写师。请只根据原文、风格类型和男女频改写开头部分，保留故事事实、人物关系、时代背景和后续衔接。输出正文，不要解释。' },
  layout: { apply_to_original: true, apply_to_ai: true, apply_sensitive: true, apply_chapter_cleanup: true,
            apply_symbol_rules: true, apply_pair_fill: true, drop_empty_lines: true, trim_lines: true },
  sensitive_ai: { enabled: true, context_chars: 12, max_hits_per_task: 80, concurrency: 4, retries: 1, temperature: 0.2, prompt: '你是内容合规改写助手。请只改写下面命中敏感词的小段内容。\n要求：保留原剧情意思、人物关系和情绪；不增加新剧情；去掉违规、擦边、色情、低俗表达。\n只返回改写后的小段，不要解释。\n\n任务ID：{book_id}\n命中词：{keyword}\n\n原片段：\n{snippet}' },
  parser: { default_parse_mode: 'smart', default_column_preset_id: 'sample_input', custom_column_order: '书籍ID,书名,推荐理由,男女频,标签,评级' }
};
```

（`sensitive_ai.prompt` 照抄 zip：见 spec 第 3 块敏感词。平台表/风格表用现有常量：`routes/novel-fetch.js` 导出 `PLATFORMS`、`STYLE_NAMES` 对应 `config/styles.json` 18 项。）

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "tests/workshop-config.test.js"` — 预期 PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/novel-fetch-workshop/config.js tests/workshop-config.test.js
git commit -m "feat(workshop): system-level config store"
```

---

### Task 2: 批量清单解析（parse.js）

**Files:**
- Create: `lib/novel-fetch-workshop/parse.js`
- Test: `tests/workshop-parse.test.js`

**Interfaces:**
- Consumes: 无外部依赖（纯函数）
- Produces:
  - `STANDARD_FIELDS = ['book_id','paid_book_id','free_book_id','book_name','gender','style','tags','reason','rating']`
  - `RATING_VALUES = ['S','S+','A','A+','B','B+','C','C+']`
  - `PARSE_MODES = ['smart','header','multi_header','fixed_full_11','fixed_from_b','fixed_paid_basic','custom']`
  - `COLUMN_PRESETS`（含 `sample_input` 默认）
  - `normalizeGender(value)` → `'男频'|'女频'|''`
  - `normalizeStyle(value, styles)` → 固定风格之一或 `''`（styles 传 `config.getStyles()`）
  - `parseBooks({ inputText, parseMode, columnPresetId, columnOrder, styles })` → `{ parsed, emptyIdCount, uniqueTasks, duplicateCount, tasks: [{ bookId, paidBookId, freeBookId, bookName, gender, genderSource, style, styleSource, tags, reason, rating, sourceLine, parseMode, parseColumns }] }`

- [ ] **Step 1: 写失败测试**

```js
const { parseBooks, normalizeGender, normalizeStyle } = require('../lib/novel-fetch-workshop/parse');
test('sample_input preset parses a tab-separated row', () => {
  const res = parseBooks({ inputText: '7674515088685943832\t书名\t推荐理由\t女频\t标签1,标签2\tS', parseMode: 'smart', columnPresetId: 'sample_input', columnOrder: '', styles: STYLES });
  assert.equal(res.parsed, 1);
  assert.equal(res.tasks[0].bookId, '7674515088685943832');
  assert.equal(res.tasks[0].gender, '女频');
  assert.equal(res.tasks[0].rating, 'S');
});
test('normalizeGender and normalizeStyle', () => {
  assert.equal(normalizeGender('男生'), '男频');
  assert.equal(normalizeStyle('现代虐', STYLES), '现代虐文');
  assert.equal(normalizeStyle('不存在风格', STYLES), '');
});
test('duplicate book ids merged, missing book id counted', () => {
  const res = parseBooks({ inputText: '123\t书A\t\t\t\t\n123\t书B\t\t\t\t\n\t无名\t\t\t\t', parseMode: 'smart', columnPresetId: 'sample_input', columnOrder: '', styles: STYLES });
  assert.equal(res.uniqueTasks, 1);
  assert.equal(res.duplicateCount, 1);
  assert.equal(res.emptyIdCount, 1);
  assert.equal(res.tasks[0].bookName, '书B'); // 重复行补齐
});
```

（`STYLES` 用 `config.js` 导出的固定 18 项数组。）

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现 parse.js**（按 spec 第 3 块 + search 摘要 1.x 节：`split_pasted_line` 分隔符优先级 `\t→|→2+空白→,→整行`；表头别名映射；7 种 mode；`merge_header_rows`；`map_row_by_order` 吸收尾列；`infer_no_header_row` 找数字 ID/日期双 ID/性别/评级；`choose_book_id`；合并去重）
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit**

---

### Task 3: 独立 AI 客户端（ai.js）

**Files:**
- Create: `lib/novel-fetch-workshop/ai.js`
- Test: `tests/workshop-ai.test.js`

**Interfaces:**
- Consumes: `../shared` 的 `requestUpstream`/`collectResponse`；`./config` 的 `getWorkshopConfigStore`
- Produces:
  - `buildAiPayload(config, { messages, temperature, jsonMode, maxTokens, stream })` → OpenAI payload（含 `response_format`、`thinking`、`extra_body_json` 合并）
  - `resolveAiSettings(configStore, purpose)` → `{ base_url, api_key, model, timeout_seconds, ... }`（purpose ∈ classifier|rewrite|sensitive_fix，取 ai_assignments 指定 preset 或 `__current__`）
  - `chatCompletion(settings, messages, { temperature } = {})` → `{ text, raw }`（走 requestUpstream，超时 settings.timeout_seconds*1000）
  - `parseAiJsonContent(text)` → 对象（剥 ```json 代码块 → 取 `{...}`/`[...]` 子串 → JSON.parse）

- [ ] **Step 1: 写失败测试**

```js
const { buildAiPayload, resolveAiSettings, parseAiJsonContent } = require('../lib/novel-fetch-workshop/ai');
test('buildAiPayload adds response_format and thinking and extra json', () => {
  const p = buildAiPayload({ model: 'm1', api_key: 'k', temperature: 0.4, top_p: 0.9, max_tokens: 500,
    json_mode: true, enable_thinking: true, extra_body_json: '{"foo":1}' },
    { messages: [{ role: 'user', content: 'hi' }], temperature: 0.4 });
  assert.equal(p.model, 'm1');
  assert.deepEqual(p.response_format, { type: 'json_object' });
  assert.deepEqual(p.thinking, { type: 'enabled' });
  assert.equal(p.foo, 1);
});
test('parseAiJsonContent strips code fences and braces', () => {
  assert.deepEqual(parseAiJsonContent('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseAiJsonContent('前缀 {"a":1} 后缀'), { a: 1 });
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现 ai.js**（`chatCompletion` 复用 requestUpstream(config, payload, collectResponse, {timeoutMs})；settings 对象直接满足 requestUpstream 的 config 字段：`baseUrl`/`apiKey`/`model`）
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit**

---

### Task 4: AI 分类（classifier.js）

**Files:**
- Create: `lib/novel-fetch-workshop/classifier.js`
- Test: `tests/workshop-classifier.test.js`

**Interfaces:**
- Consumes: `./ai` 的 `resolveAiSettings`/`chatCompletion`/`parseAiJsonContent`；`./config`
- Produces:
  - `buildClassifyMessages({ fixedStyles, items })` → `[system, user]`（prompt 照 zip 2.2/2.3 节原文）
  - `classifyMissingRows({ configStore, tasks })` → 逐 task 回填 `gender/style/classifyStatus/classifyConfidence/classifyReason/classifierModel`；未配 AI 时置 `classifyStatus='waiting_ai_config'`

- [ ] **Step 1: 写失败测试**

```js
const { buildClassifyMessages } = require('../lib/novel-fetch-workshop/classifier');
test('classify messages instruct fixed styles and gender only', () => {
  const [system, user] = buildClassifyMessages({ fixedStyles: ['现代女主'], items: [{ row_number: 1, book_id: '123', book_name: 'x' }] });
  assert.match(system.content, /男频或女频/);
  assert.match(user.content, /fixed_styles/);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现 classifier.js**（按 search 摘要 2.4 节：批量一次请求、温度 0、重试 `retry_times` 次、按 row_number 回填、style 落回固定列表否则 classify_error、gender 规范化）
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit**

---

### Task 5: 任务存储与抓原文（tasks.js）

**Files:**
- Create: `lib/novel-fetch-workshop/tasks.js`
- Test: `tests/workshop-tasks.test.js`

**Interfaces:**
- Consumes: `../system-store` 的 `withJsonLock`/`writeJsonAtomic`/`readJsonOrMissing`；`../shared` 的 `requestUpstream`/`collectResponse`（抓原文）；`./config`
- Produces:
  - `createWorkshopTasks({ usersDir, fetchUpstream })` → `{ saveTasks, listTasks, getTask, fetchOriginal, readOriginalRaw, readVersionText, appendLog, deleteTasks, restoreOriginal, pathForAiVersion }`
  - `dir(username) = data/users/<用户名>/novel-fetch-workshop/`
  - `fetchUpstream(bookId, platformId, maxTxt)` → `{ text, bookinfo }`（GET `https://txt.121w.com/api.php?bookid=..&platform=..&max_txt=..`）
  - 版本文件：`ai/ai{n}/{bookId}.txt`；`readVersionText(username, bookId, version)` 支持 `'original'`/`'ai1'..` 与 `'edited'`（= `original` 的别名，一期兼容上传）
  - `pathForAiVersion(username, bookId, n)` → `ai/ai{n}/{bookId}.txt` 绝对路径（供 rewrite.js 写文件）
  - meta 结构见 spec 第 2 块（camelCase）
  - 改文生成逻辑不在本模块：`generateAiVersion` 由 Task 6 的 rewrite.js 提供，依赖本模块的 `getTask`/`readOriginalRaw`/`appendLog`/`pathForAiVersion`

- [ ] **Step 1: 写失败测试**

```js
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createWorkshopTasks } = require('../lib/novel-fetch-workshop/tasks');
const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-workshop-tasks-'));
test('saveTasks writes meta and index; fetchOriginal stores raw+processed', async t => {
  const store = createWorkshopTasks({ usersDir: makeTempDir(), fetchUpstream: async () => ({ text: '第一行\n第二行\n', bookinfo: { book_name: '书名' } }) });
  await store.saveTasks('u1', [{ bookId: '123', bookName: '书名', platformId: '2', platformName: '番茄付费', gender: '女频', style: '现代女主' }]);
  const res = await store.fetchOriginal('u1', '123', 4000);
  assert.equal(res.status, 'done');
  assert.equal(store.readOriginalRaw('u1', '123'), '第一行\n第二行\n');
  assert.equal(store.readVersionText('u1', '123', 'original'), '第一行\n第二行\n');
  const meta = store.getTask('u1', '123').meta;
  assert.equal(meta.originalStatus, 'done');
  assert.equal(meta.originalChars, 9);
});
test('deleteTasks removes all task files', async t => {
  const store = createWorkshopTasks({ usersDir: makeTempDir(), fetchUpstream: async () => ({ text: 'x\n' }) });
  await store.saveTasks('u1', [{ bookId: '123' }]);
  await store.fetchOriginal('u1', '123', 4000);
  const r = store.deleteTasks('u1', ['123']);
  assert.equal(r.deleted, 1);
  assert.equal(store.getTask('u1', '123'), null);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现 tasks.js**
  - 落盘：`meta/{bookId}.json`、`original_raw/{bookId}.txt`、`original/{bookId}.txt`、`logs/{bookId}.jsonl`、`index.json`
  - `saveTasks`：按 bookId 合并去重（非空值补齐），写入 meta（`status:'created'`），更新 index（倒序）
  - `fetchOriginal`：fetchUpstream → 写 original_raw → 一期先做基础清洗（`normalizeNewlines` + `dropEmptyLines` 可选）写 original → 更新 meta（originalStatus/originalChars/originalRawChars/originalFetchedAt/status='original_done'；失败 status='original_failed'）→ appendLog
  - `deleteTasks`：`safeUnlink` 删除 meta/original_raw/original/logs + 各 `ai/ai*` 下该 bookId 文件 + index 移除
  - `appendLog(username, bookId, event, data)`：jsonl 追加一行 `{time, event, data}`
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit**

---

### Task 6: 改文引擎（rewrite.js）

**Files:**
- Create: `lib/novel-fetch-workshop/rewrite.js`
- Test: `tests/workshop-rewrite.test.js`

**Interfaces:**
- Consumes: `./ai` 的 `resolveAiSettings`/`chatCompletion`；`./config`；`./tasks`（`getTask`/`readOriginalRaw`/`appendLog`/`pathForAiVersion`）
- Produces:
  - `methodForAiIndex(sequence, aiIndex)` → 轮换方案名
  - `splitLines(text)` → `{ lines, targetLines, anchorLines, fullText }`（process_line_count/anchor_line_count）
  - `buildRewriteMessages({ strategy, configStore, task, targetLines, anchorLines, fullText, aiIndex })` → `[system, user]`（三方案构造，见 search 摘要 4.4 节；一期 opening_phrase/high_imitation 库可为空，走兜底文案）
  - `extractAiChangedText(text)` → `{ text, responseMode }`（优先 changed_lines JSON，见 4.5 节）
  - `mergeChangedBlockWithOriginal(originalLines, changedBlock, { processLineCount })` → 回拼文本
  - `generateAiVersion({ configStore, tasks, username, task, aiIndex, count })` → 生成并写 `ai/ai{n}/{bookId}.txt`（用 `tasks.pathForAiVersion(username, bookId, n)`），更新 meta.aiGeneratedCount/aiStatus/rewriteKnowledge

- [ ] **Step 1: 写失败测试**

```js
const { methodForAiIndex, splitLines, extractAiChangedText, mergeChangedBlockWithOriginal } = require('../lib/novel-fetch-workshop/rewrite');
test('method rotation cycles through sequence', () => {
  const seq = ['high_imitation', 'opening_instruction', 'instruction'];
  assert.equal(methodForAiIndex(seq, 1), 'high_imitation');
  assert.equal(methodForAiIndex(seq, 4), 'high_imitation');
});
test('splitLines separates target and anchor', () => {
  const { targetLines, anchorLines, fullText } = splitLines('a\nb\nc\nd\ne\nf\ng\n', { processLineCount: 3, anchorLineCount: 2 });
  assert.deepEqual(targetLines, ['a','b','c']);
  assert.deepEqual(anchorLines, ['d','e']);
  assert.ok(fullText.includes('a\nb\nc'));
});
test('extractAiChangedText parses changed_lines json', () => {
  const { text, responseMode } = extractAiChangedText(JSON.stringify({ id: '1', changed_lines: [{ line_no: 1, text: '改写内容' }] }));
  assert.equal(text, '改写内容');
  assert.equal(responseMode, 'changed_lines');
});
test('merge replaces leading block with changed text', () => {
  const out = mergeChangedBlockWithOriginal(['a','b','c','d','e'], ['A','B'], { processLineCount: 3 });
  assert.equal(out, 'A\nB\nd\ne');
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现 rewrite.js**（三方案消息构造：instruction 用模板 profile（一期 knowledge 库为空则回退 config.rewrite.prompt）；opening_instruction 追加"已选开头词"块（无库则跳过）；high_imitation 用高仿提示词 + reference（无 references 用兜底文案"当前高仿文章库没有匹配参考文案…"）。extra_instruction 含"本次生成第 N 个AI文案"等，见 search 摘要 4.4 节）
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit**

---

### Task 7: 后端路由（routes/novel-fetch-workshop.js + 挂载）

**Files:**
- Create: `routes/novel-fetch-workshop.js`
- Modify: `app.js`（挂载路由、创建 store）
- Test: `tests/workshop-routes.test.js`

**Interfaces:**
- Consumes: `./lib/novel-fetch-workshop/*` 全部模块；`apiAuth`
- Produces:
  - `createNovelFetchWorkshopRouter({ auth, tasks, configStore })`
  - 路由：`POST /process`、`GET /tasks`、`GET /tasks/:bookId`、`POST /tasks/:bookId/fetch`、`POST /tasks/:bookId/generate-ai`、`GET /config`、`POST /config`、`POST /ai/test`

- [ ] **Step 1: 写失败测试**（express + supertest 风格，沿用现有路由测试模式）

```js
const { createNovelFetchWorkshopRouter } = require('../routes/novel-fetch-workshop');
function makeApp({ tasks, configStore }) {
  return express().use(express.json()).use('/api/novel-fetch-workshop', createNovelFetchWorkshopRouter({ auth: (req,res,next)=>{req.username='u1';next();}, tasks, configStore }));
}
test('POST /process returns parsed tasks and creates them', async () => {
  const app = makeApp({ tasks: makeTasks(), configStore: makeConfig() });
  const res = await request(app).post('/api/novel-fetch-workshop/process').send({ inputText: '123\t书名\t\t女频\t\t', parseMode: 'smart', columnPresetId: 'sample_input' });
  assert.equal(res.status, 200);
  assert.equal(res.body.uniqueTasks, 1);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现路由 + app.js 挂载**（`app.use('/api/novel-fetch-workshop', createNovelFetchWorkshopRouter({ tasks: resolvedWorkshopTasks, configStore }))`；`resolvedWorkshopTasks` 用 `createWorkshopTasks({ usersDir, fetchUpstream: 复用 novel-fetch 的抓取 })`）
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit**

---

### Task 8: 前端工作台页面 + 入口

**Files:**
- Create: `frontend/src/shared/api/novelFetchWorkshop.js`
- Create: `frontend/src/user/pages/NovelFetchWorkshopPage.jsx`
- Modify: `frontend/src/user/App.jsx`（路由表加 `/novel-fetch-workshop`）
- Modify: `frontend/src/user/pages/NovelFetchPage.jsx`（顶部操作区加"改文工作台"入口按钮）
- Test: `tests/workshop-ui-contract.test.js`（字符串断言：入口按钮、路由、api 封装 token 存在）

**Interfaces:**
- api 封装：`processBatch({ inputText, parseMode, columnPresetId, columnOrder, platformId, maxTxt, aiCount })`、`listTasks()`、`getTask(bookId)`、`fetchOriginal(bookId)`、`generateAi(bookId, count)`、`getWorkshopConfig()`、`saveWorkshopConfig(patch)`、`testWorkshopAi(purpose)`

- [ ] **Step 1: 写失败测试**（ui contract，参照现有 novel-fetch-upload-ui-contract.test.js 风格）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**：处理 Tab（平台/输入格式/列预设/自定义列顺序/大文本框/开始处理/结果摘要 + 右侧任务详情与版本查看）；任务 Tab（表格 + 批量删除/重试 + 行内 查看/重新抓原文/生成AI/下载）；配置 Tab（自动处理区 + AI 接口区 + 测试接口 + 预设库三分配）。全部用 Antd 组件，风格对齐 NovelFetchPage。
- [ ] **Step 4: 运行确认通过**（前端不跑 node:test；ui-contract 测试 + `npm run build` 手动验证）
- [ ] **Step 5: Commit**

---

### Task 9: 上传集成（source + version）

**Files:**
- Modify: `routes/novel-fetch-upload.js`（upload-batch 读取支持 workshop 版本）
- Modify: `frontend/src/user/pages/NovelFetchPage.jsx`（上传配置列表"版本"选择器 + 加入上传）
- Modify: `frontend/src/shared/api/novelFetch.js`（`uploadBatch` 透传 source/version）
- Test: `tests/workshop-upload-contract.test.js`

**Interfaces:**
- upload-batch 请求项扩展：`{ bookId, gender, style, source: 'novel-fetch'|'workshop', version: 'ai2'|'original' }`
- `createNovelFetchUploadRouter({ auth, store, workshopTasks, httpClient })`：当 `item.source === 'workshop'` 时用 `workshopTasks.readVersionText(req.username, item.bookId, item.version)` 读取正文；否则走原 `store.read`

- [ ] **Step 1: 写失败测试**

```js
test('upload-batch reads workshop version text', async () => {
  const workshopTasks = { readVersionText: async (u, id, v) => v === 'ai2' ? '版本2正文' : '' };
  const app = makeApp({ store: makeStoreWithSession(), workshopTasks, httpClient: uploadMock });
  const res = await request(app).post('/api/novel-fetch-upload/upload-batch').send({
    platformId: 1, advanced: DEFAULT_ADVANCED,
    items: [{ bookId: 'w1', gender: '女频', style: '现代女主', source: 'workshop', version: 'ai2' }]
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.results[0].status, 'ok');
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**（路由分支 + 前端版本选择 UI；现有 novel-fetch 项不传 source 走原逻辑，行为不变）
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit**

---

## 二期（不在本计划）

sensitive.js / textlayout.js 完整规则、知识库页、规则页、日志页、zip 数据迁移脚本（`tests/workshop-migration.test.js` 校验）。一期先以"基础清洗（换行归一+去空行）"代排版，敏感词处理一期仅普通替换（`apply_sensitive` 可用简单替换），AI 修复与完整排版规则二期落地。
