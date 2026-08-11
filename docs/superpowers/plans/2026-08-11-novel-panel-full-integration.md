# Novel Panel Full Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the complete V77 video-prompt workflow as qiantie's detailed “小说面板” without EXE startup or external page jumps, while preserving its layout, data safety gates, and production functions.

**Architecture:** Serve the original workbench assets from qiantie under a same-origin `/novel-panel/workbench` route and place that workbench inside the React user shell at `/novel-panel`. A thin asset bridge prefixes original API calls with `/api/novel-panel`, attaches the existing Bearer token, and removes obsolete independent-window behavior. Express replaces the original local FastAPI endpoints; all projects are stored under the authenticated user and all outline writes pass the imported V77 quality gate before persistence.

**Tech Stack:** Node.js 18+, Express 5, React 18, Ant Design, browser JavaScript assets, Node built-in `node:test`, existing V77 `outline-quality-gate.js` contract.

---

## File Structure

- Create `lib/novel-panel/project-store.js`: per-user project, settings, outputs, and idempotent legacy migration.
- Create `lib/novel-panel/quality-gate.js`: Node-compatible export of the V77 pre-write outline validator.
- Create `lib/novel-panel/prompt-service.js`: server-only instruction assembly, preset resolution, upstream calls, and protocol-lock checks.
- Create `lib/novel-panel/contracts.js`: project defaults, request validation, allowed instruction keys, and API response helpers.
- Create `routes/novel-panel.js`: authenticated workbench API endpoints.
- Create `routes/novel-panel-page.js`: same-origin workbench asset and HTML route.
- Create `scripts/sync-novel-panel-assets.js`: copies the approved V77 HTML/CSS/JS assets and injects the qiantie bridge deterministically.
- Create `public/novel-panel/bridge.js`: API prefix, Bearer injection, page lifecycle, and removal of obsolete EXE/window behavior.
- Create `frontend/src/shared/api/novelPanel.js` and `frontend/src/user/pages/NovelPanelPage.jsx`.
- Modify `app.js`, `routes/pages.js`, `frontend/src/user/App.jsx`, `frontend/src/shared/layouts/UserLayout.jsx`, `frontend/src/shared/styles/global.css`, `frontend/vite.config.js`, `package.json`, and both architecture validators.
- Create `tests/novel-panel-project-store.test.js`, `tests/novel-panel-quality-gate.test.js`, `tests/novel-panel-routes.test.js`, and `tests/novel-panel-asset-contract.test.js`.

## Task 1: Freeze the approved V77 workbench contract

**Files:**
- Create: `tests/novel-panel-asset-contract.test.js`
- Create: `docs/novel-panel-v77-contract.md`
- Source: `/Users/ming/Downloads/视频画面提示词工具_CharacterCore2AI指令中心完整恢复与协议锁定版_v77_Hotfix23_20260810/_internal/app/templates/index.html`
- Source: `/Users/ming/Downloads/视频画面提示词工具_CharacterCore2AI指令中心完整恢复与协议锁定版_v77_Hotfix23_20260810/_internal/app/static/app.js`
- Source: `/Users/ming/Downloads/视频画面提示词工具_CharacterCore2AI指令中心完整恢复与协议锁定版_v77_Hotfix23_20260810/_internal/app/static/character-core/character-core.js`

- [ ] **Step 1: Write the failing asset-contract test**

```js
const requiredIds = [
  'novelText', 'characterGuideInput', 'appearanceReference', 'analyzeBtn',
  'optimizeAllCharactersBtn', 'characters', 'relationshipGraphList',
  'outlineBtn', 'scenes', 'outputs', 'mergeBtn', 'segments',
  'instructionCenterPage', 'settingsDialog', 'historyDialog', 'ttsDialog'
];

for (const id of requiredIds) {
  assert(workbenchHtml.includes(`id="${id}"`), `missing V77 workbench control: ${id}`);
}
for (const endpoint of ['/api/analyze', '/api/outline-scenes', '/api/regenerate-scene-outline']) {
  assert(workbenchJs.includes(endpoint), `missing V77 endpoint contract: ${endpoint}`);
}
```

- [ ] **Step 2: Run the test to verify the contract fixture is absent**

Run: `node --test tests/novel-panel-asset-contract.test.js`

