# Shuihuo Segmentation Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a novel source is saved, require the user to choose automatic paragraph segmentation or smart segmentation driven by an administrator-managed system preset.

**Architecture:** The Node gateway resolves the published `shuihuo-smart-segmentation` preset on the server and overwrites any browser-provided system prompt before forwarding a smart request to Go. Go treats that input as trusted bridge data, creates editable candidates, and never includes the rendered prompt in its response. Automatic segmentation runs entirely in Go by splitting non-empty paragraphs, so it has no model dependency.

**Tech Stack:** Express, React, Ant Design, Go, MySQL-backed Shuihuo service, Node test runner, Go test.

---

### Task 1: Define server-owned segmentation contracts

**Files:**
- Modify: `backend/internal/shuihuo/segmentation/service.go`
- Modify: `backend/internal/shuihuo/segmentation/service_test.go`
- Modify: `backend/internal/httpapi/router.go`
- Modify: `backend/internal/httpapi/shuihuo_segmentation_handlers.go`

- [ ] **Step 1: Write a failing paragraph-segmentation unit test**

```go
func TestParagraphSegmentsKeepsEachNonEmptyParagraph(t *testing.T) {
  got := ParagraphSegments("第一段第一句\n第一段第二句\n\n第二段")
  if len(got) != 2 || got[0].Text != "第一段第一句\n第一段第二句" || got[1].Text != "第二段" {
    t.Fatalf("segments=%#v", got)
  }
}
```

- [ ] **Step 2: Run the focused test and observe failure**

Run: `go test ./backend/internal/shuihuo/segmentation -run TestParagraphSegmentsKeepsEachNonEmptyParagraph -count=1`

Expected: FAIL because `ParagraphSegments` is undefined.

- [ ] **Step 3: Implement paragraph candidates and the HTTP endpoint**

```go
func ParagraphSegments(text string) []CandidateSegment {
  paragraphs := strings.FieldsFunc(strings.ReplaceAll(text, "\r\n", "\n"), func(r rune) bool { return r == '\n' })
  // Preserve multi-line paragraph boundaries by buffering non-empty lines.
}
```

Add `POST /projects/{id}/segmentation/paragraphs`, which reads the project source when `text` is empty and returns `{ status: "candidate", candidates }`. It must not inspect models or call text completion.

- [ ] **Step 4: Re-run the focused Go test**

Run: `go test ./backend/internal/shuihuo/segmentation -run TestParagraphSegmentsKeepsEachNonEmptyParagraph -count=1`

Expected: PASS.

### Task 2: Use the administrator preset only inside the trusted bridge

**Files:**
- Modify: `lib/system-preset-catalog.js`
- Modify: `frontend/src/admin/pages/PresetLibraryPage.jsx`
- Modify: `app.js`
- Modify: `routes/shuihuo-production.js`
- Modify: `tests/shuihuo-gateway.test.js`
- Modify: `backend/internal/httpapi/shuihuo_segmentation_handlers.go`

- [ ] **Step 1: Write a failing gateway test for smart segmentation**

```js
test('smart segmentation gateway overwrites browser prompt data with the published system preset', async t => {
  // The Go stub receives systemPromptId and a non-empty server prompt,
  // while a client supplied systemPrompt is absent.
});
```

- [ ] **Step 2: Run the focused Node test and observe failure**

Run: `node --test tests/shuihuo-gateway.test.js`

Expected: FAIL because the gateway forwards the browser body unchanged.

- [ ] **Step 3: Seed and expose the Shuihuo administrator module**

Add published base preset `shuihuo-smart-segmentation` under the `shuihuo-production` module with JSON-only segmentation output rules. Add `水货生产` to the administrator preset-module switcher. Pass the preset store into `createShuihuoProductionRouter`.

- [ ] **Step 4: Resolve the preset in the gateway and render it privately in Go**

For only `POST /api/shuihuo-production/projects/:id/segmentation/smart`, resolve the published preset in Node and replace `systemPrompt`, `systemPromptId`, and `systemPromptVersion` in the forwarded JSON body. Go must use those trusted fields to render `{{novel_text}}`, save the snapshot, and return only public snapshot metadata. Other analysis endpoints retain their existing prompt-definition behavior.

- [ ] **Step 5: Re-run the gateway test**

Run: `node --test tests/shuihuo-gateway.test.js`

Expected: PASS with no system prompt in the browser response.

### Task 3: Add the post-upload segmentation dialog

**Files:**
- Create: `frontend/src/user/pages/shuihuo/SegmentationModeModal.jsx`
- Modify: `frontend/src/shared/api/shuihuoProduction.js`
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Modify: `tests/shuihuo-production-ui-contract.test.js`

- [ ] **Step 1: Write a failing UI contract test**

```js
test('newly imported source opens a segmentation choice before the workbench', () => {
  assert.match(page, /SegmentationModeModal/);
  assert.match(page, /setSegmentationProject/);
  assert.match(modal, /智能识别/);
  assert.match(modal, /自动识别/);
  assert.match(api, /paragraphSegmentation/);
});
```

- [ ] **Step 2: Run the focused test and observe failure**

Run: `node --test tests/shuihuo-production-ui-contract.test.js`

Expected: FAIL because the post-upload dialog and paragraph endpoint client are absent.

- [ ] **Step 3: Implement modal state and candidate confirmation**

The source creation/import callbacks store the newly created project as pending and open the modal instead of opening the workbench. The modal offers exactly two modes:

```jsx
{ value: 'smart', label: '智能识别' }
{ value: 'paragraph', label: '自动识别' }
```

`智能识别` lists only enabled text models and blocks preview without a selection. `自动识别` has no model selector. Both show editable candidates and call `confirmSegmentation` only after the user clicks confirmation. Cancel returns to the project library with the saved source intact.

- [ ] **Step 4: Re-run the focused UI contract test**

Run: `node --test tests/shuihuo-production-ui-contract.test.js`

Expected: PASS.

### Task 4: Verify the integrated result

**Files:**
- Verify: `tests/shuihuo-gateway.test.js`
- Verify: `tests/shuihuo-production-ui-contract.test.js`
- Verify: `tests/shuihuo-reference-alignment-contract.test.js`

- [ ] **Step 1: Run targeted JavaScript contracts**

Run: `node --test tests/shuihuo-gateway.test.js tests/shuihuo-production-ui-contract.test.js tests/shuihuo-reference-alignment-contract.test.js`

Expected: all tests pass.

- [ ] **Step 2: Run Go tests and build the React bundle**

Run: `go test ./backend/internal/shuihuo/segmentation ./backend/internal/httpapi && npm --prefix frontend run build`

Expected: both Go packages pass and Vite writes a production bundle.

- [ ] **Step 3: Browser-check the dialog without submitting a project**

Open `/shuihuo-production`, open `新建漫剧`, and verify the source composer remains usable. Do not submit a test project into the user library. Verify the dialog source, button labels, and disabled smart mode reason with a DOM snapshot.
