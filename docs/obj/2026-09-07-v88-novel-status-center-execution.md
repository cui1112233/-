# V88 小说获取居中状态中心执行记录

日期：2026-09-07 ～ 2026-09-08
目标分支：`v88`
仓库：`cui1112233/-`

## 用户确认目标

1. 小说获取顶部正常处理状态不再使用看起来像异常的红色整框。
2. 状态显示在「小说获取」标题栏居中位置，并固定占位，避免状态变化导致布局跳动。
3. 顶部只保留简洁业务摘要；详细统计仍保留在实时日志。
4. 处理完成摘要示例：`处理完成 · 有效任务 1 · 原文成功 1 · AI文案 0 · 失败 0`。
5. 正常完成绿色、处理中蓝色、警告橙色；只有真实失败才显示红色文字，并且不显示红色边框。
6. 用户可见的 `121网站提交` / `121 登录` 改为 `视频管理系统提交` / `视频管理系统登录`，但不能误替换普通数字，例如 `1210`。
7. 所有正式修改必须进入 Git `v88`；公网只作为运行副本，不能只做 ECS 热修复。
8. 不合并到 `master/main`；`v88` 继续作为未来总分支。

## 一、功能与测试落地

### 1. 状态中心专用回归测试

新增：`test/novel-status-center.test.js`

覆盖：

- 完成长文本压缩为简洁摘要；
- 失败为 0 不误判异常；
- 非 0 失败进入 error；
- 处理中只展示第一条有意义状态；
- `121网站提交` 本地化且 `1210` 不误替换。

提交：`85fb9566ac944a0548b06724538b082947788ec0`

### 2. 状态中心模块

新增：`frontend/dist/batch-rewrite/v88-novel-status-center.js`

提交：`bcd2e3e8e98e0ff28c48b44eb056af1058f992e4`

能力：

- 监听 `batchStatus`、`siteSubmitStatus`、`v78PreviewStatus`、`webLoginResult`；
- 摘要化状态文本；
- 标题栏居中固定状态；
- 去除正常状态的红色 border / outline / box-shadow；
- 处理中显示脉冲点；
- 用户可见 121 文案本地化；
- CommonJS 导出，便于 Node 回归测试。

### 3. 页面加载入口

修改：`frontend/dist/batch-rewrite/index.html`

加载：

```html
<script src="/batch-rewrite/v88-novel-status-center.js?v=20260907-r1"></script>
```

提交：`725944025750221e2234c80931d7882950c8932c`

### 4. 修正 121 超时旧测试

CI 曾发现旧测试仍要求浏览器侧 `15 秒`，但生产 `121-login-hotfix.js` 已有意改为 `65 秒`。

历史依据：

- `6673cea4b6ec4ac96c5731264ea06a9a1fa0132a`：`extend 121 validation timeout windows`
- `360cc41a1368c9a95f411d5153f9e3c882430ef4`：`keep browser guard above active 121 worker budgets`

因此没有回退生产超时，只更新过期测试。

提交：`d169d5e8c02ac5b15cc5520667e2a5c00a0daf1d`

后续 BF11 frontend / node-proxy / go 均通过。

### 5. 修复 frontend build 后模块会丢失的问题

确认正式构建源目录为：

`frontend/public/batch-rewrite/`

仅改 `frontend/dist/...` 会在 Vite build 后被覆盖，因此补齐：

`frontend/public/batch-rewrite/v88-novel-status-center.js`

提交：`c4ecca94b63d6d858bf0ffb792b2e11fd59c00bf`

### 6. 把状态模块加入 Git-direct 发布契约

修改：`.github/workflows/v88-direct-deploy-node-stage.yml`

构建后明确复制：

```bash
cp frontend/public/batch-rewrite/v88-novel-status-center.js frontend/dist/batch-rewrite/v88-novel-status-center.js
```

并向最终 dist 页面注入：

```html
<script id="qiantie-novel-status-center" src="./v88-novel-status-center.js?v=20260907-r1"></script>
```

提交：`6e16b69c2eea19f2a22d429a050a5e907214377c`

### 7. 增加构建持久化回归

修改：`frontend/src/user/pages/batch-factory-v11/novel-fetch-121-safety-source.test.js`

检查 public 源、模块能力、Stage 复制逻辑和最终 script 注入。

提交：`a56a486335ecafa51c346c606274c6ae2da14f41`

## 二、清理发布架构迁移后的旧测试

### 8. Docker/GHCR 退役测试改为 Git-direct 契约

仓库已由 `26c50ea063b838dc22afb1d0d5afa37d988acfc9` 正式切换到 Git-direct Node public deployment。

