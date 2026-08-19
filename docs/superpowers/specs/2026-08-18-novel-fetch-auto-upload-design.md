# 小说获取 → 自动上传 two.121w.com 对接设计

> 日期：2026-08-18
> 关联页面：[NovelFetchPage.jsx](../../../frontend/src/user/pages/NovelFetchPage.jsx)、[routes/novel-fetch.js](../../../routes/novel-fetch.js)、[lib/system-preset-catalog.js](../../../lib/system-preset-catalog.js)

## 目标

在「小说获取」页面为已通过 AI 处理（诱导排查 / 爆款优化）的小说新增**一键批量上传**能力：

1. AI 处理时逐本分析该书的**男频/女频**与**适合风格**，作为元数据保存，不混入正文。
2. 处理成功的内容自动保存到后端用户文件夹（`data/users/<用户名>/novel-fetch/`），并支持**在系统内查看、继续编辑**（编辑后保存覆盖该文件）。
3. 页面内新增「对接上传」面板：启用前弹出登录框（目标站 two.121w.com），登录成功后展示上传配置与逐本待上传列表。
4. 逐本调用目标站 `api/zbooklist_upload.php` 上传 `.txt` 与配置字段，**上传使用用户编辑后的最新文档**，**每本使用该本自己的性别/风格**，一本一本顺序上传并回显结果，失败可单独重试。

> 文档编辑规则：AI 处理后、下载前，正文在系统内始终可查看、可编辑；每次编辑保存会同步到后端文件夹；下载/上传都基于**当前编辑后的版本**。下载到本地的文件即为最终版，系统内不再联动编辑。

## 范围与非目标

- 本期**不做背景音乐**上传（目标站需走 TOS 预签名 `api/music_put_url.php`，后续再扩展）。
- 本期**不做 AI 头部视频自定义**（`jieya_ai_head` 仅支持 0=不加、1=单个视频加 AI 头部、2=AI 头部复用；3=自定义 AI 头部需要上传视频，暂不支持，提交时若选 3 则回退为 0 并提示）。
- 不做上传后的轮询/统计拉取。

## 架构总览

```
NovelFetchPage.jsx
  │ ① AI 处理(诱导排查/爆款优化) → 后端返回 text + report + analysis(gender/style)
  │ ② 后端保存 <bookId>.txt + <bookId>.meta.json（初始为 AI 处理结果）
  │ ③ 用户可打开「编辑弹窗」查看并修改正文 → POST /save 覆盖后端 <bookId>.txt
  │ ④ 「对接上传」面板：
  │     登录弹窗(账号/密码) → POST /upload-login
  │     配置(平台/解压/滚屏高级设置) + 逐本列表(性别/风格可改)
  │ ⑤ 开始上传 → POST /upload-batch { platformId, advanced, items[] }
  ▼
routes/novel-fetch-upload.js（后端，工厂可注入 http 客户端）
  │ ⑥ 读取用户会话 cookie（无则 401 → 前端重新弹登录框）
  │ ⑦ 逐本：读 <bookId>.txt（最新编辑版）→ 拼 multipart → POST http://two.121w.com/tttadmin/api/zbooklist_upload.php
  ▼
{ results: [{ bookId, status, ok/error }] }
```

## 一、预设规则升级（AI 逐本分析性别/风格）

文件：`lib/system-preset-catalog.js` 的 `NOVEL_FETCH_PRESETS`。

在「诱导排查」(`INDUCE_PRESET_BODY`) 与「爆款优化」(`HOOK_PRESET_BODY`) 的输出结构中，**在报告之前**新增一节**「分析结果」**，要求 AI 单独输出一行 JSON（不解释、不加代码块标记）：

```
### 一、分析结果
{"gender":"男|女","style":"<风格名称>"}
```

