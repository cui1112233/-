# 统一制作文件保留策略

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在导航栏 `/settings` 提供当前用户统一的制作文件保留时长（7/14/30 天，默认 7 天），覆盖剧本生成、小说获取、小说面板、水货生产、Agent 工作区及后续 TOS 制作产物。只清理已完成且过期的制作产物；头像、人物/场景/道具参考图、用户上传长期素材、项目配置和账号/会话数据永久保留。

**Architecture:** 使用账号配置 `productionRetentionDays` 作为唯一来源；小说获取保留旧 `storage` 字段兼容但不再编辑。服务启动先做一次只读扫描，随后每 24 小时调用本地安全清理器；TOS 通过按用户前缀隔离的可注入适配器接入，不在 Git 保存凭据。

**Tech Stack:** Node.js、现有 Express 路由、原生 legacy batch-rewrite 页面、Node test runner。

**Spec:** 默认 7 天、可选 14/30 天、清理固定开启；首次正式清理前先执行只读扫描。

## Global Constraints

- 只修改 V88 分支，不修改 master、V78 或 production。
- 不使用 GitHub Actions/GHCR；本轮只做代码与本地验证。
- 不读取、记录或提交 TOS 密钥、账号、Cookie 或其他秘密。
- 保留工作区已有 `frontend/dist` 和其他未提交文件，不执行 reset/clean。

---

### Task 1: 全局设置与策略

**Files:**
- Modify: `lib/shared.js`
- Modify: `routes/config.js`
- Modify: `frontend/src/user/pages/SettingsPage.jsx`
- Create: `routes/config-retention.test.js`
- Create: `frontend/src/user/pages/settings-retention-source.test.js`

- [x] `productionRetentionDays` 按用户保存，非法值回退 7，只接受 7/14/30。
- [x] 设置页增加统一下拉框和中文保护说明。

### Task 2: 本地与 TOS 清理

**Files:**
- Modify: `lib/novel-fetch-workshop/v2-batch-executor.js`
- Modify: `lib/novel-fetch-workshop/v2-compose.js`
- Modify: `app.js`
- Modify: `routes/storage.js`
- Create: `lib/production-retention.js`
- Create: `lib/production-retention-scheduler.js`

- [x] 小说获取移除局部保留控件，批处理优先读取全局配置并兼容旧字段。
- [x] 本地扫描覆盖制作输出目录，保护长期资产、配置及非终态任务。
- [x] 启动只读扫描和每日后台清理；提供 `/api/storage/retention-preview`。
- [x] 提供按用户 TOS 前缀隔离的适配器接口，凭据由 ECS 注入。

### Task 3: 回归验证

**Files:**
- No additional files.

- [x] 运行策略、清理、调度器、路由与源码契约测试。
- [x] 前端构建通过；`git diff --check` 仅受既有 `frontend/dist` 换行/生成文件影响。
- [ ] ECS/TOS 部署需另行授权和验证，本次不执行。
