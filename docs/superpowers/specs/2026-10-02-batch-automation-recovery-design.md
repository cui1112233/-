# Batch Factory Automatic Recovery Design

## Goal

Make a Giant Material batch progress without a browser remaining open: an OCR
result must be persisted, validated, classified, and handed to the saved
automation plan. A failed stage must free the configured book-concurrency slot
after a bounded number of attempts rather than repeatedly consuming capacity.

## Evidence and scope

The production batch examined on 2026-10-02 showed four independent failures:

1. OCR source text existed in `batch_factory_v11_book_records`, while the
   automation record still said `waiting/source`.
2. The browser component `BatchFactoryGiantMaterialPendingProgress` owns both
   OCR result backfill and `startBatchAutomation`; closing or failing to mount
   the component prevents the handoff.
3. A structured director/asset output error was recorded many times for one
   book because restarting automation resets its retry counter.
4. The workbench status reader requests production status, merge status, and
   a separate stage summary for every book each refresh, which turns a 19-book
   batch into repeated request bursts.

This design does not resend already uploaded content, recreate finished videos,
or delete existing batch data.

## Chosen architecture

### 1. Server-owned Giant OCR reconciliation

The Node service will reconcile persisted pending Giant books as part of its
automation tick, not through React. For each book with `contentPending=true`
and an `executorJobId`, it will read the executor result through the existing
server adapter:

- `succeeded` with non-empty normalized text: write `sourceText`, clear
  `contentPending`, set `giantOcrState=succeeded`, retain provenance, and mark
  the automation book `pending` so normal stage selection continues.
- `failed` or `cancelled`: record the executor failure as a terminal source
  failure and release the slot. No OCR retry is created automatically.
- queued/running: keep the book in `waiting/source`; it consumes no automatic
  production slot.

The browser remains a progress display and manual recovery surface only. It may
refresh data but must not be required to write OCR results or launch an
automation job.

### 2. Persistent, stage-scoped retry budget

Retry state is persisted in the automatic job and keyed by the book's current
input revision plus stage name. The default policy is:

| Failure type | Automatic action |
| --- | --- |
| Network, provider 5xx, timeout, temporary queue issue | At most three attempts for that stage, with existing backoff; then `failed` and release the slot. |
| Invalid structured JSON, invalid token, unauthorized, forbidden, missing configuration, invalid input | No automatic retry; mark the stage `failed` immediately and release the slot. |
| User presses retry for this book/stage | Explicitly starts a new three-attempt budget for only that stage; prior successful stages remain immutable. |

Restarting or resuming the batch never resets a terminal stage's budget. The
global book `attempts` field is retained only as a visible audit count; retry
eligibility is calculated from the persisted stage/revision ledger.

### 3. Scheduler fairness and recovery

Books awaiting an external OCR result do not occupy the configured concurrency.
The scheduler chooses ready/pending books before waiting external work, and a
book that reaches terminal `failed` is excluded until the user retries it.
Existing successful source, assets, director, video, merge, and upload records
are reused; automatic recovery runs only the earliest missing stage.

### 4. Read model and UI

Add one batch-runtime summary endpoint that returns:

- automation state and each book's stage/retry budget;
- Giant OCR source state;
- latest production/merge task per book;
- aggregate counts used by the workbench and task-log modal.

`BatchFactoryNovelList` will request this summary once per refresh and will not
fan out into one stage request per book. It will prevent overlapping refreshes
and poll only while the page is visible or a relevant modal is open.

The task log will distinguish these user actions:

- `等待 OCR` — executor has not returned a result;
- `可继续` — source is ready and the next production stage is queued;
- `自动重试 1/3` through `3/3` — transient retry only;
- `已停止并让位` — terminal failure, with the exact reason and a single-book
  retry button;
- `等待上传` — a completed merge that is intentionally awaiting external
  upload, not a generation failure.

## Data compatibility

Existing automation JSON remains readable. Missing retry-ledger fields are
derived conservatively from the last known book status: completed stages stay
completed, while an old waiting Giant book is reconciled against its executor
job before any production stage runs. No destructive migration is required.

## Acceptance tests

1. An OCR-success executor job is reconciled with no React component running;
   its text is persisted and the saved `full_submit` automation proceeds.
2. An OCR failure reaches terminal source failure once and does not consume a
   production slot.
3. A temporary stage error receives no more than three automatic attempts;
   a fourth scheduler pass runs another ready book instead.
4. An invalid JSON/token/configuration failure receives zero automatic retry
   and is visible as a terminal reason.
5. An explicit single-book retry creates a fresh stage budget without
   regenerating previously succeeded stages.
6. A 19-book status refresh makes one runtime-summary request instead of
   per-book stage-summary requests.
7. Existing successful upload records are never resubmitted during recovery.

## Non-goals

- Changing provider model prompts or attempting to repair invalid AI JSON in
  this recovery change.
- Retrying an external upload that already has a confirmed receipt.
- Replacing the current Docker hybrid runtime or changing unrelated batch UI
  layout.