风格名称必须取自目标站 18 种风格之一：`古风虐文/古风甜文/古风通用/年代虐文/年代甜文/年代通用/现代虐文/现代甜文/现代悬疑/现代通用/男频都市/现代女主/玄幻/历史/爆款BGM/家庭奇葩/家庭伤感/职场打脸`。

原有的「合规检测报告/优化说明」「优化后全文」「关键修改说明」节依次顺延为二、三、四节。分析结果**不允许出现在优化后正文中**。

### 后端解析

`routes/novel-fetch.js` 新增 `extractAnalysis(content)`：

- 定位「分析结果」节，用正则提取 `{"gender":..., "style":...}` JSON。
- 校验：`gender` ∈ {男, 女}，`style` ∈ 已知风格名集合。
- 返回 `{ gender, style, rest }`（`rest` 为去掉分析节后的内容，用于继续执行既有 `splitReportAndText`）。
- 分析节缺失或解析失败 → 不阻断处理，`gender/style` 记为 `null`（前端逐本可手动补选）。

> **节号兼容**：新增「分析结果」为一节后，原报告/全文/修改说明的序号会顺延（如「一、合规检测报告」变「二、合规检测报告」）。`splitReportAndText` 需从"依赖数字前缀"改为**按关键词匹配**：报告节匹配含「合规检测报告|优化说明」的标题行，正文节匹配「优化后全文」，末节匹配「关键修改说明」。`extractAnalysis` 移除分析节后剩余内容可直接复用升级后的 `splitReportAndText`。

`POST /api/novel-fetch/process` 的单本结果由：

```js
{ bookId, status, text, report, error }
```

扩展为：

```js
{ bookId, status, text, report, analysis: { gender, style } | null, error }
```

前端行状态新增 `induced.analysis`。

## 二、处理后内容落盘（后台文件夹）

文件：新增 `lib/novel-fetch-store.js`（复用 `lib/system-store.js` 的 `writeJsonAtomic`）。

目录：`data/users/<用户名>/novel-fetch/`

- 正文：`<bookId>.txt`（UTF-8，当前**最新编辑版**正文；初始为 AI 处理结果，用户编辑保存后覆盖）
- 元数据：`<bookId>.meta.json`

```json
{
  "bookId": "724852",
  "platform": 3,
  "platformName": "七猫付费",
  "mode": "induce" | "hook",
  "gender": "女" | "男" | null,
  "style": "现代虐文" | null,
  "report": "…",
  "savedAt": "2026-08-18T…Z",
  "updatedAt": "2026-08-18T…Z"
}
```

### 保存时机

1. **AI 处理成功**（`status === 'ok'`）→ 自动落盘初始版（`text` 为处理结果，`analysis` 写入 `gender/style`），覆盖同 bookId 旧文件。
2. **用户编辑保存** → 覆盖 `<bookId>.txt` 为编辑后正文，更新 `updatedAt`（`gender/style` 不变，除非用户在上传面板另行修改并在开始上传时随 item 提交）。

### 对外接口

- `saveSavedBook(username, bookId, { text, meta })` → 写 `<bookId>.txt` 与 `<bookId>.meta.json`（编辑保存用）。
- `listSavedBooks(username)` → 读取 `index` 或扫描目录 meta.json，返回 `[{ bookId, platformName, mode, gender, style, savedAt, updatedAt, hasTxt }]`。
- `readSavedBook(username, bookId)` → `{ text, meta }`。
- 索引文件 `index.json`（books 数组）由 store 维护，写入用 `withJsonLock` 防并发。

### 新增 `POST /api/novel-fetch/save`（编辑保存）

挂载于既有 `routes/novel-fetch.js`（与 `/process` 同 router）。body：

```json
{ "bookId": "724852", "text": "编辑后的完整正文" }
```

