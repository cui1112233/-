# Batch Factory V11 Intake and Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在水货生产的个人作品页创建并打开批量工厂作品：复用小说获取的多行书单解析协议，顶部小说列表展示上传元数据，制作区外层一行对应一本小说。

**Architecture:** 以 V11 已有的 `batchfactoryv11` 批次、书、分镜、VIDEO、合并和发布模型作为唯一的批量工厂生产身份，不复制一套新生产链。水货生产保留当前后端和数据库；V11 运行在专用的本地后端与数据库中，避免两套迁移账本相互覆盖。Node 平台保持同一登录态，把水货项目与 V11 批次合并成同一个“个人作品”列表，并用 `水货生产` / `批量工厂` 标记区分；前端沿用水货页面的外壳，创作漫剧保持原实现，批量工厂使用小说获取的输入协议和 V11 批次读模型。

**Tech Stack:** Go、MySQL、Redis 定时队列、React、Ant Design、Vite、Go `httptest`、Node test。

## Global Constraints

- 维护源码是 V88；运行中的水货后端继续保持当前服务，批量工厂 V11 只由当前 V88 提交构建的独立 sidecar 提供。不得用 V11 后端替换水货后端。
- 手动批量只接收书单元数据，不接收粘贴或上传的小说正文；开始生产时才按书城和 bookId 获取原文。
- 新建批量默认只创建一个作品和全部小说；只有开启自动并填写未来时间，才创建 `scheduled_waiting` 记录。
- 小说获取导入保存已选完整版本，不重新抓取原文；之后和手动入口共用 V11 生产、合并和上传链。
- 顶部“小说列表”只展示书名、bookId、书城、男女频、类型、来源；制作区外层一行等于一本小说，书内分镜不成为外层序号。
- 121 只有真实回读确认后才显示已完成；本阶段不得以 HTTP 成功、排队或 task ID 伪造完成。
- 不改动水货生产的创作漫剧入口、已有项目、分镜编辑或现有数据。

---

### Task 1: 保留水货运行时并接入 V11 sidecar

**Files:**
- Create: `deploy/local/docker-compose.batch-factory-v11.preview.yml`
- Modify: `routes/batch-factory-v11.js`
- Test: `test/batch-factory-v11-proxy.test.js`

**Interfaces:**
- Consumes: V88 `backend/`、现有水货 Node 平台、Vite 对 `http://127.0.0.1:13190` 的代理。
- Produces: 13190 仅将 `/api/batch-factory/v11/*` 转发到 V11 sidecar；`/api/shuihuo-production/*` 继续转发到原水货后端。

- [ ] **Step 1: Write a failing V11 proxy-target contract test**

```js
assert.equal(resolveV11GoBaseUrl({ QIANTIE_BATCH_FACTORY_V11_BASE_URL: 'http://batch-factory-v11:4000', QIANTIE_GO_BASE_URL: 'http://backend:4000' }), 'http://batch-factory-v11:4000');
```

- [ ] **Step 2: Run it against the V88 Node source**

Run: `node --test test/batch-factory-v11-proxy.test.js`

Expected: FAIL before the V11-only environment target is implemented.

- [ ] **Step 3: Add an isolated V11 backend and MySQL sidecar**

Add a local override that builds only `batch-factory-v11` from `/Users/ming/Documents/ChatGPT/一战晟铭/backend` plus its own MySQL volume. Keep the existing `backend` and `mysql-shuihuo` services untouched. Set `QIANTIE_BATCH_FACTORY_V11_BASE_URL=http://batch-factory-v11:4000` only on the Node platform.

- [ ] **Step 4: Rebuild only the Node platform and V11 sidecar, then prove route separation**

Verify the V11 capability endpoint through 13190 and confirm a water health request still reaches the original backend. Record the current V88 SHA in the sidecar image label or build metadata.

- [ ] **Step 5: Commit the local runtime source contract**

