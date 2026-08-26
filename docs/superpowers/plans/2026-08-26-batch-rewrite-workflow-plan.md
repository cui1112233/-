# 批量改文工作流归并实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将登录和提交设置移入处理页，将任务详情改为可导航弹窗，并移除网站提交页。

**Architecture:** 复用现有 web-submit 接口和 web_submit 配置结构，只调整静态工作台布局与事件绑定；任务详情由任务页弹窗容器承载，使用当前日期过滤后的 `state.tasks` 计算上一条/下一条。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Express、Node test、Docker Compose。

## Global Constraints

- 前端 API 使用同源相对路径。
- 保留现有用户数据、提交历史和未相关工作区改动。
- 提交设置默认收起；上一条/下一条不循环。
- 修改后运行前端构建、定向测试和 Docker 健康检查。

### Task 1: 处理页归并

**Files:**
- Modify: `frontend/public/batch-rewrite/index.html`
- Modify: `frontend/public/batch-rewrite/app.js`
- Modify: `frontend/public/batch-rewrite/styles.css`
- Test: `tests/batch-rewrite-workflow-ui.test.js`

- [ ] 添加失败契约测试：没有 `siteSubmit` 导航/面板，处理页含登录状态入口和默认收起的提交设置。
- [ ] 将现有网站提交连接与设置 DOM 移入处理页，保留原有控件 id，使用 `details open=false`。
- [ ] 添加登录状态渲染、弹窗打开/关闭和验证事件，复用现有保存与验证接口。
- [ ] 将提交配置保存、同步、预览函数改为从处理页控件读取，并更新任务页提交按钮提示。
- [ ] 删除网站提交 tab/panel 的绑定和渲染分支，更新样式。
- [ ] 运行 UI 契约测试并修正失败。

### Task 2: 任务详情弹窗

**Files:**
- Modify: `frontend/public/batch-rewrite/index.html`
- Modify: `frontend/public/batch-rewrite/app.js`
- Modify: `frontend/public/batch-rewrite/styles.css`
- Test: `tests/batch-rewrite-workflow-ui.test.js`

- [ ] 添加失败契约测试：任务页存在详情弹窗、关闭/上一条/下一条控件。
- [ ] 新增弹窗容器与遮罩，`renderDetail`、`renderSensitiveLog`、`renderRulesTrace`、`renderSiteSubmitLog` 输出到弹窗内容。
- [ ] 实现 `showTask` 设置当前索引，上一条/下一条按 `state.tasks` 切换并在边界禁用。
- [ ] 事件委托支持弹窗关闭、遮罩关闭和键盘 Escape。
- [ ] 运行 UI 契约测试和现有批量改文测试。

### Task 3: 发布验证

**Files:**
- Modify: `frontend/public/batch-rewrite/index.html` (cache version only if needed)

- [ ] 运行 `npm run frontend:build`。
- [ ] 运行 Node 定向测试和 `git diff --check`。
- [ ] 使用 Docker 无缓存重建 platform，重启并执行健康检查。
- [ ] 通过 HTTP 200 检查处理页，确认网站提交导航已消失。
