# 小说面板 V78.3.0.2 集成设计

## 目标

将最新版「视频画面提示词工具 V78.3.0.2（分镜场景锚点内容事件归属全局时间轴根治版）」完整接入 qiantie 的小说面板（`/novel-panel`）。沿用既有同源工作台 + bridge 桥接架构，不启动 EXE、不依赖本机端口。

## 当前状态

- 小说面板工作台资产托管在 `public/novel-panel/workbench/`，当前为 V77（Hotfix23 级别）。
- `bridge.js` 把 iframe 内 `/api/*` 请求转发到父页面，父页面以 Bearer 调用 `/api/novel-panel/*`。
- qiantie 后端 `routes/novel-panel.js` 已实现 V77 端点；V78 新增部分端点。

## 目标资产（来自 V78.3.0.2 压缩包 `_internal/app/`）

| 源 | 目标 |
| --- | --- |
| `templates/index.html` | `workbench/index.html` |
| `static/style.css` | `workbench/style.css` |
| `static/app.js` | `workbench/app.js` |
| `static/character-core/character-core.js` | `workbench/character-core/character-core.js` |
| `static/clean-core/`（20 个模块） | `workbench/clean-core/` |

`outline-quality-gate.js` 在 V78 中不再存在（逻辑并入 clean-core），不再同步。

## index.html 变换

- 所有 `/static/style.css`、`/static/app.js`、`/static/character-core/*`、`/static/clean-core/*` 改写为 `/novel-panel/workbench/*`。
- 去掉 `?v={{asset_version}}...` 版本后缀。
- 移除 service worker / caches 清理段。
- 首个子脚本前注入唯一一次 `<script src="/novel-panel/workbench/bridge.js"></script>`。
- 校验：clean-core 全部模块均被改写、bridge 唯一、无 `{{asset_version}}` 残留。

bridge.js 使用现网较新版本（410s 超时、AbortController 取消、MessageChannel 通道），从 sync 脚本中抽出为独立模板文件，避免内嵌旧版重复。

## 后端路由新增（routes/novel-panel.js）

| 端点 | 实现 |
| --- | --- |
| `GET /build-info` | 返回 v78.3.0.2 完整 build 信息（release_version、workspace_schema_version=40 等，对齐 main.py `_V77_BUILD_INFO`） |
| `GET /clean-core/health` | build + checks 列表 |
| `GET /diagnostics/self-check` | ok/build/checks/summary，复用 ai-diagnostic-store |
| `GET /diagnostics/traces?limit=` | ai-diagnostic-store 提供 trace 列表 |
| `GET /diagnostics/trace/:id` | trace 详情 |
| `GET /history`、`POST /history` | 历史记录列表 / 新建 |
| `GET /history/:id`、`PUT /history/:id`、`DELETE /history/:id` | 读取 / 覆盖 / 删除 |
| `PATCH /history/:id/note` | 更新备注 |
| `POST /character-core/resolve-scene-cast` | 补齐 |
| `POST /character-core/build-scene-context` | 补齐 |

## 历史记录存储（新增 lib/novel-panel/history-store.js）

- 按用户隔离：`data/users/<username>/novel-panel/history/hist_*.json`
- 记录结构：`schema / history_id / note / created_at / updated_at / summary / instruction_revision / workspace`
- summary 计算对齐 main.py `_history_summary`（source_preview、character_count、scene_count、shot_count、duration）
- 原子写入、ID 白名单校验（`hist_` 前缀 + `[A-Za-z0-9_-]`）、无跨账号访问

## 精品带图降级实现

- `GET/POST /image-settings`、`POST /image-settings/test`：按用户持久化 `data/users/<username>/novel-panel/image-settings.json`；test 只做结构校验与可选连通性探测。
- `POST /reference-assets/upload`、`POST /reference-assets/use-source-as-main`：data URL 按用户落盘到 `reference_assets/`，返回 url/metadata。
- `GET /reference-assets/file/:type/:id/:variant`：路径白名单校验后服务图片文件。
- `POST /reference-assets/describe`：统一设置无视觉模型能力时返回明确错误。
- `POST /reference-assets/generate`：图片生成接口未配置时返回 502 + 明确中文提示（V78 前端自带降级，不崩溃）。
- `POST /native-clipboard/copy-rich`：网页无法写系统剪贴板，返回 503 + 提示；V78 前端自带 `v34BrowserRichCopy` 浏览器剪贴板回退。

## 质量闸门与核心链路

- 保留后端 `validateOutlineApplyGate`（V78 沿用相同 `outline_shots` 字段名，协议锁定兼容）。
- 核心接口（analyze / outline-scenes / regenerate-scene-outline / optimize-* / projects / instruction-assist / runtime-config / settings / 既有 character-core）保持不动，用 V78 实际载荷逐项验证。

## 测试

- 更新 `tests/novel-panel-asset-contract.test.js`：改为 clean-core 契约、移除 outline-quality-gate 断言。
- 新增 history-store 与新增路由测试。
- 回归：`node --test tests/novel-panel-*.test.js`、`node --check`、前端构建。

## 非目标

- 不实现真实的图片生成 API 服务（依赖图片 AI 设置，用户可自配）。
- 不实现 Windows 原生系统剪贴板（网页环境不可行，使用浏览器剪贴板回退）。
