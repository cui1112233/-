# Commentary Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Upgrade the shuihuo-production route into an independent commentary-video workbench that imports or accepts pasted source text, produces reversible storyboards, manages presets and real media tasks, and exports confirmed project assets.

**Architecture:** Keep the Go project, model, task, media and storage backend. Add source-unit and storyboard mapping tables as the durable source of truth for merge and split, then expose narrow authenticated APIs. Replace the React editor shell with a full-width production table; every media action submits a server task and renders real status.

**Tech Stack:** Go, MySQL, Redis, object storage adapters, React 18, Vite, Ant Design, lucide-react, Go test, Node test.

---

## Planned file boundaries

- backend/internal/storage/migrations.go: source-unit, mapping, asset-media and task-target migrations with legacy backfill.
- backend/internal/shuihuo/domain/types.go: SourceUnit, StoryboardSourceMapping and AssetID structures.
- backend/internal/shuihuo/store/source_units.go: owned source-unit persistence, merge, split and insert.
- backend/internal/shuihuo/documents/importer.go: TXT, SRT and DOCX parsing.
- backend/internal/httpapi/shuihuo_storyboard_handlers.go: merge, split, insert and source replacement endpoints.
- backend/internal/shuihuo/export/service.go: ZIP manifest, SRT and completed-media export.
- frontend/src/shared/api/shuihuoProduction.js: workbench HTTP boundary.
- frontend/src/user/pages/shuihuo/ImportSourceModal.jsx: unified paste/file creation.
- frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx: toolbar, table state and drawers.
- frontend/src/user/pages/shuihuo/StoryboardRow.jsx: one production row.
- frontend/src/user/pages/shuihuo/PresetWorkbenchModal.jsx: preset and asset-image workflow.
- frontend/src/user/pages/shuihuo-production.css: full-width table and responsive rules.
- tests/shuihuo-commentary-workbench-contract.test.js: frontend integration contracts.

## Task 1: Add non-destructive source-unit persistence

**Files:**
- Modify: backend/internal/storage/migrations.go
- Modify: backend/internal/shuihuo/domain/types.go
- Create: backend/internal/shuihuo/store/source_units.go
- Create: backend/internal/shuihuo/store/source_units_test.go
- Modify: backend/internal/shuihuo/store/segments.go
- Modify: backend/internal/httpapi/shuihuo_handlers.go
- Modify: backend/internal/httpapi/shuihuo_handlers_test.go

- [ ] **Step 1: Write failing store tests for merge, split and ownership.**

    func TestMergeAndSplitKeepsSourceUnitOrder(t *testing.T) {
        first, second := seedMappedSegments(t, db, ownerID, projectID,
            []string{"第一句"}, []string{"第二句"})
        repo := NewSourceUnits(db)
        if _, err := repo.MergeIntoPrevious(ctx, ownerID, second.ID); err != nil {
            t.Fatal(err)
        }
        mappings, _ := repo.ListMappingsByProject(ctx, ownerID, projectID)
        if !slices.Equal(mappings[first.ID], []int64{1, 2}) {
            t.Fatalf("mappings = %v", mappings)
        }
        restored, err := repo.Split(ctx, ownerID, first.ID)
        if err != nil || !slices.Equal(segmentTexts(restored), []string{"第一句", "第二句"}) {
            t.Fatalf("restored = %v, %v", restored, err)
        }
    }

- [ ] **Step 2: Run the test before implementation.**

    cd /Users/ming/Downloads/qiantie/backend
    go test ./internal/shuihuo/store -run TestMergeAndSplitKeepsSourceUnitOrder -count=1

Expected: FAIL because NewSourceUnits is not defined.

- [ ] **Step 3: Add migration version 12 and domain contracts.**

Create shuihuo_source_units with id, project_id, text, source_kind, source_order and created_at. Create shuihuo_segment_source_units with segment_id, source_unit_id and position_index. Add project/segment foreign keys and unique order indexes.

    type SourceUnit struct {
        ID          int64
        ProjectID   int64
        Text        string
        SourceKind  string
        SourceOrder int
        CreatedAt   time.Time
    }

    type StoryboardSourceMapping struct {
        SegmentID     int64
        SourceUnitID  int64
        PositionIndex int
    }

