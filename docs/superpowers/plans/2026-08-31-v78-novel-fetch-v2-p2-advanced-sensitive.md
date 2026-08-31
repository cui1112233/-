# V78 小说获取 V2 P2：Advanced Workflow / Sensitive Modes 实施计划

**依赖：** P0、P1 完成。  
**Branch:** `feat/v78-novel-fetch-v2-completion`

**Goal:** 恢复原系统有价值的高级自动化与敏感词策略，并保证每个配置项都有真实后端执行语义，不出现只保存不生效的假开关。

## Task 1 — 配置 normalize contract

**Files**
- Modify: `lib/novel-fetch-workshop/config.js`
- Create: `lib/novel-fetch-workshop/workflow-policy.js`
- Create: `tests/novel-fetch-workflow-policy.test.js`

正式字段：

```text
fetch.min_original_chars
fetch.skip_short_original
workflow.auto_sync_site_styles
workflow.auto_reclassify_invalid_style
storage.cleanup_enabled
storage.retention_days
web_submit.batch_size
web_submit.flush_seconds
ai.force_serial_batch
sensitive_ai.mode
```

每个数字 clamp，每个 boolean 明确保留 false；旧配置缺字段时使用安全默认值。

## Task 2 — Short original policy

修改 Runner fetch 后阶段。TDD：正文低于阈值且 skip 开启 → `skipped_short_original`，不进入 rewrite；关闭 skip 则照常处理；原始 raw 仍保留供人工查看。

## Task 3 — Invalid style reclassification

定义“无效风格”为不在当前服务端 style catalog 中。仅 `auto_reclassify_invalid_style=true` 时重新分类；已有有效 style 不重复调用 AI。

## Task 4 — Auto sync 121 styles

自动同步只能在已有有效 121 登录 session 且配置开启时执行；同步失败只标 warning，不得改用硬编码 style catalog。每个 process batch 最多同步一次，不能每本书都访问 121。

## Task 5 — Storage cleanup

新增 owner-scoped cleanup service。只删除超过 retention_days 且处于 terminal state 的普通任务；失败、waiting_retry、scheduled、tombstone 相关记录不得自动清理。必须有 dry-run helper 测试。

## Task 6 — Auto submit batching

把自动提交从一次提交所有 fetchedIds 调整为 `batch_size` 分组，并在需要时使用 bounded `flush_seconds` 聚合；仍要求 `auto_submit_after_rewrite === true && auto_submit_confirmed === true`。

不允许配置迁移后自动开启上传。

## Task 7 — Force serial batch

当 `ai.force_serial_batch=true` 时 rewrite concurrency 强制 1；false 时继续使用 `ai.max_concurrency`。TDD 记录峰值并发，证明不是 UI-only。

## Task 8 — Sensitive three modes

**Files**
- Modify: `lib/novel-fetch-workshop/sensitive.js`
- Modify: `lib/novel-fetch-workshop/runner.js`
- Modify: `frontend/public/batch-rewrite/*`
- Create: `tests/novel-fetch-sensitive-modes.test.js`

正式模式：

- `replace`
- `ai_each`
- `ai_group`

TDD：三种模式、AI error fallback、fallback 日志、命中计数/修复计数。AI 失败后的直接替换必须明确记录 `fallback_from_ai=true`。

## Task 9 — sensitive_fix 独立模型 UI

恢复 `ai_assignments.sensitive_fix` selector；后端仍以 config store 为 authority。UI 不复制模型配置，只选择已有 preset/current id。

## Task 10 — P2 verification

Focused tests 全部 RED→GREEN；再跑全量 Node tests 和 frontend build。不得改 V11 或部署生产。
