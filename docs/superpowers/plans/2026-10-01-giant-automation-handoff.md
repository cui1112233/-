# 巨量素材自动生产衔接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让巨量素材的立即执行保存自动生产计划，并在正文到位前让日志显示真实等待状态。

**Architecture:** 复用现有创建弹窗的自动化配置对话框。巨量书仍在正文回填后调用既有 `startBatchAutomation`，日志根据书籍的巨量正文等待元数据补充一个只读等待项。

**Tech Stack:** React、Ant Design、Node source-contract tests。

## Global Constraints

- 只改 V88 Git 源码，发布采用前端增量直部署。
- 不自动为历史批次提交付费生产任务。

### Task 1: 巨量创建入口与日志

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`
- Test: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js`
- Test: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

- [ ] **Step 1: Write the failing tests**

Assert giant immediate execution calls `openAutomationDialog('immediate')`, and empty task logs render `巨量素材` plus `等待正文读取`.

- [ ] **Step 2: Verify red**

Run: `node --test --test-name-pattern='giant immediate execution opens|task logs explain' frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

- [ ] **Step 3: Implement the minimal behavior**

Replace giant’s direct submit button with the existing immediate automation dialog. Add optional `books` input to `BatchLogs`, derive only giant books with `contentPending`, and render a read-only waiting section only when no other runtime task exists.

- [ ] **Step 4: Verify green and build**

Run the two targeted source tests and `npm --prefix frontend run build`.

- [ ] **Step 5: Commit and publish**

Commit the source and tests to V88, then use the approved frontend incremental deployment path and verify `/api/build-info` exact SHA plus the authenticated workbench.
