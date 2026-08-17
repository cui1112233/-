# CM 剧本协作宠物 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CM read the current script safely, return reviewable full-script rewrites, let the writer preview/apply/undo one revision, and give actionable non-duplicated error feedback.

**Architecture:** Keep the existing browser event boundary between `ScriptPage` and `StackyPet`. Expand the sanitized pet context to retain bounded script fields, introduce a preview event carrying a parsed revision candidate, and make `ScriptPage` own the Ant Design preview modal and one in-memory undo snapshot. Keep Agent API context transient and bounded; classify request errors in the renderer so CM can present recovery actions without changing the model protocol.

**Tech Stack:** React 18, Ant Design 5, Vite, Node.js built-in test runner, Express 5.

## Global Constraints

- Only current novel text, extraction result, and current script output may enter CM context; never add screen, file, or system-data access.
- API keys must never appear in pet context, chat messages, preview content, or error copy.
- A candidate script must never replace `output` until the user explicitly confirms it in the preview modal.
- Support only full-script revision in this change; do not add selected-text replacement, multi-candidate comparison, server-side version history, voice, screenshots, or native desktop capabilities.
- Preserve the existing server-side Agent context bounds and task persistence rule: page context remains transient and must not be written into `agent-tasks.json`.
- A failed script generation must preserve the prior `output`.
- Use `node --test` for repository tests and `npm --prefix frontend run build` for renderer verification.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/shared/pet/stacky.js` | Sanitize/bound page context, define the preview browser event, and expose event dispatch helpers. |
| `frontend/src/shared/pet/stacky.test.js` | Unit-test context retention, sensitive-key redaction, bounds, and preview event payload behavior. |
| `frontend/src/shared/pet/scriptCollaboration.js` | Pure revision parsing and renderer error-to-recovery-action classification. |
| `frontend/src/shared/pet/scriptCollaboration.test.js` | Unit-test revision parsing and error classifications independently of React. |
| `frontend/src/shared/pet/StackyPet.jsx` | Send complete bounded context, offer revision preview, and show CM error recovery actions. |
| `frontend/src/shared/api/client.js` | Attach request status/source metadata to thrown API errors and permit opt-out from the global API-error event. |
| `frontend/src/user/pages/ScriptPage.jsx` | Own revision preview state, confirmation, one-step undo, script-error CM feedback, and no-output loss on generation failure. |
| `frontend/src/shared/styles/global.css` | Add narrow scoped styles for revision preview columns and CM recovery controls. |
| `tests/cm-agent-ui-contract.test.js` | Update UI contract assertions for the preview workflow and retained script context. |
| `tests/agent-routes.test.js` | Retain existing Agent transient-context tests and add an end-to-end bounded script-context assertion. |

## Event and Function Interfaces

```js
// frontend/src/shared/pet/stacky.js
export const PET_PREVIEW_EVENT = 'qiantie:pet-preview';
export function dispatchPetPreview({ summary, candidateOutput }) {}

// frontend/src/shared/pet/scriptCollaboration.js
export function parseScriptRevision(content) {
  // Returns { summary: string, candidateOutput: string } or null.
}

export function classifyPetRequestError(error) {
  // Returns { message: string, action: 'retry' | 'settings' | 'none' }.
}

