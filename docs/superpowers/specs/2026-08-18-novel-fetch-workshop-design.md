# 批量改文系统集成到"小说获取"设计

- 日期：2026-08-18
- 状态：已批准（整体设计 5 块均获用户确认，实施分两期）

## 背景

用户提供一个独立的 Python FastAPI 工具"批量原文改文系统"（zip 包），要求把其**完整功能**重写集成进 qiantie 的"小说获取"模块。qiantie 为 Node.js + Express + React(Antd) 架构。

经澄清确认的需求：

1. 集成范围：完整功能（批量清单导入、AI 分类、三方案改文多版本、敏感词/排版规则、知识库、任务管理）
2. 与现有"诱导排查/爆款优化"两者并存，现有功能不动
3. 改文结果全链路接入（查看/编辑/下载/对接上传 two.121w.com）
4. 多版本（ai1/ai2/ai3…）每版独立管理，上传时选择版本
5. zip 里的知识库与规则数据一并迁移
6. 改文系统自带独立 AI 配置（预设库 + classifier/rewrite/sensitive_fix 三用途分别指定模型）
7. 新增"批量清单导入"，保留现有"输入 ID 单本获取"

## 架构

**方案**：完全重写为 Node 模块，集成进 qiantie 架构（方案 A）。

**放置方式**：现有小说获取页顶部加"改文工作台"入口按钮 → 打开独立页面 `/novel-fetch-workshop`（有返回按钮）；工作台页内部用 Tab 分区（处理 / 任务 / 配置 / 知识库 / 规则 / 日志）。

**后端新增模块**（`lib/novel-fetch-workshop/`）：

| 模块 | 职责 |
|---|---|
| `parse.js` | 批量清单解析（7 种 parse mode、表头别名、列预设、智能推断、男女频/风格规范化） |
| `classifier.js` | AI 男女频/风格分类（批量、温度 0、JSON 解析、风格落回固定列表） |
| `rewrite.js` | 改文引擎（指令/开头词+指令/高仿三方案、method_sequence 轮换、行切分/锚点、回拼、多版本） |
| `sensitive.js` | 敏感词检测 + AI 修复/普通替换 |
| `textlayout.js` | 排版流水线（章节清洗/重复标点/字位符号/成对补符号/段落样式，8 项开关） |
| `knowledge.js` | 三类知识库 + 开头词拆解入库 + 规则集读写 |
| `tasks.js` | 任务状态机与落盘 |
| `ai.js` | 独立 AI 客户端（OpenAI 兼容、预设库、三用途分配） |

**路由**：`routes/novel-fetch-workshop.js` 挂载 `/api/novel-fetch-workshop/*`，沿用 `apiAuth` 系统鉴权。

## 数据模型

### 任务数据（用户级）

目录：`data/users/<用户名>/novel-fetch-workshop/`

```
meta/{bookId}.json            任务元信息 + 全部状态
original_raw/{bookId}.txt     接口原始原文（永不被覆盖，可恢复）
original/{bookId}.txt         处理后原文（排版 + 敏感词处理）
ai/ai1..aiN/{bookId}.txt      各版本 AI 改文
sensitive_hits/{bookId}.json  敏感词命中记录
sensitive_fixed/{bookId}.json 敏感词修复记录
logs/{bookId}.jsonl           任务事件日志（逐行 JSON）
index.json                    任务列表索引
```

### meta 字段

```jsonc
{
  "bookId": "7674515088685943832",
  "bookName": "…",
  "platformId": "2", "platformName": "番茄付费",
  "gender": "女频", "genderSource": "ai",          // input | ai
  "style": "现代女主", "styleSource": "ai",
  "tags": "…", "reason": "…", "rating": "S",
  "sourceLine": "…", "parseMode": "smart", "parseColumns": [],
  "maxTxt": 4000, "aiCount": 1,
  "classifyStatus": "classified",                  // classified|failed|waiting_ai_config|input_ready
  "originalStatus": "done",                        // done|failed
  "originalChars": 0, "originalRawChars": 0,
  "sensitiveMode": "ai_fix",                       // ai_fix|replace|disabled
  "sensitiveStatus": "done",                        // done|skipped|failed|pending|waiting_ai_config
  "sensitiveHitCount": 0, "sensitiveFixedCount": 0,
  "aiStatus": "done",                              // done|partial|failed|waiting_original|waiting_ai_config
  "aiGeneratedCount": 0, "aiError": "",
  "status": "original_done",                       // created|original_done|original_failed|original_restored|retrying|retry_done
  "error": "",
  "rewriteKnowledge": { "strategy": "high_imitation", "aiIndex": 1,
    "rewriteTemplateId": "rewrite_008", "openingPhraseId": "…",
    "highImitationRefId": "…", "responseMode": "changed_lines",
    "patch": { "deleteLineCount": 5, "changedLineCount": 5, "finalLineCount": 233 } },
  "rewriteKnowledgeHistory": [],
  "createdAt": "…", "updatedAt": "…"
}
```

