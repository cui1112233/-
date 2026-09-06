# OBJ Live Log｜V88 小说面板 V78.3.0.31 实时执行记录

> 日期：2026-09-06
> 仓库：`cui1112233/-`
> 分支：`v88`
> 主记录：`docs/obj/2026-09-06-v783031-execution-record.md`
> 当前状态：`SOURCE VERIFIED / V31 REGRESSION 9/9 PASS / LINUX AMD64 RELEASE SUCCESS / GHCR PUBLISHED / ECS SSH PRECHECK PASSED / ECS IMAGE STREAM IN PROGRESS / PUBLIC DEPLOYMENT PENDING`

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

---

## 2026-09-06｜执行节点 08｜独立公网探测边界

为避免仅依据 workflow 的“跳过验证”推断公网状态，额外进行了独立探测：

1. Web 浏览工具尝试访问 `http://115.190.156.223:3000/api/novel-panel/build-info` 与 `/novel-panel`：该工具不接受裸 IP + 3000 端口形式，无法建立有效页面引用。
2. 当前执行环境直接 `curl --connect-timeout 8 --max-time 12 http://115.190.156.223:3000/api/novel-panel/build-info`：当前运行环境无法连接该公网端口，返回 `curl: (7) Failed to connect`。

因此这里不把上述探测解释为“服务器下线”，也不把它解释为“公网已经更新”。权威事实仍是：本轮 release 日志明确记录 `ECS_DEPLOY_READY=false`，所以本轮没有执行 ECS 切换，也没有完成 V31 公网验收。

当前状态保持：`PUBLIC DEPLOYMENT PENDING`。

---

## 2026-09-06｜执行节点 09｜用户要求由 ChatGPT 代执行 Secret 配置

### 执行能力检查

已检查当前 GitHub 连接器能力。连接器明确限制：

- GitHub 仓库文件、Actions runs、workflow、PR/issue 等可以读写/查询。
- GitHub **Secrets API 属于敏感 endpoint family，当前连接器不支持**。
- 当前会话也不能读取用户电脑上的 ECS SSH 私钥文件。

因此 `V88_ECS_SSH_PRIVATE_KEY` 不能由当前 ChatGPT 会话直接写入 GitHub，也不能从用户本机私钥中自动取值。

### 安全边界

这不是代码阻塞，而是凭据写入权限边界。私钥不得：

- 提交到 Git 仓库；
- 写入 OBJ；
- 粘贴到普通源码、workflow 或日志；
- 通过聊天记录长期保存。

### 可由 ChatGPT 继续自动执行的部分

当用户本人完成一次 GitHub Actions Secret 写入后，ChatGPT 可以继续执行/核验：

1. 触发 `V88 Linux AMD64 Public Image Release`；
2. 检查 SSH preflight；
3. 检查镜像是否真正传入 ECS；
4. 检查 `v88-node` 是否重建；
5. 检查 ECS localhost V31 build-info；
6. 检查公网 V31 build-info 与 `/novel-panel`；
7. 若失败，检查自动 rollback 是否执行；
8. 实时更新本 OBJ。

当前状态保持：`ECS SECRET MISSING / PUBLIC DEPLOYMENT PENDING`。

---

## 2026-09-06｜执行节点 10｜Secret 已由用户配置，发布重跑被 GitHub Hosted Runner 分配层阻塞

### Secret 状态

用户已在 GitHub 仓库 Actions secrets 页面完成 `V88_ECS_SSH_PRIVATE_KEY` 的新增操作。

由于 GitHub Secrets API 对当前连接器不可读，这里只能记录为：

`USER-CONFIGURED / WAITING FOR WORKFLOW CONSUMPTION VERIFICATION`

不会读取、输出或记录 Secret 的实际值。

### 已实际触发发布重跑

对原 release workflow 的 `build-release` job 执行 re-run：

- workflow：`V88 Linux AMD64 Public Image Release`
- run：`34018081234`
- attempt：`2`
- 原 job：`101445406996`
- attempt 2 新 job：`101461881446`

