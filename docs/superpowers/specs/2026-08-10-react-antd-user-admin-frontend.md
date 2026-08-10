# React + Antd 前后台统一前端设计

## 背景

当前项目已经完成 Express 多页面、Bearer 鉴权、按用户数据隔离，以及真实 prompt 后端内置化。下一阶段准备把纯 HTML / CSS / JavaScript 前端迁移到 React + Antd，并同时建设：

- 用户端 / 前台：面向小说转可视化剧本、配音、历史记录等生产流程。
- 管理端 / 后台：面向系统配置、用户管理、运行状态、策略开关等管理流程。

用户明确要求：管理端和用户端要放在同一个文件夹，避免后期 AI 无法理解整体思路。

## 核心结论

采用一个统一的 `frontend/` React + Antd 工程，内部按 `user`、`admin`、`shared` 分区。

不把管理端和用户端拆成两个独立工程；不做隐藏在不同目录、不同构建链路里的两套前端。

## 目标

1. 保留 Express 作为后端入口和 API 层。
2. 前端统一迁移到 React + Antd。
3. 用户端和管理端同处一个 `frontend/` 文件夹。
4. 共享鉴权、API 客户端、基础布局、主题和通用组件。
5. 真实 prompt 继续只在后端 `prompts/` 内部读取，不进入 React 前端构建产物。
6. 路由语义清晰，便于后期 AI 或人工快速理解：
   - `/`、`/script`、`/tts`：用户端。
   - `/admin`、`/admin/*`：管理端。
   - `/api/*`：后端接口。

## 非目标

1. 不改后端技术栈为 Go、Next.js 或其他框架。
2. 不把真实 prompt 暴露给前端。
3. 不把后台做成可以直接查看完整 prompt 原文的页面。
4. 不在第一阶段重做全部业务逻辑。
5. 不删除现有 HTML 页面，迁移期间保留可回退路径。

## 目录结构

```text
qiantie/
├── server.js
├── routes/
├── lib/
├── middleware/
├── prompts/                    # 后端私有；不进入前端构建
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   ├── admin.html
│   └── src/
│       ├── shared/
│       │   ├── api/
│       │   │   ├── client.js
│       │   │   ├── auth.js
│       │   │   ├── config.js
│       │   │   ├── generation.js
│       │   │   └── history.js
│       │   ├── components/
│       │   ├── layouts/
│       │   ├── styles/
│       │   └── utils/
│       ├── user/
│       │   ├── main.jsx
│       │   ├── App.jsx
│       │   ├── routes.jsx
│       │   ├── pages/
│       │   │   ├── HomePage.jsx
│       │   │   ├── ScriptPage.jsx
│       │   │   ├── TtsPage.jsx
│       │   │   └── HistoryPage.jsx
│       │   └── components/
│       └── admin/
│           ├── main.jsx
│           ├── App.jsx
│           ├── routes.jsx
│           ├── pages/
│           │   ├── DashboardPage.jsx
│           │   ├── UsersPage.jsx
│           │   ├── ConfigPage.jsx
│           │   ├── PromptStrategyPage.jsx
│           │   └── RuntimePage.jsx
│           └── components/
└── docs/
```

## 构建方式

使用 Vite 多入口构建：

- `frontend/index.html` 对应用户端入口。
- `frontend/admin.html` 对应管理端入口。

Express 生产环境服务打包后的静态资源：

```text
frontend/dist/
├── index.html
├── admin.html
└── assets/
```

建议后端路由：

| 路径 | 返回 |
|------|------|
| `/` | 用户端 React 入口 |
| `/script` | 用户端 React 入口 |
| `/tts` | 用户端 React 入口 |
| `/history` | 用户端 React 入口 |
| `/admin` | 管理端 React 入口 |
| `/admin/*` | 管理端 React 入口 |
| `/api/*` | Express API |

说明：用户端和管理端可以各自使用 React Router，但入口仍是两个清晰的前端应用，不把前后台混成一个巨大 SPA。

## 用户端职责

用户端面向生产流程，第一批页面：

1. 首页
   - 创作入口。
   - 最近历史。
   - API 配置入口。
   - 登录状态。
2. 剧本生成页
   - 小说输入。
   - 人物场景提取。
   - 生成模式选择：连续开头 / 爆款开头。
   - 输出格式选择：剧情模式 / 画布模式 / 剧本模式。
   - 时长选择：10s / 15s。
   - 生成结果、复制、导出、保存历史。
3. 配音页
   - 文本输入。
   - 角色音色、语速、音调、风格。
   - 音频生成。
4. 历史页
   - 当前登录账号自己的历史记录。
   - 查看、复制、删除、清空。

## 管理端职责

管理端面向维护和治理，第一批页面：

1. Dashboard
   - 服务状态。
   - 当前版本。
   - 用户数。
   - 生成记录数量。
   - 配置完整度。
2. 用户管理
   - 用户列表。
   - 启用 / 禁用。
   - 重置密码。
   - 查看用户数据目录状态。
