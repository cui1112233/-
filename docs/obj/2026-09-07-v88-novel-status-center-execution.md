# V88 小说获取居中状态中心执行记录

日期：2026-09-07
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

## 本次实际写入 Git v88

### 1. 状态中心专用回归测试

新增：

`test/novel-status-center.test.js`

覆盖 5 项：

- 处理完成长文本压缩为简洁摘要；
- 失败为 0 不误判异常；
- 非 0 失败进入 error；
- 处理中只展示第一条有意义状态；
- `121网站提交` 本地化且 `1210` 不误替换。

提交：`85fb9566ac944a0548b06724538b082947788ec0`

### 2. 状态中心模块

首次写入构建产物：

`frontend/dist/batch-rewrite/v88-novel-status-center.js`

提交：`bcd2e3e8e98e0ff28c48b44eb056af1058f992e4`

能力：

- 监听 `batchStatus`、`siteSubmitStatus`、`v78PreviewStatus`、`webLoginResult`；
- 摘要化状态文本；
- 标题栏居中固定状态；
- 去除正常状态的红色边框、outline、box-shadow；
- 处理中显示脉冲点；
- 用户可见 121 文案本地化；
- CommonJS 导出，便于 Node 回归测试。

### 3. 页面加载入口

修改：

`frontend/dist/batch-rewrite/index.html`

新增加载：

```html
<script src="/batch-rewrite/v88-novel-status-center.js?v=20260907-r1"></script>
```

提交：`725944025750221e2234c80931d7882950c8932c`

### 4. 修正 121 超时旧测试

首次 CI 跟进发现 `BF11 Integrated Runtime Verify` 失败：前端主测试 113/114，通过日志确认旧测试仍要求浏览器侧 `15 秒`，但生产文件 `frontend/public/batch-rewrite/121-login-hotfix.js` 已有意改为 `65 秒`。

历史提交证明 65 秒是正式设计：

- `6673cea4b6ec4ac96c5731264ea06a9a1fa0132a`：`extend 121 validation timeout windows`
- `360cc41a1368c9a95f411d5153f9e3c882430ef4`：`keep browser guard above active 121 worker budgets`

因此没有回退生产超时，只更新过期测试：

`frontend/src/user/pages/batch-factory-v11/novel-fetch-121-safety-source.test.js`

提交：`d169d5e8c02ac5b15cc5520667e2a5c00a0daf1d`

验证结果：后续 BF11 的 frontend、node-proxy、go 三个 job 均通过。

### 5. 修复 frontend build 后状态模块会丢失的问题

进一步检查正式发布链发现：部署会执行 `npm --prefix frontend run build`，真正的静态源目录是：

`frontend/public/batch-rewrite/`

仅修改 `frontend/dist/...` 会在重新 build 后被覆盖，因此补齐正式源：

`frontend/public/batch-rewrite/v88-novel-status-center.js`

提交：`c4ecca94b63d6d858bf0ffb792b2e11fd59c00bf`

### 6. 把状态模块加入 Git-direct 发布契约

修改：

`.github/workflows/v88-direct-deploy-node-stage.yml`

构建后明确执行：

```bash
cp frontend/public/batch-rewrite/v88-novel-status-center.js frontend/dist/batch-rewrite/v88-novel-status-center.js
```

并向最终 `frontend/dist/batch-rewrite/index.html` 注入：

```html
<script id="qiantie-novel-status-center" src="./v88-novel-status-center.js?v=20260907-r1"></script>
```

提交：`6e16b69c2eea19f2a22d429a050a5e907214377c`

### 7. 增加“构建后仍存在”的发布回归

继续修改：

`frontend/src/user/pages/batch-factory-v11/novel-fetch-121-safety-source.test.js`

新增检查：

- public 源模块存在；
- 模块包含状态中心和本地化能力；
- Stage workflow 必须复制模块；
- Stage workflow 必须注入 `qiantie-novel-status-center`。

提交：`a56a486335ecafa51c346c606274c6ae2da14f41`

### 8. 清理 Git-direct 切换后遗留的两条 Docker/GHCR 旧测试

`Novel Fetch V2 Check` 全量 Node 回归一度为 262 项中 260 通过、2 失败。两条失败均要求已经退役的 Docker/GHCR 发布流程：