### 状态机

- 主状态：`created → original_done / original_failed → retrying → retry_done`；支持 `original_restored`
- 重试 = 只补跑失败环节（缺分类补分类 → 缺原文补抓取 → 缺 AI 补改文），不覆盖已成功结果
- 环节状态：classifyStatus / originalStatus / sensitiveStatus / aiStatus 独立

### 系统级数据

目录：`data/system/novel-fetch-workshop/`（单份，迁移自 zip，不迁移 API Key/账号密码）

```
platforms.json              平台表（与 qiantie 现有一致，复用）
styles.json                 18 个固定风格（与现有一致）
sensitive.json              敏感词规则（约 260+ 条，原样迁移）
knowledge/high_imitation.json   高仿文章库（prompts + references）
knowledge/opening_phrases.json  爆款开头词库
knowledge/rewrite_templates.json 改文指令库（8 套 profile + 6 条临时指令）
rules/chapter_rules.json    章节清洗规则
rules/symbol_rules.json     字位符号规则
rules/pair_fill_rules.json  成对补符号规则
rules/layout_rules.json     批量排版规则
ai-config.json              独立 AI 配置（预设库 + 三用途分配）
opening_analyzer.json       开头词拆解 prompt
```

## 处理流水线

全自动链路（各步可开关）：

```
批量清单导入(parse) → 落盘任务(meta) → AI分类(缺性别/风格时) → 抓原文(txt.121w.com)
→ 存 original_raw(纯原文备份) → 排版清洗 → 敏感词处理(替换/AI修复) → 存 original
→ 逐任务生成改文(ai1..aiN，每版都过清洗排版) → 更新状态与日志
```

### 抓原文

`GET https://txt.121w.com/api.php?bookid=..&platform=..&max_txt=..`（复用现有 fetchUpstream 逻辑）。并发 4、重试 1、超时 30s，失败不换平台。

### AI 分类

一次请求批量分类所有缺项行；system prompt 与返回 JSON 格式照搬 zip（`{results:[{row_number,book_id,style,gender,confidence,reason}]}`）；style 必须落回 18 个固定风格之一否则记 classify_error；温度 0；重试 2 次。

### 改文引擎

- 读取处理后原文，过滤空行得 `original_lines`
- 待处理块 `target_lines` = 前 `process_line_count`（默认 5）行——唯一改写对象
- 只读锚点 `anchor_lines` = 紧随其后 `anchor_line_count`（默认 5）行——只给 AI 看衔接，禁止改写
- 完整原文 `full_text` 作为上下文（只读）
- 回拼：AI 返回改写块 → 清洗 → 删原文前 N 行 → 插入改写块 → 接回剩余原文 → 整篇再过一遍 ai 排版

三种方案：
- 指令改文：改文模板（8 套 profile）+ 额外要求拼接
- 开头词+指令：指令改文基础上注入"已选开头词模板"（槽位/适配提示）
- 高仿文章改文：高仿参考库（风格+5 / 男女频+3 / 标签命中+1 打分选参考）+ 高仿提示词

出文轮换：`method_sequence`（默认 `[high_imitation, opening_instruction, instruction]`），`aiN` 用 `sequence[(N-1) % len]` 取方案。

多版本：每个版本独立调用 AI → 独立解析（优先 `changed_lines` JSON）→ 独立落盘 `ai/aiN/`。每次生成记录 `rewrite_knowledge` 与日志。

### 敏感词处理

- 检测：对启用规则逐条全文查找命中，取上下文片段（断句符边界，无则左右 context_chars=12 字），按 start 排序、去重叠，上限 max_hits_per_task=80
- AI 修复模式（默认开）：并发修复每段，`{book_id,keyword,snippet}` 进 prompt，保留原意去违规；任一段失败则整任务 sensitive_status=failed
- 普通替换模式：AI 修复关闭时按 `replace` 直接替换

### 排版流水线

顺序固定，8 项开关：

```
换行归一 → 敏感词替换(可选) → 章节清洗(整行删除/行内命中) → 重复标点归一
→ 字位符号切分(按 position 命中符号切行) → 成对补符号 → 重复标点归一 → 章节清洗
→ 段落样式(缩进/段间空行/去空行/行首尾空格)
```