3. API 配置管理
   - 查看每个用户是否已配置 API。
   - 不展示完整 API key，只展示脱敏状态。
4. Prompt 策略管理
   - 展示策略名称：连续开头、爆款开头、剧情模式、画布模式、剧本模式。
   - 展示启用状态、版本号、更新时间。
   - 不展示真实 prompt 全文。
   - 后续如需编辑 prompt，必须单独设计权限和审计，不在第一阶段开放。
5. 运行状态
   - 最近错误。
   - 上游 API 测试。
   - TTS 服务状态。

## Prompt 安全边界

前端永远不直接读取 `prompts/*.md`。

允许前端传：

```json
{
  "promptType": "script",
  "mode": "hook",
  "format": "storyboard",
  "duration": "10s",
  "novelText": "...",
  "characters": "...",
  "scenes": "..."
}
```

不允许前端传或接收：

```json
{
  "systemPrompt": "...真实提示词..."
}
```

后台 Prompt 策略页只展示：

- 策略名称。
- 策略说明。
- 启用状态。
- 版本号。
- 最近更新时间。

不展示真实 prompt 原文。

## 共享模块

`frontend/src/shared/` 是前后台共同理解项目的关键，不允许把同类逻辑散落到 `user` 和 `admin` 两边重复实现。

共享模块包括：

| 模块 | 说明 |
|------|------|
| `shared/api/client.js` | `fetch` 封装、Bearer token 注入、错误处理 |
| `shared/api/auth.js` | 登录、登出、当前用户 |
| `shared/api/config.js` | API 配置读写 |
| `shared/api/generation.js` | 人物提取、剧本生成 |
| `shared/api/history.js` | 历史列表、读取、删除、清空 |
| `shared/layouts/` | 用户端和后台布局基础 |
| `shared/components/` | 通用按钮、空状态、加载状态、错误提示 |
| `shared/styles/` | 主题 token、全局样式 |

## Antd 使用原则

用户端：

- 表单：`Form`、`Input.TextArea`、`Select`、`Segmented`。
- 操作：`Button`、`Tooltip`、`Dropdown`。
- 展示：`Tabs`、`List`、`Card`、`Tag`。
- 状态：`Spin`、`Progress`、`Alert`、`Empty`。
- 弹窗：`Modal`、`Drawer`。

管理端：

- 布局：`Layout`、`Menu`、`Breadcrumb`。
- 数据：`Table`、`Descriptions`、`Statistic`。
- 操作：`Switch`、`Popconfirm`、`Button`。
- 配置：`Form`、`Input.Password`、`Select`。

视觉原则：

- 生产工具要密度适中，避免营销页风格。
- 前台偏创作工作台，后台偏管理控制台。
- 不使用大面积装饰渐变。
- 不用卡片套卡片。

## 迁移阶段

### 阶段 1：前端工程骨架

- 创建 `frontend/`。
- 安装 React、Vite、Antd。
- 建立 `user`、`admin`、`shared` 三分区。
- 打通 Express 静态服务。

### 阶段 2：共享 API 与鉴权

- 实现 `shared/api/client.js`。
- 迁移登录弹窗。
- 统一 token 存储和 401 处理。

### 阶段 3：用户端迁移

- 首页。
- 剧本生成页。
- 历史记录。
- 配音页。

### 阶段 4：管理端最小可用版

- `/admin` 入口。
- Dashboard。
- 用户列表。
- 配置状态查看。
- Prompt 策略状态查看。

### 阶段 5：替换旧 HTML

- 验证 React 用户端完整覆盖旧页面能力。
- 更新 `routes/pages.js`。
- 保留旧页面一段时间作为回退。
- 最后再删除旧 HTML / CSS / JS。

## 验收标准

1. `frontend/` 内同时包含用户端和管理端。
2. 用户端和管理端共享 `shared/api/client.js`。
3. `/admin` 能打开后台入口。
4. 前端构建产物中不包含 `prompts/*.md` 原文。
5. 浏览器访问 `/api/prompt` 不返回真实提示词。
6. 用户端生成流程仍通过 `/api/chat`，由后端拼接真实 prompt。
7. 后台只显示 prompt 策略元信息，不显示完整真实 prompt。
8. Express 后端仍负责 API、鉴权、数据隔离和 prompt 保护。

## 风险与约束

1. React 迁移期间不要一次性删除旧页面，否则回退成本高。
2. Antd 默认样式体积较大，需要统一引入和构建优化。
3. 如果后台未来支持 prompt 编辑，必须新增权限、审计和版本回滚设计。
4. 当前账号体系仍是硬编码账号，不适合公开部署；后台用户管理只能作为本地 MVP。
5. 当前 token 在内存中，服务重启会失效；React 前端需要处理 401 后重新登录。

## 推荐下一步

先写实施计划，再动代码。实施计划应拆成小步：

1. 创建 `frontend/` 骨架。
2. 接入 Antd 和共享 API 客户端。
3. 做用户端首页壳。
4. 做管理端 Dashboard 壳。
5. 配置 Express 服务 React 构建产物。
6. 验证 prompt 不进入前端构建产物。
