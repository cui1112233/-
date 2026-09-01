# V78 公网正式运行环境设计（115.190.156.223）

## 目标

把当前 V78 运行环境部署到公网服务器 `115.190.156.223`，使用户通过：

`http://115.190.156.223`

访问完整 V78，而不依赖用户本地电脑或 Docker Desktop 持续在线。

本阶段只做 HTTP/80，不启用 HTTPS。后续有域名后再升级到 443/TLS。

## 基线

- 仓库：`cui1112233/-`
- 部署设计分支：`ops/v78-public-115.190.156.223`
- 起始代码基线：`283d5354061f0509923c2522e7c2db82e637f901`
- 基线来源：`feat/v78-novel-fetch-v2-completion`

## 核心架构

公网只暴露一个 HTTP 入口：

```text
Internet
  |
  v
115.190.156.223:80
  |
  v
Nginx
  |
  v
V78 Node (internal only)
  |
  +--> internal services / MySQL / Browser Worker
```

浏览器端继续使用同源相对 API（例如 `/api/login`、`/api/batch-rewrite/...`），不得把公网 IP 硬编码进 React/API client。

## 端口策略

公网允许：

- TCP 80：V78 HTTP 入口
- TCP 22：仅用于服务器管理，建议安全组限制为管理员固定来源 IP

公网不得暴露：

- V78 Node 内部端口
- 121 Browser Worker 8787
- MySQL 3306
- Redis（如使用）
- Go/视频服务内部端口

内部服务只通过 loopback 或 Docker private network 互通。

## Nginx

Nginx 监听：

- `0.0.0.0:80`
- `server_name 115.190.156.223`

Nginx 将 `/` 全量反代到 V78 Node。

必须传递：

- `Host`
- `X-Real-IP`
- `X-Forwarded-For`
- `X-Forwarded-Proto`

必须支持较长业务请求和较大的上传请求，避免小说文件、视频、合并或发布流程因默认 Nginx 限制出现 413/504。

本阶段不在 Nginx 中暴露 Browser Worker 或数据库路径。

## V78 Node

V78 Node 继续监听 `0.0.0.0`，实际容器端口由部署环境变量统一确定。

生产 Docker 只把 Node 端口发布到宿主机 loopback，例如：

```text
127.0.0.1:<host-port> -> container:<node-port>
```

不允许绑定成：

```text
0.0.0.0:<node-port>
```

这样公网用户只能经过 Nginx 进入 V78。

## 121 Browser Worker

121 Browser Worker 必须独立容器运行，保持 Playwright/Chromium 与 V78 Node 主镜像分离。

Worker：

- 使用内部 Docker network
- 不映射 8787 到公网
- session storage 使用独立持久卷
- `restart: unless-stopped`
- V78 Node 通过内部服务名访问 Worker

凭据、cookie、Playwright storage state 不进入 Git、日志或前端响应。

## 持久化

生产数据必须使用服务器持久卷/目录，不得放在临时容器文件系统。

需要持久化的至少包括：

- V78 用户/系统 data
- Novel Fetch / Browser session references
- 121 Browser Worker storage state
- MySQL 数据（若 MySQL 属于本部署栈）
- 业务 outputs / media references（按现有架构）

容器更新不得删除这些数据。

## 自动恢复

所有长期运行服务使用：

`restart: unless-stopped`

因此：

- 用户电脑关机不影响 V78
- Docker Desktop 是否运行不影响服务器
- 云服务器 Docker daemon 重启后容器自动恢复

## 安全组 / 防火墙

服务器或云厂商安全组：

允许：

- `80/tcp` from `0.0.0.0/0`

SSH：

- `22/tcp` 建议只允许管理员来源 IP

明确拒绝公网访问：

- 3306
- 8787
- V78 Node 内部端口
- 其他 internal service ports

## 部署方式

不直接修改当前正在运行的生产容器。

部署采用 candidate-first：

1. 拉取指定完整 Git SHA。
2. 构建带 SHA 标识的 V78 candidate image。
3. 构建带 SHA 标识的 121 Browser Worker candidate image。
4. 使用独立 Compose project / private network / 临时端口启动 candidate。
5. 验证健康状态、登录、核心 API、Novel Fetch、121 Worker session、上传/发布关键路径。
6. candidate 验证通过后，才允许切换 Nginx upstream 到正式 V78 candidate。
7. 保留上一个可工作的 image/SHA，出现问题立即回滚 Nginx/upstream 和应用容器。

## 不做的事情

本设计不授权：

- 把 master 未审查代码直接部署到生产
- 把 3306/8787 等内部端口暴露公网
- 将密码/API key/Browser storage state 写入仓库
- 为了公网访问而把 React API URL 全部改成 `http://115.190.156.223/...`
- 在 candidate 验证前替换当前生产 `:3000`
- 删除或覆盖现有生产数据卷

## 验收标准

切换正式入口前必须确认：

1. `http://115.190.156.223` 能打开 V78。
2. 静态资源正常加载。
3. `/api/build-info` 返回预期版本。
4. 登录/退出正常。
5. 页面刷新后登录会话行为符合现有 V78 约定。
6. Novel Fetch 主要 API 可用。
7. Browser Worker 未直接暴露公网。
8. 121 session/test/refresh 通过内部网络运行。
9. 大请求不会被 Nginx 默认限制直接拦截。
10. 重启应用容器后数据仍存在。
11. 重启 Docker daemon 后长期容器自动恢复。
12. 从公网无法访问 3306、8787 和 Node internal port。
13. 有明确、已演练的回滚步骤。

## Codex/服务器执行边界

网页版 GPT 负责：

- 部署配置、Nginx 配置、Compose、文档和静态审查。

Codex/具备服务器权限的执行端负责：

- SSH 登录 `115.190.156.223`
- 检查 Docker/Nginx/磁盘/端口/安全组实际状态
- 在隔离 candidate 环境运行测试
- 经用户确认后切换生产入口

任何实际生产切换都必须以被审查的完整 Git SHA 为准。