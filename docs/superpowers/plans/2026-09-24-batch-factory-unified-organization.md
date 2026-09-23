# Batch Factory Unified Organization Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a batch select and persist one default Video Management System organization, with optional book-level override, upload-dialog prefill, and frozen automation submission.

**Architecture:** Store the selected organization ID in the existing `publishSettings.organization` field. The unified settings form reads the live organization catalog, while book-level settings reuse the same stored field as an explicit override. Submission derives the effective setting in one place: book override, then batch default, then a dialog-only temporary override.

**Tech Stack:** React, Ant Design, Node test runner, V11/V12 compatibility route, existing Video Management System organization API.

## Global Constraints

- Work only from Git branch `v88`; commit source before public deployment.
- Do not alter existing batch, book, media, or Video Management System data during verification.
- Keep gender, style, and tag AI classification independent from organization ownership.
- A missing organization must block upload preparation and automatic publish, but not saving unrelated unified settings.
- Temporary selection in the upload dialog must not persist settings.
- Existing frozen automation `publishSettings.organization` remains authoritative.

---

### Task 1: Make the unified organization selection durable

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.jsx:1-178`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js:1-80`

**Interfaces:**
- Consumes: `get121OrganizationOptions(): Promise<{ organizations: Array<{ id: string, name: string, level: string }> }>` from `shared/api/batchFactoryV11`.
- Produces: `draftPatch.publishSettings.organization: string`, saved by the existing unified-settings save action.

- [ ] **Step 1: Write the failing source-contract test**

```js
test('stores a unified organization selection independently from AI classification fields', () => {
  assert.match(source, /get121OrganizationOptions/);
  assert.match(source, /<b>组织归属<\/b>/);
  assert.match(source, /publishSettings: \{ \.\.\.publish, organization/);
  assert.doesNotMatch(source, /<b>男女频 \/ 风格 \/ 标签<\/b>/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test --test-name-pattern='stores a unified organization' frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js`

Expected: FAIL because the form has no organization catalog request or select field.

- [ ] **Step 3: Implement the smallest durable selector**

