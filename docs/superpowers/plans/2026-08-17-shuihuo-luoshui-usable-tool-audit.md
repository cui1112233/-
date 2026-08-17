# Shuihuo Luoshui Usable Tool Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an evidence-backed audit report that classifies Shuihuo Production functions as real, environment-dependent, disabled, backend-only, candidate-only, or virtual, then maps the missing work against Luoshui2026's visible comic-commentary workflow.

**Architecture:** This is a documentation/audit implementation, not a product-code change. The audit reads React UI code, Node gateway code, Go backend code, tests, and safe runtime HTTP health responses, then writes one Markdown report under `docs/superpowers/audits/`. The report separates static evidence from runtime evidence and does not inspect browser cookies, local storage, saved credentials, or third-party protected data.

**Tech Stack:** React, Express, Go HTTP API, MySQL-backed store code, Redis task queue code, object storage adapters, Markdown documentation, `rg`, `sed`, `curl`, `git`.

---

### Task 1: Build The Evidence Map

**Files:**
- Read: `/Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Read: `/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/*.jsx`
- Read: `/Users/ming/Downloads/qiantie/frontend/src/shared/api/shuihuoProduction.js`
- Read: `/Users/ming/Downloads/qiantie/routes/shuihuo-production.js`
- Read: `/Users/ming/Downloads/qiantie/backend/internal/httpapi/router.go`
- Read: `/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_*.go`
- Read: `/Users/ming/Downloads/qiantie/backend/internal/shuihuo/**/*.go`
- Read: `/Users/ming/Documents/小说前贴/docs/reverse/luoshui2026-prompt-community/evidence_index.md`
- Create: `/Users/ming/Downloads/qiantie/docs/superpowers/audits/2026-08-17-shuihuo-luoshui-usable-tool-audit.md`

- [ ] **Step 1: Capture UI entry points**

Run:

```bash
rg -n "Button|Modal|Drawer|message\\.|disabled|title=|onClick|createTask|createBatchTasks|exportProject|uploadMedia|generatePromptCandidates|analyzeAssets|listTasks|cancelTask|retryTask|downloadMedia|导出|配音|视频|图片|素材|分段|预设" \
  /Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx \
  /Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo \
  /Users/ming/Downloads/qiantie/frontend/src/shared/api/shuihuoProduction.js
```

Expected: output includes user-visible controls in `StudioView.jsx`, `TaskDrawer.jsx`, `BatchTaskModal.jsx`, `AssetsView.jsx`, `PromptCandidatesModal.jsx`, `MediaModal.jsx`, `ProductionConfigModal.jsx`, `ProjectFilesModal.jsx`, and `SegmentProductionCard.jsx`.

- [ ] **Step 2: Capture gateway and backend route coverage**

Run:

```bash
rg -n "shuihuo-production|handle.*Shuihuo|createShuihuoTask|BuildZIP|Worker|ProviderConfigured|Queue|Object|Export|Media|PromptCandidates|AssetAnalysis" \
  /Users/ming/Downloads/qiantie/routes/shuihuo-production.js \
  /Users/ming/Downloads/qiantie/backend/internal/httpapi \
  /Users/ming/Downloads/qiantie/backend/internal/shuihuo
```

Expected: output includes Node bridge signing, Go route registration, project/source/segmentation/storyboard/asset/media/task/export handlers, worker implementation, model adapter boundary, and storage/export services.

- [ ] **Step 3: Capture safe runtime health**

Run:

```bash
curl -sS -I http://127.0.0.1:3000/shuihuo-production
curl -sS http://127.0.0.1:3000/shuihuo-production | head -n 30
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:4000 -sTCP:LISTEN
```

Expected: port 3000 serves the React entry through Express; port 4000 is the Go backend process if currently running. Do not query authenticated APIs unless a safe token-free response is available through the app's normal auth layer.

- [ ] **Step 4: Create the audit report skeleton**

Create `/Users/ming/Downloads/qiantie/docs/superpowers/audits/2026-08-17-shuihuo-luoshui-usable-tool-audit.md` with this structure:

```markdown
# 水货生产洛水对齐可用工具审计