Expected: FAIL because the qiantie workbench contract document and copied fixture do not exist.

- [ ] **Step 3: Record the endpoint and UI contract**

Document these V77 endpoint families and their qiantie equivalents:

| V77 path | qiantie path | Required behavior |
| --- | --- | --- |
| `/api/settings`, `/api/settings/test` | `/api/novel-panel/settings`, `/api/novel-panel/settings/test` | unified API settings plus panel-specific options. |
| `/api/projects` | `/api/novel-panel/projects` | list, save, load, and delete only current-user projects. |
| `/api/analyze` | `/api/novel-panel/analyze` | style analysis and CharacterCore analysis result. |
| `/api/optimize-character*` | `/api/novel-panel/characters/*` | single and batch character operations, isolated failures. |
| `/api/outline-scenes` | `/api/novel-panel/outline-scenes` | whole-outline generation and pre-write gate. |
| `/api/regenerate-scene-outline` | `/api/novel-panel/regenerate-scene-outline` | one-scene regeneration and pre-write gate. |
| `/api/instruction-assist` | `/api/novel-panel/instruction-assist` | review, rewrite, correct with protocol-lock validation. |
| `/api/runtime-config` | `/api/novel-panel/runtime-config` | user panel timeout options. |
| `/api/character-core/*` | `/api/novel-panel/character-core/*` | slots, cast, project migration, trace, and lease compatibility. |

- [ ] **Step 4: Run the contract test**

Run: `node --test tests/novel-panel-asset-contract.test.js`

Expected: PASS and all required controls and endpoint families are named in the contract document.

- [ ] **Step 5: Commit the frozen contract**

```bash
git add tests/novel-panel-asset-contract.test.js docs/novel-panel-v77-contract.md
git commit -m "docs: freeze novel panel V77 contract"
```

## Task 2: Add per-user novel-panel storage and legacy migration

**Files:**
- Create: `lib/novel-panel/contracts.js`
- Create: `lib/novel-panel/project-store.js`
- Test: `tests/novel-panel-project-store.test.js`

- [ ] **Step 1: Write failing storage and migration tests**

```js
test('projects remain isolated by user', () => {
  const store = createNovelPanelStore({ usersDir: tempUsersDir(), legacyDir: tempLegacyDir() });
  store.saveProject('choushiyiguai', { id: 'p1', name: '主账号项目', data: { novel_text: '甲' } });
  assert.equal(store.listProjects('choushiyiguai').length, 1);
  assert.equal(store.listProjects('choushiyiguai1').length, 0);
});

test('legacy migration only imports once for the owner', () => {
  const store = createNovelPanelStore({ usersDir: tempUsersDir(), legacyDir: seededV77LegacyDir() });
  assert.equal(store.migrateLegacyIfNeeded('choushiyiguai').imported, 1);
  assert.equal(store.migrateLegacyIfNeeded('choushiyiguai').imported, 0);
  assert.equal(store.migrateLegacyIfNeeded('choushiyiguai1').imported, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/novel-panel-project-store.test.js`

Expected: FAIL with `Cannot find module '../lib/novel-panel/project-store'`.

- [ ] **Step 3: Implement project validation and storage paths**

```js
const PROJECT_ID = /^[a-zA-Z0-9_-]{1,80}$/;
function projectPath(username, id) {
  if (!PROJECT_ID.test(id)) throw new Error('Invalid project id');
  return path.join(usersDir, username, 'novel-panel', 'projects', `${id}.json`);
}
function saveProject(username, project) {
  const normalized = normalizeProject(project);
  writeJsonAtomic(projectPath(username, normalized.id), normalized);
  return normalized;
}
```

`normalizeProject()` keeps the V77 project fields, including `outline_shots`, `timeline_segments`, `characters`, `relationships`, instruction overrides, and panel settings. Reject traversal strings before any filesystem operation.

- [ ] **Step 4: Implement explicit legacy source selection**

Read legacy data only when `QIANTIE_NOVEL_PANEL_LEGACY_DIR` is configured or supplied by the test constructor. Never hard-code a Downloads path. Copy imported projects into `data/users/choushiyiguai/novel-panel/`, add a migration marker with source fingerprint, and leave the legacy directory unchanged.

- [ ] **Step 5: Run storage tests and syntax checks**