因此不复活退役 Docker/GHCR 发布，而是更新：

- `tests/novel-panel-v783031-release-artifact-retention.test.js`
  - 提交：`48bc969ad5efeb479f0aba20c3413fb89506ecd2`
- `tests/v88-release-worker-secret-consistency.test.js`
  - 提交：`dc157b96e15403f83564ca154eed872a8a26f09f`
  - `${...}` 字面占位符安全修正：`419f0bfa6304d34342c8f1ea9a756ba4705c1197`

现行安全契约：

- 退役 workflow 不得保留 GHCR publish 权限；
- Node 与 121 Worker 继续共享三组内部密钥；
- Git-direct Stage 从现网 Node 继承环境；
- 新 Node 继续连接现有 Browser Worker；
- Stage 与 Cutover 必须分离。

## 三、第一次 Stage 失败与根因

### 9. 第一次 Stage

第一次 Stage 请求提交：

`ba51f25d54ae2932cea40b1c7c4eebc61468bc59`

Stage 构建得到约 5.3 MB whitelisted Node release payload。

结果：失败，但失败发生在：

```text
SCP_UPLOAD_START
...
Process completed with exit code 124
```

即 GitHub Runner → ECS 的单次 `scp` 达到 180 秒硬超时。

已经确认：

- 精确 SHA checkout 通过；
- 发布包契约通过；
- 前端 build 通过；
- ECS SSH 通过；
- 失败发生在远端 Stage 脚本执行之前；
- 没有执行公网 Cutover；
- 公网仍保持原版本。

因此根因是发布传输通道，不是小说获取状态中心业务代码。

## 四、发布传输通道修复

### 10. 从单次 SCP 改为有界 SSH 分片传输

新增/更新发布契约测试：

`tests/v88-node-release-package.test.js`

提交：`37be714bff4416d167a922585862cb81647a26f5`

修改 `.github/workflows/v88-direct-deploy-node-stage.yml`：

- 不再使用单次 SCP/SFTP；
- payload 先计算 SHA256；
- `split -b 512K`；
- 使用已经验证的 SSH command channel 逐片写入 ECS；
- 每片 `timeout 120`；
- 每片最多重试 3 次；
- SSH ControlMaster / KeepAlive；
- ECS 端重组 `source.tar.gz`；
- 远端 SHA256 必须与 Runner 完全一致；
- 完整性通过后才允许执行 `stage-node-host.sh`。

提交：`c45c4b89e74ad32c7c4b80e145bda941efd67a58`

### 11. 清理仍写死 SCP 的两条旧发布测试

新传输实现首次跑发布契约时，确认真正失败的只是两个旧断言仍要求 `scp`：

- `tests/v88-node-stage-contract.test.js`
  - 改为检查 512K split、bounded SSH、SHA256、无 SCP。
  - 提交：`e4aa7b55b544fc003e85c4b5211eca01efc8345b`
- `tests/v88-release-registry-resilience.test.js`
  - 改为验证 Git-direct + chunked SSH + SHA256。
  - 提交：`5a1aadfe738dbb6569a4ea2cdc47433c66e7e2d0`

之后 `V88 Direct Deploy Contract` 恢复通过。

## 五、第二次 Stage 成功

### 12. 精确 Stage SHA

第二次 `STAGE-REQUEST` 提交：

`7390234d52031e63b1f6d169b86f90f510e3c9e2`

Stage workflow：

- Run：`34143271868`
- 结果：`success`

验证通过：

- Checkout exact SHA；
- Assert exact source SHA；
- 发布包契约；
- 前端正式 build；
- 状态中心 source → dist 复制与 script 注入；
- ECS SSH；
- 512 KB 分片 SSH 传输；
- 每片上传完成；
- ECS 重组；
- 远端 SHA256 校验；
- `stage-node-host.sh`；
- 旁路 Node build-info；
- Nginx 到旁路 Node 可达；
- 原公网路由在 Stage 期间继续健康。

Stage 没有切公网流量。

## 六、Cutover 成功并完成外部精确 SHA 验证

### 13. Cutover 请求

`deploy/v88-direct/CUTOVER-REQUEST` 写入第二次 Stage 的精确 SHA：

`7390234d52031e63b1f6d169b86f90f510e3c9e2`

Cutover 请求提交：

`e4c45533f8bf04c138b56da9d12032a2bfae5586`

Cutover workflow：

- Run：`34143650958`
- Job：`101810880796`
- 结果：`success`

Cutover 日志确认：

