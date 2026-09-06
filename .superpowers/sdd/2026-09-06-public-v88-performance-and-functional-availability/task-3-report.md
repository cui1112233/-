# Task 3 report: versioned workbench assets and safe caching

## Status

Fixed the reviewer finding. The router now builds and validates the manifest once at router creation, tracks bounded asset-directory watchers plus asynchronous stat fingerprints for drift invalidation, and serves asset bytes with `res.sendFile` streaming. Drift invalidates the cached manifest and falls back to safe revalidation without request-time full-file hashing. HTML remains no-store with CSP; matching manifest hashes remain immutable; non-versioned and mismatched assets remain revalidated.

No release-info, Nginx, public `:3000`, production volume, or unrelated Batch Factory files were changed or staged.

## TDD evidence

### RED

Command:

```text
node --test tests/novel-panel-workbench-cache.test.js
```

Result: 4 passed, 1 failed. The new repeated-request regression failed with `16 !== 0` for synchronous JS/CSS reads, reproducing the reviewer finding.

### GREEN

Command:

```text
node --test --test-concurrency=1 tests/novel-panel-workbench-cache.test.js
```

Result: 5 passed, 0 failed.

## Final verification

Command:

```text
node --test --test-concurrency=1 tests/novel-panel-asset-contract.test.js tests/novel-panel-workbench-cache.test.js tests/frontend-asset-cache-contract.test.js
node --check lib/novel-panel/workbench-assets.js
node --check routes/novel-panel-page.js
node --check tests/novel-panel-workbench-cache.test.js
git diff --check
```

Result: 12 tests passed, 0 failed; all syntax and whitespace checks passed.

## Changed files

- `lib/novel-panel/workbench-assets.js`: exports the existing safe resolver for streaming delivery.
- `routes/novel-panel-page.js`: removes per-request manifest rebuilding and full-file hashing, adds bounded invalidation/fingerprint checks, streams assets, and avoids implicit response-body hashing.
- `tests/novel-panel-workbench-cache.test.js`: preserves the no-sync-read/no-hash regression and closes test watchers deterministically.

## Commits

- `b6746f48` — `perf: fix workbench asset delivery caching`
- `docs: record Task 3 performance fix` — report commit follows after this report is written.

## Concerns

- Watcher/stat invalidation is intentionally fail-safe: after drift, the process serves revalidation URLs until assets are regenerated or the service restarts; it does not rebuild the manifest on requests.
- Full browser smoke and candidate packaging remain outside Task 3 and are still required by later plan tasks.