```bash
git add routes/batch-factory-v11.js test/batch-factory-v11-proxy.test.js deploy/local docs/superpowers/plans
git commit -m "chore: isolate batch factory V11 local runtime"
```

### Task 2: Add the Novel Fetch-compatible manual intake contract

**Files:**
- Modify: `backend/internal/batchfactoryv11/types.go`
- Create: `backend/internal/batchfactoryv11/manual_intake.go`
- Create: `backend/internal/batchfactoryv11/manual_intake_test.go`
- Modify: `backend/internal/batchfactoryv11/mysql_store.go`
- Modify: `backend/internal/storage/batch_factory_v11_schema.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_slice1.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_slice1_test.go`

**Interfaces:**
- Consumes `ManualIntakeInput{PlatformID, ParseMode, ColumnPresetID, ColumnOrder, InputText, ContentRangeLines, ScheduledAt}`.
- Produces `ManualIntakeResult{Batch, Books, Schedule}` with each book’s `bookId`, `title`, `sourceMetadata`, `sourceLine`, `sourceMode`, and queue status.
- Reuses `batchfactoryv11.Store.CreateBatch` and creates only V11 batch/book records plus durable intake/schedule state.

- [ ] **Step 1: Write parser tests before implementation**

```go
func TestParseManualBookListUsesPresetAndRetainsMetadata(t *testing.T) {
  got, err := ParseManualBookList(ManualIntakeInput{
    PlatformID: "15", ParseMode: "smart", ColumnPresetID: "sample_input",
    InputText: "2080989285751305136\t重生书\t推荐理由\t女频\t重生,爽文\tS",
  })
  if err != nil { t.Fatal(err) }
  if len(got) != 1 || got[0].BookID != "2080989285751305136" || got[0].Title != "重生书" { t.Fatalf("books=%+v", got) }
  if got[0].SourceMetadata["gender"] != "女频" || got[0].SourceMetadata["rating"] != "S" { t.Fatalf("metadata=%#v", got[0].SourceMetadata) }
}
```

- [ ] **Step 2: Run the parser test and verify RED**

Run: `go test ./backend/internal/batchfactoryv11 -run TestParseManualBookListUsesPresetAndRetainsMetadata`

Expected: FAIL because `ManualIntakeInput` and `ParseManualBookList` do not exist.

- [ ] **Step 3: Implement the parser as the shared protocol**

Port the current Novel Fetch rules exactly: split rows by tab, pipe, two-or-more spaces or CSV; support `smart`, `header`, `multi_header`, `fixed_full_11`, `fixed_from_b`, `fixed_paid_basic`, and `custom`; apply the five known column presets; detect aliases; select book ID from explicit/paid/free ID; retain gender, tags, reason, rating and `sourceLine`. Reject an empty input or a row without a usable book ID; deduplicate repeated book IDs within one request without dropping the first source line.

- [ ] **Step 4: Write route and scheduling tests**

```go
func TestManualIntakeCreatesOneBatchAndFutureSchedule(t *testing.T) {
  rec := signedJSONRequest(t, api, now, "alice", http.MethodPost, "/api/batch-factory/v11/intakes/manual", map[string]any{
    "title":"晚间批量", "platformId":"15", "parseMode":"smart", "columnPresetId":"sample_input",
    "inputText":"100000000001\t书A\t理由\t女频\t标签\tS\n100000000002\t书B\t理由\t男频\t标签\tA",
    "contentRangeLines":5, "scheduledAt":"2026-09-14T02:00:00Z",
  })
  if rec.Code != http.StatusCreated { t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String()) }
  if !strings.Contains(rec.Body.String(), `"scheduled_waiting"`) || strings.Count(rec.Body.String(), `"bookId"`) != 2 { t.Fatal(rec.Body.String()) }
}
```

- [ ] **Step 5: Implement durable manual intake and route**

