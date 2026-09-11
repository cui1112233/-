# V88 总收口阶段1：盘点并冻结

日期：2026-09-08
仓库：`cui1112233/-`
目标维护分支：`v88`
状态：阶段1冻结基线已建立；本阶段不删除旧分支、不删除旧 Workflow、不迁移生产基础设施。

## 一、七阶段总计划

1. 阶段1：盘点并冻结
2. 阶段2：V88 功能收口
3. 阶段3：Git 规则收口
4. 阶段4：GPT 多聊天协作收口
5. 阶段5：发布方式收口
6. 阶段6：生产运行方式收口
7. 阶段7：删除旧分支 / 旧 Workflow

执行原则：前 6 个阶段先证明“功能、规则、发布、运行依赖”都已经归一；只有阶段7才允许删除历史分支和旧 Workflow。

---

## 二、Git 仓库基线

### 2.1 默认分支与维护分支

- GitHub 当前默认分支仍是：`master`。
- `master` 当前仍存在，阶段1不修改默认分支。
- `v88` 是当前唯一维护主线和未来总分支。
- 本次盘点开始时 `v88` HEAD：`5128872151038ee5703125f1e9ee8b6e3ff5c782`。
- 阶段1冻结规则写入 `AGENTS.md` 后提交：`5038cef442357bae69fe83692f84ffb1dbdc99ca`。
- `v88` 和 `master` 当前均未启用 branch protection；此项留给阶段3统一处理。

### 2.2 分支数量

通过 GitHub branches API 逐页确认：

- 第 147 条分支存在，并且就是 `v88`；
- 第 148 条分支为空；
- 因此当前仓库共有 **147 个分支**。

分支类型明显包含：

- 历史编号功能分支：`01-*`、`02-*`、`03-*` ...
- `feat/*`
- `fix/*`
- `design/*`
- `integration/*`
- `integrate/*`
- `ops/*`
- `release/*`
- `archive/*`
- `ci/*`
- `diag/*`
- `docs/*`
- `plan/*`
- `review/*`
- `tmp/*`、`tmp-*`、`temp-*`
- `master`
- `v88`

阶段1冻结规则：除 `v88` 外，上述历史分支全部先视为 **只读参考源**。不得再把它们当作新的长期维护目标，也不得从它们直接发布公网。

阶段7之前不删除任何历史分支。

---

## 三、Workflow 基线

### 3.1 master

`master` 当前 `.github/workflows/` 只有 1 个文件：

- `novel-fetch-v2-check.yml`

说明默认分支与 V88 当前 CI / 发布体系已经明显脱节。阶段3需要处理默认分支与规则，阶段7再清理旧 Workflow。

### 3.2 v88

`v88` 当前共有 **21 个 Workflow**：

1. `bf11-integrated-runtime-verify.yml`
2. `bf11-ui-verify.yml`
3. `novel-fetch-v2-check.yml`
4. `novel-panel-v783031-regression.yml`
5. `v88-build-info-auth-fix-once.yml`
6. `v88-cm-public-release-guard.yml`
7. `v88-direct-deploy-contract.yml`
8. `v88-direct-deploy-node-cutover.yml`
9. `v88-direct-deploy-node-stage.yml`
10. `v88-ecs-deploy-status-once.yml`
11. `v88-ecs-registry-diagnostic.yml`
12. `v88-exact-release-image-patch-once.yml`
13. `v88-linux-amd64-image-release.yml`
14. `v88-local-executor-live-smoke.yml`
15. `v88-local-executor-public-fix-once.yml`
16. `v88-local-executor-public-regression.yml`
17. `v88-local-executor-regression.yml`
18. `v88-local-executor-windows.yml`
19. `v88-node-emergency-redeploy.yml`
20. `v88-novel-fetch-browser-worker-wireup.yml`
21. `v88-script-prompt-pipeline.yml`