- 校验 `bookId` 合法、`text` 非空且 ≤ 120000 字符。
- 仅允许保存**已处理过**（meta 存在）的书；正文写入 `<bookId>.txt`，`updatedAt` 更新。
- 返回 `{ ok: true, savedAt }`。
- 无 meta 但用户已在本会话处理过该书（前端行状态有 `induced`）→ 也允许首次落盘并记录 meta（用于"处理后未刷新就上传"的场景）。

### 新增 `GET /api/novel-fetch/saved`（已保存列表）

挂载于既有 `routes/novel-fetch.js`。返回：

```json
{ "books": [{ "bookId", "platformName", "mode", "gender", "style", "savedAt", "updatedAt", "hasTxt" }] }
```

供上传面板展示"可上传的书 + 已存的性别/风格"，也支持页面刷新后恢复待上传列表。

## 三、后端路由 `routes/novel-fetch-upload.js`

工厂 `createNovelFetchUploadRouter({ auth = apiAuth, store, httpClient } = {})`，挂载于 `app.js`：

```js
app.use('/api/novel-fetch-upload', createNovelFetchUploadRouter({ store: resolvedNovelFetchStore }));
```

依赖 `store`：用户会话 + novel-fetch 文件夹；`httpClient` 可注入用于测试。

### 3.1 目标站登录与会话

- 会话文件：`data/users/<用户名>/upload-target.json`（写入用 `writeJsonAtomic`）
  ```json
  { "cookie": "PHPSESSID=…", "loginAt": "…", "lastVerifiedAt": "…" }
  ```
  **不保存目标站账号密码**。
- `POST /upload-login`，body `{ username, password }`：
  1. `GET http://two.121w.com/tttadmin/login.php?username=<u>&password=<p>`（跟随重定向，`http` 模块）。
  2. 从响应 `set-cookie` 头捕获 cookie。
  3. 校验：用 cookie `GET /tttadmin/zidingyi.php`，响应含「自定义文案」且不含「管理员登录」→ 成功；否则返回 400 `{ ok: false, error: '登录失败，请检查账号密码' }`。
  4. 成功 → 保存会话，返回 `{ ok: true, username }`。
- `GET /upload-session`：返回 `{ ok: true, loggedIn: boolean, lastVerifiedAt }`，不暴露 cookie 内容。

> **不使用 401 状态码**：前端 `client.js` 的 `apiRequest` 会把任何非 `/api/login` 的 401 当作"本系统登录失效"并清空用户自己的 token。因此本功能所有接口**禁止返回 401**；"目标站未登录/会话失效"统一用 `200 + { ok:false, notLoggedIn:true, error }` 表达，登录失败用 `400`。

### 3.2 批量上传

`POST /upload-batch`，body：

```json
{
  "platformId": 3,
  "advanced": {
    "tl5": 0, "ziti": 1, "zitidx": 62, "biaohong": "",
    "keywords": "", "biaohongReuse": "",
    "jieyaNum": 4, "jieyaAiHead": 0, "jieyaSpeed": 1.7, "jieyaPitch": 0,
    "gunpingNum": 4, "gunpingSpeed": 1, "fontColorStyles": [1]
  },
  "items": [
    { "bookId": "724852", "gender": "女", "style": "现代虐文", "overrideJieyaNum": null, "overrideGunpingNum": null },
    …
  ]
}
```

流程：

1. 读取会话 cookie；无 → `200 { ok: false, notLoggedIn: true, error: '请先登录目标站' }`（前端弹登录框）。
2. 校验 `platformId` 合法（`1/2/3/4/6/7/15/20/26/29/31`）；逐项校验 `gender`（男/女）、`style`（18 种之一）、数量（0–20）、语速/音调范围（解压 0.5–2.0 / -50–50；滚屏 0.1–2.0）。
3. 逐本（**顺序执行，非并发**）：
   - 从 store 读取 `<bookId>.txt`（**该本最新编辑版**）与 meta；缺失 → 该项 `error: '未找到已保存的正文'`。
   - 用该本 `gender/style`（item 覆盖优先，其次 meta，再次报错要求补选）。
   - 组装 multipart（见 §四），`files[]` 为该本 txt（文件名 `${bookId}.txt`）。
   - `POST http://two.121w.com/tttadmin/api/zbooklist_upload.php`，带 cookie。
   - 响应 JSON：`data.success === true` → 成功；否则失败（`data.message`）。网络/超时（30s）→ 失败可读原因。
