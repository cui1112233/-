# OBJ Live Log｜V88 小说面板 V78.3.0.31 实时执行记录

> 日期：2026-09-06
> 仓库：`cui1112233/-`
> 分支：`v88`
> 主记录：`docs/obj/2026-09-06-v783031-execution-record.md`
> 当前状态：`SOURCE VERIFIED / V31 REGRESSION BASELINE 7/7 PASS / IMAGE BUILT / RELEASE DISTRIBUTION FIX IN CI / PUBLIC DEPLOYMENT PENDING`

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

### 当前阶段

实现已提交，正在等待/检查真实 GitHub Actions：

1. V31 regression 是否从 RED → GREEN。
2. Linux AMD64 release workflow 是否能登录并推送 GHCR。
3. artifact cleanup 是否具备权限并真实执行。
4. 即使 Artifact 配额仍未刷新，GHCR 成功时 workflow 是否保持 success。

