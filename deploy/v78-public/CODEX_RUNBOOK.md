# V78 公网部署 Runbook V2（115.190.156.223）

## 当前正式入口

当前阶段固定使用：

- `http://115.190.156.223:3000`

公网 `3000` 只绑定 Nginx；Node `3000`、Go `4000`、MySQL `3306`、121 Worker `8787` 仅在 Docker 内部网络使用。

```text
Internet
  ↓
115.190.156.223:3000
  ↓
Nginx container :80
  ↓
v78-node:3000
  ↓
Go / MySQL / 121 Browser Worker
```

## 锁定来源

应用源码：

- V78 SHA: `cb9decd1054ca6c9e6931f6fb24627d6ae6f280c`
- Go SHA: `13e40da4092046846ad13c5c0bbb15918216465a`

部署脚本使用 GitHub Actions 成功产物中的 `DEPLOY_SHA`，不要手工拼接不同版本的 Compose、Nginx、脚本和镜像。

## 唯一支持的 ECS 生产流程

ECS 正式环境只使用：

```bash
bash offline-deploy.sh
```

不要在 ECS 正式环境执行在线构建脚本 `deploy.sh`。`deploy.sh` 默认会拒绝运行，只有明确设置 `QIANTIE_ALLOW_ONLINE_BUILD_DEPLOY=1` 才允许在有镜像仓库访问能力的非生产环境使用。

ECS 正式部署禁止：

```text
docker pull
docker build
docker compose down -v
```

不要删除 volume，不要重新生成 `.env`，不要更换锁定 SHA。

## Mac 的职责

Codex 所在 Mac 只负责：

1. 从成功的 GitHub Actions run 下载 artifact。
2. 校验 artifact digest / SHA256。
3. 解压后再次校验 `SHA256SUMS` 和 `DEPLOYMENT-SHA256SUMS`。
4. 原样上传到 ECS。

Mac 不负责 Docker 构建、架构转换或重新打包镜像。

## ECS 目录

活动配置：

```text
/opt/qiantie/v78/deploy/v78-public
```

建议每个新发布包先放到独立 incoming 目录，例如：

```text
/opt/qiantie/releases/incoming/<workflow-run-id>/
```

artifact 解压后应类似：

```text
/opt/qiantie/releases/incoming/<workflow-run-id>/
├── qiantie-v78-linux-amd64-base.tar.gz
├── qiantie-v78-linux-amd64-browser-worker.tar.gz
├── qiantie-v78-linux-amd64-go.tar.gz
├── qiantie-v78-linux-amd64-node.tar.gz
├── SHA256SUMS
├── DEPLOYMENT-SHA256SUMS
├── RELEASE-METADATA.txt
└── deployment/
    ├── .env.example
    ├── CODEX_RUNBOOK.md
    ├── backup.sh
    ├── deploy.sh
    ├── docker-compose.yml
    ├── nginx.conf
    ├── offline-deploy.sh
    ├── release-snapshot.sh
    ├── rollback.sh
    ├── verify.sh
    └── tests/deploy-v2-contract.sh
```

`incoming` 目录里绝对不能出现真实 `.env`、SSH key、Token 或密码。

## 首次使用 Deploy V2 前

活动目录必须保留现有：

```text
/opt/qiantie/v78/deploy/v78-public/.env
```

Deploy V2 不会重新生成密钥。如果旧 `.env` 还没有 `PUBLIC_PORT`，`offline-deploy.sh` 只会追加以下非秘密配置：

```text
PUBLIC_PORT=3000
```

不会覆盖已有 MySQL、Bridge、121 密钥。

建议同时准备备份加密口令文件：

```bash
umask 077
openssl rand -hex 32 > /root/.qiantie-backup-passphrase
chmod 600 /root/.qiantie-backup-passphrase
```

这个文件不要提交 GitHub，也不要上传到 artifact。

## 上线前备份

活动目录执行：