4. 返回 `{ ok: true, results: [{ bookId, status: 'ok'|'error', error }] }`。

> 会话失效探测：某本返回登录页/未授权 → 整批中断，返回 `200 { ok: false, notLoggedIn: true, error: '目标站登录已失效，请重新登录' }`，前端提示重新登录。

## 四、目标站 multipart 字段（已实测确认）

| 字段 | 含义 | 取值 |
|---|---|---|
| `platform_id` | 平台 | 1黑岩/2番茄/3七猫/4点众/6阅文/7番茄免费/15知乎/20掌阅/26卓越/29九州/31掌文 |
| `gender` | 性别 | 1=男 / 2=女 |
| `style` | 风格 | 101古风虐文/102古风甜文/103古风通用/201年代虐文/202年代甜文/203年代通用/301现代虐文/302现代甜文/303现代悬疑/304现代通用/305男频都市/306现代女主/307玄幻/308历史/309爆款BGM/310家庭奇葩/311家庭伤感/312职场打脸 |
| `tl5` | 时长限制 | 0=不限制 / 1=限制 |
| `ziti` | 字体 | 1–6（默认1） |
| `zitidx` | 一行字数 | 62…130（默认62） |
| `biaohong` / `biaohong_reuse` | 标红 | 文本 / 复用值（默认空） |
| `keywords` | 关键词 | 文本（默认空） |
| `jieya_num` | 解压生成数量 | 0–20（默认4） |
| `jieya_ai_head` | AI头部 | 0/1/2（默认0；3 回退 0） |
| `jieya_speed` | 解压语速 | 0.5–2.0（默认1.7） |
| `jieya_pitch` | 解压音调 | -50–50（默认0） |
| `font_color_styles` | 字体颜色 | JSON 数组，1–4 个，默认 `[1]` |
| `gunping_num` | 滚屏生成数量 | 0–20（默认4） |
| `gunping_speed` | 滚屏语速 | 0.1–2.0（默认1） |
| `files[]` | 小说文件 | `.txt`，多选；本功能一次一本 |
| `background_music` / `background_music_mode` / `bg_image` / `bg_image_mode` | 音乐/背景图 | 本期不传 |

- 上传用 `multipart/form-data`（Node 内置 `http.request` + 手拼 boundary，不引第三方依赖；与项目 `novel-fetch.js` 用 `https` 内置模块的风格一致）。
- 目标站为 **HTTP**，用 `node:http`。

## 五、前端交互（NovelFetchPage.jsx）

### 文档查看/编辑弹窗（核心：AI 处理后仍可编辑）

- 每本已处理成功的行新增 **「编辑」** 操作（原有「查看/预览」对已处理行升级为可编辑）。
- 弹窗内 `Input.TextArea`（`autoSize`，只读模式 vs 编辑模式切换）展示该书**当前编辑版正文**：
  - 未处理的书 → 只读预览（保持现状）。
  - 已处理的书 → 可编辑；顶部显示书 ID、处理类型、AI 分析性别/风格（此处不可改性别风格，仅在下方上传面板可改）。
- 按钮：**保存**（`POST /api/novel-fetch/save` 覆盖后端 `<bookId>.txt`，提示保存成功）、**下载**（用**当前弹窗内编辑后的内容**生成 `<bookId>.txt` 下载）、关闭。
- 编辑内容未保存时关闭 → 提示「有未保存的修改」。
- 行状态 `induced.edited` 记录「相对 AI 结果是否被用户改过」，用于上传面板提示「该本已手动编辑」。

