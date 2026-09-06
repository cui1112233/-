# OBJ Live Log｜V88 小说面板 V78.3.0.31 实时执行记录

> 日期：2026-09-06
> 仓库：`cui1112233/-`
> 分支：`v88`
> 主记录：`docs/obj/2026-09-06-v783031-execution-record.md`
> 当前状态：`SOURCE VERIFIED / V31 RELEASE DISTRIBUTION VERIFIED / ECS AUTO-DEPLOY IMPLEMENTED / ECS SSH SECRET CHECK IN CI / PUBLIC DEPLOYMENT PENDING`

---

## 2026-09-06｜执行节点 01｜重新定位 Linux AMD64 发布失败根因

目标 workflow：

- `V88 Linux AMD64 Public Image Release`
- run：`34017327266`
- job：`101443305692` (`build-release`)

### 实际步骤结果

1. Checkout V88 release source：PASS
2. Assert Linux AMD64 runner：PASS
3. Setup Node：PASS
4. Build frontend：PASS
5. Verify V88 pet release contract：PASS
6. Build V88 AMD64 Docker image：PASS
7. Save release package：PASS
8. Upload V88 AMD64 release artifact：FAIL

### 已确认产物

- Docker image：`qiantie-v88:public-21eefd231526`
- 架构：`linux/amd64`
- Docker image SHA：`sha256:5693888d592b69811375ff4247033610fe1b5731121e33ad1fafb1c8202f6b77`
- 发布包：`qiantie-v88-linux-amd64-21eefd231526.tar.gz`
- 发布包大小：约 `68M`
- SHA256：`371bee9811850a56edc68b92aa1def65406372c07bdf3205877b11451599c406`
- `RELEASE-METADATA.txt`：已生成
- `SHA256SUMS`：已生成
- `ECS-STORAGE.txt`：已生成

### 真正失败原因

GitHub Actions `actions/upload-artifact@v4` 返回：

`Failed to CreateArtifact: Artifact storage quota has been hit. Unable to upload any new artifacts.`

结论：

> V31 Linux AMD64 镜像并没有构建失败。镜像、tar.gz、SHA256、ECS 元数据全部成功生成；失败只发生在 GitHub Actions Artifact 持久化阶段，因为 Artifact 存储配额已满。

### 当前判断

- 业务源码：正常
- V31 回归：7/7 PASS
- Docker build：正常
- Linux AMD64 image：已成功构建
- release tar.gz：已成功生成在 runner 临时磁盘
- GitHub Artifact：未保存
- ECS：尚未部署
- 公网：尚未验证

---

## 2026-09-06｜执行节点 02｜发布链修复 TDD RED

### 设计决定

仅依赖“删除旧 Artifact 后立即重新上传”不够可靠，因为 GitHub 错误明确提示 storage usage 可能需要 `6–12 hours` 重新计算。

因此发布链采用双通道：

1. `GHCR`：主发布通道，存放可直接给 ECS 拉取的 Linux/AMD64 Docker image。
2. `GitHub Actions Artifact`：兼容下载通道；继续生成 tar.gz，但 Artifact 配额问题不能阻断已经成功推到 GHCR 的正式发布。
3. 上传前自动清理旧 `qiantie-v88-linux-amd64-*` artifacts，降低后续再次触发配额上限的概率。

### TDD RED

新增：

`tests/novel-panel-v783031-release-artifact-retention.test.js`

提交：

`3f31ae00e867302b02efdd213fe432817c10fc3c`

V31 regression run：

- run：`34017761486`
- job：`101444511052`
- 结果：按预期 FAIL
- 其他原有 V31 测试继续 PASS

期望失败：

`release workflow must have actions: write so it can prune old release artifacts`

随后测试继续扩展，要求：

- `actions: write`
- `packages: write`
- `actions/github-script@v7`
- `listArtifactsForRepo`
- `deleteArtifact`
- 保留最近 2 个 V88 AMD64 release artifacts
- `docker/login-action@v3`
- GHCR 登录
- immutable GHCR image push
- release metadata 记录 `registry_image`
- Artifact 上传为兼容通道，配额失败不阻断 GHCR 成功发布