// frontend/src/shared/api/client.js
export async function apiRequest(path, options = {}) {
  // options.suppressGlobalError === true prevents qiantie:api-error dispatch for this request only.
}
```

```js
// Browser event payload
window.dispatchEvent(new CustomEvent('qiantie:pet-preview', {
  detail: { summary: '修改说明', candidateOutput: '完整候选剧本' }
}));
```

### Task 1: Add safe script-context and revision helper contracts

**Files:**
- Create: `frontend/src/shared/pet/scriptCollaboration.js`
- Create: `frontend/src/shared/pet/scriptCollaboration.test.js`
- Modify: `frontend/src/shared/pet/stacky.js:1-245`
- Modify: `frontend/src/shared/pet/stacky.test.js:1-273`

**Consumes:** Existing `normalizePetContext(context)`, existing sensitive-key redaction rules, and the existing `PET_CONTEXT_EVENT` convention.

**Produces:** `PET_PREVIEW_EVENT`, `dispatchPetPreview({ summary, candidateOutput })`, `parseScriptRevision(content)`, and `classifyPetRequestError(error)` for Tasks 2 and 3.

- [ ] **Step 1: Write failing helper tests**

Create `frontend/src/shared/pet/scriptCollaboration.test.js` with these exact behavioral tests:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPetRequestError, parseScriptRevision } from './scriptCollaboration.js';

test('parses only a non-empty complete revision marked by 【修改稿】', () => {
  assert.deepEqual(parseScriptRevision('修改重点：加强第三场冲突。\n【修改稿】\n场景一：修改后的完整剧本'), {
    summary: '修改重点：加强第三场冲突。',
    candidateOutput: '场景一：修改后的完整剧本'
  });
  assert.equal(parseScriptRevision('只有建议，没有完整稿'), null);
  assert.equal(parseScriptRevision('说明\n【修改稿】\n   '), null);
});

test('classifies timeout, configuration, upstream, and unknown pet request failures', () => {
  assert.deepEqual(classifyPetRequestError({ status: 504, message: '上游模型请求超时，请稍后重试' }), {
    message: '连接模型超时，当前剧本已保留。', action: 'retry'
  });
  assert.deepEqual(classifyPetRequestError({ status: 401, message: 'API key invalid' }), {
    message: '模型配置无法使用，请检查接口、模型名或密钥。', action: 'settings'
  });
  assert.deepEqual(classifyPetRequestError({ status: 502, message: 'Upstream returned non-JSON response' }), {
    message: '模型返回内容异常，当前剧本未改动。', action: 'retry'
  });
  assert.deepEqual(classifyPetRequestError(new Error('Network request failed')), {
    message: '网络连接不稳定，当前剧本已保留。', action: 'retry'
  });
});
```

Extend `stacky.test.js` with an assertion that `normalizePetContext()` retains bounded `novelText`, sanitized `extracted`, and bounded `scriptOutput`, while dropping `apiKey` and `token` anywhere in nested content.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
node --test "frontend/src/shared/pet/scriptCollaboration.test.js" "frontend/src/shared/pet/stacky.test.js"
```

Expected: FAIL because `scriptCollaboration.js`, `PET_PREVIEW_EVENT`, and retained script fields do not exist yet.

- [ ] **Step 3: Implement pure revision and error helpers**

Create `scriptCollaboration.js` with a strict marker parser and deterministic classifications:

```js
const REVISION_MARKER = '【修改稿】';

export function parseScriptRevision(content) {
  const text = String(content || '').trim();
  const markerIndex = text.indexOf(REVISION_MARKER);
  if (markerIndex < 0) return null;
  const summary = text.slice(0, markerIndex).trim();
  const candidateOutput = text.slice(markerIndex + REVISION_MARKER.length).trim();
  return candidateOutput ? { summary, candidateOutput } : null;
}