### 入口

工具栏「批量下载」之后新增按钮 **「对接上传」**（lucide `UploadCloud`）。已处理（`induced` 存在）的书才可选。

### 登录弹窗

- 打开上传面板且后端无有效会话 → 先弹登录 Modal：账号、密码、登录按钮。
- `POST /api/novel-fetch-upload/upload-login`；成功进入配置界面；失败提示「登录失败，请检查账号密码」。
- 会话过期（上传返回 `not_logged_in`）→ 自动重新弹登录框。

### 上传配置 Modal

- **平台下拉**：默认当前行的平台（10 项 + 阅文）。
- **解压视频高级设置**：生成数量(0–20，默认4)、AI头部(不加/单视频/复用)、解压语速(0.5–2.0，默认1.7)、解压音调(-50–50，默认0)。
- **滚屏视频高级设置**：生成数量(0–20，默认4)、滚屏语速(0.1–2.0，默认1)。
- **逐本列表**（Table）：书 ID、处理类型、AI 分析性别/风格（Select 可改）、解压/滚屏数量（每本可覆盖，默认用配置值）。每行可点 **「编辑」** 直接改该本文档（与上文同一编辑弹窗，保存即落盘）。
- 说明文案：本期不支持背景音乐与自定义 AI 头部视频。
- 底部按钮：**开始上传**（loading）、**关闭**。

### 上传结果

- 逐本状态回显（成功/失败+原因），失败行可**单独重试**。
- 全部结束后汇总 `message`：成功 X 本，失败 Y 本。

## 六、错误处理

| 场景 | 行为 |
|---|---|
| 目标站登录失败/密码错误 | 400，登录框保留并提示 |
| 会话过期/被顶 | 批量中断，返回 `200 + notLoggedIn:true`，自动重新弹登录框 |
| 某本正文未落盘 | 该项 `error: '未找到已保存的正文'`，其余继续 |
| 某本性别/风格未填 | 该项 `error: '请为该本选择性别和风格'`，其余继续 |
| 目标站超时/网络错误 | 该项失败可读原因，可重试 |
| AI 未解析出性别/风格 | `analysis: null`，前端列表中手动补选后再上传 |

## 七、测试（node:test，`tests/`）

- `novel-fetch-upload-contract.test.js`：
  - `extractAnalysis` 解析正常 JSON、缺节、非法风格的回退。
  - 预设 seed 文案包含「分析结果」节与 18 种风格名。
  - `POST /save`：合法保存写文件/更新 `updatedAt`；非法 bookId/空文本拒绝；无 meta 但行内处理过的首次落盘。
  - multipart 拼装含正确字段与边界格式（注入假 `httpClient` 捕获请求体）。
  - `upload-batch`：会话缺失 → 401；逐本失败不影响其他本；顺序执行；读取的是编辑后版本。
  - `upload-login`：注入假 `httpClient` 校验成功/失败路径与 cookie 保存。
- 全量回归 `node --test tests/` + `npm --prefix frontend run build`。

## 八、待办文件清单

| 动作 | 文件 |
|---|---|
| 新增 | `lib/novel-fetch-store.js` |
| 新增 | `routes/novel-fetch-upload.js` |
| 新增 | `tests/novel-fetch-upload-contract.test.js` |
| 修改 | `lib/system-preset-catalog.js`（两个预设加分析节） |
| 修改 | `routes/novel-fetch.js`（`extractAnalysis` + process 返回 analysis + 保存落盘 + `POST /save`） |
| 修改 | `frontend/src/shared/api/novelFetch.js`（saveNovelContent/uploadLogin/uploadSession/uploadBatch） |
| 修改 | `frontend/src/user/pages/NovelFetchPage.jsx`（编辑弹窗+入口+登录弹窗+配置弹窗+逐本列表+结果） |
| 修改 | `app.js`（挂载新路由） |