```text
V88_NODE_PUBLIC_CUTOVER_OK
sha=7390234d52031e63b1f6d169b86f90f510e3c9e2
upstream=172.19.0.1:18081
```

Nginx：

- `nginx -t` 成功；
- reload 成功；
- 没有进入 rollback。

随后由 GitHub Runner 从公网地址执行：

- `/api/build-info`；
- 校验 `git_sha == 7390234d52031e63b1f6d169b86f90f510e3c9e2`；
- 校验 `deploy_mode == git-direct`；
- 校验公网 `/` 可访问。

最终输出：

```text
PUBLIC_CUTOVER_VERIFIED_SHA=7390234d52031e63b1f6d169b86f90f510e3c9e2
```

因此公网正式运行版本确定为：

`7390234d52031e63b1f6d169b86f90f510e3c9e2`

## 七、部署 SHA 的完整 CI 状态

对实际部署 SHA `7390234d52031e63b1f6d169b86f90f510e3c9e2`，以下 workflow 均为 `completed / success`：

- Novel Panel V78.3.0.31 Regression：Run `34143271429`
- V88 Direct Deploy Contract：Run `34143271425`
- BF11 Integrated Runtime Verify：Run `34143271495`
- V88 CM Public Release Guard：Run `34143271443`
- Novel Fetch V2 Check：Run `34143271488`
- V88 Direct Deploy Node Stage：Run `34143271868`

没有发现该部署 SHA 的 workflow failure。

## 八、TDD / 验证结果

### RED

状态中心模块不存在时：

```bash
node --test test/novel-status-center.test.js
```

结果：`MODULE_NOT_FOUND`。

后续 CI 还暴露：

- 121 浏览器 guard 旧测试仍要求 15 秒；
- Docker/GHCR 退役后旧测试仍要求旧发布流程；
- 新 SSH 分片发布后，两条旧契约仍写死 `scp`。

以上均按真实现行架构逐项修正，没有为了让测试变绿而回退生产设计。

### GREEN

状态中心专用：

- JS syntax check：通过；
- `node --test test/novel-status-center.test.js`：5/5；
- 0 failed。

部署 SHA 的完整 CI：通过。

Stage：通过。

Cutover：通过。

公网 exact SHA：通过。

## 九、正式发布路径（当前标准）

当前 V88 公网正式发布不再使用自动 Docker/GHCR Image Release。

标准流程：

1. 所有正式代码先进入 Git `v88`；
2. 修改 `deploy/v88-direct/STAGE-REQUEST`；
3. `V88 Direct Deploy Node Stage` 从精确 SHA build；
4. payload 走 512 KB bounded SSH chunk transfer + SHA256；
5. ECS 旁路启动精确 SHA，先做健康验证，不切流量；
6. Stage 成功后，把同一个精确 SHA 写进 `CUTOVER-REQUEST`；
7. `V88 Direct Deploy Node Cutover` 执行 Nginx 公网切换；
8. Cutover 后从外部 `/api/build-info` 再校验 exact SHA 与 `deploy_mode=git-direct`；
9. 健康检查失败则由 Cutover 脚本自动回滚；
10. 不直接进入 ECS 容器手改正式文件。

## 十、分支与公网版本关系

- 不合并到 `master/main`。
- `v88` 继续作为唯一维护主线和未来总分支。
- 公网正式功能版本：`7390234d52031e63b1f6d169b86f90f510e3c9e2`。
- 本 OBJ 更新本身属于发布后的文档提交，因此更新后 Git `v88` HEAD 会领先公网一个 docs-only commit；这不表示公网漏部署业务代码。
- 不为了一个纯文档提交重新 Stage/Cutover，避免无意义发布抖动。

## 十一、最终执行状态

- 状态中心正式代码：已进入 `v88`。
- public 静态源：已进入 `v88`。
- build 后复制与页面注入：已进入正式发布契约。
- 状态中心 5 项专用回归：通过。
- 121 65 秒浏览器 guard 回归：对齐并通过。
- Git-direct 发布旧契约：已清理。
- 单次 SCP 跨区传输瓶颈：已改为 512 KB SSH 分片 + retry + SHA256。
- 第二次 Stage：成功。
- 正式 Cutover：成功。
- 公网 `/api/build-info` exact SHA：成功。
- 公网运行模式：`git-direct`。
- 公网运行 SHA：`7390234d52031e63b1f6d169b86f90f510e3c9e2`。
- 未执行手工 ECS 热修复。
- 未合并 `master/main`。

结论：**V88 小说获取居中状态中心已完成 Git 落地、测试、构建持久化、Stage、Cutover 和公网精确版本验证，本轮发布闭环完成。**