export function classifyPetRequestError(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  const source = String(error?.source || '');
  const detail = String(error?.message || error || '');
  if (status === 401 || status === 403 || /api.?key|unauthori[sz]ed|forbidden|密钥|鉴权/i.test(detail)) {
    return { message: '模型配置无法使用，请检查接口、模型名或密钥。', action: 'settings' };
  }
  if (status === 504 || /timeout|超时/i.test(detail)) {
    return { message: '连接模型超时，当前剧本已保留。', action: 'retry' };
  }
  if (status === 502 || /non-json|upstream|返回.*异常/i.test(detail)) {
    return { message: '模型返回内容异常，当前剧本未改动。', action: 'retry' };
  }
  if (source === '/api/agent/chat' || /network|failed to fetch|网络/i.test(detail)) {
    return { message: '网络连接不稳定，当前剧本已保留。', action: 'retry' };
  }
  return { message: '这次没有完成处理，当前剧本未改动。', action: 'retry' };
}
```

- [ ] **Step 4: Extend sanitized pet context and preview dispatch**

In `stacky.js`:

1. Add `PET_PREVIEW_EVENT` adjacent to the other event constants.
2. Add explicit bounded field constants: `MAX_NOVEL_TEXT_CHARS = 4500`, `MAX_EXTRACTED_CHARS = 2500`, and `MAX_SCRIPT_OUTPUT_CHARS = 4500`.
3. Reuse the existing safe readers and entity sanitizer to produce a plain `extracted` value. Serialize it safely, redact sensitive nested keys, and truncate to `MAX_EXTRACTED_CHARS`.
4. Add `novelText: text(read(source, 'novelText')).slice(0, MAX_NOVEL_TEXT_CHARS)` and `scriptOutput: text(read(source, 'scriptOutput')).slice(0, MAX_SCRIPT_OUTPUT_CHARS)` to the return object. Update `text()` to accept an optional cap so the script fields are not prematurely truncated to 1600 characters.
5. Add:

```js
export function dispatchPetPreview({ summary, candidateOutput } = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PET_PREVIEW_EVENT, {
    detail: {
      summary: String(summary || '').trim(),
      candidateOutput: String(candidateOutput || '').trim()
    }
  }));
}
```

Do not change `dispatchPetApply`; keep it temporarily for compatibility, but Task 3 must stop using it from CM revision buttons.

- [ ] **Step 5: Run helper tests to verify they pass**

Run:

```powershell
node --test "frontend/src/shared/pet/scriptCollaboration.test.js" "frontend/src/shared/pet/stacky.test.js"
```

Expected: PASS.

- [ ] **Step 6: Commit the safe context boundary**

```powershell
git add "frontend/src/shared/pet/scriptCollaboration.js" "frontend/src/shared/pet/scriptCollaboration.test.js" "frontend/src/shared/pet/stacky.js" "frontend/src/shared/pet/stacky.test.js"
git commit -m "feat: retain bounded script context for CM"
```

### Task 2: Make CM offer revision preview and actionable recovery

**Files:**
- Modify: `frontend/src/shared/api/client.js:20-75`
- Modify: `frontend/src/shared/pet/StackyPet.jsx:1-486`
- Modify: `frontend/src/shared/styles/global.css:1666-1794`
- Modify: `tests/cm-agent-ui-contract.test.js:1-296`

**Consumes:** `parseScriptRevision`, `classifyPetRequestError`, `dispatchPetPreview`, and `PET_PREVIEW_EVENT` from Task 1.

**Produces:** CM message-level “预览修改” action, retry/settings recovery controls, and agent requests that suppress the duplicate global API modal.

- [ ] **Step 1: Write failing UI contract assertions**

In `tests/cm-agent-ui-contract.test.js`, add a test that reads source files and asserts all of the following exact contracts:

```js
assert.match(pet, /parseScriptRevision/);
assert.match(pet, /dispatchPetPreview\(revision\)/);
assert.match(pet, /预览修改/);
assert.doesNotMatch(pet, /onClick=\{\(\) => dispatchPetApply\(/);
assert.match(pet, /classifyPetRequestError/);
assert.match(pet, /打开模型设置/);
assert.match(pet, /suppressGlobalError: true/);
assert.match(client, /if \(!options\.suppressGlobalError\) notifyApiFailure/);
assert.match(css, /\.stacky-agent-recovery/);
```

- [ ] **Step 2: Run the UI contract test to verify it fails**

Run:

```powershell
node --test "tests/cm-agent-ui-contract.test.js"
```

Expected: FAIL because the preview/recovery controls and request option are absent.

- [ ] **Step 3: Add error metadata and duplicate-modal suppression in the API client**

In `apiRequest()` add a local helper:

```js
function attachApiError(error, { path, method, status }) {
  error.status = status;
  error.source = path;
  error.method = method || 'GET';
  return error;
}
```

Use it for the network `catch`, 401 error, and non-OK error paths. Wrap each existing `notifyApiFailure(...)` call in:

```js
if (!options.suppressGlobalError) notifyApiFailure(failure);
```

Do not suppress error reporting with `reportClientError`; only suppress the user-facing global modal for callers that take ownership of recovery UI.

- [ ] **Step 4: Replace direct apply with preview and recovery controls in CM**

In `StackyPet.jsx`:

1. Replace the `PET_APPLY_EVENT` and `dispatchPetApply` imports with `dispatchPetPreview` and import `parseScriptRevision` and `classifyPetRequestError`.
2. Pass `suppressGlobalError: true` to `askAgent()` by extending `askAgent` in `frontend/src/shared/api/agent.js` to accept `{ suppressGlobalError = false }` and pass it to `apiRequest`. Add this small API-file change to this task's commit.
3. In the assistant-message render block, compute `const revision = message.role === 'assistant' && contextRef.current.scriptOutput ? parseScriptRevision(message.content) : null;` before JSX. Render a `预览修改` button only when `revision` is non-null. Its click handler must call `dispatchPetPreview(revision)`.
4. In `catch`, replace raw error display with:

```js
const recovery = classifyPetRequestError(error);
setFailedRequest({ prompt: content, ...recovery });
setReply(recovery.message);
```

5. Render recovery actions as follows:

```jsx
{failedRequest ? (
  <div className="stacky-agent-recovery" role="alert">
    <span>{failedRequest.message}</span>
    {failedRequest.action === 'retry' ? (
      <button type="button" onClick={() => sendQuestion(failedRequest.prompt)} disabled={asking}>重新发送</button>
    ) : null}
    {failedRequest.action === 'settings' ? (
      <button type="button" onClick={() => { window.location.href = '/settings'; }}>打开模型设置</button>
    ) : null}
  </div>
) : null}
```

Keep the stale-task path unchanged because it already resets the task safely.

- [ ] **Step 5: Add scoped styles**

Append styles near current `.stacky-agent-retry` rules:

```css
.stacky-agent-recovery {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-radius: 10px;
  color: #ffd6d6;
  background: rgba(164, 55, 55, 0.2);
}

.stacky-agent-recovery button {
  border: 0;
  border-radius: 7px;
  padding: 4px 8px;
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
  cursor: pointer;
}
```

- [ ] **Step 6: Run contracts and frontend build**

Run:

```powershell
node --test "tests/cm-agent-ui-contract.test.js"
npm --prefix frontend run build
```

Expected: both commands exit with code 0.

- [ ] **Step 7: Commit CM preview entry and recovery feedback**

```powershell
git add "frontend/src/shared/api/client.js" "frontend/src/shared/api/agent.js" "frontend/src/shared/pet/StackyPet.jsx" "frontend/src/shared/styles/global.css" "tests/cm-agent-ui-contract.test.js"
git commit -m "feat: add CM revision preview and recovery actions"
```

### Task 3: Add script-page preview, confirm, and one-step undo

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx:1-490,740-890`
- Modify: `frontend/src/shared/styles/global.css:existing script styles`
- Modify: `tests/cm-agent-ui-contract.test.js`
- Modify: `tests/script-draft-persistence-contract.test.js`

**Consumes:** `PET_PREVIEW_EVENT` and the event payload from Task 1; preview request from Task 2; existing `updateOutputDraft(nextOutput)` persistence behavior.

**Produces:** Preview modal, explicit apply/discard behavior, in-memory one-step undo, and preserved output after generation failure.

- [ ] **Step 1: Write failing page contract tests**

Add assertions in `tests/cm-agent-ui-contract.test.js` and `tests/script-draft-persistence-contract.test.js` for:

```js
assert.match(scriptPage, /PET_PREVIEW_EVENT/);
assert.match(scriptPage, /const \[revisionPreview, setRevisionPreview\] = useState/);
assert.match(scriptPage, /const \[previousOutput, setPreviousOutput\] = useState\(''\)/);
assert.match(scriptPage, /title="CM 修改预览"/);
assert.match(scriptPage, /onOk=\{applyRevisionPreview\}/);
assert.match(scriptPage, /撤销本次修改/);
assert.match(scriptPage, /function undoLastRevision\(\)/);
assert.doesNotMatch(scriptPage, /setOutput\(''\);\s*setGenerationStage\('error'\)/);
```

- [ ] **Step 2: Run contract tests to verify they fail**

Run:

```powershell
node --test "tests/cm-agent-ui-contract.test.js" "tests/script-draft-persistence-contract.test.js"
```

Expected: FAIL because preview state, undo, and retained-output handling are absent.

- [ ] **Step 3: Add preview state and listener in ScriptPage**

Update the pet import to include `PET_PREVIEW_EVENT`. Add state immediately after `output`:

```js
const [revisionPreview, setRevisionPreview] = useState({ open: false, summary: '', currentOutput: '', candidateOutput: '' });
const [previousOutput, setPreviousOutput] = useState('');
```

Replace the current `PET_APPLY_EVENT` listener with a `PET_PREVIEW_EVENT` listener that validates candidate text and snapshots the current output only into preview state:

```js
useEffect(() => {
  function openRevisionPreview(event) {
    const candidateOutput = String(event.detail?.candidateOutput || '').trim();
    if (!output.trim() || !candidateOutput) return;
    setRevisionPreview({
      open: true,
      summary: String(event.detail?.summary || '').trim(),
      currentOutput: output,
      candidateOutput
    });
  }
  window.addEventListener(PET_PREVIEW_EVENT, openRevisionPreview);
  return () => window.removeEventListener(PET_PREVIEW_EVENT, openRevisionPreview);
}, [output]);
```

Do not write `candidateOutput` through `updateOutputDraft` from this listener.

- [ ] **Step 4: Implement confirm, cancel, and one-step undo actions**

Add these functions before JSX:

```js
function closeRevisionPreview() {
  setRevisionPreview({ open: false, summary: '', currentOutput: '', candidateOutput: '' });
}

function applyRevisionPreview() {
  const nextOutput = revisionPreview.candidateOutput.trim();
  if (!nextOutput) return;
  setPreviousOutput(output);
  updateOutputDraft(nextOutput);
  setEditingOutput(true);
  closeRevisionPreview();
  message.success('CM 的修改稿已应用，可撤销一次。');
}

function undoLastRevision() {
  if (!previousOutput) return;
  updateOutputDraft(previousOutput);
  setEditingOutput(true);
  setPreviousOutput('');
  message.success('已撤销 CM 的本次修改。');
}
```

Use the live `output` when applying so a user cannot overwrite intervening edits silently; before applying, require `revisionPreview.currentOutput === output`. If it differs, close the preview and show `message.warning('当前剧本已变化，请重新让 CM 生成修改稿。')`.

- [ ] **Step 5: Render preview modal and undo button**

In the existing script toolbar, add after the edit control:

```jsx
<Button onClick={undoLastRevision} disabled={!previousOutput}>撤销本次修改</Button>
```

Add an Ant Design `Modal` near other page modals:

```jsx
<Modal
  title="CM 修改预览"
  open={revisionPreview.open}
  onCancel={closeRevisionPreview}
  onOk={applyRevisionPreview}
  okText="应用修改"
  cancelText="放弃修改"
  width={1100}
>
  {revisionPreview.summary ? <Typography.Paragraph>{revisionPreview.summary}</Typography.Paragraph> : null}
  <div className="cm-revision-preview">
    <section>
      <Typography.Title level={5}>当前剧本</Typography.Title>
      <Input.TextArea value={revisionPreview.currentOutput} rows={24} readOnly />
    </section>
    <section>
      <Typography.Title level={5}>CM 修改稿</Typography.Title>
      <Input.TextArea value={revisionPreview.candidateOutput} rows={24} readOnly />
    </section>
  </div>
</Modal>
```

Add CSS:

```css
.cm-revision-preview { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.cm-revision-preview section { min-width: 0; }
.cm-revision-preview textarea { font-family: inherit; }
@media (max-width: 760px) { .cm-revision-preview { grid-template-columns: 1fr; } }
```

- [ ] **Step 6: Preserve existing script output on generation failure**

In `generateOutput()` remove only `setOutput('');` from the `catch` path. Keep `generationStage='error'`, page feedback, and pet error animation. This preserves prior draft/output while signaling the failed request.

- [ ] **Step 7: Run page contracts and build**

Run:

```powershell
node --test "tests/cm-agent-ui-contract.test.js" "tests/script-draft-persistence-contract.test.js"
npm --prefix frontend run build
```

Expected: both commands exit with code 0.

- [ ] **Step 8: Commit the safe apply workflow**

```powershell
git add "frontend/src/user/pages/ScriptPage.jsx" "frontend/src/shared/styles/global.css" "tests/cm-agent-ui-contract.test.js" "tests/script-draft-persistence-contract.test.js"
git commit -m "feat: preview and undo CM script revisions"
```

### Task 4: Verify server context, regression suite, and end-to-end behavior

**Files:**
- Modify: `tests/agent-routes.test.js:304-569`
- Modify: `tests/cm-agent-ui-contract.test.js`

**Consumes:** All renderer contracts from Tasks 1–3 and existing Agent router bounded-context behavior.

**Produces:** Regression coverage proving current script fields reach the responder transiently, sensitive values do not, and the reviewed workflow remains wired.

- [ ] **Step 1: Add a failing server regression test for the exact CM script payload**

In `tests/agent-routes.test.js`, add a test that posts context shaped exactly like `normalizePetContext()` output:

```js
test('Agent receives transient sanitized CM script context with all revision fields', async t => {
  let context;
  const { app, systemDir } = createFixture(t, {
    responder: async ({ context: received }) => {
      context = received;
      return '修改说明\n【修改稿】\n完整候选剧本';
    }
  });
  const loginResult = await login(app, 'choushiyiguai1');
  const task = await createTask(app, loginResult.body.token);
  const result = await request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token: loginResult.body.token,
    body: {
      taskId: task.id,
      prompt: '加强第三场冲突',
      context: {
        page: '剧本生成', pagePath: '/script',
        novelText: 'NOVEL_MARKER',
        extracted: { character: '角色A', nested: { apiKey: 'hidden', scene: '场景A' } },
        scriptOutput: 'SCRIPT_MARKER',
        entities: { hasOutput: true }
      }
    }
  });
  assert.equal(result.status, 200);
  assert.match(context.novelText, /NOVEL_MARKER/);
  assert.match(context.scriptOutput, /SCRIPT_MARKER/);
  assert.match(JSON.stringify(context.extracted), /角色A/);
  assert.doesNotMatch(JSON.stringify(context), /hidden|apiKey/i);
  const persisted = fs.readFileSync(path.join(systemDir, 'users', 'choushiyiguai1', 'agent-tasks.json'), 'utf8');
  assert.doesNotMatch(persisted, /NOVEL_MARKER|SCRIPT_MARKER|角色A/);
});
```

- [ ] **Step 2: Run focused tests to verify the new regression test passes**

Run:

```powershell
node --test "tests/agent-routes.test.js" "frontend/src/shared/pet/stacky.test.js" "frontend/src/shared/pet/scriptCollaboration.test.js" "tests/cm-agent-ui-contract.test.js" "tests/script-draft-persistence-contract.test.js"
```

Expected: PASS.

- [ ] **Step 3: Run complete repository verification**

Run:

```powershell
node --test "tests/*.test.js" "lib/*.test.js"
npm --prefix frontend run build
```

Expected: both commands exit with code 0. If an unrelated pre-existing test fails, record its exact name and output; do not alter unrelated product behavior to silence it.

- [ ] **Step 4: Perform manual acceptance flow**

1. Start the application with `npm start` and frontend with `npm --prefix frontend run dev` if not already running.
2. Log in, open `/script`, create or restore a non-empty script, and open CM.
3. Ask CM: `第三场冲突不够强，给我完整修改稿。`
4. Confirm the CM message shows `预览修改`, and opening it does not change the editor content.
5. Confirm the modal displays current and candidate scripts, `放弃修改` leaves the editor unchanged, and `应用修改` replaces it and enables `撤销本次修改`.
6. Confirm undo restores the exact prior script and becomes disabled afterward.
7. Simulate an invalid model key and a network/timeout failure; confirm CM offers `打开模型设置` or `重新发送`, no duplicate global modal appears for the CM request, and existing script output remains visible.
8. Trigger script generation failure with an existing output; confirm the prior output remains visible.

- [ ] **Step 5: Commit regression coverage**

```powershell
git add "tests/agent-routes.test.js" "tests/cm-agent-ui-contract.test.js"
git commit -m "test: cover CM script collaboration flow"
```
