# 远程分支收敛清单（2026-10-03）

## 保留

- `v88`：生产发布线，当前 `b9a1b6d3df7682f29b0fe9047cc6d53bbd702c61`
- `master`：主开发/集成线
- 近期发布 tag：当前仓库尚需补建/核验 `v88-release-<sha>` tag
- 未合入 `v88` 的活跃功能分支：本次不删除

## 删除前提

下列分支全部满足 `git branch -r --merged origin/v88`，且不包含 `origin/v88` 或 `origin/master`。删除只移除远程引用，提交内容仍由 `v88` 历史保留。

## 本次删除列表

```text
origin/codex/v88-direct-deploy-target-050fdd
origin/codex/v88-direct-deploy-target-219ca
origin/codex/v88-h3-smart-unified
origin/feat/agent-native-backend-tools-20260921
origin/feat/v78-novel-fetch-v2-completion
origin/feat/v78-novel-fetch-v2-completion-copy
origin/feat/v88-direct-deploy-final-20260907
origin/feat/v88-direct-deploy-final2-20260907
origin/feat/v88-unified-public-deploy-20260912
origin/feature/v88-batch-factory-public-release-20260912
origin/feature/v88-batch-factory-rebuild-20260912
origin/fix/novel-fetch-config-v2-20260912
origin/fix/v88-121-secret-alignment-20260907
origin/fix/v88-121-validation-timeout-20260907-r2
origin/fix/v88-active-121-worker-timeouts-20260907
origin/fix/v88-active-121-worker-timeouts-ci-20260907
origin/fix/v88-bf11-release-gates-20260912
origin/fix/v88-browser-worker-first-deploy-20260906
origin/fix/v88-cm-public-release-guard
origin/fix/v88-doubao-video-tab
origin/fix/v88-doubao-video-tab-temp
origin/fix/v88-h3-api-contract-20260909
origin/fix/v88-local-executor-bridge-auth-20260906
origin/fix/v88-local-executor-public-regression-20260907
origin/fix/v88-local-executor-script-video-20260907
origin/fix/v88-novel-fetch-browser-worker-wireup-r2-20260906
origin/fix/v88-novel-fetch-selected-submit-20260917
origin/fix/v88-novel-submit-confirm-20260909
origin/fix/v88-public-deploy-ghcr-first-20260906
origin/fix/v88-public-merge-recovery-20260925
origin/fix/v88-release-auth-verification-clean-20260907
origin/fix/v88-release-heredoc-syntax-20260907
origin/fix/v88-script-model-selectors-20260913
origin/fix/v88-shuihuo-compat-priority-20260912
origin/fix/v88-update-browser-worker-env-contract-20260907
origin/fix/v88-upload-session-expired-401-20260909
origin/fix/v88-version-config-persistence-20260906
origin/hotfix/production-v78.3.0.3-novel-fetch-timeout
origin/integrate/v88-batch-factory-handoff
origin/integrate/v88-local-executor-auto-update
origin/integrate/v88-local-executor-auto-update-final
origin/integration/v88-h3-on-current-v88-20260909-r3
origin/integration/v88-novel-fetch-public-parity-20260919
origin/integration/v88-script-at-mentions-20260922
origin/ops/v88-public-121-timeout-hotfix-20260906
origin/ops/v88-public-121-timeout-hotfix-20260906-final
origin/ops/v88-public-121-timeout-hotfix-20260906-final-run
origin/ops/v88-public-121-timeout-hotfix-20260906-run
origin/ops/v88-public-amd64-release-20260903
origin/release/v88-batch-factory-public-20260912
origin/temp-delete-me
origin/tmp-ignore
origin/tmp-noop
origin/tmp-red-tests
origin/tmp-red-tests-2
```

## 未删除

所有未合入 `v88` 的分支、当前活跃工作树对应分支，以及所有 Git tag 均保留；删除前需单独评估其功能是否已等价合入。
