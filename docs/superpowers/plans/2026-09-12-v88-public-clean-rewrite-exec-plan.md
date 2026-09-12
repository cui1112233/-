# 一战晟铭 v88 公网清晰仓库重构执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/Users/ming/Documents/ChatGPT/一战晟铭` 重建为只跟踪 `origin/v88` 的清晰主线仓库，并剔除非公网必需内容。

**Architecture:** 本仓库保留为单主线源码快照，核心逻辑由 `v88` 提供。所有开发与发布动作只围绕 `v88` 分支展开，避免并行分支污染工作区。

**Tech Stack:** Node.js / Go（按项目既有栈），Git（标准操作）

## Global Constraints

- 只保留公网可运行的来源文件，过滤本地临时运行态和历史规划文件。
- 远端固定为 `https://github.com/cui1112233/-`，主线固定为 `v88`。
- 不执行破坏性恢复性操作（不做 `git reset --hard`、不回滚未提交敏感改动）。

---

### Task 1: 建立 v88 远端追踪与工作分支

**Files:**
- `.git/config`
- 工作树（检出内容来自 `origin/v88`）

**Interfaces:**
- Consumes: 当前仓库 `.git` 和 `main` 目录
- Produces: 本地 `v88` 分支（追踪 `origin/v88`）

- [ ] **Step 1: 添加远端并拉取 v88**
  
Run: `git -C /Users/ming/Documents/ChatGPT/一战晟铭 remote add origin https://github.com/cui1112233/-.git && git -C /Users/ming/Documents/ChatGPT/一战晟铭 fetch origin v88:refs/remotes/origin/v88`

Expected: `origin/v88` 可用，未批量拉取其他分支。

- [ ] **Step 2: 以 `v88` 覆盖当前工作树**
  
Run: `git -C /Users/ming/Documents/ChatGPT/一战晟铭 checkout -B v88 --track origin/v88`

Expected: 当前仓库工作树切换为 `v88` 源码，当前分支为 `v88`。

- [ ] **Step 3: 把设计文档提交补入新主线（保留审计文档）**
  
Run: `git -C /Users/ming/Documents/ChatGPT/一战晟铭 cherry-pick eec9119`

Expected: `docs/superpowers/specs/2026-09-12-v88-public-clean-rewrite-design.md` 仍在新主线中。

- [ ] **Step 4: 提交里程碑**
  
Run: `git -C /Users/ming/Documents/ChatGPT/一战晟铭 status --short --branch`

Expected: 关键文件在 `v88` 上可见，后续清理可按任务进行。

### Task 2: 清理非公网必需文件

**Files:**
- `.gitignore`（新增）
- 工作树内文件（`git rm`）

**Interfaces:**
- Consumes: `Task 1` 的 `v88` 工作树
- Produces: 仅公网必需内容与一份最小化分支结构

- [ ] **Step 1: 删除开发噪音与临时文件**
  
Run: `git -C /Users/ming/Documents/ChatGPT/一战晟铭 rm -r --cached --ignore-unmatch .superpowers docs/superpowers/plans docs/superpowers/reports data test tests .DS_Store`

Expected: 以上路径从版本控制中移除（若不存在则忽略）。

- [ ] **Step 2: 提交清理结果**
  
Run: `git -C /Users/ming/Documents/ChatGPT/一战晟铭 commit -m "chore: clean local repo for v88 public baseline"`

Expected: 仓库只保留核心发布链路内容。

### Task 3: 固化并验证分支与远端边界

**Files:**
- `docs/superpowers/plans/2026-09-12-v88-public-clean-rewrite-exec-plan.md`

**Interfaces:**
- Consumes: 任务 1~2 的执行结果
- Produces: 可复用的分支边界状态

- [ ] **Step 1: 固定默认关注到 v88（可选）**
  
Run: `git -C /Users/ming/Documents/ChatGPT/一战晟铭 branch -D main`

Expected: 仅保留 `v88` 长期分支（如需保留 `main` 记录可跳过）。

- [ ] **Step 2: 验证边界**
  
Run: `git -C /Users/ming/Documents/ChatGPT/一战晟铭 branch --list && git -C /Users/ming/Documents/ChatGPT/一战晟铭 branch -r && git -C /Users/ming/Documents/ChatGPT/一战晟铭 status --short --branch`

Expected: 当前为单主线 `v88` 工作区，未跟踪无关本地分支。

- [ ] **Step 3: 提交完成状态**
  
Run: `git -C /Users/ming/Documents/ChatGPT/一战晟铭 commit -m "feat: bootstrap clean v88 public baseline branch"`

Expected: 形成一次可回溯的“清理完成”提交（如无改动则说明前序清理已包含）。
