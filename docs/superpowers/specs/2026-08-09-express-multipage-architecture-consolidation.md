# Express 多页面架构收口设计

## 目标

把当前 `qiantie` 项目稳定到已经确认的目标架构：

- 后端使用 Express。
- 页面由 Express 按独立路由提供。
- 首页不再作为单页面 SPA 容器。
- 技术文档描述当前真实架构，而不是旧版手写 Node 服务。

本设计不修改提示词行为。`通用规则.md` 与 `爆款开头.md` 的规则冲突本轮先忽略。

## 当前问题

项目正处在架构迁移的半完成状态。

当前服务端已经基于 Express，并通过 `routes/pages.js` 提供页面路由；但 `docs/技术文档.md` 仍描述为“零依赖、手写 Node 路由、使用 X-Auth-Token”。

当前前端同时存在真实多页面和 SPA 残留。`/script`、`/agent`、`/tts` 已经是独立页面，但 `index.html` 里还内嵌了 `page-script` 和 `page-agent`，并使用 `data-page` 做页面内切换。

登录已经存在，但用户数据隔离没有完成。API 配置和生成历史仍使用全局文件。本轮只记录为下一阶段优先问题，不在本轮实现。

## 范围

### 本轮包含

- 保留 Express 作为后端框架。
- 将 `/` 收口为真正的首页。
- 保留 `/script`、`/agent`、`/tts` 三个独立页面。
- 从首页移除 SPA 式页面切换。
- 首页侧边栏和快捷入口全部改为真实 URL 跳转。
- 更新技术文档，使其匹配 Express、路由模块、Bearer 鉴权、静态资源和页面路由。
- 增加已知问题记录：用户数据隔离未完成、测试脚本过期。

### 本轮不包含

- 提示词架构调整。
- AI 生成效果调整。
- 用户级配置和历史隔离的实现。
- 鉴权安全加固。
- 视觉重设计。
- TTS 服务商替换。

## 目标页面架构

Express 提供四个用户页面：

| 路由 | 文件 | 用途 |
| --- | --- | --- |
| `/` | `index.html` | 首页仪表盘和导航入口 |
| `/script` | `views/script.html` | 小说提取与剧本生成工作流 |
| `/agent` | `views/agent.html` | Agent 工作区占位页 |
| `/tts` | `views/tts.html` | 配音工作区 |

首页不得再包含 `page-script` 或 `page-agent`。这些内容只能存在于各自的独立页面文件中。

导航全部使用真实路由：

- 首页到剧本生成：`/script`
- 首页到 Agent：`/agent`
- 首页到配音：`/tts`
- 侧边栏统一使用 `data-href`

## 前端公共职责

`public/js/common.js` 保留为公共浏览器脚本，负责：

- 主题切换。
- 侧边栏收起和移动端遮罩。
- `data-href` 导航。
- API 设置弹窗。
- 登录状态和 Bearer token。
- Toast 提示。

`public/js/script.js` 只由 `views/script.html` 加载。

`public/js/tts.js` 只由 `views/tts.html` 加载。

首页不应依赖剧本生成页面的 DOM ID，例如 `novel-input`、`output-area`、`char-list`、`scene-list`。

## 后端架构

后端继续使用 Express。

`server.js` 作为应用组合入口：

- 创建 Express app。
- 挂载 JSON body 解析和静态资源服务。
- 挂载各个路由模块。
- 启动服务。

路由模块保持当前职责：

- `routes/pages.js`：HTML 页面。
- `routes/auth.js`：登录。
- `routes/config.js`：API 配置。
- `routes/chat.js`：上游 AI 代理和测试接口。
- `routes/prompt.js`：提示词文件读取。
- `routes/history.js`：生成历史。
- `routes/tts.js`：TTS 代理。

不回退到旧版手写 HTTP 路由。

## 文档更新

`docs/技术文档.md` 需要改为说明：

- 后端使用 Express。
- `package.json` 依赖 Express。
- 页面通过真实服务端路由提供。
- API 鉴权使用 `Authorization: Bearer <token>`。
- 静态资源位于 `public/`。
- 页面文件位于 `views/`。
- 当前请求体限制为 `50mb`。
- 用户数据隔离尚未完成。

文档必须移除或改写以下旧说法：

- 零第三方依赖。
- 不使用 Express/Koa/Fastify。
- 使用 `X-Auth-Token` 鉴权。
- 手写 `routeRequest`。
- 当前前端是单文件 SPA。

## 下一阶段遗留问题

### P0：用户数据隔离

当前登录没有真正隔离用户。`api-config.json`、`outputs/index.json` 和生成文件仍是全局共享。下一阶段应确认存储结构，建议方向：

```text
data/users/<username>/api-config.json
data/users/<username>/outputs/index.json
data/users/<username>/outputs/<id>.txt
```

### P1：测试脚本过期

`test-gen.js` 仍使用旧的 `X-Auth-Token` 行为，后续应更新或删除。

### P1：工作区清理

调试文件、二进制输出和日志文件需要在实现提交前统一检查，避免混入正式提交。

## 验证方式

实现后执行：

- `node -c server.js`
- `node -c public/js/common.js`
- `node -c public/js/script.js`
- 使用 `npm start` 启动服务。
- `GET /` 返回首页。
- `GET /script` 返回剧本生成页。
- `GET /agent` 返回 Agent 页。
- `GET /tts` 返回配音页。
- 首页不再包含 `id="page-script"` 或 `id="page-agent"`。
- `/script` 仍包含剧本生成工作流。
- 未登录访问 `GET /api/config` 返回 `401`。

## 验收标准

- 代码库只有一种清晰页面模型：Express 提供的多页面。
- `index.html` 不再是剧本页和 Agent 页的 SPA 容器。
- 主要页面之间使用真实路由跳转。
- 技术文档匹配当前 Express 实现。
- 用户隔离和测试脚本问题被明确记录为下一阶段工作。
