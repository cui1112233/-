# v88 小说获取源文件设计

## 目标

把用户提供的“批量原文改文系统”压缩包中的可复用流程，迁移为 qiantie-v88 的模块化小说获取链路，优先解决 121 浏览器登录、配置同步、原文获取、预览、提交和状态确认。设计目标是“可逐项验收”，不是把旧 Python 工具整体搬进 v88。

## 输入材料与边界

用户提供的参考包：

`G:\Backup\Documents\WXWork\1688857688816333\Cache\File\2026-08\批量原文改文系统 - 副本(1).zip`

已只读检查其源码和文档。压缩包内的 `main.py`、`site_submit_helper.py`、`dual_server.py`、`static/app.js`、配置样例和文档可作为设计参考；`data/`、`runtime/`、`__pycache__/`、浏览器会话、任务队列和包含账号/密码的配置内容不迁移、不执行、不提交。

旧工具体现的可复用原则：

1. 任务按书籍 ID 独立保存原文、原始备份、改文版本、元数据和日志。
2. 121 网站登录由浏览器自动化完成，登录会话单独持久化，登录、测试、配置同步、提交分步执行。
3. 配置档和风格目录从目标站同步后再提交，提交配置与书籍任务分离。
4. 批量任务按单本记录成功、失败、跳过、待确认，不因一本失败而把整批伪装成成功。
5. 上传后必须等待明确的站点反馈，并通过书籍列表再次核验；“请求已发出”不等于“提交成功”。
6. 本地服务与访客端口是运行方式，不是业务模块；v88 继续由 Node、Browser Worker、MySQL 和 Nginx 组成。

## v88 源文件分层

### 1. 浏览器端

- `frontend/src/shared/api/novelFetch.js`
  - 只负责把页面动作映射到后端实际路由。
  - 登录、会话测试、配置同步、风格同步、环境检查、预览、提交和单本重试必须使用同一套 v2 路径，不允许保留旧的幽灵前缀。
  - 不保存密码、121 Cookie、Worker secret 或第三方 Token。

- `frontend/src/user/pages/NovelFetchPage.jsx`、`frontend/src/user/pages/NovelFetchWorkshopPage.jsx` 及其样式文件
  - 显示流程步骤和每本书的状态。
  - 将“平台登录”“登录验证”“配置同步”“原文获取”“预览”“提交网络”“提交确认”分开显示。
  - 失败消息显示可操作原因；不要把 HTML 网关页面或内部密钥信息直接展示给用户。

### 2. Node API 与业务编排

- `routes/novel-fetch.js`
  - 负责源站原文获取、书籍 ID/平台参数校验、原文保存和单本重试。
  - 源站网络失败、响应格式错误、空正文和短正文要保留可追踪状态。

- `routes/novel-fetch-upload.js`
  - 负责 121 登录、会话检查、批量上传入口。
  - 仅接收页面所需的安全字段；密码只短暂传入登录动作，不能回显或写日志。
  - 上传结果按书籍返回，基础设施错误不能降级成“121 密码错误”。

- `routes/novel-fetch-workshop.js`
  - 负责小说改文工作台的任务、原文、规则、AI 版本和配置接口。
  - 只调用下层 `tasks`、`configStore` 和 `runner`，不重复实现浏览器登录。

- `routes/novel-fetch-web-submit.js`（若当前入口存在）
  - 作为 v2 批量提交入口的唯一适配层，禁止与 upload 路由各自保存一套提交状态。
  - 旧接口如需兼容，必须内部转发到同一服务并保留相同错误语义。

### 3. 121 浏览器 Worker 与服务层

- `lib/novel-fetch-workshop/121-browser-client.js`
  - 只处理 Node 到 Browser Worker 的内部请求、超时、401、不可用和结果解析。
  - Node/Worker 内部 401 映射为 `BROWSER_WORKER_UNAUTHORIZED`/503；不能当作目标站 `session_expired`。

- `lib/novel-fetch-workshop/121-credential-store.js`
  - 使用服务端密钥加密/保护 121 凭据，按用户隔离。
  - 不把明文凭据、Cookie 或 session state 返回浏览器。

- `lib/novel-fetch-workshop/121-web-submit-service.js`
  - 统一登录会话、目标站 action、配置档同步、风格同步、上传、书籍列表核验和状态归并。
  - 上传可得到 `accepted_pending`，只有列表中找到匹配书号且关键字段、版本和素材数量核对通过，才进入 `confirmed/submitted`。

