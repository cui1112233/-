# Task 4 Report — compatibility-preserving progressive workbench loading

## Status

Implemented and committed the compatibility-first progressive loader foundation requested for Task 4:

- classic/deferred loading preserves the inline V78 marker and the existing bridge.js, app.js, character-core, and clean-core order;
- window.__QIANTE_WORKBENCH__.loadFeature(name) tracks idle/loading/loaded/failed state and deduplicates concurrent loads;
- all four primary and legacy fallback entry pairs are manifest-referenced but inert until invoked;
- failed loads show a safe Chinese retry notice, keep core input/outline available, and do not replay save/export/AI actions;
- business-operation errors are not converted into fallback success;
- existing implementations remain in app.js or behind the compatibility bridge pending candidate browser smoke.

No candidate/public deployment, public :3000 mutation, formal data mutation, frontend build, or frontend/dist write was performed.

## Commit

- Implementation: 5c652b238ebe32134bccaf81460b8afa40e2fdc1
- Subject: perf: progressively load non-critical workbench features

## Exact files

Modified:

- public/novel-panel/workbench/index.html
- public/novel-panel/workbench/app.js

Added:

- public/novel-panel/workbench/modules/workbench-loader.js
- public/novel-panel/workbench/modules/history-save-export.js
- public/novel-panel/workbench/modules/legacy-history-save-export.js
- public/novel-panel/workbench/modules/diagnostics-runtime.js
- public/novel-panel/workbench/modules/legacy-diagnostics-runtime.js
- public/novel-panel/workbench/modules/premium-image.js
- public/novel-panel/workbench/modules/legacy-premium-image.js
- public/novel-panel/workbench/modules/settings-instructions.js
- public/novel-panel/workbench/modules/legacy-settings-instructions.js
- tests/novel-panel-workbench-loading.test.js

## RED

Command:

    node --test tests/novel-panel-workbench-loading.test.js

Output:

    tests 16
    pass 7
    fail 9
    duration_ms 69.588542

Expected failures:

- core classic scripts were not deferred;
- feature and legacy URLs were not inert manifest references;
- deferred app initialization did not wait when readyState was interactive;
- feature/legacy TXT export entry files were missing;
- feature/legacy history entry files were missing;
- feature/legacy premium entry files were missing.

Loader state, retry, deduplication, failure, and fallback tests already passed against the partial loader artifact.

## GREEN

Focused loader test:

    node --test tests/novel-panel-workbench-loading.test.js

    tests 16
    pass 16
    fail 0
    duration_ms 67.625417

Final sequential compatibility gate:

    node --test tests/novel-panel-workbench-loading.test.js
    node --test tests/novel-panel-asset-contract.test.js
    node --test tests/novel-panel-workbench-cache.test.js
    node --check public/novel-panel/workbench/app.js
    for file in public/novel-panel/workbench/modules/*.js; do node --check "$file"; done
    git diff --check -- public/novel-panel/workbench/index.html public/novel-panel/workbench/app.js public/novel-panel/workbench/modules tests/novel-panel-workbench-loading.test.js
    git diff --cached --check

Output:

    loader: 16/16 passed, 0 failed
    asset contract: 6/6 passed, 0 failed
    cache contract: 7/7 passed, 0 failed
    total: 29/29 passed, 0 failed
    all Task 4 JavaScript syntax checks passed
    Task 4 diff checks passed

One earlier parallel three-file invocation produced a timeout only in “asset drift cannot retain immutable caching or stale versioned HTML” after 1 second. The same test passed earlier in the parallel suite, passed alone at about 30 ms, and passed in the final sequential gate at about 26 ms. No Task 3 cache code or cache test was changed.

## Static transfer measurement

Method: compared the HEAD initial classic script list and bytes with the Task 4 working tree, using gzip level 9. This is a source-level transfer estimate, not a browser timing capture.

    before: 22 initial script requests, 2,126,853 raw bytes, 607,319 gzip bytes
    after:  23 initial script requests, 2,133,755 raw bytes, 609,651 gzip bytes
    delta:  +1 request, +6,902 raw bytes, +2,332 gzip bytes

The added initial request is modules/workbench-loader.js. Feature and legacy entry files remain inert until invoked.

TTFB, browser total transfer, and interaction-ready timing were not measured because no isolated candidate/browser environment was available in this task and the user explicitly directed the task not to wait for one.

## Concerns and remaining gate

1. This commit deliberately prioritizes loader/fallback compatibility over the larger physical extraction. The complete legacy implementations remain available, so the static initial payload is currently larger by the loader cost. This commit must not be described as a proven first-paint performance reduction.
2. Candidate browser smoke is still required to prove real click paths for history/save/export, diagnostics/runtime, premium/image, and settings/instruction center; verify no 404, console exception, duplicate download, duplicated click execution, session/auth regression, or false success.
3. Only after that browser smoke should individual legacy blocks be removed from the initial app.js, one group at a time, retaining the corresponding legacy fallback bundle and repeating transfer/interaction measurements.
4. No frontend build was run because it would overwrite unrelated concurrent frontend/dist changes.
5. No public deployment or formal-data operation was attempted.