```bash
cd /opt/qiantie/v78/deploy/v78-public
bash backup.sh
```

备份包含：

- MySQL 逻辑 dump
- `v78_data`
- `v78_outputs`
- `browser_sessions`
- 加密后的 `.env`
- `SHA256SUMS`

Docker volume 是持久化，不等于备份。

## 上传后校验

假设发布目录：

```bash
RELEASE_DIR=/opt/qiantie/releases/incoming/33599999999
```

先验证镜像包：

```bash
cd "$RELEASE_DIR"
sha256sum -c SHA256SUMS
```

再验证部署文件：

```bash
cd "$RELEASE_DIR/deployment"
sha256sum -c "$RELEASE_DIR/DEPLOYMENT-SHA256SUMS"
```

任何一项不一致立即停止。

## 正式离线部署

执行：

```bash
RELEASE_DIR=/opt/qiantie/releases/incoming/33599999999
ACTIVE_DIR=/opt/qiantie/v78/deploy/v78-public

RELEASE_DIR="$RELEASE_DIR" \
ACTIVE_DIR="$ACTIVE_DIR" \
bash "$RELEASE_DIR/deployment/offline-deploy.sh"
```

脚本顺序：

1. 再次校验镜像和部署文件 SHA256。
2. 校验 `linux/amd64`、V78 SHA、Go SHA、DEPLOY_SHA、workflow run ID。
3. 在 `docker load` 前先快照当前 Compose、Nginx 和旧应用镜像标签。
4. 停止旧 Nginx，进入短暂维护窗口，避免未经验证的新容器直接对公网服务。
5. `docker load` 五个正式运行镜像。
6. 安装经过校验的新部署文件，但保留服务器 `.env`。
7. 使用 `--no-build --pull never` 启动 MySQL、Go、121、Node。
8. 等待 MySQL、121、Node health，并显式检查 Go `/health`。
9. 全部通过后再启动 Nginx。
10. 执行 `verify.sh`。

如果内部健康检查失败，Nginx 不会切回公网。脚本不会自动删除数据，也不会自动做破坏性修复。

## 验证

服务器内：

```bash
cd /opt/qiantie/v78/deploy/v78-public
bash verify.sh
```

应确认：

- MySQL 正常
- Node `/api/build-info` 正常
- Go `/health` 正常
- 121 `/healthz` 正常
- `http://127.0.0.1:3000/api/build-info` 正常

服务器外：

```text
http://115.190.156.223:3000
```

## 业务验收

基础设施验证通过不等于业务验收通过。还必须手动完成：

1. 登录页打开。
2. 正常登录。
3. 小说获取页面打开。
4. 创建测试小说任务。
5. 刷新后任务仍存在。
6. 实际执行 121 登录/验证。
7. 重启 `go-api browser-worker v78-node`。
8. 再次确认小说任务存在。
9. 确认 121 保存状态符合预期。

这些通过后才能称为完整生产验收。

## 回滚

Deploy V2 在导入新镜像前已经保存上一版快照到：

```text
/opt/qiantie/releases/previous
```

需要回滚时：

```bash
cd /opt/qiantie/v78/deploy/v78-public
bash rollback.sh
```

回滚恢复上一版运行时 Compose/Nginx 和应用镜像标签，不删除 MySQL、121 session、V78 data/output volume，也不重建 `.env`。

如果数据库版本包含不可逆 migration，必须先人工判断数据库兼容性，不能把镜像回滚等同于数据库回滚。

## 数据保护红线

永远不要在生产执行：

```bash
docker compose down -v
```

也不要删除：

- `mysql_data`
- `browser_sessions`
- `v78_data`
- `v78_outputs`

## 下一阶段

Deploy V2 先保证 `http://115.190.156.223:3000` 稳定、可重复部署和可回滚。

域名、HTTPS 443、HTTP → HTTPS 跳转、Secure Cookie、Passkey/WebAuthn 验证属于独立下一阶段。