Add `POST /api/batch-factory/v11/intakes/manual`. Save raw protocol fields and parsed metadata in the existing V11 intake payload, then call `CreateBatch` once with all parsed books. Add an additive migration for `content_range_lines`, `source_mode`, `queue_status`, `scheduled_at`, and the one-per-batch schedule record. With no `scheduledAt`, write `manual_pending`; with a future time, write `scheduled_waiting`. Do not call fetch, AI, media, merge or publish adapters here.

- [ ] **Step 6: Verify GREEN and commit**

Run: `go test ./backend/internal/batchfactoryv11 ./backend/internal/httpapi ./backend/internal/storage`

```bash
git add backend/internal/batchfactoryv11 backend/internal/httpapi/batch_factory_v11_slice1.go backend/internal/storage
git commit -m "feat: add batch factory manual novel intake"
```

### Task 3: Connect shared works to V11 batches and 小说列表

**Files:**
- Modify: `backend/internal/batchfactoryv11/types.go`
- Modify: `backend/internal/batchfactoryv11/mysql_store.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_slice1.go`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`
- Modify: `frontend/src/shared/api/shuihuoProduction.js`
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Modify: `frontend/src/user/pages/shuihuo/ProjectsView.jsx`
- Create: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`
- Test: `frontend/src/user/pages/shuihuo/ProjectsView.test.jsx`

**Interfaces:**
- Produces a unified personal-work view carrying immutable `productionMode: 'batch_factory'` and `batchId`.
- `GET /api/batch-factory/v11/batches/{batchId}` returns the metadata needed by the 小说列表 panel.
- `BatchFactoryNovelList({ batch, onClose, onSelectBook })` renders metadata only; `onClose` restores the production workspace.

- [ ] **Step 1: Write failing UI behavior tests**

```jsx
it('opens 新建批量 with Novel Fetch controls and leaves 创作漫剧 unchanged', async () => {
  render(<ProjectsView projects={[]} onCreate={vi.fn()} onCreateBatch={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', {name:'批量工厂'}))
  expect(screen.getByLabelText('输入格式')).toBeInTheDocument()
  expect(screen.getByLabelText('列顺序预设')).toBeInTheDocument()
  expect(screen.queryByLabelText('字幕内容')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm --prefix frontend test -- ProjectsView.test.jsx`

Expected: FAIL because the current dialog has only a simplified custom-column field.

- [ ] **Step 3: Implement unified personal-work projection and read APIs**

Map each V11 batch to a virtual personal-work item in the frontend read model. Fetch water projects and V11 batches with the same logged-in account, merge only in the client display, and retain the immutable `batchId`. Existing water projects keep `shuihuo_production`; no V11 migration or write may alter `shuihuo_projects`. Reject opening a V11 batch owned by another user.

- [ ] **Step 4: Implement the confirmed page interactions**