日期：2026-08-17
项目：/Users/ming/Downloads/qiantie
参考：/Users/ming/Documents/小说前贴/docs/reverse/luoshui2026-prompt-community/

## 1. 结论摘要

## 2. 证据边界

## 3. 功能真实性矩阵

| 功能 | 前端入口 | API/网关 | Go 后端 | 持久化/产物 | 判定 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |

## 4. 已真实落地

## 5. 依赖存在但当前环境可能阻塞

## 6. 前端禁用或阶段性关闭

## 7. 后端已实现但前端未完全开放

## 8. 候选/人工审核机制

## 9. 虚拟或空转功能

## 10. 洛水2026对照缺口

| 洛水能力 | 洛水证据字段 | 水货当前对应 | 缺口 | 优先级 |
| --- | --- | --- | --- | --- |

## 11. 最小可用工具补齐路线

## 12. 验证记录
```

Expected: report exists with all sections present before detailed filling.

### Task 2: Classify Current Shuihuo Features

**Files:**
- Modify: `/Users/ming/Downloads/qiantie/docs/superpowers/audits/2026-08-17-shuihuo-luoshui-usable-tool-audit.md`

- [ ] **Step 1: Classify project and source import**

Inspect:

```bash
sed -n '1,180p' /Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx
sed -n '1,180p' /Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/ProjectsView.jsx
sed -n '180,330p' /Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_handlers.go
```

Expected classification: project creation, paste import, source replacement, and deletion are real if backed by Go handlers and stores; note environment dependence on configured database and object storage for document/source persistence.

- [ ] **Step 2: Classify segmentation and storyboard editing**

Inspect:

```bash
sed -n '1,220p' /Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/StudioView.jsx
sed -n '1,220p' /Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/StoryboardRow.jsx
sed -n '1,220p' /Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_segmentation_handlers.go
sed -n '1,220p' /Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_storyboard_handlers.go
```

Expected classification: fixed/import/manual segmentation and confirm are real; smart segmentation is environment/model/preset dependent; merge/split/insert/delete/reorder are real when corresponding handlers and store calls are present.

- [ ] **Step 3: Classify assets and prompt candidates**

Inspect:

```bash
sed -n '1,180p' /Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/AssetsView.jsx
sed -n '1,140p' /Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/PromptCandidatesModal.jsx
sed -n '1,220p' /Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_analysis_handlers.go
sed -n '1,220p' /Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_prompt_generation_handlers.go
```

Expected classification: AI assets and prompt generation are candidate-only until user applies; generation depends on enabled text model and published preset. Manual asset editing is real.

- [ ] **Step 4: Classify media upload, task generation, and export**

Inspect:

```bash
sed -n '1,220p' /Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/MediaModal.jsx
sed -n '1,180p' /Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/TaskDrawer.jsx
sed -n '1,160p' /Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/BatchTaskModal.jsx
sed -n '1,230p' /Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_media_handlers.go
sed -n '1,380p' /Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_task_handlers.go
sed -n '1,240p' /Users/ming/Downloads/qiantie/backend/internal/shuihuo/tasks/worker.go
sed -n '1,120p' /Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_export_handlers.go
```

Expected classification: manual media upload/download/primary selection is real; task submission is real only when Redis queue, model configuration, object storage, and worker are healthy; export backend exists, but classify user-visible export by current frontend button state.

### Task 3: Map Luoshui Gaps And Write The Route To A Usable Tool

**Files:**
- Modify: `/Users/ming/Downloads/qiantie/docs/superpowers/audits/2026-08-17-shuihuo-luoshui-usable-tool-audit.md`

- [ ] **Step 1: Map Luoshui database fields to Shuihuo entities**

Inspect:

```bash
sed -n '80,150p' /Users/ming/Documents/小说前贴/docs/reverse/luoshui2026-prompt-community/evidence_index.md
sed -n '1,220p' /Users/ming/Downloads/qiantie/backend/internal/shuihuo/domain/types.go
```

Expected mapping: `screenplay_shots` and `storyboards` map mostly to Shuihuo segments/storyboards/media/tasks; `dubbing_shots` and voice tables map to audio task and subtitle/audio fields; `prompts` maps to system preset/prompt candidate workflow rather than direct copying.

- [ ] **Step 2: Fill the Luoshui gap table**

Write concrete rows for:

```markdown
| 负面词/negative_prompt | screenplay_shots.negative_prompt, storyboards.negative_prompt | Check current Shuihuo segment/domain prompt fields | Missing or present | P1 |
| 配音行字段 | dubbing_shots emotion/speed/voice_id/audio_path | Audio task input and media audio | Missing or partial | P1 |
| 多候选图片集合 | image_collection/keyframe_path | Media records and primary media | Present or partial | P1 |
| 导出入口 | output_path/video_path/audio_path | Backend ZIP export and disabled UI | Backend-only or disabled | P0 |
| 提示词社区元数据 | prompts likes/stars/is_shared | System preset/admin prompt store | Out of first stage | P3 |
```

Expected: each row states whether Shuihuo should implement, defer, or intentionally skip the capability.

- [ ] **Step 3: Write the minimum route to a usable tool**

Write `## 11. 最小可用工具补齐路线` as ordered P0/P1/P2 actions:

```markdown
P0:
- Open the user-visible export button only when confirmed storyboards exist; call the existing export API and download the ZIP.
- Surface backend health details near task controls: database, Redis, storage, enabled model kinds.
- Make disabled controls say exactly which dependency is missing.

P1:
- Add negative prompt fields to the editable storyboard UI if backend/domain lacks them.
- Expose per-row audio settings and generated audio media consistently.
- Confirm worker startup and polling are visible in operations docs.

P2:
- Add Luoshui-style prompt asset review/import as an editable local preset workflow.
- Keep community/social metadata out of the first usable production tool.
```

Expected: route is implementation-ready and does not promise third-party private integrations.

### Task 4: Verify And Commit The Audit Report

**Files:**
- Verify: `/Users/ming/Downloads/qiantie/docs/superpowers/audits/2026-08-17-shuihuo-luoshui-usable-tool-audit.md`

- [ ] **Step 1: Scan for unsupported claims**

Run:

```bash
rg -n "已验证|真实可用|必然|一定|TBD|TODO|待定|未确定|应该是|可能是" \
  /Users/ming/Downloads/qiantie/docs/superpowers/audits/2026-08-17-shuihuo-luoshui-usable-tool-audit.md
```

Expected: no unsupported certainty. Any `可能` language must point to environment dependence or absent runtime verification.

- [ ] **Step 2: Confirm report references exist**

Run:

```bash
rg -n "frontend/src|routes/shuihuo-production|backend/internal|docs/reverse/luoshui2026" \
  /Users/ming/Downloads/qiantie/docs/superpowers/audits/2026-08-17-shuihuo-luoshui-usable-tool-audit.md
```

Expected: report includes file evidence from frontend, Node gateway, Go backend, and Luoshui extraction.

- [ ] **Step 3: Commit only the audit report**

Run:

```bash
git status --short /Users/ming/Downloads/qiantie/docs/superpowers/audits/2026-08-17-shuihuo-luoshui-usable-tool-audit.md
git add /Users/ming/Downloads/qiantie/docs/superpowers/audits/2026-08-17-shuihuo-luoshui-usable-tool-audit.md
git diff --cached --name-only
git commit -m "docs: audit shuihuo luoshui usable tool"
```

Expected: the cached diff contains only `docs/superpowers/audits/2026-08-17-shuihuo-luoshui-usable-tool-audit.md`; commit succeeds without including unrelated existing worktree changes.

---

## Self-Review

- Spec coverage: The plan covers evidence boundaries, current Shuihuo feature classification, Luoshui field mapping, the minimum usable-tool route, verification, and a report commit.
- Placeholder scan: No TBD/TODO/fill-in placeholders are present; every task has exact files and commands.
- Type consistency: Report path and category names match the approved design document.