Run: `node --test tests/novel-panel-project-store.test.js && node --check lib/novel-panel/contracts.js && node --check lib/novel-panel/project-store.js`

Expected: all pass.

- [ ] **Step 6: Commit panel storage**

```bash
git add lib/novel-panel/contracts.js lib/novel-panel/project-store.js tests/novel-panel-project-store.test.js
git commit -m "feat: add isolated novel panel project storage"
```

## Task 3: Import and test the V77 pre-write quality gate

**Files:**
- Create: `lib/novel-panel/quality-gate.js`
- Create: `tests/novel-panel-quality-gate.test.js`
- Source: `/Users/ming/Downloads/视频画面提示词工具_CharacterCore2AI指令中心完整恢复与协议锁定版_v77_Hotfix23_20260810/_internal/app/static/outline-quality-gate.js`

- [ ] **Step 1: Port the existing 18 behavior cases as failing Node tests**

```js
test('blocks missing source coverage without overwriting previous shots', () => {
  const report = validateOutlineApplyGate({ novelText: '甲\n乙', candidate: { outline_shots: [shotFor('甲')] } });
  assert.equal(report.ok, false);
  assert(report.blockingIssues.some(issue => issue.code === 'source_coverage_missing'));
});

test('permits screen content mentioning JSON errors', () => {
  const report = validateOutlineApplyGate({ novelText: '手机弹出 JSON 错误', candidate: completeCandidate() });
  assert.equal(report.ok, true);
});
```

Include the original tests for short `source_basis`, negative `source_index`, manual cast authority, unchanged regeneration, generic prompts, duplicate load guard, and summary aliases.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/novel-panel-quality-gate.test.js`

Expected: FAIL with missing validator module.

- [ ] **Step 3: Export a CommonJS validator without browser globals**

```js
function validateOutlineApplyGate({ novelText, candidate, previousShots, context }) {
  const coverage = validateOutlineCoverage(novelText, candidate?.outline_shots || []);
  const display = validateShotDisplayability(candidate?.outline_shots || []);
  const cast = validateManualCastAuthority(candidate, context);
  const regeneration = validateRegenerationGuidance(candidate, previousShots, context);
  return summarizeOutlineGateIssues([coverage, display, cast, regeneration]);
}
module.exports = { validateOutlineApplyGate, validateOutlineCoverage, validateShotDisplayability, validateManualCastAuthority, validateRegenerationGuidance };
```

Keep the report contract `{ ok, severity, blockingIssues, warnings, metrics }` and `blockers` alias exactly compatible with V77.

- [ ] **Step 4: Run all gate tests**

Run: `node --test tests/novel-panel-quality-gate.test.js`

Expected: all 18 migrated cases pass.

- [ ] **Step 5: Commit the quality gate**

```bash
git add lib/novel-panel/quality-gate.js tests/novel-panel-quality-gate.test.js
git commit -m "feat: protect novel panel outline writes"
```

## Task 4: Implement protected instruction and generation services

**Files:**
- Create: `lib/novel-panel/prompt-service.js`
- Modify: `lib/preset-store.js`
- Test: `tests/novel-panel-routes.test.js`

- [ ] **Step 1: Write failing service tests for server-only prompt assembly**

```js
test('assembled generation messages contain selected preset bodies but API responses do not', () => {
  const messages = buildOutlineMessages({ project, selection: { baseId: 'base_realism', addonIds: ['addon_camera'] } });
  assert(messages[0].content.includes('server-only base rules'));
  assert(!JSON.stringify(publicProjectResponse(project)).includes('server-only base rules'));
});

test('instruction changes that alter protected protocol are rejected', () => {
  assert.throws(() => validateInstructionChange('不要 JSON，改成 Markdown'), /protocol lock/);
});
```

- [ ] **Step 2: Run service tests to verify failure**

Run: `node --test tests/novel-panel-routes.test.js`

Expected: FAIL with missing prompt service.

- [ ] **Step 3: Implement instruction assembly and upstream invocation**

```js
function buildOutlineMessages({ project, selection }) {
  const preset = presetStore.resolveSelection(selection, { module: 'novel-panel', includeBodies: true });
  return [
    { role: 'system', content: [preset.base.body, ...preset.addons.map(item => item.body), project.instructions.outline].filter(Boolean).join('\n\n') },
    { role: 'user', content: project.novel_text }
  ];
}