### attempt 2 实际结果

GitHub API 返回：

- status：`completed`
- conclusion：`failure`
- created/start：`2026-09-06T09:14:45Z`
- completed：`2026-09-06T09:14:48Z`
- 总耗时：约 3 秒
- runner label：`ubuntu-24.04`
- `runner_id=0`
- `runner_name=""`
- `steps=[]`
- job log 不存在，日志下载返回 BlobNotFound

这说明本次失败发生在 **GitHub 分配 Hosted Runner 之前**。因此：

- 没有 Checkout；
- 没有构建；
- 没有读取 SSH Secret 的执行步骤；
- 没有 SSH preflight；
- 没有连接 ECS；
- 没有修改公网服务；
- 没有触发 rollback。

### 与 Secret 无关的交叉证据

在用户配置 Secret 之前，仓库内另一个完全不同的 workflow 已出现相同签名：

- workflow：`V88 CM Public Release Guard`
- run：`34022984904`
- job：`101458853545`
- runner label：`ubuntu-latest`
- `runner_id=0`
- `runner_name=""`
- `steps=[]`
- 创建后约 2 秒直接 failure

同一时间的 `V88 Linux AMD64 Public Image Release` run `34022984905` 也以 0-step failure 结束。

因此当前故障不能归因于刚新增的 SSH 私钥内容，也不能归因于 `ubuntu-24.04` 单一 runner 镜像。

### 时间边界

已查到 v88 最近仍正常分配 Runner 的成功运行：

- `BF11 Integrated Runtime Verify`
- run：`34018249890`
- commit：`ec5c430ab277dae731e536fec5c31c3c0e20373f`
- created：`2026-09-06T07:06:26Z`
- conclusion：`success`

而到 `2026-09-06T08:50:36Z` 左右，不同 workflow 已同时出现 runner_id=0 / steps=[] 的秒失败。

### 外部状态交叉检查

GitHub Status 当前显示：

- `All Systems Operational`
- `Actions: Operational`
- 2026-09-06：`No incidents reported today`

因此现阶段更符合以下两类根因之一：

1. 当前 GitHub 个人账号/私有仓库的 Hosted Runner 使用额度、Billing/Budget/Spending 限制导致 runner allocation 被拒绝；
2. GitHub 控制面存在未反映到公开 Status 的账户级/局部 runner allocation 异常。

当前连接器无法读取 GitHub 账户 Billing/Actions budget 页面，因此不能在没有页面证据时把其中某一个宣称为最终根因。

### 当前安全状态

- SSH Secret：✅ 用户已配置（值未读取）
- release re-run：✅ 已实际触发
- GitHub Hosted Runner：❌ 未分配
- SSH preflight：⏸ 未执行
- ECS 镜像传输：⏸ 未执行
- Compose 重建：⏸ 未执行
- ECS localhost V31 验证：⏸ 未执行
- 公网 V31 验证：⏸ 未执行
- rollback：⏸ 未触发

当前状态：`GITHUB HOSTED RUNNER NOT ASSIGNED / PUBLIC DEPLOYMENT PENDING`。

---

## 2026-09-06｜执行节点 11｜Actions 账户级计费门槛复核与本机 SSH 只读边界

### GitHub Actions 当前真实状态

在用户已配置 V88_ECS_SSH_PRIVATE_KEY 后，对既有发布 run 34018081234 的 build-release job 再次执行真实 re-run：

- 最新 attempt：3
- 最新 job：101475048709
- head SHA：e4b59f272806e203b251c5a47f772d958d9760e2
- status：completed
- conclusion：failure
- job started：2026-09-06T11:01:11Z
- job completed：2026-09-06T11:01:13Z
- runner label：ubuntu-24.04
- runner_id：0
- runner_name：空
- steps：空
- 总耗时：约 2 秒

GitHub Actions 页面 Annotations 的原文为：

The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings

该错误发生在 Hosted Runner 分配前。没有 Checkout、Secret 消费、SSH preflight、ECS 连接、镜像传输、Compose 重建或 rollback。

