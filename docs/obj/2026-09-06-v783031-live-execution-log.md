# OBJ Live Log｜V88 小说面板 V78.3.0.31 实时执行记录

> 日期：2026-09-06
> 仓库：`cui1112233/-`
> 分支：`v88`
> 主记录：`docs/obj/2026-09-06-v783031-execution-record.md`
> 当前状态：`SOURCE VERIFIED / V31 REGRESSION 9/9 PASS / LINUX AMD64 RELEASE SUCCESS / GHCR PUBLISHED / ECS AUTO-DEPLOY READY / ECS SECRET MISSING / PUBLIC DEPLOYMENT PENDING`

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

随后测试扩展为要求 GHCR 主发布通道、Artifact 自动清理与非阻断兼容上传。

扩展测试提交：

`384ac37afaef73cd3aaf64421140a435c88d2772`

---

## 2026-09-06｜执行节点 03｜发布链最小实现

修改：

`.github/workflows/v88-linux-amd64-image-release.yml`

提交：

`90cd3c1a908432a96f265b92bc4fb4b7e6fe4585`

### 已加入

- workflow permissions：`contents: read / actions: write / packages: write`
- GHCR immutable image push
- release metadata 记录 `registry_image`
- `actions/github-script@v7` 自动清理旧 V88 AMD64 release artifacts
- 保留最近 `2` 个旧发布 artifact
- `actions/upload-artifact@v4` 作为兼容通道，`continue-on-error: true`

---

## 2026-09-06｜执行节点 04｜发布链 GREEN + GHCR 实际发布成功

### V31 回归

- workflow：`Novel Panel V78.3.0.31 Regression`
- run：`34017818181`
- result：`success`
- regression：`8 / 8 PASS`

### Linux AMD64 发布

- workflow：`V88 Linux AMD64 Public Image Release`
- run：`34017818178`
- job：`101444667352`
- conclusion：`success`

### 正式 GHCR 镜像

- image：`ghcr.io/cui1112233/qiantie-v88:public-90cd3c1a9084`
- registry digest：`sha256:cbfcd3de69c06617af545559c2266cca1d4db29d57f2cd10f6b3f8a4cae5aad8`
- architecture：`linux/amd64`

### Artifact 清理

- 检测旧 V88 AMD64 release artifacts：`16`
- 自动删除：`14`
- 保留最近：`2`
- cleanup：PASS

---

## 2026-09-06｜执行节点 05｜ECS 自动部署通道检查

仓库未发现既有 SSH/ECS/TOS 自动发布通道，因此新增基于 GitHub Actions + SSH 的最后一跳。

生产目标：

- ECS：`115.190.156.223`
- SSH 用户：`root`
- Compose 工作目录：`/opt/v88`
- Compose 文件：`/opt/v88/docker-compose.yml`
- service：`v88-node`
- 生产镜像 tag：`v88-public-v88-node:v88-latest`

设计：GitHub Runner 将已验证镜像通过 `docker save | gzip | ssh ... docker load` 直接流式送入 ECS，不在 ECS 保存 GHCR 登录凭据。

唯一需要的 GitHub Secret：

`V88_ECS_SSH_PRIVATE_KEY`

---

## 2026-09-06｜执行节点 06｜ECS 部署 TDD RED + 实现

### RED

新增：`tests/novel-panel-v783031-ecs-deploy.test.js`

- 初始提交：`183106449b1862dab9ec20ab142bbb016b0ba8c9`
- 自动回滚约束提交：`09b24b78e1c38a5201fdeb1b666a4f7d381b6e37`
- RED run：`34017985059`
- job：`101445141537`
- 总测试：9
- PASS：8
- FAIL：1
- 唯一失败：缺少 ECS SSH 部署步骤

### GREEN 实现

提交：`e4b59f272806e203b251c5a47f772d958d9760e2`

加入：

1. `Prepare V88 ECS SSH`
2. `Deploy verified image to V88 ECS`
3. 部署前自动保存 rollback image
4. `/opt/v88` 原地 Compose 重建 `v88-node`
5. ECS localhost + 公网 V31 build-info 验证
6. 公网 `/novel-panel` 验证
7. 验证失败自动 rollback
8. GitHub Secret 缺失时显式跳过，绝不虚报部署

---

## 2026-09-06｜执行节点 07｜ECS 自动部署最终 CI 验证

### V31 专用回归最终 GREEN

- workflow：`Novel Panel V78.3.0.31 Regression`
- run：`34018081211`
- conclusion：`success`
- 最终 regression：`9 / 9 PASS`

新增 ECS deployment regression 已从 RED 转 GREEN，原有业务/版本/发布分发测试继续全部 PASS。

### Release workflow

- workflow：`V88 Linux AMD64 Public Image Release`
- run：`34018081234`
- job：`101445406996`
- conclusion：`success`

镜像重新构建和发布成功：

- local image：`qiantie-v88:public-e4b59f272806`
- Docker image SHA：`sha256:86966626ae01cdcd370828673ad295181a025289f1934a6cb746a78f572949fd`
- GHCR image：`ghcr.io/cui1112233/qiantie-v88:public-e4b59f272806`
- GHCR digest：`sha256:d9468422533313cecc2b9f70fcf442ba6710cecce15ca8b39b5345381af23b29`
- tar：`qiantie-v88-linux-amd64-e4b59f272806.tar.gz`
- tar SHA256：`5c31c06e2f8175bd5604ee0a024e584242b05196df1db63d9387e87076a7f748`
- tar size：约 `68M`

### GitHub ECS Secret 检查结果

真实日志：

- `V88_ECS_SSH_PRIVATE_KEY:` 为空
- notice：`V88_ECS_SSH_PRIVATE_KEY is not configured; ECS deployment will be skipped.`
- `ECS_DEPLOY_READY=false`
- Deploy step：安全跳过
- Verify step：安全跳过
- Rollback step：未触发（因为根本没有部署）

结论：

> 当前唯一剩余阻塞不是代码、镜像、CI 或发布链，而是 GitHub 仓库尚未配置 `V88_ECS_SSH_PRIVATE_KEY`。因此本轮没有修改 ECS，也没有公网 V31 验证。工作流没有误报部署。

### Artifact 兼容通道

- cleanup 检测到 2 个旧 V88 AMD64 artifacts，保留 2，删除 0
- GitHub Artifact quota 仍未完成 6–12 小时重新计算
- upload-artifact 仍提示 quota hit
- 因 GHCR 已成功发布，该兼容通道不阻断正式 release workflow

### 当前最终状态

- V31 源码：✅
- V31 正式版本身份：✅
- V31 regression：✅ `9/9 PASS`
- Linux AMD64 Docker image：✅
- GHCR durable image：✅
- Release workflow：✅
- 自动清理旧 Artifact：✅
- ECS 自动部署代码：✅
- 自动回滚：✅
- GitHub ECS SSH Secret：❌ 未配置
- ECS 实际切换：❌ 未执行
- 公网 V31 验证：❌ 未执行

### 唯一下一步

在 GitHub 仓库 Actions Secret 中一次性新增：

`V88_ECS_SSH_PRIVATE_KEY`

值必须是当前 ECS `root@115.190.156.223` 已授权的 SSH **私钥完整内容**。不要把私钥提交到 Git、OBJ 或聊天记录。

Secret 配好后，再触发 `V88 Linux AMD64 Public Image Release`，工作流将自动完成：SSH 预检 → 镜像流式传输 → 生产镜像 rollback 备份 → Compose 重建 → ECS 内网 V31 验证 → 公网 V31 验证 → 失败自动回滚。