async function requestPanelCompletion(username, messages, options) {
  const config = readConfig(username);
  ensureReadyConfig(config);
  return requestUpstream(config, { model: config.model, messages, stream: false, max_tokens: options.maxTokens, temperature: options.temperature }, collectResponse);
}
```

Parse upstream output with the same tolerant JSON recovery rules used by V77. Return a structured error before any project write on malformed upstream JSON.

- [ ] **Step 4: Add CharacterCore compatibility adapters**

Implement route-service functions for `parse-slots`, `resolve-scene-cast`, `build-scene-context`, `migrate-project`, trace, and project lease. Preserve `slot_id`, `person_id`, source hash, manual locks, selected character authority, and temporary-character metadata. Use the V77 Python and browser contract as the behavioral reference; do not introduce name-based fallback matching.

- [ ] **Step 5: Run service tests**

Run: `node --test tests/novel-panel-routes.test.js && node --check lib/novel-panel/prompt-service.js`

Expected: all service tests pass without exposing a preset body in response data.

- [ ] **Step 6: Commit generation services**

```bash
git add lib/novel-panel/prompt-service.js lib/preset-store.js tests/novel-panel-routes.test.js
git commit -m "feat: add protected novel panel generation service"
```

## Task 5: Add authenticated novel-panel API routes

**Files:**
- Create: `routes/novel-panel.js`
- Modify: `app.js`
- Test: `tests/novel-panel-routes.test.js`

- [ ] **Step 1: Add failing route tests for persistence and blocked writes**

```js
test('outline gate failure returns applied false and preserves the saved project', async () => {
  const before = await saveFixtureProject('choushiyiguai', completeProject());
  const response = await request(app)
    .post('/api/novel-panel/outline-scenes')
    .set(auth('choushiyiguai'))
    .send({ projectId: before.id, candidate: weakOutline() });
  assert.equal(response.status, 422);
  assert.equal(response.body.applied, false);
  assert.deepEqual(loadProject(before.id).outline_shots, before.outline_shots);
});
```

- [ ] **Step 2: Run route tests to verify missing endpoint failure**

Run: `node --test tests/novel-panel-routes.test.js`

Expected: FAIL with 404 for `/api/novel-panel/outline-scenes`.

- [ ] **Step 3: Implement the route matrix**

```js
router.use(apiAuth);
router.get('/projects', listProjects);
router.post('/projects', saveProject);
router.get('/projects/:id', loadProject);
router.delete('/projects/:id', deleteProject);
router.get('/settings', getPanelSettings);
router.post('/settings', savePanelSettings);
router.post('/settings/test', testUnifiedAiSettings);
router.post('/analyze', analyzeProject);
router.post('/characters/one', optimizeCharacter);
router.post('/characters/all', optimizeAllCharacters);
router.post('/outline-scenes', generateOutline);
router.post('/regenerate-scene-outline', regenerateSceneOutline);
router.post('/instruction-assist', assistInstruction);
router.get('/runtime-config', getRuntimeConfig);
router.post('/runtime-config', saveRuntimeConfig);
router.use('/character-core', characterCoreRouter);
```

`generateOutline` and `regenerateSceneOutline` must call `validateOutlineApplyGate()` before `projectStore.saveProject()`. On failure return HTTP 422 and `{ applied: false, reason, report }`; do not call save, synchronization, or history writes.

- [ ] **Step 4: Implement text processing, export, and TTS reuse**

Expose panel-scoped text cleanup and TXT export endpoints. Reuse the authenticated `/api/tts` service through an internal function rather than making a browser request to a second origin. Ensure audio errors preserve the project and return bounded diagnostic text.

- [ ] **Step 5: Run route tests and syntax checks**

Run: `node --test tests/novel-panel-routes.test.js && node --check routes/novel-panel.js && node --check app.js`

Expected: all pass.

- [ ] **Step 6: Commit panel APIs**

```bash
git add routes/novel-panel.js app.js tests/novel-panel-routes.test.js
git commit -m "feat: add novel panel API routes"
```

## Task 6: Publish the original workbench assets behind a same-origin bridge

**Files:**
- Create: `scripts/sync-novel-panel-assets.js`
- Create: `public/novel-panel/bridge.js`
- Create: `routes/novel-panel-page.js`
- Modify: `app.js`
- Test: `tests/novel-panel-asset-contract.test.js`

- [ ] **Step 1: Add failing bridge assertions**

```js
assert(workbenchHtml.includes('/novel-panel/bridge.js'));
assert(bridgeJs.includes('Authorization'));
assert(bridgeJs.includes('/api/novel-panel/'));
assert(!bridgeJs.includes('VideoPromptTool.exe'));
assert(!bridgeJs.includes('127.0.0.1:8818'));
```

- [ ] **Step 2: Run the asset contract test**

Run: `node --test tests/novel-panel-asset-contract.test.js`

Expected: FAIL because copied assets and bridge do not exist.

- [ ] **Step 3: Implement deterministic source asset synchronization**

```js
const sourceRoot = process.env.NOVEL_PANEL_V77_SOURCE;
if (!sourceRoot) throw new Error('NOVEL_PANEL_V77_SOURCE is required to sync approved V77 assets');
copyFile(path.join(sourceRoot, '_internal/app/templates/index.html'), path.join(targetRoot, 'index.html'));
copyFile(path.join(sourceRoot, '_internal/app/static/style.css'), path.join(targetRoot, 'style.css'));
copyFile(path.join(sourceRoot, '_internal/app/static/app.js'), path.join(targetRoot, 'app.js'));
copyFile(path.join(sourceRoot, '_internal/app/static/outline-quality-gate.js'), path.join(targetRoot, 'outline-quality-gate.js'));
copyTree(path.join(sourceRoot, '_internal/app/static/character-core'), path.join(targetRoot, 'character-core'));
```

Inject `<script src="/novel-panel/bridge.js"></script>` before the validator and app scripts. The script must fail if the source lacks any asset named in Task 1.

- [ ] **Step 4: Implement the API and lifecycle bridge**

```js
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const mapped = url.startsWith('/api/') ? url.replace('/api/', '/api/novel-panel/') : url;
  const headers = new Headers(init.headers || {});
  const token = window.parent?.localStorage?.getItem('auth_token') || localStorage.getItem('auth_token');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return nativeFetch(mapped, { ...init, headers, cache: 'no-store' });
};
```

Replace any `sendBeacon` lease release through the sync transform with the bridge `fetch` path so the Bearer header is retained. Remove only independent-window and EXE startup assumptions; do not alter the source panel IDs, action labels, JSON handling, CharacterCore behavior, or instruction-center flow.

- [ ] **Step 5: Serve the workbench and enforce same-origin framing**

```js
router.get('/workbench', (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'self';");
  res.sendFile(path.join(PUBLIC_DIR, 'novel-panel', 'index.html'));
});
```

Mount the page router before the generic 404 handler. Serve static assets with no-cache headers during active migration.

- [ ] **Step 6: Run contract and route tests**

Run: `NOVEL_PANEL_V77_SOURCE='/Users/ming/Downloads/视频画面提示词工具_CharacterCore2AI指令中心完整恢复与协议锁定版_v77_Hotfix23_20260810' node scripts/sync-novel-panel-assets.js && node --test tests/novel-panel-asset-contract.test.js tests/novel-panel-routes.test.js`

Expected: all assets are copied, required controls remain present, and no bridge reference points at the old EXE or port.

- [ ] **Step 7: Commit workbench bridge assets**

```bash
git add scripts/sync-novel-panel-assets.js public/novel-panel routes/novel-panel-page.js app.js tests/novel-panel-asset-contract.test.js
git commit -m "feat: host V77 workbench inside qiantie"
```

## Task 7: Add the 小说面板 user route and navigation entry

**Files:**
- Create: `frontend/src/shared/api/novelPanel.js`
- Create: `frontend/src/user/pages/NovelPanelPage.jsx`
- Modify: `frontend/src/user/App.jsx`
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`
- Modify: `routes/pages.js`
- Modify: `frontend/src/shared/styles/global.css`
- Modify: `scripts/validate-react-frontend-architecture.js`
- Modify: `scripts/validate-multipage-architecture.js`