The migration apply function backfills each legacy segment with one source_kind legacy_segment unit only when it lacks a mapping. This preserves current project content during upgrade.

- [ ] **Step 4: Implement transactional mapping operations.**

ReplaceConfirmed creates one source unit per approved candidate, one segment per unit, and one-to-one mappings. MergeIntoPrevious verifies the selected segment has an owned immediate predecessor, moves its mappings after the predecessor mappings, deletes only the selected segment, and safely renumbers rows. Split keeps the first mapping on the existing segment, creates one row per later unit, and renumbers.

    func (s *SourceUnits) MergeIntoPrevious(ctx context.Context, ownerID, segmentID int64) error {
        tx, err := s.db.BeginTx(ctx, nil)
        if err != nil { return err }
        defer tx.Rollback()
        previous, current, err := s.ownedAdjacent(ctx, tx, ownerID, segmentID)
        if err != nil { return err }
        if err := s.appendMappings(ctx, tx, previous.ID, current.ID); err != nil { return err }
        if _, err := tx.ExecContext(ctx, "DELETE FROM shuihuo_segments WHERE id = ?", current.ID); err != nil { return err }
        if err := s.renumber(ctx, tx, previous.ProjectID); err != nil { return err }
        return tx.Commit()
    }

Display sourceText is derived from mapped unit text joined by a newline. It is not an irreversible merge record.

- [ ] **Step 5: Extend the project read model.**

Return sourceUnits and segmentSourceUnitIDs with existing project, segments, assets, media and tasks. Fetch mappings per project, not once per segment.

- [ ] **Step 6: Run focused tests and commit.**

    cd /Users/ming/Downloads/qiantie/backend
    go test ./internal/shuihuo/store ./internal/httpapi ./internal/storage -count=1
    git add internal/storage/migrations.go internal/shuihuo/domain/types.go internal/shuihuo/store/source_units.go internal/shuihuo/store/source_units_test.go internal/shuihuo/store/segments.go internal/httpapi/shuihuo_handlers.go internal/httpapi/shuihuo_handlers_test.go
    git commit -m "feat: add reversible storyboard source mappings"

Expected: PASS for successful operations, first-row merge rejection, single-unit split rejection, cross-account rejection and legacy backfill.

## Task 2: Import pasted text and TXT/SRT/DOCX documents

**Files:**
- Create: backend/internal/shuihuo/documents/importer.go
- Create: backend/internal/shuihuo/documents/importer_test.go
- Modify: backend/internal/httpapi/router.go
- Modify: backend/internal/httpapi/shuihuo_handlers.go
- Modify: backend/internal/shuihuo/store/projects.go
- Modify: backend/internal/httpapi/shuihuo_handlers_test.go

