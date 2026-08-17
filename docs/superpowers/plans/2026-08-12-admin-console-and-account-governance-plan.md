# 管理后台与账号授权 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将管理后台升级为可返回工作台的运营界面，并接通账号、申请和授权管理。

**Architecture:** Express 管理接口继续以服务端能力校验作为唯一权限边界。React 管理端使用独立布局和真实文档跳转返回用户端；账号页只调用安全的管理接口，密码只允许写入而不回显。

**Tech Stack:** Express、Node test、React 18、Ant Design、Vite。

---

### Task 1: 管理账号 API

**Files:**
- Modify: `routes/admin.js`
- Test: `tests/governance-routes.test.js`

- [ ] 为主账号新增创建账号、读取授权列表接口，并保持审核员无法创建账号或修改授权。
- [ ] 用 `node --test tests/governance-routes.test.js` 证明未实现时失败，再实现并复验。

### Task 2: 账号与授权页面

**Files:**
- Create: `frontend/src/admin/pages/AccountGovernancePage.jsx`
- Modify: `frontend/src/shared/api/admin.js`
- Modify: `frontend/src/admin/App.jsx`

- [ ] 添加账号、申请、状态、密码与授权 API 客户端。
- [ ] 实现账号表、申请审核、账号抽屉和主账号授权抽屉；密码字段只写不回显。

### Task 3: 管理端导航和视觉

**Files:**
- Modify: `frontend/src/shared/layouts/AdminLayout.jsx`
- Modify: `frontend/src/admin/pages/DashboardPage.jsx`
- Modify: `frontend/src/shared/styles/global.css`

- [ ] 使用统一后台侧栏、清晰当前页和“返回创作工作台”文档跳转。
- [ ] 为管理页添加紧凑的表格、统计和窄屏布局样式。

### Task 4: 验证

**Files:**
- Test: `tests/governance-routes.test.js`
- Test: `scripts/validate-react-frontend-architecture.js`

- [ ] 运行管理接口测试、前端构建、静态结构检查。
- [ ] 重启常驻服务，在浏览器验证创建账号入口、授权抽屉和返回工作台。