```jsx
const [organizations, setOrganizations] = useState([]);
useEffect(() => {
  if (!active || !publishSessionReady) return undefined;
  let alive = true;
  get121OrganizationOptions()
    .then(result => alive && setOrganizations(Array.isArray(result?.organizations) ? result.organizations : []))
    .catch(() => alive && setOrganizations([]));
  return () => { alive = false; };
}, [active, publishSessionReady]);

<label className="batch-factory-engine-field">
  <span><b>组织归属</b><small>批量默认值；单书可覆盖</small></span>
  <Select
    allowClear
    value={publish.organization || undefined}
    placeholder="登录并读取组织目录后选择"
    options={organizations.map(item => ({ value: item.id, label: item.level ? `${item.name}（${item.level}）` : item.name }))}
    onChange={organization => patch({ publishSettings: { ...publish, organization: organization || '' } })}
    disabled={!publishSessionReady}
  />
</label>
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test --test-name-pattern='stores a unified organization' frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the durable unified selector**

```bash
git add frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js
git commit -m "feat(batch-factory): select default organization"
```

### Task 2: Add an explicit per-book organization override

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.jsx:13-18,540-548`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js`

**Interfaces:**
- Consumes: `batch.settingsState.patch.publishSettings.organization` as inherited value and `publish.organization` as book override.
- Produces: book `settingsState.patch.publishSettings.organization`; an empty/absent key means inherit batch default.

- [ ] **Step 1: Write the failing source-contract test**

```js
test('lets a book override only the inherited publish organization', () => {
  assert.match(source, /组织归属/);
  assert.match(source, /publishSettings: \{ \.\.\.publish, organization/);
  assert.match(source, /继承批量组织归属/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test --test-name-pattern='lets a book override only' frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js`

Expected: FAIL because the book publication tab does not render organization selection.

- [ ] **Step 3: Implement book override with catalog passthrough**

```jsx
<InheritedField
  label="组织归属"
  value={publish.organization}
  inherited={inheritedPublish.organization}
  options={(publish.organizations || inheritedPublish.organizations || []).map(item => ({
    value: item.id,
    label: item.level ? `${item.name}（${item.level}）` : item.name
  }))}
  onChange={organization => patch({ publishSettings: { ...publish, organization: organization || '' } })}
/>
```

Show `继承批量组织归属` when the book does not have a saved organization key. Retain all other existing publishing fields.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test --test-name-pattern='lets a book override only' frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the book override**

```bash
git add frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js
git commit -m "feat(batch-factory): support book organization override"
```

### Task 3: Prefill upload from effective settings without persisting dialog edits

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx:1888-2023`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js:830-845`

**Interfaces:**
- Consumes: `effectiveBookSettings(batch, book).publishSettings.organization`.
- Produces: `organizationID` dialog state initialized from the single shared effective organization; per-request `organization` submitted to `submitBookTo121`.

- [ ] **Step 1: Write the failing source-contract test**

```js
test('prefills upload organization from effective settings without saving a dialog override', () => {
  assert.match(source, /const defaultOrganizationID =/);
  assert.match(source, /setOrganizationID\(defaultOrganizationID\)/);
  assert.match(source, /organization: organizationID/);
  assert.doesNotMatch(source, /saveBatchSettings\(.*organizationID/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test --test-name-pattern='prefills upload organization' frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

Expected: FAIL because upload begins with an empty organization ID.

- [ ] **Step 3: Implement deterministic prefill and mixed-book guard**

```jsx
const defaultOrganizationIDs = [...new Set(targetBooks
  .map(book => String(effectiveBookSettings(batch, book).publishSettings?.organization || '').trim())
  .filter(Boolean))];
const defaultOrganizationID = defaultOrganizationIDs.length === 1 ? defaultOrganizationIDs[0] : '';

useEffect(() => {
  if (!mode) return;
  setOrganizationID(defaultOrganizationID);
}, [mode, defaultOrganizationID]);
```

If selected books have different book overrides, show a warning and require one explicit dialog selection. Keep the existing `submitBookTo121(... { organization: organizationID })` request untouched; do not call any settings save API from this component.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test --test-name-pattern='prefills upload organization' frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

Expected: PASS.

- [ ] **Step 5: Commit upload prefill**

```bash
git add frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js
git commit -m "feat(batch-factory): prefill upload organization"
```

### Task 4: Prove frozen automation and full UI regression

**Files:**
- Modify: `routes/batch-factory-v11.test.js:75-80,1450-1485`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js`

**Interfaces:**
- Consumes: `automationPublishSettings(batch, book, frozenSettings)`.
- Produces: server request body `organization: frozenSettings.publishSettings.organization` for running/scheduled automation.

- [ ] **Step 1: Write the failing backend assertion**

```js
test('uses the frozen automation organization instead of a later batch default', () => {
  const batch = { settingsState: { patch: { publishSettings: { organization: 'later-org' } } } };
  const book = { settingsState: { patch: {} } };
  assert.deepEqual(
    automationPublishSettings(batch, book, { publishSettings: { organization: 'frozen-org' } }),
    { organization: 'frozen-org' }
  );
});
```

- [ ] **Step 2: Run the focused backend test and verify it fails only if freeze behavior regressed**

Run: `node --test --test-name-pattern='uses the frozen automation organization' routes/batch-factory-v11.test.js`

Expected: PASS if the established freeze contract already holds; otherwise FAIL and repair only `automationPublishSettings`.

- [ ] **Step 3: Verify all changed source contracts and build**

Run:

```bash
node --test frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js
node --test frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js
node --test --test-name-pattern='prefills upload organization' frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js
node --test --test-name-pattern='uses the frozen automation organization' routes/batch-factory-v11.test.js
npm --prefix frontend run build
```

Expected: changed assertions pass; unrelated existing source-contract failures are reported separately rather than hidden.

- [ ] **Step 4: Commit regression coverage**

```bash
git add routes/batch-factory-v11.test.js frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js
git commit -m "test(batch-factory): cover frozen organization ownership"
```

- [ ] **Step 5: Deploy and verify without submitting a book**

Build and deploy only the frontend update from the committed V88 SHA. On the public batch workbench: open unified configuration, choose an organization, save, reopen upload confirmation, and verify the organization is prefilled. Do not click “确认并上传到 121”. Verify `/api/runtime-build-info` reports the deployed SHA.
