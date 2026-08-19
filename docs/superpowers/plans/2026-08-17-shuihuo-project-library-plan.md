# 水货生产项目库视觉对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 将水货生产项目库入口按参考截图重构，保留现有后端和项目操作能力。

**Architecture:** 重做 `ProjectsView` 的页面结构，使用父页面提供的项目数据和现有 API；在 `ShuihuoProductionPage` 中保留健康检查但把它变成可收起的窄条；所有视觉规则集中在 `shuihuo-production.css`，不改变工作台组件。

**Tech Stack:** React 18, Ant Design, Lucide/Ant Design icons, CSS, Node contract tests, Vite.

---

### Task 1: 项目库结构与交互

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/ProjectsView.jsx`
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Modify: `tests/shuihuo-production-ui-contract.test.js`

- [ ] **Step 1: 写项目库合同测试。**

断言 `ProjectsView.jsx` 包含“漫剧解说”“管理和创建您的漫剧解说作品”“个人作品”“搜索作品”“全部合集”“按时间降序”“创建漫剧”，并断言卡片使用封面、分镜数量、更新时间和悬停操作；断言健康条有关闭入口。

- [ ] **Step 2: 运行合同测试确认失败。**

Run: `node --test tests/shuihuo-production-ui-contract.test.js`

Expected: FAIL，因为当前页面仍是普通项目卡片、网页式标题和常驻操作。

- [ ] **Step 3: 重做项目库 DOM。**

增加名称搜索、排序状态、健康条关闭状态和参考图式卡片结构。搜索与排序只作用于已加载项目数组；打开、删除、创建、上传仍调用现有回调。新建弹窗保留现有文件读取和导入接口。

- [ ] **Step 4: 重做项目库样式。**

使用 38px 顶部壳层、24px 页面边距、200px 左右固定卡片、深蓝灰颜色、右侧单行筛选控件和悬停操作；窄屏改为可滚动筛选行和两列/单列卡片，不改变桌面端比例。

- [ ] **Step 5: 运行合同和构建。**

Run: `node --test tests/shuihuo-production-ui-contract.test.js tests/shuihuo-reference-alignment-contract.test.js && npm --prefix frontend run build && git diff --check`

Expected: all tests pass, Vite exits 0, diff check has no output。

### Task 2: 视觉核对与回归

**Files:**
- Modify only if required: `frontend/src/user/pages/shuihuo-production.css`, `tests/shuihuo-production-ui-contract.test.js`

- [ ] **Step 1: 检查 1920x1080 与 390x844。**

确认桌面端标题、筛选行和首行卡片位置与截图比例一致；确认窄屏没有横向溢出、卡片文字不被操作覆盖。

- [ ] **Step 2: 回归现有功能合同。**

Run: `node --test tests/shuihuo-production-ui-contract.test.js tests/shuihuo-reference-alignment-contract.test.js && npm --prefix frontend run build`

- [ ] **Step 3: 不触发真实生成任务。**

只访问项目库页面和新建弹窗，不提交图片、视频、音频或文本模型任务。