### 3.3 Workflow 初步分类（阶段1只冻结，不删除）

#### A. 当前正式 Node 发布链：保留

- `v88-direct-deploy-contract.yml`
- `v88-direct-deploy-node-stage.yml`
- `v88-direct-deploy-node-cutover.yml`

当前正式发布路径：

`Git v88 -> Stage 精确 SHA -> 旁路健康检查 -> CUTOVER-REQUEST 锁定精确 SHA -> Cutover -> 外部 /api/build-info 精确 SHA 验证 -> 失败自动回滚保护`

最近一次已经成功完成完整 Stage -> Cutover 的公网 Node SHA：

`7390234d52031e63b1f6d169b86f90f510e3c9e2`

#### B. 当前 CI / 回归 / 构建类：暂时保留，阶段2/4/6逐项确认是否合并

- `bf11-integrated-runtime-verify.yml`
- `bf11-ui-verify.yml`
- `novel-fetch-v2-check.yml`
- `novel-panel-v783031-regression.yml`
- `v88-cm-public-release-guard.yml`
- `v88-local-executor-live-smoke.yml`
- `v88-local-executor-public-regression.yml`
- `v88-local-executor-regression.yml`
- `v88-local-executor-windows.yml`
- `v88-novel-fetch-browser-worker-wireup.yml`
- `v88-script-prompt-pipeline.yml`

这些 Workflow 暂不删除，因为它们仍承担功能回归、Windows 执行器构建、Browser Worker 合约、提示词链验证或公网运行烟测中的一种或多种职责。

#### C. 历史 / 一次性 / 诊断 / 旧发布候选：冻结，不再作为日常入口

- `v88-build-info-auth-fix-once.yml`
  - 自身被修改时会直接 patch `app.js` 并 push 回 `v88`；属于一次性修复器。
- `v88-ecs-deploy-status-once.yml`
  - 用于一次性生产恢复；可以创建/启用 emergency systemd service。
- `v88-ecs-registry-diagnostic.yml`
  - 面向 GHCR / Docker / 旧 Compose 的诊断工具；不是正常发布路径。
- `v88-exact-release-image-patch-once.yml`
  - 会运行 patch 脚本并自动 commit/push；属于一次性修复器。
- `v88-linux-amd64-image-release.yml`
  - 文件自身已经明确标记 `(Retired)`，只输出“Docker/GHCR 自动公网发布已退役，请使用 Direct Stage/Cutover”。
- `v88-local-executor-public-fix-once.yml`
  - 只面向历史 fix 分支执行一次性 UI patch 和自动 push。
- `v88-node-emergency-redeploy.yml`
  - 仍保留旧 GHCR Docker image build/push + ECS Docker recreate 紧急发布能力；现在不是正常发布入口。

阶段1规则：这些文件先保留用于审计 / 紧急恢复证据；普通“执行 / 发布”不得选择它们。阶段7在确认替代关系后再删除。

---

## 四、发布目录基线

`v88/deploy/` 当前同时存在：

- `deploy/v78-public/`
- `deploy/v88-public/`
- `deploy/v88-direct/`

### 4.1 deploy/v88-direct

当前包含：

- `STAGE-REQUEST`
- `CUTOVER-REQUEST`
- `package-node-release.sh`
- `stage-node-host.sh`
- `cutover-node-host.sh`

这是当前正式 Node Git-direct 发布链，应继续作为阶段5收口的基线。

### 4.2 deploy/v88-public

Git `v88` 当前只看到：

- `docker-compose.browser-worker.yml`

但是多个现有 Workflow 仍直接使用 ECS 上：

`/opt/qiantie/v88/deploy/v88-public/docker-compose.yml`

这意味着 **生产基础 Compose 配置至少有一部分仍是 ECS 运行时依赖，而不是完整地由当前 Git `v88/deploy/v88-public/` 表达**。

这是阶段6的关键收口项，阶段1严禁为了“去 Docker”直接删除这些生产依赖。