扩展测试提交：

`384ac37afaef73cd3aaf64421140a435c88d2772`

---

## 2026-09-06｜执行节点 03｜发布链最小实现

修改：

`.github/workflows/v88-linux-amd64-image-release.yml`

提交：

`90cd3c1a908432a96f265b92bc4fb4b7e6fe4585`

### 已加入

- workflow permissions：
  - `contents: read`
  - `actions: write`
  - `packages: write`
- Docker build 后生成 GHCR immutable image 名称：
  - `ghcr.io/<owner>/qiantie-v88:public-<SHORT_SHA>`
- `docker/login-action@v3` 登录 GHCR
- `docker push "$GHCR_IMAGE"`
- `RELEASE-METADATA.txt` 新增：
  - `registry_image=${GHCR_IMAGE}`
- `ECS-STORAGE.txt` 记录 GHCR 为主发布通道
- `actions/github-script@v7` 自动清理旧 V88 AMD64 release artifacts
- 保留最近 `2` 个旧发布 artifact
- `actions/upload-artifact@v4` 保留为兼容通道并设置 `continue-on-error: true`

---

## 2026-09-06｜执行节点 04｜发布链 GREEN + GHCR 实际发布成功

### V31 回归

Workflow：`Novel Panel V78.3.0.31 Regression`

- run：`34017818181`
- result：`success`
- 当前 V31 regression：`8 / 8 PASS`

说明：新增的 release distribution regression 已进入专用 V31 CI，并从 RED 转为 GREEN。

### Linux AMD64 发布

Workflow：`V88 Linux AMD64 Public Image Release`

- run：`34017818178`
- job：`101444667352`
- conclusion：`success`

实际步骤：

1. Checkout V88 release source：PASS
2. Assert Linux AMD64 runner：PASS
3. Setup Node：PASS
4. Build frontend：PASS
5. Verify V88 pet release contract：PASS
6. Build V88 AMD64 Docker image：PASS
7. Login to GHCR：PASS
8. Push V88 AMD64 image to GHCR：PASS
9. Save release package：PASS
10. Prune old V88 AMD64 release artifacts：PASS
11. Upload V88 AMD64 release artifact：Artifact quota 仍未刷新，但已设置兼容非阻断；release job 最终 SUCCESS

### 正式 GHCR 镜像

- image：`ghcr.io/cui1112233/qiantie-v88:public-90cd3c1a9084`
- registry digest：`sha256:cbfcd3de69c06617af545559c2266cca1d4db29d57f2cd10f6b3f8a4cae5aad8`
- local build image：`qiantie-v88:public-90cd3c1a9084`
- local Docker image SHA：`sha256:01e589a8eca6527419f4a491ef4f785738c86e31d7907586ca20c6357770f994`
- architecture：`linux/amd64`

### tar fallback

- archive：`qiantie-v88-linux-amd64-90cd3c1a9084.tar.gz`
- size：约 `68M`
- SHA256：`05650cc6105a250eea8f35d21a2f2368893ed3ffcd1af98ee8c469133d588efe`

### Artifact 清理

真实执行结果：

- 检测到旧 V88 AMD64 release artifacts：`16`
- 自动删除：`14`
- 保留最近：`2`
- cleanup step：PASS

Artifact 存储额度仍提示需要 `6–12 hours` 重新计算，因此本次兼容 tar artifact 尚未重新持久化；这不影响 GHCR 正式镜像已经发布。

---

## 2026-09-06｜执行节点 05｜ECS 自动部署通道检查

### 检查结果

仓库未发现以下现成部署通道：

- 公网 ECS IP 写入现有 workflow
- `SSH_HOST` / ECS SSH secrets 命名
- `appleboy/ssh-action`
- `scp` / SSH 自动发布脚本
- Volcano Engine / TOS 发布脚本

已知生产运行形态按现有 V88 部署保持：

