# 巨量素材先创建再获取原文 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让巨量获取模式的“立即执行”直接创建批量并通过已解析书城与 Book ID 获取原文，不被自动制作预设阻塞。

**Architecture:** 复用 `submitGiantMaterial({ automationRun: false })` 已有的占位登记和 `fetchBookOriginal` 调用。仅将巨量模式按钮从“打开自动化预设对话框”改为直接提交；普通书城、定时入口和预设对话框不改。

**Tech Stack:** React、Ant Design、Node test runner、Vite。

## Global Constraints

- 巨量立即执行不得调用自动制作、视频生成或上传接口。
- 青语令牌保持在公网受保护 `.env`，不进入前端、日志或 Git。
- 仅前端代码变更，发布走 V88 Node Git 直部署，不构建或重启 Go 镜像、数据库、Redis 或执行器。
- 已解析失败（缺书名/Book ID）的素材不创建占位书。

---

### Task 1: 锁定巨量立即执行不需要预设的界面契约

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx:646-648`

**Interfaces:**
- Consumes: `submitGiantMaterial({ scheduledRun?: boolean, automationRun?: boolean })`。
- Produces: 巨量模式的“立即执行”按钮直接调用 `submitGiantMaterial()`；非巨量模式继续调用 `openAutomationDialog('immediate')`。

- [ ] **Step 1: 写入失败测试**

在现有 `offers giant material intake through the resident executor` 测试中，用以下断言替换旧的“不含读取并创建”断言，并增加独立测试：

```js
test('giant immediate execution creates and starts original retrieval without an automation preset', () => {
  assert.match(source, /isGiantMaterial\s*\?\s*<>[\s\S]*?onClick=\{\(\) => submitGiantMaterial\(\)\}/);
  assert.match(source, /onClick=\{\(\) => openAutomationDialog\('immediate'\)\}/);
});
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
node --test frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js
```

Expected: FAIL，因为巨量“立即执行”当前仍调用 `openAutomationDialog('immediate')`。

- [ ] **Step 3: 最小实现**

在巨量工具栏中将按钮改为：

```jsx
<Button
  type="primary"
  disabled={createDisabled}
  loading={busy}
  onClick={() => submitGiantMaterial()}
>
  立即执行
</Button>
```

保留非巨量分支的原样代码：

```jsx
<Button type="primary" disabled={createDisabled} loading={busy} onClick={() => openAutomationDialog('immediate')}>
  立即执行
</Button>
```

- [ ] **Step 4: 运行通过测试**

Run:

```bash
node --test frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交实现**

```bash
git add frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js
git commit -m "fix(batch): create giant batch before original retrieval"
```

### Task 2: 验证前端构建与精确 V88 发布

**Files:**
- Verify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx`
- Verify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js`

**Interfaces:**
- Consumes: Task 1 的巨量立即执行入口。
- Produces: V88 精确 SHA 的 Node 增量发布；Go API、执行器和数据服务保持运行。

- [ ] **Step 1: 运行聚焦测试和前端构建**

```bash
node --test frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js
npm --prefix frontend run build
```

Expected: 测试通过，Vite 构建完成。

- [ ] **Step 2: 推送实现 SHA 到 V88**

```bash
git push origin HEAD:v88
git rev-parse HEAD
```

Expected: 返回的 SHA 是 `origin/v88` 的最新提交。

- [ ] **Step 3: 走 V88 Node Git 直部署**

对该精确 SHA 执行正式的 `V88 Direct Deploy Node Stage`，待 stage 健康检查通过后执行 `V88 Direct Deploy Node Cutover`。不选择镜像发布、Docker 重建或 Go 发布工作流。

- [ ] **Step 4: 外部验收**

在已登录公网的“水货生产 → 批量工厂”中，选择巨量获取并解析一条完整素材：点击“立即执行”后应关闭预设选择窗口、创建批量，并在工作区书卡显示原文获取状态。验证该动作不出现自动化预设对话框。