### 4.3 deploy/v78-public

当前仍保留历史 `nginx.conf`。

阶段1只标记为历史发布遗留；阶段6确认当前 Nginx 来源后，阶段7才能决定删除。

---

## 五、生产运行方式基线

当前 Node 发布方式虽然已经 Git-direct，但生产并不是“完全脱离 Docker”。

`deploy/v88-direct/stage-node-host.sh` 明确依赖：

- Docker network：`v88-public_qiantie_internal`
- 当前 Docker Node 容器，用于继承真实生产环境变量和持久化挂载信息
- Go API 容器
- Browser Worker 容器
- Nginx 容器
- Go / Worker 的 Docker IP

Git-direct Stage Node：

- 固定 Node runtime：`24.19.0`
- Stage release 目录：`/opt/qiantie/releases/v88-stage/*`
- systemd service：`qiantie-v88-node-stage.service`
- Stage port：`18081`
- 持久化数据复用 `/app/data`、`/app/outputs` 的现有挂载来源或 `/opt/qiantie/v88/shared/*`

因此当前生产应定义为：

**Git-direct host Node + 现有 Docker 网络 / Go API / Browser Worker / Nginx 的混合运行模式。**

阶段6目标不是“立即删 Docker”，而是把每一个生产组件的来源、配置、端口、启动方式、持久化、健康检查、恢复方式都变成可追溯的正式配置，再决定哪些继续容器化、哪些改 systemd / Go binary。

---

## 六、发现的文档漂移

### CURRENT_VERSION.md

当前文件仍写着：

- `Status: integration branch, not production/default`
- `Production: unchanged`

其中“默认分支仍非 v88”仍然正确；但“v88 不是生产来源 / Production unchanged”已经不符合当前 Node 公网实际情况。

阶段1将同步修正该文档，明确：

- `v88` 已是唯一维护源码与当前公网应用代码来源；
- GitHub 默认分支仍是 `master`，留待阶段3；
- 公网 Node 当前运行的是从 `v88` 通过 Git-direct 发布的确定 SHA；
- 生产运行仍是混合模式，阶段6继续收口。

### PRODUCTION_SNAPSHOT.md

该文件记录的是历史 V78.3.0.3 镜像快照，不是当前生产真相。后续 GPT 不得把它当作当前公网源码或当前发布入口。

---

## 七、阶段1冻结规则（立即生效）

1. `v88` 是唯一维护主线。
2. 147 个分支全部先保留；除 `v88` 外均按只读参考处理。
3. 前 6 个阶段禁止批量删分支 / Workflow。
4. 不再新建新的长期维护总分支。
5. 不再新增新的公网发布机制；Node 正常发布只认 Direct Stage -> Cutover。
6. 旧 GHCR / Docker emergency / once workflow 不能用于普通发布。
7. ECS 不能作为开发源码；任何生产依赖必须最终回到 Git 可追溯配置。
8. 当前混合 Docker 运行依赖不得在阶段6完成前删除。
9. 所有 GPT / Codex / 新聊天在改 V88 前必须读：
   - `AGENTS.md`
   - `docs/V88_PROJECT_EXECUTION_MEMORY.md`
   - 本文件
10. 阶段1完成后进入阶段2：逐功能核对“公网正在使用的能力是否全部已存在于 v88”，缺失的功能先收回 v88，再谈 Git/Workflow 删除。

---

## 八、阶段状态

- 阶段1：**已建立冻结基线**。
- 阶段2：待执行，下一步开始 V88 功能收口清单。
- 阶段3：未开始。
- 阶段4：已有 AGENTS / Memory 基础，但尚未正式收口。
- 阶段5：Node Stage/Cutover 已形成实际基线，但整个项目发布方式尚未完全收口。
- 阶段6：未完成；当前仍是混合运行。
- 阶段7：严禁提前执行。