- ECS：`115.190.156.223`
- SSH 用户：`root`
- Docker Compose 工作目录：`/opt/v88`
- Compose 文件：`/opt/v88/docker-compose.yml`
- service：`v88-node`
- 当前生产镜像 tag：`v88-public-v88-node:v88-latest`

设计决定：

> 不在 ECS 上保存 GHCR 凭据。GitHub Runner 使用已经构建并验证通过的本地镜像，通过 SSH 流式执行 `docker save | gzip | ssh ... docker load`，然后在 ECS 原地给镜像打生产 tag，并用现有 Docker Compose 强制重建 `v88-node`。这样数据库、Redis、环境变量、volume、network、端口均继续由现有 Compose 管理。

唯一需要的 GitHub Secret：

`V88_ECS_SSH_PRIVATE_KEY`

如果该 Secret 不存在：workflow 必须显式记录 `ECS_DEPLOY_READY=false` 并跳过 ECS；不能伪装成已经部署。

---

## 2026-09-06｜执行节点 06｜ECS 部署 TDD RED + 实现

### RED 测试

新增：

`tests/novel-panel-v783031-ecs-deploy.test.js`

初始提交：

`183106449b1862dab9ec20ab142bbb016b0ba8c9`

随后增加生产安全要求：验证失败必须自动恢复旧生产镜像，而不只是保留 rollback tag。

扩展测试提交：

`09b24b78e1c38a5201fdeb1b666a4f7d381b6e37`

V31 regression：

- run：`34017985059`
- job：`101445141537`
- 结果：按预期 RED
- 总测试：`9`
- PASS：`8`
- FAIL：`1`
- 唯一失败：`V78.3.0.31 guarded ECS deployment regression`
- 期望错误：`release workflow must prepare the ECS SSH channel`

原有 V31 业务、发布分发、版本身份等测试继续 PASS。

### GREEN 实现

修改：

`.github/workflows/v88-linux-amd64-image-release.yml`

提交：

`e4b59f272806e203b251c5a47f772d958d9760e2`

加入：

1. 固定生产目标：
   - `ECS_HOST=115.190.156.223`
   - `ECS_USER=root`
2. `Prepare V88 ECS SSH`
   - 读取 `V88_ECS_SSH_PRIVATE_KEY`
   - Secret 缺失时设置 `ECS_DEPLOY_READY=false` 并明确跳过
   - Secret 存在时仅允许 key-only / password-disabled SSH
   - 预检 root、Docker、Docker Compose、`/opt/v88/docker-compose.yml`
3. `Deploy verified image to V88 ECS`
   - `docker save "$IMAGE_NAME" | gzip -1 | ssh ... 'gunzip | docker load'`
   - 当前 `v88-public-v88-node:v88-latest` 先保存为 `v88-public-v88-node:rollback-<SHA>-<timestamp>`
   - 新镜像重新 tag 为 `v88-public-v88-node:v88-latest`
   - `cd /opt/v88`
   - `docker compose up -d --no-deps --force-recreate v88-node`
4. `Verify V88 ECS deployment`
   - ECS 本机 `127.0.0.1:3000/api/novel-panel/build-info`
   - 公网 `115.190.156.223:3000/api/novel-panel/build-info`
   - 强制要求 `app_version=v78.3.0.31`
   - 强制要求 `release_version=v78.3.0.31`
   - 验证公网 `/novel-panel` 可访问
5. `Rollback V88 ECS on failed verification`
   - `if: failure()`
   - 读取部署前记录的 rollback image
   - 恢复 `v88-public-v88-node:v88-latest`
   - 再次强制重建 `v88-node`
   - 没有 rollback 记录时拒绝猜测

### 当前阶段

正在检查提交 `e4b59f27...` 触发的真实 Actions：

- V31 regression 是否 9/9 GREEN
- Linux AMD64 release 是否继续成功
- `V88_ECS_SSH_PRIVATE_KEY` 在 GitHub 是否已经存在
- 如果存在：本轮会直接执行 ECS 发布 + 公网 V31 验证
- 如果不存在：本轮会明确跳过 ECS，下一步只剩一次性把现有 ECS SSH 私钥加入 GitHub Secret