### 本机真实 SSH 只读检查

执行目标：root@115.190.156.223

结果：

- 连接返回：Permission denied (publickey,password).
- SSH_EXIT=255
- 未读取、打印或记录任何私钥内容。
- 未修改 ECS、Docker、Compose、数据卷或公网服务。

本机当前没有可用于该目标的已认证 SSH 通道；因此不使用本机绕过 GitHub Actions 执行生产切换。

### 公网当前版本与页面证据

直接公网请求：

- /novel-panel：HTTP 200，返回现有前端 HTML。
- /api/novel-panel/build-info：HTTP 401 Unauthorized，返回 invalid or expired token；未取得可认证的 build-info 版本值。

已登录浏览器打开的公网 /novel-panel 页面可见：

- 页面版本：V78.3.0.2 · 场景锚点/事件归属/连续时间轴根治
- Clean Core 自检：runtime=v78.3.0.2 / v78.3.0.2-scene-event-canonical-timeline-20260818-r1
- 页面 Build 版本：page=v78.3.0.2
- 自检汇总：PASS 29 · WARN 2 · FAIL 1

因此公网当前明确不是目标 V78.3.0.31，不能标记为 PUBLIC DEPLOYED。

### ECS 与发布状态边界

- ECS SSH preflight：未执行
- Docker image load：未执行
- /opt/v88 Compose：未执行
- v88-node 重建：未执行
- ECS localhost build-info：未执行
- 公网 V31 build-info：未执行
- 公网 V31 /novel-panel 验证：未通过
- rollback：未触发
- 公网现有服务：本轮未修改

### 当前阻塞与下一步

代码、V31 回归、Linux AMD64 镜像、GHCR 发布和部署 workflow 逻辑均已有记录；当前新增的实际阻塞是 GitHub 账户 Billing/Spending 门槛导致 Hosted Runner 无法启动。

在 GitHub Settings 的 Billing & plans 中处理付款失败或提高 Spending limit 后，继续重跑 V88 Linux AMD64 Public Image Release。只有看到 Runner 被实际分配并完成 SSH preflight → Docker/Compose → ECS localhost build-info → 公网 build-info 与 /novel-panel 验证，才允许把状态改为 PUBLIC DEPLOYED / VERIFIED。


---

## 2026-09-06｜执行节点 12｜仓库公开后 Hosted Runner 已实际分配，自动部署进行中

### GitHub 仓库状态

- repository：`cui1112233/-`
- visibility：`public`（已由用户完成切换）
- branch：`v88`

### 最新 Release workflow 真实状态

对既有 run `34018081234` 的失败 job 重新触发后，GitHub 已实际分配 Hosted Runner：

- workflow：`V88 Linux AMD64 Public Image Release`
- attempt：`4`
- job：`101477911494`
- head SHA：`e4b59f272806e203b251c5a47f772d958d9760e2`
- runner label：`ubuntu-24.04`
- status：`in_progress`
- runner allocation：✅
- Set up job：✅
- Checkout：✅
- Assert Linux AMD64 runner：✅
- Setup Node：✅
- 当前步骤：`Build frontend`
- ECS SSH Secret：仅由 workflow 消费；未读取、输出或写入本 OBJ

### 当前边界

- Linux AMD64 镜像：⏳ 构建中
- GHCR 推送：⏳ 未到达
- ECS SSH preflight：⏳ 未到达
- Docker/Compose 切换：⏳ 未执行
- ECS localhost build-info：⏳ 未验证
- 公网 V31 build-info 与 `/novel-panel`：⏳ 未验证
- rollback：⏳ 未触发

当前状态：`GITHUB HOSTED RUNNER ALLOCATED / ECS DEPLOYMENT IN PROGRESS / PUBLIC DEPLOYMENT PENDING`


---

## 2026-09-06｜执行节点 13｜ECS 预检逐项诊断确认 Compose 文件路径假设错误

### 最新 Release workflow 真实结果