- [ ] **Step 1: Add failing route and navigation assertions**

```js
assert(read('frontend/src/user/App.jsx').includes("pathname === '/novel-panel'"));
assert(read('frontend/src/shared/layouts/UserLayout.jsx').includes("href: '/novel-panel'"));
assert(read('frontend/src/user/pages/NovelPanelPage.jsx').includes('/novel-panel/workbench'));
assert(read('routes/pages.js').includes("router.get('/novel-panel'"));
```

- [ ] **Step 2: Run both validators**

Run: `node scripts/validate-react-frontend-architecture.js && node scripts/validate-multipage-architecture.js`

Expected: FAIL with missing novel-panel files and route assertions.

- [ ] **Step 3: Implement the focused React page**

```jsx
export function NovelPanelPage() {
  return (
    <div className="novel-panel-host">
      <iframe className="novel-panel-frame" title="小说面板" src="/novel-panel/workbench" />
    </div>
  );
}
```

`NovelPanelPage` owns only the host and loading/error state. It must not duplicate the V77 panels in React. `novelPanel.js` provides project and preset calls needed by qiantie shell actions without exposing preset bodies.

- [ ] **Step 4: Add the route and navigation item in the confirmed order**

```js
{ href: '/script', icon: '📝', label: '剧本生成' },
{ href: '/novel-panel', icon: '🎬', label: '小说面板' },
{ href: '/agent', icon: '🤖', label: 'Agent 工作区' },
```

