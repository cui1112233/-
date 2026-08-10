# Go + React + MySQL 重构设计草案

## 1. 背景

当前项目是 Node.js + Express 后端、纯 HTML/CSS/JavaScript 前端、本地 JSON 文件存储。它已经完成了 Express 多页面、Bearer 登录鉴权、按用户隔离 API 配置和生成历史等基础收口。

下一阶段建议重构为：

- 后端：Go，编译为单个二进制程序。
- 前端：React + Ant Design，替代当前纯 HTML 页面。
- 数据库：MySQL，替代本地 JSON 文件。

目标不是简单换技术栈，而是把当前工具升级成更容易维护、部署、扩展和让 AI 辅助开发的长期版本。

## 2. 重构目标

### 2.1 后端目标

- 使用 Go 提供 HTTP API、鉴权、AI 上游代理、TTS 代理、历史管理和提示词编排。
- 构建为单个二进制文件，便于本地运行、服务器部署和后续打包。
- 后端内部读取真实提示词，不把核心系统 prompt 暴露给前端。
- 保留流式生成能力，支持 SSE 透传。
- 使用 MySQL 存储用户、API 配置、生成历史、生成任务、提示词版本等数据。

### 2.2 前端目标

- 使用 React + Ant Design 重建页面，提升组件复用和交互一致性。
- 页面继续以业务页面划分，不回到旧式单文件大页面。
- 表单、表格、抽屉、弹窗、步骤条、标签编辑、历史列表等使用 Antd 标准组件。
- 前端只发送业务参数，不拼接真实 system prompt。
- 提供“系统预设词预览”时，只展示可公开的结构说明或脱敏摘要，不展示完整核心 prompt。

### 2.3 数据目标

- 从文件存储迁移到 MySQL。
- 保留旧数据迁移路径：旧 `data/users/<username>/api-config.json` 与 `outputs/index.json` 可导入 MySQL。
- 用户之间的数据必须继续隔离。
- 历史记录可检索、分页、按模式/格式筛选。

## 3. 推荐总体架构

```text
qiantie/
├── backend/                   # Go 后端
│   ├── cmd/qiantie/            # main 入口，编译为二进制
│   ├── internal/
│   │   ├── auth/               # 登录、token、用户上下文
│   │   ├── config/             # 用户 API 配置
│   │   ├── generation/         # 人物场景提取、剧本生成、AI 代理
│   │   ├── history/            # 历史记录
│   │   ├── prompt/             # 后端提示词读取、组合、版本管理
│   │   ├── tts/                # TTS 代理
│   │   ├── storage/            # MySQL 访问层
│   │   └── httpapi/            # 路由和中间件
│   ├── migrations/             # MySQL 表结构迁移
│   └── prompts/                # 服务端真实提示词文件或种子数据
├── frontend/                   # React + Antd 前端
│   ├── src/
│   │   ├── pages/              # Home、Script、Agent、TTS、Settings
│   │   ├── components/         # 通用组件
│   │   ├── api/                # API client
│   │   ├── stores/             # 登录态和页面状态
│   │   └── types/              # TypeScript 类型
│   └── vite.config.ts
├── docs/
└── legacy/                     # 迁移期保留旧 Express 版本或旧数据导入脚本
```

## 4. 技术选型

### 4.1 Go 后端

推荐：

- Web 框架：`net/http` + `chi`。
- 数据库：MySQL。
- SQL 工具：`sqlc` 或 `database/sql` + 小型 repository 层。
- 迁移工具：`golang-migrate`。
- 配置：环境变量 + `.env` 本地开发。
- 日志：Go 标准 `slog`。

理由：

- Go 编译后二进制部署简单。
- `chi` 足够轻量，路由清晰，适合当前 API 规模。
- 不建议上来使用过重框架，避免迁移成本失控。

### 4.2 React + Antd 前端

推荐：

- React + TypeScript。
- Vite 构建。
- Ant Design 组件库。
- 请求层使用 `fetch` 封装或 `axios`。
- 状态管理先用 React Context + hooks，复杂后再引入 Zustand。

理由：