- workflow：`V88 Linux AMD64 Public Image Release`
- run：`34030235329`
- job：`101478280173`
- head SHA：`9b900a3e4a58b6aeb93a3fd0f5ba88aa713481c9`
- runner：`ubuntu-24.04`
- build frontend：✅
- V88 release contract：✅
- Linux AMD64 Docker build：✅
- GHCR push：✅
- release package：✅
- Prepare V88 ECS SSH：❌

### 远端逐项非敏感诊断

- SSH 连接与指定 Secret 消费：✅（Secret 值未读取、未输出）
- `remote_uid=0`：✅
- `docker_binary=present`：✅
- `docker_daemon=ready`：✅
- `docker_compose=ready`：✅
- `compose_file=/opt/v88/docker-compose.yml`：❌，文件不存在，退出码 24

### 安全边界

本次未执行：

- Docker 镜像传输
- ECS `docker load`
- 生产 Compose 重建
- 公网服务切换
- 回滚

结论：原部署逻辑中的 `/opt/v88/docker-compose.yml` 是未经现场验证的路径假设；需要先只读发现真实 V88 Compose 工作目录，再更新部署路径。


---

## 2026-09-06｜执行节点 14｜ECS 只读发现确认 v88 Compose 真实路径

### 远端发现结果

在不修改 ECS 的前提下，通过真实 SSH 预检发现：

- v78 Compose：`/opt/qiantie/v78/deploy/v78-public/docker-compose.yml`
- v88 Compose：`/opt/qiantie/v88/deploy/v88-public/docker-compose.yml`
- Compose 项目：`v78-public`、`v88-public`
- `/opt/v88/docker-compose.yml`：不存在，为错误路径假设

### 本次边界

- UID / Docker / Docker Compose：均已通过
- v88 Compose 文件：已发现但尚未切换工作目录
- v88 service 名称：待只读确认
- Docker 镜像传输：未执行
- Compose 重建：未执行
- 公网服务：未修改
- 公网 V31 验证：未执行

下一步：只读读取 v88 Compose services/config/images，确认后将部署工作目录改为已存在的 `/opt/qiantie/v88/deploy/v88-public`。


---

## 2026-09-06｜执行节点 15｜误触发运行已取消，Compose 未执行，需核对镜像传输边界

### 运行结果

- workflow：`V88 Linux AMD64 Public Image Release`
- run：`34030429156`
- head SHA：`f8db2764d4073f6f1891cdc99e5ceab11b3400bf`
- conclusion：`cancelled`
- Prepare V88 ECS SSH：✅
- Deploy verified image to V88 ECS：⏹ 被取消
- Verify V88 ECS deployment：未执行
- Rollback：未执行

### 取消时的实际边界

日志显示部署步骤已启动第一段：

`docker save | gzip | ssh ... 'gunzip | docker load'`

随后在约 25 秒后收到取消信号。用于 `cd /opt/v88`、记录 rollback image、打 tag、`docker compose up` 的第二个 SSH 命令尚未开始。

因此已确认：

- 生产 Compose 重建：未执行
- v88-node 容器切换：未执行
- 公网服务验证：未执行
- 旧容器回滚：未执行
- ECS 是否存在未完成/未标记的临时镜像：待只读核对

下一步：通过真实 SSH 只读检查 v88-public 当前容器、镜像和 Compose 状态；确认原环境未被改变后，再将部署脚本改为真实 Compose 路径。


---

## 2026-09-06｜执行节点 16｜并行旧发布已停止，真实 Compose/service 契约进入 RED

### 并行运行安全处理

以下旧 Release 运行已由本次执行取消并确认完成取消：

- `34030649733`
- `34030682250`
- `34030881712`

它们未形成可接受的 V31 公网验收结果；保留单一修正后的发布链，避免并行 ECS 操作竞态。

### TDD RED

- 回归 workflow：`Novel Panel V78.3.0.31 Regression`
- run：`34030993368`
- job：`101480335016`
- 结果：`8 / 9 PASS`
- 唯一失败：发布脚本尚未发现并保存真实 v88-node Compose `service_image`

