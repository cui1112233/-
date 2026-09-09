# Batch Factory V78 parity root cause — 2026-09-09

## Scope

This note covers only Batch Factory UI and V11 batch orchestration. It does not change Novel Fetch, shared authentication, Nginx, deployment, MiniMax H3 adapter internals, master, V78, or production containers.

## Verified historical baseline

The later V78 production line `release/production-v78.3.0.3-batch-factory-go-first` contains the recovered data-driven Batch Factory workbench. Its `BatchFactoryPage.jsx` renders `BatchFactoryPreviewPage`, and that preview implements the user-facing production chain rather than a static mock.

The recovered workbench retains these product semantics:

1. Multiple books stay visible and operable in one batch.
2. Batch script/director generation operates over the batch rather than requiring manual one-book-at-a-time work.
3. Each generated VIDEO exposes editable visual prompts.
4. Production settings include video-model selection.
5. Finished work enters a batch upload/publish flow, with 121 as a primary target.

The recovery commit in that lineage is `17125d67f0919d714ae9ae9f4edc80b9d1a04788` (`recovery: restore V78 frontend source baseline`).

## Root cause 1 — the V78 workbench shell was replaced twice

The V88 baseline did not carry the later recovered data-driven `BatchFactoryPreviewPage.jsx`; its file is a small static preview/mock. On 2026-09-03, commit `6371f0d5e8a46f68c5ed025538c11ab1cf5f6947` (`feat(v88): integrate Batch Factory V11 onto master baseline`) changed the live `BatchFactoryPage.jsx` entry to render `BatchFactoryV11UiPage` directly.

Result: the historical V78 workbench did not disappear because one endpoint was removed. The visible shell itself was first represented by a stale/static preview in the V88 baseline and then bypassed by the V11 entry replacement.

Recovery decision: do not restore the old V78 API stack. Keep V11 authoritative and migrate the proven V78 interaction semantics into the V11 workbench.

## Root cause 2 — a V11 load failure replaced the entire product with an error page

`bf11UiAdapter.loadWorkbench()` starts with the V11 capabilities request. Before this recovery, `BatchFactoryV11UiPage` converted any runtime load error into a full-page `Batch Factory V11 暂时不可用` alert.

Result: when the candidate/local V11 capability path or bridge was temporarily unavailable, the page looked as though Batch Factory itself had disappeared. Users could not even see that the intended production flow still existed.

Recovery: `BatchFactoryUnavailableShell` keeps a read-only, non-actionable representation of the verified V78 flow visible:

- 多本批量剧本生成
- VIDEO 画面提示词
- 视频模型
- 上传 121

The shell does not submit production or publication requests while V11 is unavailable and does not fall back to legacy APIs.

## Root cause 3 — batch script generation was still serial

The V11 batch Director HTTP handler iterated `batch.Books` and called `RunDirector` synchronously for each book. A RED regression with three books measured `maxActive=1`, proving the batch operation was serial.

Result: a multi-book request accumulated per-book latency inside one HTTP request and could look stalled or time out under a larger batch, which did not match the V78 multi-book simultaneous-operation expectation.

Recovery: run per-book Director work with a bounded concurrency of 4 while preserving result ordering and the existing sanitized per-book failure response. This is orchestration only; Director semantics and H3 adapter code are unchanged.

## Root cause 4 — H3 was shown as the personal API provider

The V11 workbench used a two-way provider label expression: Doubao local vs. personal API. Any other provider, including `autodl_comfyui`, therefore displayed as `个人中心 API · yd2.0-mini`.

Recovery: map the existing server-managed `autodl_comfyui` provider to the user-facing model label `MiniMax H3`. The server model catalog and H3 adapter contract remain authoritative.

## 121 compatibility

The existing V11 `ExternalPublishPanel` already includes 121 and keeps 121 as its default provider. The workbench now labels the main action `上传 121` so the historical production path is explicit. The existing confirmation/credential flow is reused; no credential value is stored in source or this document.

## Regression contracts

- `backend/internal/httpapi/batch_factory_v11_batch_director_concurrency_test.go`
  - proves at least two books execute concurrently;
  - proves every book still receives Director/VIDEO output.
- `frontend/src/user/pages/batch-factory-v11/v78Parity.contract.test.js`
  - locks the authoritative V11 entry;
  - locks the degraded shell instead of a blank/error-only replacement;
  - locks batch script generation, VIDEO visual prompts, MiniMax H3 labeling, and upload 121;
  - locks server-catalog model selection and default 121 publishing;
  - rejects exposure of H3 internal workflow names or secret-bearing source patterns.

## Explicit non-goals / remaining dependencies

- This recovery does not prove a live 121 account can publish; that requires external-service acceptance with authorized credentials and should not be inferred from UI/contract tests.
- This recovery does not change or certify the MiniMax H3 adapter implementation; it only preserves compatibility with the existing server-managed catalog/provider contract.
- It does not change shared auth/proxy/Nginx/deployment. If a candidate environment cannot reach V11 capabilities, the degraded shell makes that dependency visible but does not mask or bypass it.