1. `tests/novel-panel-v783031-release-artifact-retention.test.js`
2. `tests/v88-release-worker-secret-consistency.test.js`

仓库历史已确认 `26c50ea063b838dc22afb1d0d5afa37d988acfc9`（`formalize Git-direct Node public deployment`）正式退役自动 Docker/GHCR 公网发布。

处理原则：不复活退役流程，改为验证当前 Git-direct 安全契约。

更新 1：`tests/novel-panel-v783031-release-artifact-retention.test.js`

- 退役 workflow 不得再有 `packages: write` / `actions: write`；
- 不得再登录 GHCR 或 `docker push`；
- 当前发布必须使用 `STAGE-REQUEST` + `CUTOVER-REQUEST`；
- Stage 必须先旁路构建，不能直接切公网。

提交：`48bc969ad5efeb479f0aba20c3413fb89506ecd2`

更新 2：`tests/v88-release-worker-secret-consistency.test.js`

- Node 与 121 Worker 仍必须使用同一组三个内部密钥；
- 两者的 Compose 源仍共同使用 `novel-fetch-121.env`；
- Git-direct Stage 从当前生产 Node 容器继承实际环境；
- 三个 121 密钥不得被继承过滤器排除；
- 新 Node 继续连接现有 Browser Worker IP，不另建一套 Worker。

提交：`dc157b96e15403f83564ca154eed872a8a26f09f`

随后修正测试自身 `${...}` Compose 占位符的 JS 转义风险，改为字面字符串拼接：

提交：`419f0bfa6304d34342c8f1ea9a756ba4705c1197`

## TDD / 验证记录

### RED

状态中心专用测试在生产模块不存在时：

- `node --test test/novel-status-center.test.js`
- 结果：失败，`MODULE_NOT_FOUND`。

CI 跟进也暴露了两类旧契约：

- 121 浏览器 guard 旧测试仍要求 15 秒；
- Docker/GHCR 已退役，但两条全量 Node 回归仍要求旧发布流程。

### GREEN

状态中心模块加入后：

- `node --check frontend/dist/batch-rewrite/v88-novel-status-center.js`
- `node --test test/novel-status-center.test.js`
- 5/5 通过，0 failed。

修正 121 旧测试后：

- BF11 frontend job 通过；
- BF11 node-proxy job 通过；
- BF11 go job 通过。

构建持久化规则已加入 source + stage workflow，并有独立回归防止后续 build 再次丢失状态模块。

Git-direct 两条遗留测试已改为现行发布安全契约；最终全量 CI 结果以本次发布前最新 run 为准。

### Git 内容一致性

早期本地验证文件 Git blob：

- 状态模块：`631d5b358b59c306669acd9adedbffeff6867488`
- 状态专用测试：`d1be82539f9fc4085138d3b90ef0b0b3d587842a`

GitHub `v88` 读回 SHA 与以上一致。

## 正式发布路径

当前 V88 公网正式发布不再使用自动 Docker/GHCR Image Release。

正式流程为：

1. 所有代码先进入 Git `v88`；
2. 修改 `deploy/v88-direct/STAGE-REQUEST`，触发 `V88 Direct Deploy Node Stage`；
3. Stage 只在 ECS 旁路启动精确 Git SHA，并验证 build-info、首页和 Nginx 到旁路 Node 的可达性，不切公网流量；
4. Stage 成功后，把精确 staged SHA 写入 `deploy/v88-direct/CUTOVER-REQUEST`；
5. `V88 Direct Deploy Node Cutover` 再执行公网切换，并保留自动回滚保护；
6. 不直接进入 ECS 容器手改正式文件。

## 分支策略

- 不合并到 `master/main`。
- `v88` 继续作为唯一维护主线和未来总分支。
- 所有正式功能继续收口 `v88`，公网仅运行从 `v88` 发布出的确定版本。

## 当前执行状态

- 状态中心代码：已写入 `v88`。
- public 静态源：已补齐。
- build 后复制/注入：已补齐。
- 状态中心专用 5 项回归：通过。
- 121 旧超时测试：已与现行 65 秒浏览器 guard 对齐。
- Docker/GHCR 退役后的旧回归：已改成 Git-direct 现行契约。
- 下一步：等待最新 `v88` CI 通过后，执行 Stage → Cutover 发布到公网。
