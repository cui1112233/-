# V78 公网部署 Runbook（115.190.156.223）

## 目标

将 V78 长期运行在云服务器 `115.190.156.223`。部署完成后，用户电脑关机或 Docker Desktop 退出都不影响公网访问。

公网唯一入口：

- `http://115.190.156.223`

不要把 MySQL、Go API、V78 Node 或 121 Browser Worker 的内部端口开放到公网。

## 固定来源

V78/部署 checkout：

- branch: `ops/v78-public-115.190.156.223-v3`
- V78 base SHA: `50c0c91651c3c1d8d15bb9d67ba37fcda7c6a925`
- 部署时使用本 runbook 最终报告给出的 deployment HEAD，不要直接跟随其它开发分支。

Go checkout：

- source branch: `feat/v78-novel-fetch-go-bridge`
- verified SHA: `13e40da4092046846ad13c5c0bbb15918216465a`

执行部署前必须记录两个 checkout 的完整 SHA，并先审查 diff。`deploy.sh` 会拒绝 Go checkout 与上述 SHA 不一致的情况。

## 推荐目录

```text
/opt/qiantie/v78   # V78 + deploy/v78-public
/opt/qiantie/go    # Go backend checkout
```

## 服务器准备

需要：

- Git
- Docker Engine
- Docker Compose plugin（`docker compose`）
- TCP 80 对公网开放
- SSH 端口只用于管理，尽量限制来源 IP

不要对公网开放：3306、3000、4000、8787。

## 配置

进入：

```bash
cd /opt/qiantie/v78/deploy/v78-public
cp .env.example .env
```

把 `.env` 里的所有 `CHANGE_ME_...` 替换为随机强密码/密钥。不要提交 `.env`。

推荐用：

```bash
openssl rand -hex 32
```

分别生成 bridge、worker、credential 密钥。MySQL 密码也使用独立随机值。

确保：

```text
QIANTIE_GO_SOURCE_DIR=/opt/qiantie/go
QIANTIE_GO_EXPECTED_SHA=13e40da4092046846ad13c5c0bbb15918216465a
```

## 审查后启动

Go checkout 必须解析到：

```text
13e40da4092046846ad13c5c0bbb15918216465a
```

建议 Codex 使用 detached HEAD 或在 `feat/v78-novel-fetch-go-bridge` 上 checkout 该 SHA，避免分支后续移动影响本次部署。

然后：

```bash
cd /opt/qiantie/v78/deploy/v78-public
bash deploy.sh
```

脚本会先启动内部 candidate，并检查：

1. Go checkout SHA 与本次验证 SHA 完全一致。
2. V78 Node 能正常响应。
3. Node 能访问 Go API。
4. Node 能访问 121 Browser Worker。
5. 上述检查全部成功后，才启动 Nginx 80 公网入口。
6. 最后再次验证本机公网入口。

任何内部检查失败时，不应切换公网入口。

## 上线后验证

服务器内：

```bash
cd /opt/qiantie/v78/deploy/v78-public
bash verify.sh
```

服务器外再检查：

```text
http://115.190.156.223
```

至少验证：

- 登录页能打开。
- 登录成功。
- 小说获取页面能打开。
- 新建一个测试任务后刷新页面，任务仍存在（证明 MySQL bridge 生效）。
- 121 登录/测试入口能正常调用 Browser Worker。
- 重启 Docker 服务/容器后数据仍存在。

## 回滚

`deploy.sh` 在覆盖当前应用镜像之前，会保存上一版应用镜像为 `:rollback`。

需要应用回滚时：

```bash
cd /opt/qiantie/v78/deploy/v78-public
bash rollback.sh
```

回滚脚本只恢复上一版应用镜像，不主动删除 MySQL 数据卷。

## 数据保护

不要执行：

```bash
docker compose down -v
```

`-v` 会删除持久化卷，不属于正常部署或回滚步骤。

正常更新使用 `bash deploy.sh`，正常回滚使用 `bash rollback.sh`。
