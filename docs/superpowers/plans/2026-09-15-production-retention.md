# 制作文件保留时长设置实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在小说获取“配置”中提供 7/14/30 天制作任务保留时长，默认启用 7 天清理，并确保头像、参考图和长期用户素材不受影响。

**Architecture:** 复用现有 novel-fetch workshop 的 `storage` 策略和批处理清理链路。服务端统一规范化为 `cleanup_enabled` 与 `retention_days`，前端只编辑这两个字段；清理逻辑继续只删除已完成且超过期限的小说获取任务，不触碰头像、人物/场景参考图、用户素材或项目配置。

**Tech Stack:** Node.js、现有 Express 路由、原生 legacy batch-rewrite 页面、Node test runner。

**Spec:** 本轮以用户确认的“默认 7 天、可选 14/30 天、只清理制作文件”为需求；TOS 媒体迁移继续作为后续独立阶段，不在本轮写入凭据或切换存储。

## Global Constraints

- 只修改 V88 分支，不修改 master、V78 或 production。
- 不使用 GitHub Actions/GHCR；本轮只做代码与本地验证。
- 不读取、记录或提交 TOS 密钥、账号、Cookie 或其他秘密。
- 保留工作区已有 `frontend/dist` 和其他未提交文件，不执行 reset/clean。

---

### Task 1: 规范化保留策略并补测试

**Files:**
- Modify: `lib/novel-fetch-workshop/workflow-policy.js`
- Create: `lib/novel-fetch-workshop/workflow-policy.test.js`

- [ ] 写测试：默认返回 `cleanup_enabled: true` 与 `retention_days: 7`；非法值回退 7；只接受 7、14、30 天。
- [ ] 运行测试确认当前默认 30/关闭会失败。
- [ ] 修改规范化逻辑，保留旧配置兼容但把可选范围收敛到 7/14/30。
- [ ] 运行测试确认通过。

### Task 2: 在小说获取配置页加入设置

**Files:**
- Modify: `frontend/public/batch-rewrite/index.html`
- Modify: `frontend/public/batch-rewrite/app.js`
- Create: `frontend/public/batch-rewrite/storage-retention-source.test.js`

- [ ] 写源码契约测试，要求页面出现“制作文件保留时长”、7/14/30 选项、默认 7 天和只清理制作产物的中文说明。
- [ ] 运行测试确认当前页面缺少这些控件而失败。
- [ ] 在“配置”面板加入开关与下拉框，默认选中 7 天，并明确头像、参考图、用户素材不会清理。
- [ ] 让 `renderWorkflowConfig` 回填 `storage.cleanup_enabled` 和 `storage.retention_days`，让 `syncFormToAppConfig` 保存这两个字段。
- [ ] 运行源码契约测试。

### Task 3: 回归验证

**Files:**
- No additional files.

- [ ] 运行策略与源码契约测试。
- [ ] 运行完整 Node 回归测试。
- [ ] 运行前端构建并检查 `git diff --check`。
- [ ] 仅汇报已验证的代码范围；不声称已经部署到 ECS 或 TOS。