- Antd 对后台工具型产品更友好，表单、表格、弹窗、抽屉、步骤条都成熟。
- TypeScript 让 AI 辅助修改时更容易保持接口一致。
- Vite 启动和构建简单，适合本地工具。

## 5. 页面规划

### 5.1 首页 `/`

职责：

- 展示最近生成历史。
- 展示当前登录用户和 API 配置状态。
- 提供进入剧本生成、Agent、TTS 的入口。

### 5.2 剧本生成 `/script`

核心工作流：

1. 粘贴小说原文。
2. 选择开头策略：连续开头 / 爆款开头。
3. 选择输出格式：剧情模式 / 画布模式 / 剧本模式。
4. 选择时长：10s / 15s。
5. 一键提取人物与场景。
6. 用户确认或修正人物、场景标签。
7. 生成最终内容。
8. 保存历史、复制、导出。

Antd 组件建议：

- `Steps`：展示两步生成流程。
- `Input.TextArea`：小说原文。
- `Segmented`：开头策略、输出格式、时长。
- `Card` 或 `List`：人物与场景结果。
- `Drawer`：编辑人物、场景详情。
- `Tabs`：不同格式输出。
- `Button`、`Dropdown`：复制、导出、重新生成。

### 5.3 设置 `/settings`

职责：

- 配置用户自己的 AI API provider、baseUrl、model、apiKey。
- 测试连接。
- 显示是否已配置 API key，但不回显完整 key。

### 5.4 历史 `/history`

职责：

- 分页展示生成历史。
- 支持按模式、格式、时间搜索。
- 支持查看、复制、删除、导出。

### 5.5 Agent `/agent`

先保留为可扩展工作区，不在第一阶段重构中过度设计。

### 5.6 TTS `/tts`

保留文本转语音能力：

- 文本输入。
- 声音、语速、音调、风格选择。
- 生成结果播放和下载。

## 6. API 设计

### 6.1 鉴权

```http
POST /api/login
POST /api/logout
GET  /api/me
```

第一阶段可继续使用本地账号表或数据库账号表。后续再做密码哈希、token 过期、刷新 token。

### 6.2 用户配置

```http
GET  /api/config
POST /api/config
POST /api/config/test
```

配置必须按当前登录用户隔离。

### 6.3 生成任务

```http
POST /api/extract
POST /api/generate
POST /api/generate/stream
```

前端只传业务参数：

```json
{
  "novelText": "小说原文内容",
  "mode": "continuous",
  "format": "storyboard",
  "duration": "10s",
  "characters": [],
  "scenes": []
}
```

后端根据参数选择并拼接真实提示词：

```text
role prompt + common rules + format prompt + user payload
```

### 6.4 历史

```http
GET    /api/history
GET    /api/history/{id}
DELETE /api/history/{id}
DELETE /api/history
```

### 6.5 提示词

```http
GET /api/prompt-presets
```

只返回可公开的预设名称、模式说明、版本号和更新时间，不返回完整真实 prompt。

不建议继续开放：

```http
GET /api/prompt?file={fileName}.md
```

原因：真实系统提示词属于后端资产，前端不应直接读取。

## 7. MySQL 表设计

### 7.1 users

```sql
CREATE TABLE users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);
```

### 7.2 api_configs

```sql
CREATE TABLE api_configs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  provider VARCHAR(64) NOT NULL,
  base_url VARCHAR(512) NOT NULL,
  model VARCHAR(128) NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uniq_user_config (user_id)
);
```

### 7.3 generation_histories

```sql
CREATE TABLE generation_histories (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  external_id VARCHAR(64) NOT NULL,
  mode VARCHAR(32) NOT NULL,
  format VARCHAR(32) NOT NULL,
  format_name VARCHAR(64) NOT NULL,
  duration VARCHAR(16) NOT NULL,
  preview VARCHAR(255) NOT NULL,
  output MEDIUMTEXT NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uniq_user_external_id (user_id, external_id),
  KEY idx_user_created_at (user_id, created_at)
);
```

### 7.4 prompt_versions

```sql
CREATE TABLE prompt_versions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL,
  version VARCHAR(64) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uniq_prompt_version (name, version)
);
```