### 当前已确认的现网契约

- Compose 文件：`/opt/qiantie/v88/deploy/v88-public/docker-compose.yml`
- Compose 项目：`v88-public`
- service：`v88-node`、`novel-fetch-121-worker` 等
- 现有 v88-node 镜像：由远端运行容器实际配置决定，不能继续假设 `v88-public-v88-node:v88-latest`

### 实现边界

只修改 v88 发布 workflow 与对应回归测试：

- 使用已验证的 v88 Compose 目录
- 从现有 v88-node 容器读取实际服务镜像标签
- 旧镜像按实际服务标签保存 rollback
- 新镜像按实际服务标签替换
- rollback 恢复实际服务标签
- 仅重建 v88-node/121 worker，不触碰 MySQL、正式数据卷和无关功能

当前状态：`ECS REAL COMPOSE PATH VERIFIED / ECS DEPLOYMENT FIX IN PROGRESS / PUBLIC DEPLOYMENT PENDING`


---

## 2026-09-06｜执行节点 17｜真实 Compose/service 修正通过回归，Release 进入 ECS 部署

### 回归 GREEN

- workflow：`Novel Panel V78.3.0.31 Regression`
- run：`34031158633`
- head：`654c418eba4332abc3211f6d4e7fe2988596f13b`
- 结果：`success`

### 修正版 Release 当前状态

- workflow：`V88 Linux AMD64 Public Image Release`
- run：`34031114328`
- head：`9872dee0d61f1eab4f68d73ee8a4d48857baf3bd`
- job：`101480672191`
- runner：已实际分配
- Build frontend：✅
- V88 release contract：✅
- Linux AMD64 主镜像构建：✅
- 121 worker AMD64 镜像构建：✅
- 双镜像 GHCR 推送：✅
- 发布包生成：✅
- 真实 SSH 预检：✅
- 当前步骤：`Deploy verified images to V88 ECS`

### ECS 部署边界

修正版已使用：

- Compose 文件：`/opt/qiantie/v88/deploy/v88-public/docker-compose.yml`
- Compose override：`/opt/qiantie/v88/deploy/v88-public/docker-compose.browser-worker.yml`
- 从运行中 `v88-node`、`novel-fetch-121-worker` 容器读取实际镜像标签
- 分别保存主服务和 worker rollback 标签
- 仅重建 `v88-node` 与 `novel-fetch-121-worker`
- 使用 `--no-deps`、`--pull never`

当前仍未取得：

- ECS Compose 重建完成证据
- ECS localhost V31 build-info
- 公网 V31 build-info
- 公网 `/novel-panel` 验证

当前状态：`ECS SSH PRECHECK PASSED / ECS DEPLOYMENT IN PROGRESS / PUBLIC DEPLOYMENT PENDING`


---

## 2026-09-06｜执行节点 18｜发布分支收敛到 Browser Worker 首次上线修正

### 后续分支状态

- 最新 v88 head：`7c51504e7abf7422eafc94fa93569eb24c61e636`
- 该提交修正了 121 Browser Worker 首次上线的发布策略：
  - 主应用镜像继续 GHCR 发布
  - worker 镜像直接流式传输到 ECS
  - 首次 worker 不要求已有稳定 worker 镜像标签
  - rollback 区分首次 worker 上线与已有 worker 升级
- 前一版修正 Release：`34031114328`，在镜像流式传输阶段被后续分支运行取消；未进入 Compose/验证步骤
- 当前唯一最新 Release：`34031612944`
- 当前 job：`101482045348`
- 当前状态：`in_progress`
- 已完成：构建、worker 构建、主镜像 GHCR、发布包、SSH 预检
- 当前步骤：`Deploy verified images to V88 ECS`
- 当前尚未取得：ECS Compose 重建、ECS localhost build-info、公网 V31 build-info、`/novel-panel` 验证

### 安全边界

当前仍未宣称部署成功；以 Release 最终日志和真实 ECS/公网证据为准。