## 前端页面

**入口**：现有小说获取页顶部操作区加"改文工作台"按钮 → `/novel-fetch-workshop`（可返回）。

**6 个 Tab**：
1. 处理：平台 + 输入格式 + 列顺序预设/自定义 + 大文本框（一行一本）+ 开始处理 + 刷新任务；右侧任务详情（meta、重新抓原文/生成AI/恢复原文、处理后原文、各 ai 版本块、敏感日志）
2. 任务：表格 + 批量操作（重试选中/失败、规则处理选中/全部 both/original/ai、删除选中/失败/全部）；状态色（失败红/等待黄/成功绿）
3. 配置：自动处理区 + AI 接口区（含测试接口）+ 预设库（三用途分配）+ 平台表/风格表
4. 知识库：三类库切换 + 搜索 + 条目编辑 + AI 优化 + 爆款开头拆解入库 + 矫正旧开头词
5. 规则：六类规则编辑器 + 规则 AI 助手 + 预览处理效果
6. 日志：全局日志列表

**每本任务操作**：查看、编辑（任意版本写回 `ai/aiN/`）、下载（按版本）、重新抓原文、生成 AI（选数量）、从备份恢复原文、敏感日志。

## 上传集成（对接 two.121w.com）

- 工作台任务可"加入上传" → 进入现有对接上传流程
- 上传配置列表扩展：工作台加入的书行内带"版本"选择器（ai1/ai2/ai3…或编辑版），上传读取所选版本
- 上传路由扩展：支持 `{source:'workshop', bookId, version:'ai2'}` 读取对应版本；现有 novel-fetch 的书不传 source 走原逻辑
- 性别/风格：工作台任务已含 AI 分类结果，加入上传自动带出，仍可修改
- 平台：任务平台即上传平台，沿用现有 platformId 映射

## 错误处理

- 任务级隔离：任一环节失败只标记该书并记 error，不中断其他书
- 阶段状态独立，单环节可重试，不重复成功结果
- AI 失败按配置重试（2 次、间隔递增）；模型未配置→ waiting_ai_config
- 敏感词任一段失败 → sensitive_status=failed，取前 3 条错误入 meta
- 落盘：JSON 锁 + 原子写（复用 withJsonLock/writeJsonAtomic）；删除带路径越界保护
- 上传：目标站未登录用 200+notLoggedIn，不触发系统会话退出；失败单本重试，批量前跳过成功项

## 并发

- 抓原文：并发池 4
- AI 分类：单次批量请求
- 改文：逐本顺序生成（每本内部多版本串行）
- 敏感词 AI 修复：并发池 4
- 不引入新运行时依赖

## 测试策略（node:test 风格）

1. `tests/workshop-parse.test.js` — 7 种 parse mode、表头别名、列预设、智能推断、规范化
2. `tests/workshop-classifier.test.js` — 分类 prompt、JSON 解析、风格落回校验
3. `tests/workshop-rewrite.test.js` — 行切分/锚点、三方案消息、轮换、回拼、AI 返回解析
4. `tests/workshop-sensitive.test.js` — 命中检测、普通替换、AI 修复重建
5. `tests/workshop-textlayout.test.js` — 流水线顺序、各规则处理
6. `tests/workshop-knowledge.test.js` — 三库读写、开头词规范化、拆解入库、规则集
7. `tests/workshop-tasks.test.js` — 状态机、批量删除/重试、restore-original、规则重应用
8. `tests/workshop-routes.test.js` — 全路由契约
9. `tests/workshop-upload-contract.test.js` — 上传路由对 workshop 版本读取兼容
10. `tests/workshop-migration.test.js` — zip 数据迁移导入校验

## 数据迁移

提供一次性导入脚本，从解压目录读取 zip 数据写入 `data/system/novel-fetch-workshop/`；导入前打印数量预览（敏感词/知识库/规则条目数）；不迁移 API Key/账号密码。

## 分期实施

- **一期（核心链路）**：parse + classifier + fetch + rewrite（三方案+多版本）+ tasks + ai 配置 + 处理/任务 Tab + 上传集成
- **二期（周边完善）**：sensitive + textlayout 完整规则 + 知识库页 + 规则页 + 日志页 + 数据迁移

## 明确不做的

- 不迁移 API Key/账号密码
- 不实现 zip 中未实现的"按行宽智能换行"（enable_len_wrap）
- 不引入 Python 运行时，全部 Node 重写
- 不改动现有 novel-fetch / 诱导排查 / 爆款优化 / 上传登录逻辑（仅上传路由向后兼容扩展）