Keep “剧本生成” as the existing fast 10/15-second workflow. `routes/pages.js` must serve the React entry for `/novel-panel` in the same manner as `/script`.

- [ ] **Step 5: Implement stable host dimensions**

```css
.novel-panel-host { min-width: 0; flex: 1; height: 100%; overflow: hidden; }
.novel-panel-frame { display: block; width: 100%; height: 100%; border: 0; background: transparent; }
```

At small viewports, allow the workbench's own responsive behavior while retaining accessible qiantie navigation; do not crop the frame or force a second horizontal scroll container.

- [ ] **Step 6: Build and verify**

Run: `npm --prefix frontend run build && node scripts/validate-react-frontend-architecture.js && node scripts/validate-multipage-architecture.js`

Expected: build passes and both validators print `passed.`

- [ ] **Step 7: Commit user navigation integration**

```bash
git add frontend/src routes/pages.js scripts/validate-react-frontend-architecture.js scripts/validate-multipage-architecture.js
git commit -m "feat: add novel panel to user navigation"
```

## Task 8: End-to-end regression and manual workbench verification

**Files:**
- Modify: `README.md`
- Test: `tests/novel-panel-project-store.test.js`
- Test: `tests/novel-panel-quality-gate.test.js`
- Test: `tests/novel-panel-routes.test.js`
- Test: `tests/novel-panel-asset-contract.test.js`

- [ ] **Step 1: Add documented local prerequisites**

Document the two one-time source paths: `NOVEL_PANEL_V77_SOURCE` for asset synchronization and `QIANTIE_NOVEL_PANEL_LEGACY_DIR` for optional owner-only data import. State that neither source is deleted or modified.

- [ ] **Step 2: Run deterministic tests**

Run: `node --test tests/novel-panel-project-store.test.js tests/novel-panel-quality-gate.test.js tests/novel-panel-routes.test.js tests/novel-panel-asset-contract.test.js && node --check routes/novel-panel.js && node --check lib/novel-panel/project-store.js && node --check lib/novel-panel/prompt-service.js && npm --prefix frontend run build && node scripts/validate-multipage-architecture.js && node scripts/validate-react-frontend-architecture.js`

Expected: every command exits `0`.

- [ ] **Step 3: Run manual browser acceptance with a test AI configuration**

Verify at desktop and mobile widths that `/novel-panel` keeps qiantie navigation visible, loads the full V77 workbench, and exposes source input, style analysis, character cards, relationship graph, outline generation, a single-scene regeneration action, time-axis merge, TXT export, TTS settings, project history, and AI instruction center. Confirm a deliberately weak generated outline returns an unapplied warning and preserves a prior valid outline.

- [ ] **Step 4: Verify permission and data boundaries**

As the owner, import one legacy project and confirm it appears only in `choushiyiguai`'s novel-panel history. As another active account, confirm that project is absent, a catalog item can be selected by metadata, and the complete preset body cannot be retrieved through browser network responses.

- [ ] **Step 5: Commit final documentation and tests**

```bash
git add README.md tests
git commit -m "test: verify complete novel panel integration"
```
