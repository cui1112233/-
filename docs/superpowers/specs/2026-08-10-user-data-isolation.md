# 用户数据隔离设计

## 目标

让 6 个登录账号拥有互相独立的 API 配置和生成历史，避免一个账号看到或覆盖另一个账号的数据。

本轮采用已确认方案：把现有根目录全局数据归属到主账号 `choushiyiguai`。旧根目录文件不自动删除。

## 当前问题

当前登录只完成身份入口：

- `middleware/auth.js` 能把 Bearer token 解析为 `req.username`。
- `routes/config.js` 仍读写全局 `api-config.json`。
- `routes/history.js` 仍读写全局 `outputs/index.json` 和 `outputs/*.txt`。

结果是：不同账号登录后仍共享 API Key、模型配置和生成记录。

## 数据目录

新增运行时用户目录：

```text
data/users/<username>/api-config.json
data/users/<username>/outputs/index.json
data/users/<username>/outputs/<id>.txt
```

`data/users/` 包含 API Key 和生成内容，必须加入 `.gitignore`。

## 迁移规则

### API 配置

如果根目录存在旧 `api-config.json`，第一次访问主账号 `choushiyiguai` 的配置时：

- 复制到 `data/users/choushiyiguai/api-config.json`。
- 保留根目录旧文件，不删除。
- 其他账号不复制旧配置，默认使用空配置。

如果主账号目录已经存在 `api-config.json`，不重复覆盖。

### 生成历史

如果根目录存在旧 `outputs/index.json`，第一次访问主账号 `choushiyiguai` 的历史时：

- 复制 `outputs/index.json` 到 `data/users/choushiyiguai/outputs/index.json`。
- 复制 `outputs/*.txt` 到 `data/users/choushiyiguai/outputs/`。
- 保留根目录旧 `outputs/`，不删除。
- 其他账号不复制旧历史，默认空历史。

如果主账号用户历史目录已经存在 `index.json`，不重复覆盖。

## 后端接口行为

### 配置接口

`routes/config.js` 改为使用 `req.username`：

- `GET /api/config` 读取当前用户配置。
- `POST /api/config` 保存当前用户配置。

不同用户保存不同的 `api-config.json`。

### AI 调用接口

`routes/chat.js` 改为使用当前用户配置：

- `POST /api/test` 读取 `req.username` 的配置。
- `POST /api/chat` 读取 `req.username` 的配置。

这样不同用户可使用不同模型、Base URL 和 API Key。

### 历史接口

`routes/history.js` 改为使用 `req.username`：

- `GET /api/history` 只返回当前用户历史。
- `POST /api/history` 只写入当前用户输出目录。
- `GET /api/history/:id` 只读取当前用户输出目录。
- `DELETE /api/history` 只清空当前用户历史。
- `DELETE /api/history/:id` 只删除当前用户单条历史。

## 共享工具接口

`lib/shared.js` 增加用户路径工具：

- `safeUserName(username)`
- `getUserDir(username)`
- `getUserConfigPath(username)`
- `getUserOutputsDir(username)`
- `getUserHistoryIndex(username)`
- `ensureUserDir(username)`
- `readConfig(username)`
- `writeConfig(username, config)`
- `readHistoryIndex(username)`
- `writeHistoryIndex(username, data)`

所有需要用户数据的调用必须传入 `req.username`。

## 兼容边界

为了避免破坏现有运行状态：

- 不删除根目录 `api-config.json`。
- 不删除根目录 `outputs/`。
- 不自动迁移到非主账号。
- 不改变登录账号列表和密码。
- 不改变提示词和生成格式。

## 验证标准

实现后至少验证：

- 主账号登录后能读取从旧 `api-config.json` 迁移来的配置。
- 第二账号登录后配置为空或默认，不显示主账号 API Key 状态。
- 主账号保存配置不会影响第二账号。
- 主账号和第二账号生成历史互相不可见。
- 清空第二账号历史不会删除主账号历史。
- `node scripts/validate-multipage-architecture.js` 继续通过。
- `node -c server.js`、`node -c lib/shared.js`、`node -c routes/config.js`、`node -c routes/chat.js`、`node -c routes/history.js` 通过。

## 后续不在本轮处理

- 密码加密存储。
- Token 过期时间。
- 用户管理页面。
- 把根目录旧文件自动归档或删除。
- 提示词冲突问题。