第一阶段也可以继续从后端 `prompts/` 文件读取提示词，不急着把 prompt 写入数据库。`prompt_versions` 可以作为第二阶段能力。

## 8. 旧数据迁移

迁移范围：

- `data/users/<username>/api-config.json` -> `api_configs`
- `data/users/<username>/outputs/index.json` -> `generation_histories`
- `data/users/<username>/outputs/<id>.txt` -> `generation_histories.output`

迁移策略：

1. Go 后端提供一次性 CLI 命令：

```bash
qiantie migrate-legacy --source ./data/users
```

2. 迁移时按用户名匹配或创建用户。
3. 已存在的历史通过 `(user_id, external_id)` 去重。
4. 迁移不删除旧文件。

## 9. 提示词安全边界

当前要修正一个关键认知：

- 前端不要出现“系统预设词 - prompt（后端替换真实提示词）”这种说法。
- 正确表达是：前端选择“预设模式”和“输出格式”，后端内部选择并拼接真实提示词。
- 如果前端需要展示，只展示“预设名称、用途、版本、说明”，不展示完整系统提示词。

前端文案建议：

```text
系统预设词
后端将根据当前模式自动选择真实提示词。
```

或：

```text
当前预设：爆款开头 + 画布模式
真实提示词由后端内部组合，不在前端展示。
```

## 10. 分阶段实施

### 阶段一：后端基础迁移

- 建立 Go 项目结构。
- 实现登录、用户上下文、中间件。
- 实现 MySQL 连接和 migration。
- 实现 config/history 的 MySQL 读写。
- 保留旧 Express 版本不删除。

### 阶段二：生成链路迁移

- 后端实现 prompt 读取和组合。
- 实现 `/api/extract`、`/api/generate`、`/api/generate/stream`。
- 保留 OpenAI 兼容 API 代理能力。
- 增加错误分类：配置缺失、上游超时、上游非 JSON、流式中断。

### 阶段三：React + Antd 前端

- 建立 Vite + React + TypeScript 项目。
- 重建登录、首页、剧本生成、设置、历史页面。
- 前端接入 Go API。
- 保留真实 URL 路由。

### 阶段四：旧数据导入与收口

- 实现 legacy migration CLI。
- 导入旧 JSON 数据。
- 对照验证不同用户的数据隔离。
- 更新部署文档。

## 11. 风险与取舍

### 11.1 不建议一次性全量重写

Go 后端、React 前端、MySQL 数据库同时切换，风险较高。建议先让 Go 后端与旧前端并行验证，再切 React 前端。

推荐顺序：

```text
MySQL schema -> Go API -> 旧前端接 Go API -> React 前端 -> 旧 Express 下线
```

### 11.2 React 不等于单页面 SPA

可以使用 React，但仍然保留业务页面边界：

- `/`
- `/script`
- `/history`
- `/settings`
- `/agent`
- `/tts`

如果使用 React Router，也要保证每个路径可以直接刷新和访问。

### 11.3 Antd 的好处与限制

好处：

- 表单和表格稳定，AI 辅助生成代码更容易。
- 组件语义清晰，减少手写 CSS。
- 对后台工具型产品友好。

限制：

- 默认视觉风格较通用，需要少量主题定制。
- 如果过度使用弹窗和卡片，页面会变重。

## 12. 验收标准

- Go 后端可以通过一个二进制启动。
- MySQL 中不同用户的数据完全隔离。
- 旧 JSON 数据可以导入，且不删除旧文件。
- 前端不再读取真实 prompt 文件。
- 前端不展示完整系统 prompt，只展示预设摘要。
- React + Antd 页面覆盖当前核心工作流。
- `/script`、`/history`、`/settings` 等路径可以直接刷新。
- 流式生成正常。
- 生成历史可分页、可查看、可删除。

## 13. 当前建议

建议先执行“阶段一 + 阶段二”的后端迁移设计和计划，不急着马上重写前端。

原因：

- 当前最大架构变化是数据和提示词边界，应该先由后端稳定承接。
- React + Antd 前端依赖后端 API 形态，API 先稳定，前端改版会更顺。
- Go 二进制 + MySQL 跑通后，旧 HTML 前端还可以作为回退路径。
