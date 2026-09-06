# V88 小说获取｜版本对应配置档单一权威持久化

日期：2026-09-06
目标分支：`v88`
修复分支：`fix/v88-version-config-authority-20260906`
PR：#24

## 用户现象

1. 公网小说获取中的“版本对应配置档”点击保存耗时明显偏长。
2. 保存后关闭卡片，再次进入时刚保存的版本/配置档信息会消失或回到旧值。

## 根因

旧的保存按钮一次点击串行等待三条保存链路：

1. `saveWorkFormStateNow()` → `/api/work-form`
2. `saveConfig(true)` → `/api/config`
3. `saveWebSubmitConfig(true)` → `/api/web-submit/config`

同一张“版本对应配置档”卡片的数据因此分散在 `work_form`、`app_config`、`web_submit` 三条写入路径中。保存耗时是三次 HTTP + 三次配置持久化的累加；重新打开又会从旧的 `state.config` 渲染提示词/配置，存在刚保存值被旧内存状态覆盖的风险。

后端现有 `/api/batch-rewrite/config` 已具备单次 `tasks.saveConfig(next)` 的完整配置持久化能力，并在回读时同时返回 `app_config`、`web_submit`、`work_form`，因此无需新增数据库表或第二套配置结构。

## 修复方案

### 单一权威入口

新增 `frontend/public/batch-rewrite/version-config-authority.js`，只接管“保存版本配置”按钮。

一次保存会先在浏览器内合成本次完整配置：

- `work_form`
  - `selected_versions`
  - `ai_slot_methods`
  - `sensitive_ai_enabled`
  - 平台/输入等现有工作表状态
- `web_submit`
  - 121 配置档
  - 默认配置档
  - `profile_bindings`
  - `submit_versions`
  - 其他上传保护参数
- `app_config`
  - 改文提示词
  - 处理规则提示词
  - AI/改文相关现有配置
- `knowledge`
  - 知识库使用提示词及现有知识库数据

随后只发送一次：

`POST /api/batch-rewrite/config`

payload：

```json
{
  "app_config": {
    "work_form": "...",
    "web_submit": "...",
    "knowledge": "..."
  }
}
```

服务端执行一次 `tasks.saveConfig(next)` 后返回最新完整配置；前端立即执行：

`state.config = result.config`

从此保存成功后的服务端回读结果是唯一权威状态，不再继续使用保存前的旧 `state.config`。

### 防止额外延迟/竞态

保存前执行 `clearTimeout(workFormSaveTimer)`，取消工作表 800ms 自动保存的待执行定时器，避免点击保存后又额外触发 `/work-form` 写入。

保存按钮在请求期间 disabled，避免重复点击产生并发写入。

保存成功后把同一份 `formState` 写入 localStorage，浏览器本地缓存与服务端权威配置保持一致。

## 修改文件

- `frontend/public/batch-rewrite/version-config-authority.js`
  - 新增单一权威保存函数 `saveVersionConfigAuthority()`
  - 新增按钮处理器 `confirmWebSubmitSelectionAuthority()`
  - 覆盖旧按钮绑定
- `frontend/public/batch-rewrite/index.html`
  - 在原 `app.js` 后加载 `version-config-authority.js`
- `tests/novel-fetch-v88-mainline-version-config.test.js`
  - 新增单一保存契约回归
  - 校验服务端回读覆盖 `state.config`
  - 校验 `work_form` / `web_submit` 同时进入同一 `app_config` payload
  - 保留 AI4/AI5 121 配置档绑定回归
- `.github/workflows/v88-version-config-persistence.yml`
  - 新增轻量专用回归，PR 到 v88 或 v88 push 且相关文件变化时运行

## TDD / 验证

测试先定义了不存在的 `saveVersionConfigAuthority()` 单一保存契约；旧生产代码仍是三段串行保存，因此不满足新契约。

实现后 PR #24 当前 HEAD：`31d3dbfe9a911cc06936ce5cb0d7cb7caef49dd2`

GitHub Actions：

- `V88 Version Config Persistence`
  - run：`34043654874`
  - job：`101514751549`
  - `Run version config persistence regression`：SUCCESS
- `V88 CM Public Release Guard`
  - run：`34043654885`
  - conclusion：SUCCESS

PR 与当前 v88：GitHub 判定 `mergeable: true`。虽然 v88 在修复过程中有其他提交进入，compare 显示分支 behind，但本 PR 的有效文件差异仍只包含本次 4 个修复/测试文件，没有覆盖其他 V88 功能文件。

## 预期用户结果

1. “保存版本配置”从三段串行保存收口为一次权威配置保存。
2. 保存完成后当前页面立即采用服务端刚回读的数据。
3. 关闭后重新打开，配置不应恢复成保存前旧值。
4. 页面刷新后，`work_form`、121 `profile_bindings`、提示词仍从同一服务端配置记录读回。
5. AI1～AI5 的绑定继续相互独立，不会串配置档。

## 公网部署边界

此前存在一次 V88 ECS 发布被人工取消、`PUBLIC DEPLOYMENT PENDING` 的历史记录。因此代码合并后仍必须以最新 `v88` 的发布工作流 / ECS 实际 build-info 为准，不能仅凭 GitHub 合并就宣称公网已更新。