Keep both entry buttons on the water project page. “创作漫剧” opens only the existing subtitle/file dialog. “批量工厂” opens the latest Novel Fetch-style dialog: platform, input format, preset, custom order, multiline list, automatic toggle, future schedule and content range. On success, open the production workspace and expose its “小说列表” control. That control opens `BatchFactoryNovelList` with book name, bookId, bookstore, gender, type and source; closing it returns to production.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm --prefix frontend test -- ProjectsView.test.jsx && npm --prefix frontend run build`

```bash
git add frontend/src/shared/api frontend/src/user/pages/ShuihuoProductionPage.jsx frontend/src/user/pages/shuihuo
git commit -m "feat: connect batch factory works and novel list"
```

### Task 4: Render the V11 book workspace as one outer row per novel

**Files:**
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Create: `frontend/src/user/pages/shuihuo/BatchFactoryBookRow.jsx`
- Create: `frontend/src/user/pages/shuihuo/BatchFactoryBookRow.test.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`

**Interfaces:**
- Consumes V11 `Batch.Books[]`.
- Produces one `BatchFactoryBookRow` per V11 book, keyed by V11 `book.id`, with outer ordinal from its batch order.
- The row reads content, settings, internal storyboards/VIDEO and status only for its own book.

- [ ] **Step 1: Write the row-identity test**

```jsx
it('renders one outer row per book and never promotes inner videos to outer rows', () => {
  render(<BatchFactoryBookRow ordinal={1} book={{id:'book-a', title:'书A', bookId:'1001', videos:[{id:'v1'}, {id:'v2'}]}} />)
  expect(screen.getByText('1')).toBeInTheDocument()
  expect(screen.getByText('书A')).toBeInTheDocument()
  expect(screen.queryByText('2')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the row test and verify RED**

Run: `npm --prefix frontend test -- BatchFactoryBookRow.test.jsx`

Expected: FAIL because `BatchFactoryBookRow` does not exist.

- [ ] **Step 3: Implement the row from the water production layout**

Copy structural styling and interaction affordances from `CommentaryWorkbench` rather than replacing the page with the legacy V11 free-layout UI. Render an outer ordinal, book title and metadata, content-range working text, per-book preset slots, internal storyboard/VIDEO state, current final merge state and publication status. Keep all actions scoped by `batchId` and `book.id`; do not render one outer card per internal VIDEO.

- [ ] **Step 4: Run frontend tests and visual build**

Run: `npm --prefix frontend test -- BatchFactoryBookRow.test.jsx && npm --prefix frontend run build`

- [ ] **Step 5: Commit the row workspace**

```bash
git add frontend/src/user/pages/shuihuo frontend/src/user/pages/ShuihuoProductionPage.jsx frontend/src/user/pages/shuihuo-production.css
git commit -m "feat: render one batch factory row per novel"
```

### Task 5: Local authenticated acceptance and scheduled-release safety

**Files:**
- Modify: none
- Test: `backend/internal/httpapi/batch_factory_v11_slice1_test.go`

**Interfaces:**
- Consumes local Vite at `5173` and V88-built API at `13190`.
- Produces browser and API evidence for manual and scheduled creation, list display, and unchanged water creation.

- [ ] **Step 1: Verify backend image provenance and migrations**

Confirm the live backend container image labels reference the V88 commit used for this work. Confirm V11 migrations apply repeatedly against the isolated local MySQL without changing formal or public volumes.

- [ ] **Step 2: Verify manual intake**

In an authenticated local session, create one batch with two pasted book rows and automatic disabled. Confirm one shared project card with the 批量工厂 label, two upload-metadata list rows, and two outer production rows. Confirm neither book starts AI, media, merge or publication.

- [ ] **Step 3: Verify scheduled intake**

Create a future scheduled batch. Confirm both books persist as `scheduled_waiting`; cancel before the due time; verify the work and its book metadata remain while only unreleased queue records are cancelled.

- [ ] **Step 4: Verify water regression boundary**

Open 创作漫剧 and create/open an existing water project. Confirm its subtitle/file form, split/merge storyboard actions and existing assets remain unchanged.

- [ ] **Step 5: Record evidence and commit the acceptance note**

```bash
git add docs/superpowers
 git commit -m "test: record batch factory intake acceptance"
```

## Self-review

- Spec coverage: Tasks 2–4 cover the confirmed novel-fetch protocol, two content sources, shared project metadata, 小说列表, one-row-per-book workspace and scope boundaries. Task 5 verifies manual/scheduled behavior and water regression. Existing V11 services retain per-book settings, storyboards, VIDEO, merge and publication contracts.
- Excluded from this slice: live provider fetch execution and real 121 upload are not simulated. They remain disabled until the V11 adapter and actual video management system receipt are verified; the UI may show their true unavailable state but cannot label them complete.
- Type consistency: `ManualIntakeInput` produces V11 `CreateBookInput`; V11 `Batch.Books` feeds `BatchFactoryNovelList` and `BatchFactoryBookRow`; shared project mapping uses V11 `batchId`.