- `lib/novel-fetch-workshop/v2-compose.js`
  - 只负责把 Browser Client、Credential Store、Web Submit Service、Task Store 组装起来。
  - 不在这里复制上传或登录逻辑。

- `lib/novel-fetch-workshop/v2-batch-executor.js`、`lib/novel-fetch-workshop/runner.js`
  - 编排“输入→分类→抓原文→规则处理→生成版本→可选提交”的顺序。
  - 每本书独立记录结果；Worker 基础设施故障可停止当前批次并明确报告，不得被 per-item catch 吞掉。

- `lib/novel-fetch-workshop/tasks.js`、`queue-store.js`、`mysql-store.js`、`config.js`
  - 统一任务、版本、日志、重试、配置和浏览器会话持久化。
  - 原文、处理后正文、提交记录和登录会话不能混存为一份不可区分的大 JSON。

### 4. 部署与验收

- `docker-compose.v88-review.yml`
  - Node 与 `novel-fetch-121-worker` 通过同一变量获得内部密钥；Worker 保持内网可达，不暴露到公网。
  - 121 凭据密钥和 H3/API Token 只能通过 ECS 环境变量或密钥注入。

- `deploy/v88-public/` 的 Compose/Nginx/发布文件
  - 公网只代理到明确的 v88 Node；发布前必须记录镜像 ID、源码 SHA、包 SHA256 和 `/api/build-info`。
  - 不修改 V78/production 容器，不用旧 V78 build-info 证明 v88 已上线。

## 用户可见流程

```text
保存 121 账号
  -> Browser Worker 登录
  -> 保存并验证登录会话
  -> 同步配置档与风格目录
  -> 输入书籍 ID 获取原文
  -> 原文保存并显示可预览内容
  -> 选择版本/配置并提交网络
  -> 等待上传反馈
  -> 通过 121 书籍列表核验
  -> 显示 已确认 / 待确认 / 失败，并允许单本重试
```

每个阶段都必须有独立状态。浏览器看到的“登录成功”只表示目标站会话测试成功；它不代表原文获取或上传已经成功。

## 统一错误语义

| 层级 | 示例 | 用户看到的含义 | HTTP |
|---|---|---|---:|
| v88 平台鉴权 | 平台登录令牌失效 | 请重新登录 v88 | 401 |
| Node→Worker 内部鉴权 | Worker secret 不一致 | 服务配置异常，请联系管理员 | 503 |
| Worker 不可用/超时 | Browser Worker 无响应 | 浏览器服务暂不可用，请稍后重试 | 503 |
| 121 目标会话失效 | `session_expired`/`expired` | 重新保存账号并验证 121 登录 | 401 |
| 121 账号错误 | 目标站明确拒绝账号密码 | 121 账号或密码错误 | 401 |
| 上传已接收未核验 | 无匹配书籍列表记录 | 已发送，等待 121 后台确认 | 202/业务状态 |
| 目标站业务失败 | 明确上传失败/参数错误 | 修正配置或书籍信息后重试 | 400/业务状态 |

## 测试与发布门槛

### 源码合同测试

至少覆盖：

- 121 登录、会话测试、会话刷新和错误分类。
- 上传后 `accepted_pending` 与列表匹配后的 `confirmed` 状态转换。
- Worker 401/503/timeout 不被批量循环吞掉。
- 前端实际调用路径与后端挂载路径一致。
- 配置档、风格同步和提交状态刷新不泄露敏感字段。

### 本地用户验收

必须在当前构建启动后由用户看见：登录验证、配置同步、输入书号、正文预览和单本提交状态；没有真实 121 账号时只能验收页面和假 Worker 合同，不能宣称真实登录。

### ECS 公网验收

必须使用同一 v88 SHA 构建并发布，然后依次验证：

1. `/api/build-info` 与发布 SHA 一致。
2. `/novel-fetch` 加载的前端与该 SHA 一致。
3. 121 登录验证成功。
4. 一本书能获取正文并在任务详情中看到保存内容。
5. 上传后能看到明确反馈和列表核验结果。

## 明确不做的事情

- 不复制旧 Python `main.py` 作为 v88 后端。
- 不迁移压缩包中的 `data/`、`runtime/`、浏览器会话、任务队列或明文账号配置。
- 不为绕过 Worker 新增旧 PHP 登录回退。
- 不把健康检查、401、任务 ID、静态构建成功或本地 build-info 当作真实公网完成。
- 不修改 `master`、V78、production 或未命名的 ECS 容器。