- [ ] **Step 1: Write failing parser tests.**

    func TestParseUploadSupportsTXTAndSRT(t *testing.T) {
        text, kind, err := documents.ParseUpload("a.srt", "application/x-subrip",
            []byte("1
00:00:00,000 --> 00:00:02,000
你好
"))
        if err != nil || kind != "srt" || text != "你好" {
            t.Fatalf("%q %q %v", text, kind, err)
        }
    }

    func TestParseUploadRejectsPDF(t *testing.T) {
        _, _, err := documents.ParseUpload("a.pdf", "application/pdf", []byte("%PDF"))
        if !errors.Is(err, documents.ErrUnsupportedDocument) { t.Fatal(err) }
    }

- [ ] **Step 2: Run the tests before implementation.**

    cd /Users/ming/Downloads/qiantie/backend
    go test ./internal/shuihuo/documents -count=1

Expected: FAIL because package documents is absent.

- [ ] **Step 3: Implement a standard-library-only parser.**

TXT removes UTF-8 BOM. SRT keeps cue text. DOCX opens word/document.xml with archive/zip and collects XML text nodes in paragraph order. Reject PDF, unsafe filename, missing input, NUL bytes, wrong MIME and files over 5 MiB.

    const MaxDocumentBytes = 5 << 20

    func ParseUpload(filename, contentType string, body []byte) (string, string, error) {
        if len(body) == 0 || len(body) > MaxDocumentBytes {
            return "", "", ErrInvalidDocument
        }
        switch strings.ToLower(path.Ext(filename)) {
        case ".txt":
            return normalizeText(stripBOM(body)), "txt", nil
        case ".srt":
            return normalizeText(parseSRT(string(body))), "srt", nil
        case ".docx":
            return parseDOCX(body)
        default:
            return "", "", ErrUnsupportedDocument
        }
    }

- [ ] **Step 4: Add source creation and replacement APIs.**

Add POST /api/shuihuo-production/projects/import for name, filename and dataUrl. Parse before persistence, store original bytes through the existing object store, create project source text/object key, and clean up all partial storage/database state if any later operation fails.

Add PUT /api/shuihuo-production/projects/{id}/source for pasted source replacement. It rejects empty text and returns 409 when queued/running tasks exist. Both paths remove previous segments and mappings transactionally and return the fresh project read model.

- [ ] **Step 5: Add handler tests, run and commit.**

    cd /Users/ming/Downloads/qiantie/backend
    go test ./internal/shuihuo/documents ./internal/httpapi -run "Test(ParseUpload|ImportShuihuo|ReplaceShuihuo)" -count=1
    git add internal/shuihuo/documents internal/httpapi/router.go internal/httpapi/shuihuo_handlers.go internal/shuihuo/store/projects.go internal/httpapi/shuihuo_handlers_test.go
    git commit -m "feat: import commentary source documents"

Expected: TXT, SRT and DOCX work; PDF and oversized input return readable errors; rejected uploads leave no accessible empty project.

## Task 3: Add merge, split and insert HTTP APIs

**Files:**
- Modify: backend/internal/httpapi/router.go
- Create: backend/internal/httpapi/shuihuo_storyboard_handlers.go
- Modify: backend/internal/httpapi/shuihuo_handlers_test.go
- Modify: backend/internal/shuihuo/store/source_units.go

- [ ] **Step 1: Write the failing HTTP contract.**

    func TestMergeStoryboardReturnsUpdatedReadModel(t *testing.T) {
        response := requestAs(t, owner, http.MethodPost,
            "/api/shuihuo-production/segments/22/merge-up", nil)
        requireStatus(t, response, http.StatusOK)
        requireJSONContains(t, response, "segmentSourceUnitIDs")
    }

- [ ] **Step 2: Run it before routes exist.**

    cd /Users/ming/Downloads/qiantie/backend
    go test ./internal/httpapi -run TestMergeStoryboardReturnsUpdatedReadModel -count=1

Expected: FAIL with 404.

- [ ] **Step 3: Add routes and handlers.**

    r.Post("/shuihuo-production/segments/{segmentId}/merge-up", api.handleMergeShuihuoStoryboard)
    r.Post("/shuihuo-production/segments/{segmentId}/split", api.handleSplitShuihuoStoryboard)
    r.Post("/shuihuo-production/segments/{segmentId}/insert-after", api.handleInsertShuihuoStoryboard)

Insert accepts sourceText and subtitleText, creates one manual source unit and blank unlocked prompts. Merge returns 409 with 第一条分镜不能向上合并 when no predecessor exists. Split returns 409 when only one mapping exists. Every success response uses the full project read model.

- [ ] **Step 4: Guard live task inputs and run tests.**

Before merge, split, insert, delete or source replacement, query for queued/running tasks on the project. Return 409 with 存在进行中的生成任务，请先取消或等待完成. Completed media stays attached until explicit deletion.

    cd /Users/ming/Downloads/qiantie/backend
    go test ./internal/httpapi ./internal/shuihuo/store -run "Test(Merge|Split|Insert|SourceUnits)" -count=1
    git add internal/httpapi/router.go internal/httpapi/shuihuo_storyboard_handlers.go internal/httpapi/shuihuo_handlers_test.go internal/shuihuo/store/source_units.go
    git commit -m "feat: edit commentary storyboards safely"

Expected: PASS for success, active-task conflict and account isolation.

## Task 4: Add asset image candidates, audio readiness and ZIP export

**Files:**
- Modify: backend/internal/storage/migrations.go
- Modify: backend/internal/shuihuo/domain/types.go
- Modify: backend/internal/shuihuo/store/media.go
- Modify: backend/internal/shuihuo/store/tasks.go
- Modify: backend/internal/httpapi/shuihuo_task_handlers.go
- Modify: backend/internal/httpapi/shuihuo_production_handlers.go
- Modify: backend/internal/httpapi/shuihuo_health_handlers.go
- Modify: backend/internal/shuihuo/tasks/worker.go
- Create: backend/internal/shuihuo/export/service.go
- Create: backend/internal/shuihuo/export/service_test.go
- Modify: backend/internal/httpapi/router.go
- Create: backend/internal/httpapi/shuihuo_export_handlers.go

- [ ] **Step 1: Write failing asset-task and export tests.**

    func TestAssetImageOutputDoesNotUseSegmentID(t *testing.T) {
        media := finishAssetImageTask(t, db, taskID)
        if media.AssetID == nil || media.SegmentID != nil {
            t.Fatalf("%#v", media)
        }
    }

    func TestExportIncludesManifestAndSRT(t *testing.T) {
        body, err := service.BuildZIP(ctx, project, segments, media)
        if err != nil { t.Fatal(err) }
        if !slices.Contains(zipEntryNames(t, body), "manifest.json") {
            t.Fatal("manifest missing")
        }
    }

- [ ] **Step 2: Run before implementation.**

    cd /Users/ming/Downloads/qiantie/backend
    go test ./internal/httpapi ./internal/shuihuo/tasks ./internal/shuihuo/export -run "Test(AssetImage|Export)" -count=1

Expected: FAIL because AssetID and exporter do not exist.

- [ ] **Step 3: Add migration version 13 and asset task target.**

Add nullable asset_id columns and indexes to shuihuo_tasks and shuihuo_media. Add AssetID pointer fields to Task and Media, and update every store select, scan and insert. Enforce exactly one target in task service code.

    func validateTaskTarget(segmentID, assetID *int64) error {
        if (segmentID == nil) == (assetID == nil) {
            return errors.New("task must target exactly one segment or asset")
        }
        return nil
    }

- [ ] **Step 4: Implement real asset-image generation.**

Add POST /assets/{assetId}/image-tasks with modelId, aspectRatio, styleReferenceMediaIds and threeView. Validate owned asset/reference media and enabled image model. Worker persists results with asset_id present and segment_id absent, keeping candidates and automatically selecting only the first image when no primary candidate exists.

Add audio to requiredShuihuoModelKinds so health reports 配音模型未配置. Keep user model response based only on models.ToPublic. Do not return endpoint, credential reference, request template, response mapping or raw task input.

- [ ] **Step 5: Implement owned ZIP export.**

Create manifest.json with project, source mappings, text, asset IDs, prompts, task statuses and media metadata. Create subtitles.srt from actual audio durations; use three-second estimates only when durations are unavailable and mark timingSource estimated. Add GET /projects/{id}/export, returning 409 for no confirmed segments and 503 for unavailable storage.

- [ ] **Step 6: Run and commit.**

    cd /Users/ming/Downloads/qiantie/backend
    go test ./internal/httpapi ./internal/shuihuo/tasks ./internal/shuihuo/export ./internal/shuihuo/store -count=1
    git add internal/storage/migrations.go internal/shuihuo/domain/types.go internal/shuihuo/store/media.go internal/shuihuo/store/tasks.go internal/httpapi/shuihuo_task_handlers.go internal/httpapi/shuihuo_production_handlers.go internal/httpapi/shuihuo_health_handlers.go internal/httpapi/router.go internal/httpapi/shuihuo_export_handlers.go internal/shuihuo/tasks/worker.go internal/shuihuo/export
    git commit -m "feat: generate asset candidates and export projects"

Expected: asset candidate images never appear as unrelated segment media, and ZIP export is account scoped.

## Task 5: Replace the editor shell and add the unified import modal

**Files:**
- Modify: frontend/src/shared/api/shuihuoProduction.js
- Create: frontend/src/user/pages/shuihuo/ImportSourceModal.jsx
- Create: frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx
- Modify: frontend/src/user/pages/ShuihuoProductionPage.jsx
- Modify: frontend/src/user/pages/shuihuo/ProjectsView.jsx
- Modify: frontend/src/user/pages/shuihuo-production.css
- Create: tests/shuihuo-commentary-workbench-contract.test.js

- [ ] **Step 1: Write the failing frontend contract.**

    test("workbench uses import API and removes editor sidebar", () => {
      const api = read("frontend/src/shared/api/shuihuoProduction.js");
      const page = read("frontend/src/user/pages/ShuihuoProductionPage.jsx");
      expect(api).toContain("export function importProjectDocument");
      expect(api).toContain("export function replaceProjectSource");
      expect(page).toContain("<CommentaryWorkbench");
      expect(page).not.toContain("shuihuo-sidebar");
    });

- [ ] **Step 2: Run the contract before implementation.**

    cd /Users/ming/Downloads/qiantie
    node --test tests/shuihuo-commentary-workbench-contract.test.js

Expected: FAIL because the workbench files/functions are absent.

- [ ] **Step 3: Add client APIs and import experience.**

    export function importProjectDocument(payload) {
      return apiRequest(base + "/projects/import", { method: "POST", body: JSON.stringify(payload) });
    }
    export function replaceProjectSource(projectId, sourceText) {
      return apiRequest(base + "/projects/" + projectId + "/source", { method: "PUT", body: JSON.stringify({ sourceText }) });
    }
    export function mergeStoryboard(segmentId) {
      return apiRequest(base + "/segments/" + segmentId + "/merge-up", { method: "POST" });
    }
    export function splitStoryboard(segmentId) {
      return apiRequest(base + "/segments/" + segmentId + "/split", { method: "POST" });
    }

ImportSourceModal has exactly 粘贴内容 and 上传文档 modes. Paste requires name and source text. Upload accepts only txt/srt/docx below 5 MiB, uses FileReader for a data URL and sends it only to importProjectDocument. Browser DOCX parsing is intentionally not added.

- [ ] **Step 4: Replace page navigation.**

Keep project library. When a project opens, render CommentaryWorkbench only. Remove StudioView, AssetsView, old view state and all persistent editor sidebar markup. Keep request race guards, health status and CM context dispatch.

- [ ] **Step 5: Run build and commit.**

    cd /Users/ming/Downloads/qiantie
    node --test tests/shuihuo-commentary-workbench-contract.test.js
    npm --prefix frontend run build
    git add frontend/src/shared/api/shuihuoProduction.js frontend/src/user/pages/ShuihuoProductionPage.jsx frontend/src/user/pages/shuihuo/ImportSourceModal.jsx frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx frontend/src/user/pages/shuihuo/ProjectsView.jsx frontend/src/user/pages/shuihuo-production.css tests/shuihuo-commentary-workbench-contract.test.js
    git commit -m "feat: add full-width commentary workbench shell"

Expected: PASS and open projects have no project sidebar.

## Task 6: Build the full-width storyboard production table

**Files:**
- Create: frontend/src/user/pages/shuihuo/StoryboardRow.jsx
- Modify: frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx
- Modify: frontend/src/user/pages/shuihuo/SegmentEditorModal.jsx
- Modify: frontend/src/user/pages/shuihuo/SegmentAssetsModal.jsx
- Modify: frontend/src/user/pages/shuihuo-production.css
- Modify: tests/shuihuo-commentary-workbench-contract.test.js

- [ ] **Step 1: Write failing row contract coverage.**

    test("storyboard row has confirmed columns and safe actions", () => {
      const row = read("frontend/src/user/pages/shuihuo/StoryboardRow.jsx");
      for (const label of ["序号", "字幕", "配音", "预设", "提示词", "片段库", "操作"]) {
        expect(row).toContain(label);
      }
      expect(row).toContain("mergeStoryboard");
      expect(row).toContain("splitStoryboard");
      expect(row).toContain("Popconfirm");
    });

- [ ] **Step 2: Run it before implementation.**

    cd /Users/ming/Downloads/qiantie
    node --test tests/shuihuo-commentary-workbench-contract.test.js

Expected: FAIL because StoryboardRow is absent.

- [ ] **Step 3: Implement semantic table and stable row controls.**

Use table, thead and tbody with exactly seven columns: 序号, 字幕, 配音, 预设, 提示词, 片段库, 操作. Order cell has lucide Merge and SplitSquareVertical icon buttons with tooltips. Subtitle and prompts save explicitly through updateSegment. Presets open binding modal. Clip cell renders primary image, up to four candidates, audio and video. Operations use tooltip icon buttons for image, video, add-after and delete. Delete uses Popconfirm and does not erase media.

- [ ] **Step 4: Wire mutations and layout.**

Use busySegmentId plus try/finally. Refresh only from server responses; do not optimistically remove/insert rows. Header/tool bar are sticky; table min-width is 1280px; mobile scrolls horizontally; text uses overflow-wrap anywhere; all icon buttons have aria-label values.

- [ ] **Step 5: Run build and commit.**

    cd /Users/ming/Downloads/qiantie
    node --test tests/shuihuo-commentary-workbench-contract.test.js
    npm --prefix frontend run build
    git add frontend/src/user/pages/shuihuo/StoryboardRow.jsx frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx frontend/src/user/pages/shuihuo/SegmentEditorModal.jsx frontend/src/user/pages/shuihuo/SegmentAssetsModal.jsx frontend/src/user/pages/shuihuo-production.css tests/shuihuo-commentary-workbench-contract.test.js
    git commit -m "feat: add commentary storyboard production table"

## Task 7: Integrate presets, real task controls, logs and export UI

**Files:**
- Create: frontend/src/user/pages/shuihuo/PresetWorkbenchModal.jsx
- Modify: frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx
- Modify: frontend/src/user/pages/shuihuo/TaskDrawer.jsx
- Modify: frontend/src/user/pages/shuihuo/BatchTaskModal.jsx
- Modify: frontend/src/shared/api/shuihuoProduction.js
- Modify: frontend/src/user/pages/shuihuo-production.css
- Modify: docs/shuihuo-production-operations.md
- Modify: tests/shuihuo-commentary-workbench-contract.test.js

- [ ] **Step 1: Write failing preset and task contracts.**

    test("preset workflow and row generation use real APIs", () => {
      const preset = read("frontend/src/user/pages/shuihuo/PresetWorkbenchModal.jsx");
      const workbench = read("frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx");
      for (const label of ["AI角色", "AI场景", "AI道具", "AI音色", "角色库", "场景库", "音色库"]) {
        expect(preset).toContain(label);
      }
      expect(workbench).toContain("createTask");
      expect(workbench).toContain("createBatchTasks");
      expect(workbench).toContain("exportProject(project.id)");
    });

- [ ] **Step 2: Run them before implementation.**

    cd /Users/ming/Downloads/qiantie
    node --test tests/shuihuo-commentary-workbench-contract.test.js

Expected: FAIL because preset modal and toolbar actions are absent.

- [ ] **Step 3: Implement the two-stage preset workflow.**

AI角色, AI场景, AI道具 and AI音色 call text analysis and show editable candidates. Save calls createAsset. Per asset configuration uses image model, aspect ratio, style reference media IDs and optional three-view, then calls createAssetImageTask. Candidate image selection uses media.assetId and setPrimaryMedia. No image is generated in browser.

- [ ] **Step 4: Implement real row/batch task controls.**

Image, video and audio use createTask with kinds image, video and audio. If compatible model missing, show health/model reason and do not select another model automatically. BatchTaskModal has 图片, 视频, 配音 and disabled 翻译任务尚未接入模型适配器. Batch ranges are 全部, 未完成 and 指定范围. Unfinished is based on missing primary output rather than old task records.

- [ ] **Step 5: Protect task logs and add browser download.**

TaskDrawer polls every five seconds only when open and queued/running tasks exist. Stop on close/unmount. Show status, provider, error, cancel and retry; never raw task input, endpoint, credential reference or templates.

Export button calls exportProject, downloads project name plus 漫剧解说.zip from one object URL, then revokes it after 60 seconds. It disables only for no confirmed segments or active download.

- [ ] **Step 6: Document, test and commit.**

Document MySQL migrations, Redis worker, object storage, enabled text/image/video/audio models, 503 missing dependency, 409 live-task conflict, and 502/504 upstream failure. State PDF unsupported.

    cd /Users/ming/Downloads/qiantie/backend
    go test ./internal/httpapi ./internal/shuihuo/... ./internal/storage -count=1
    cd /Users/ming/Downloads/qiantie
    node --test tests/shuihuo-production-ui-contract.test.js tests/shuihuo-model-catalog-contract.test.js tests/shuihuo-commentary-workbench-contract.test.js
    npm --prefix frontend run build
    git diff --check
    git add frontend/src/user/pages/shuihuo/PresetWorkbenchModal.jsx frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx frontend/src/user/pages/shuihuo/TaskDrawer.jsx frontend/src/user/pages/shuihuo/BatchTaskModal.jsx frontend/src/shared/api/shuihuoProduction.js frontend/src/user/pages/shuihuo-production.css docs/shuihuo-production-operations.md tests/shuihuo-commentary-workbench-contract.test.js
    git commit -m "feat: connect commentary presets tasks and export"

## Task 8: Browser and configured-service verification

**Files:**
- Modify: docs/shuihuo-production-operations.md

- [ ] **Step 1: Check server and health.**

    lsof -nP -iTCP:3000 -sTCP:LISTEN
    curl -i http://127.0.0.1:3000/shuihuo-production
    curl -i http://127.0.0.1:3000/api/shuihuo-production/health

Expected: page returns 200. Health may return 503 only when it names the missing dependency.

- [ ] **Step 2: Browser-check without paid generation.**

1. Project library has no persistent editor sidebar.
2. Pasted project plus TXT, SRT and DOCX import create readable source units.
3. Reload preserves source units, merge/split, add-after and binding state.
4. Seven columns are legible on desktop and intentionally scroll on mobile.
5. Missing models explain why; task UI exposes no secrets.
6. Existing local media exports a ZIP.

- [ ] **Step 3: Verify one configured real generation chain.**

Only after a disposable project has enabled text/image/video/audio models plus Redis worker/storage, submit one text segmentation, asset image, row image, video and audio task. Verify every task reaches succeeded or an actual error state. Record which evidence is real-service evidence; queued status alone is not success.

- [ ] **Step 4: Commit only final operations notes.**

    git add docs/shuihuo-production-operations.md
    git commit -m "docs: verify commentary workbench operations"

## Final review checklist

- [ ] Import and paste create the same project source model.
- [ ] Merge and split use source mappings, never irreversible concatenation.
- [ ] Legacy projects are backfilled before editor use.
- [ ] Active tasks block source-changing mutations.
- [ ] Media buttons create actual server tasks or report precise dependencies.
- [ ] User UI never renders credentialRef, endpoint, requestTemplate, responseMapping or raw task input.
- [ ] Export contains only owned, confirmed and readable assets.
- [ ] Static/build/HTTP/browser evidence is recorded separately from real model-generation evidence.

