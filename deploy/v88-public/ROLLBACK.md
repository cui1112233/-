# V88 回滚说明

## 原则

回滚只使用仓库中已有、已验证的完整 Git SHA。Node 与 Go 镜像必须使用同一个 SHA；不使用 `latest`、本地构建镜像或 ECS 残留文件。

## 回滚步骤

1. 选择 `deploy/v88-public/releases/<sha>.manifest.json` 中的已验证发布点。
2. 核对清单中的 `release_sha`、Node 镜像和 Go 镜像后，再更新 `CURRENT_RELEASE`。
3. 在 ECS 上登录 GHCR，拉取清单中的两个完整镜像引用。
4. 使用仓库中的 Compose 和 Nginx 契约执行成对切换；保留当前 `.env` 与 Compose 备份，失败时恢复备份。
5. 依次验证 `/api/build-info` 的 `git_sha`、Node→Go `/health` 和 `/shuihuo-production` 返回码。
6. 只有三项验证全部通过，才将回滚标记为完成；否则恢复切换前版本并保留失败证据。

## 保留策略

至少保留最近三个已验证 `v88-release-<sha>` tag 和对应 manifest。清理 ECS 镜像前，必须确认保留 tag 的镜像仍可从 GHCR 拉取；数据库、任务状态和视频产物不参与回滚清理。
