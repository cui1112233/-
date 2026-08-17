# 小说获取功能设计

## 目标

在「一战晟铭」前端新增「小说获取」页面（路径 `/novel-fetch`），通过后端代理调用 `https://txt.121w.com/api.php` 文本接口，按书籍 ID 批量获取小说内容，支持按平台选择、字数选择、逐本查看/复制/下载、单选/全选与批量操作。

接口参数对照（与 `txt.121w.com/api.php` 一致）：

- `bookid` — 书籍 ID（可批量）
- `platform` — 平台 ID（由下拉名称自动映射）
- `max_txt` — 截取字数

## 交互与页面结构

### 导航与入口

- 左侧导航新增「小说获取」项，图标使用与现有导航一致的 lucide 线性图标 `BookOpen`（size 18、strokeWidth 1.8），放在「剧本生成」之后、其余项之前。
- 路由：`frontend/src/user/App.jsx` 的 `getPage` 增加 `/novel-fetch` 映射到新页面组件。
- 后端 `routes/pages.js` 增加 `router.get('/novel-fetch', serveReactEntry('index.html', 'index.html'))`，保证直接访问该 URL 不 404。
- 顶栏标题由 `navItems` 的 label 自动呈现为「小说获取」。

### 顶部表单（一行，仿图二风格）

从左到右：

1. **平台下拉**：只显示平台名称，选中项的数据结构为 `{ id, name }`，提交时自动取 `id` 作为 `platform`。10 个选项：
   - 黑岩付费（1）、番茄付费（2）、七猫付费（3）、点众付费（4）、番茄免费（7）、知乎付费（15）、掌阅付费（20）、卓越付费（26）、九州书城（29）、掌文付费（31）
2. **书籍 ID 输入框**：多行文本框，批量输入，按换行 / 逗号 / 空格 / 分号 解析多个 ID，自动去重、去空、去非法字符。
3. **字数下拉**：500 / 1000 / 2000 / 3000 / 5000 / 10000，并提供「自定义」让用户输入任意数值（默认 2000）。
4. **获取按钮**（主按钮）+ **重置按钮**。

校验：未选平台、无有效书籍 ID 时提示并阻止提交；书籍 ID 数量上限 50 个，超出给出提示。

### 结果列表（每本书一行）

每本书一行，包含：

- 复选框（单选；可多选）
- 书籍 ID
- 平台名称
- 状态：获取中 / 成功 / 失败（失败显示错误信息）
- 实际字数（成功时）
- 「查看」按钮：弹出详情弹窗，正文可读，含「复制」按钮一键复制到剪贴板
- 「下载」按钮：无需进入详情，点击直接下载为 `{bookid}.txt`
- 失败项提供「重试」按钮（用当前平台与字数重新获取该 ID）

列表顶部工具栏：

- 全选复选框
- 批量复制：把选中项内容合并（每本以「bookid —— 平台名」分隔）复制到剪贴板
- 批量下载：逐个触发选中项下载

## 数据流

前端 `NovelFetchPage.jsx` 提交表单 → `shared/api/novelFetch.js` 的 `fetchNovelContent({ platform, bookIds, maxTxt })` → `POST /api/novel-fetch` → 后端并发代理到 `txt.121w.com/api.php` → 返回按书分组的 `results`。

## 后端接口

新增 `routes/novel-fetch.js`，挂载于 `app.js`：`app.use('/api/novel-fetch', novelFetchRouter)`。沿用 `apiAuth` 鉴权（与 `routes/tts.js` 一致）。

`POST /api/novel-fetch`：

- 请求体：`{ platform: number, bookIds: string[], maxTxt: number }`
- 校验：`platform` 必须为已支持的平台 ID；`bookIds` 非空数组且每项为合法书籍 ID（1–20 位数字）；`maxTxt` 为 100–100000 的整数。
- 对每个 `bookId` 并发发起 HTTPS GET：`https://txt.121w.com/api.php?bookid=<id>&platform=<platform>&max_txt=<maxTxt>`，单个请求超时 20s。
- 上游响应 JSON 形如 `{ code, msg, data }`：
  - `code === 200` 且 `data` 为非空字符串 → 成功
  - 否则 → 该书失败，`error` 取 `msg`
  - 网络/超时/非 JSON → 该书失败，给出可读错误
- 响应：`{ results: [{ bookId, platform, platformName, status: 'ok' | 'error', data, error, length }] }`，按请求顺序返回。

平台 ID → 名称映射在后端单独维护一份常量，与前端一致，用于回填 `platformName`。

## 前端实现

- 新文件 `frontend/src/user/pages/NovelFetchPage.jsx`：React + Ant Design（Form / Select / Input.TextArea / InputNumber / Checkbox / Table 或自定义列表 / Modal / message），复用 `legacy-*` 主题变量与 `user-theme-active` 弹窗样式。
- 新文件 `frontend/src/shared/api/novelFetch.js`：封装 `fetchNovelContent`，通过 `apiRequest` 发送带 Bearer token 的 POST。
- 下载：构造 Blob（`text/plain;charset=utf-8`），用 URL.createObjectURL 触发 `<a download>` 点击。
- 复制：`navigator.clipboard.writeText`，失败回退到 `document.execCommand('copy')`。
- 平台常量与字数选项在前端维护，供下拉渲染。

## 测试

- 新增契约测试 `tests/novel-fetch-contract.test.js`（沿用读取源码 + 正则断言的模式）：
  - `app.js` 已挂载 `/api/novel-fetch` 路由；`pages.js` 提供 `/novel-fetch` 页面路由。
  - `App.jsx` 将 `/novel-fetch` 映射到页面；`UserLayout.jsx` 导航含「小说获取」与 `BookOpen` 图标。
  - 页面组件包含平台下拉 10 个选项、批量书籍 ID 解析、字数选项、逐本查看/复制/下载、全选、批量复制/下载、失败重试。
  - 后端路由包含 `platform` 白名单校验、`bookIds` 校验、`max_txt` 校验、按 `code === 200` 判定成功。
- 后端接口可手动验证：`POST /api/novel-fetch` 返回按书分组结果，成功/失败各含对应字段。
- 前端生产构建必须通过（`npm --prefix frontend run build`）。

## 不在范围内

- 不实现书单/收藏/历史持久化。
- 不处理第三方接口的鉴权、签名或加密字段。
- 不修改 TTS、剧本生成、小说面板等现有功能。
- 不接入真实书籍元信息（书名/作者），仅返回文本内容。
