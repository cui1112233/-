# Issue Log Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the user-facing `/issues` page a theme-safe operational timeline that helps users identify automatic failures without changing error collection or ownership rules.

**Architecture:** Keep `IssueLogPage` as the view-level owner of its already merged error-log and novel-panel diagnostic data. Add local presentation helpers for severity, status and three summary counters, then render semantic HTML timeline elements. Scope all visual rules under `.issue-log-page` and use existing `--legacy-*` tokens so both themes inherit the platform palette.

**Tech Stack:** React 18, Ant Design, lucide-react, CSS custom properties, Node built-in test runner, Vite.

---

### Task 1: Lock the timeline UI contract with a failing test

**Files:**
- Modify: `tests/error-logging.test.js:139-169`
- Verify: `tests/theme-readability-contract.test.js`

- [x] **Step 1: Write the failing user issue-log timeline contract test**

Append this test to `tests/error-logging.test.js`:

```js
test('user issue log renders a compact operational timeline with severity and summary contracts', () => {
  const page = read('frontend/src/user/pages/IssueLogPage.jsx');
  const css = read('frontend/src/shared/styles/global.css');

  assert.match(page, /function severityForEntry\(entry\)/);
  assert.match(page, /function summarizeEntries\(entries, now = Date\.now\(\)\)/);
  assert.match(page, /issue-log-summary-grid/);
  assert.match(page, /最近 24 小时异常/);
  assert.match(page, /接口失败/);
  assert.match(page, /认证或配置问题/);
  assert.match(page, /issue-log-timeline/);
  assert.match(page, /issue-log-entry--\$\{severityForEntry\(entry\)\}/);
  assert.match(page, /HTTP \{entry\.status\}/);
  assert.match(page, /novel-panel\.ai/);
  assert.match(css, /\.issue-log-page\s*\{/);
  assert.match(css, /\.issue-log-entry--warning/);
  assert.match(css, /\.issue-log-entry--error/);
  assert.match(css, /\.issue-log-meta\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\[data-theme='light'\] \.issue-log-page/);
});
```

- [x] **Step 2: Run test to verify it fails for missing timeline structure**

Run:

```bash
node --test tests/error-logging.test.js
```

Expected: the new `user issue log renders...` test fails because `severityForEntry`, summary cards and timeline selectors do not exist yet. Existing tests remain green.

- [ ] **Step 3: Commit the red test when working in a clean, dedicated change set**

```bash
git add tests/error-logging.test.js
git commit -m "test: define issue log timeline contract"
```

Do not stage or commit unrelated pre-existing changes in the dirty worktree.

### Task 2: Render readable severity-aware timeline content

**Files:**
- Modify: `frontend/src/user/pages/IssueLogPage.jsx:1-72`
- Test: `tests/error-logging.test.js`

- [x] **Step 1: Update imports and normalize novel-panel diagnostic presentation**

Replace the imports and `diagnosticEntry` return fields so visual metadata is explicit:

```jsx
import { Button, Empty, Tag, Typography, message } from 'antd';
import { Bug, KeyRound, RefreshCw, ServerCrash } from 'lucide-react';

function diagnosticEntry(entry) {
  const status = Number.isInteger(entry.http_status) ? entry.http_status : null;
  return {
    id: `novel-panel:${entry.id}`,
    kind: 'novel-panel.ai',
    message: entry.gate_summary || '小说面板 AI 请求记录',
    at: entry.at,
    path: entry.operation ? `小说面板 / ${entry.operation}` : '小说面板',
    method: entry.outcome || 'AI 诊断',
    status,
  };
}
```

- [x] **Step 2: Add local severity, status and summary helpers below `diagnosticEntry`**

```jsx
function severityForEntry(entry) {
  if (entry.status === 401 || entry.status === 403) return 'warning';
  if (entry.kind === 'client.api-network' || (Number.isInteger(entry.status) && entry.status >= 400)) return 'error';
  return 'neutral';
}

function entryIcon(entry) {
  const severity = severityForEntry(entry);
  if (severity === 'warning') return <KeyRound size={17} aria-hidden="true" />;
  if (severity === 'error') return <ServerCrash size={17} aria-hidden="true" />;
  return <Bug size={17} aria-hidden="true" />;
}

function summarizeEntries(entries, now = Date.now()) {
  const dayAgo = now - 24 * 60 * 60 * 1000;
  return entries.reduce((summary, entry) => ({
    recent: summary.recent + (new Date(entry.at).getTime() >= dayAgo ? 1 : 0),
    api: summary.api + (entry.kind === 'client.api-response' || entry.kind === 'client.api-network' || entry.kind === 'novel-panel.ai' ? 1 : 0),
    access: summary.access + (entry.status === 401 || entry.status === 403 ? 1 : 0),
  }), { recent: 0, api: 0, access: 0 });
}
```

- [x] **Step 3: Replace the `List` block with overview and timeline markup**

Immediately before `return`, define `const summary = summarizeEntries(entries);`. Replace the current conditional `<List>` with:

```jsx
{entries.length ? <>
  <div className="issue-log-summary-grid" aria-label="异常概览">
    <div className="issue-log-summary-card"><span>最近 24 小时异常</span><strong>{summary.recent}</strong></div>
    <div className="issue-log-summary-card"><span>接口失败</span><strong>{summary.api}</strong></div>
    <div className="issue-log-summary-card"><span>认证或配置问题</span><strong>{summary.access}</strong></div>
  </div>
  <ol className="issue-log-timeline" aria-label="按发生时间排列的问题日志">
    {entries.map(entry => <li className={`issue-log-entry issue-log-entry--${severityForEntry(entry)}`} key={entry.id}>
      <span className="issue-log-marker">{entryIcon(entry)}</span>
      <article className="issue-log-entry-card">
        <div className="issue-log-entry-topline">
          <div><span className="issue-log-kind">{readableKind(entry.kind)}</span><time dateTime={entry.at}>{formatTime(entry.at)}</time></div>
          {Number.isInteger(entry.status) ? <Tag className="issue-log-status">HTTP {entry.status}</Tag> : <Tag className="issue-log-status">{entry.method || '系统记录'}</Tag>}
        </div>
        <p className="issue-log-message">{entry.message}</p>
        <div className="issue-log-meta">
          {entry.path ? <span>{entry.path}</span> : null}
          {entry.method && Number.isInteger(entry.status) ? <span>{entry.method}</span> : null}
        </div>
      </article>
    </li>)}
  </ol>
</> : <Empty description={loading ? '正在读取问题日志' : '暂时没有问题日志'} />}
```

Keep `loadEntries()` unchanged: it must continue using `Promise.allSettled`, preserve API errors when diagnostics fail, merge `listMyErrorLogs()` with `listNovelPanelAiDiagnostics()`, and sort by `at` descending.

- [x] **Step 4: Run the focused test to verify the UI contract passes**

Run:

```bash
node --test tests/error-logging.test.js
```

Expected: all error-log tests pass, including the new timeline contract.

- [ ] **Step 5: Commit the presentation change when working in a clean, dedicated change set**

```bash
git add frontend/src/user/pages/IssueLogPage.jsx tests/error-logging.test.js
git commit -m "feat: render user issue logs as a timeline"
```

### Task 3: Add scoped, theme-safe timeline styling

**Files:**
- Modify: `frontend/src/shared/styles/global.css:1914-1918`
- Test: `tests/error-logging.test.js`, `tests/theme-readability-contract.test.js`

- [x] **Step 1: Add scoped issue-log CSS after `.utility-page`**

```css
.issue-log-page {
  display: block !important;
  max-width: 1080px;
  width: 100%;
  margin: 0 auto;
  color: var(--legacy-text);
  --issue-log-warning: #f2b65a;
  --issue-log-warning-border: rgba(242, 182, 90, 0.46);
  --issue-log-warning-soft: rgba(242, 182, 90, 0.12);
  --issue-log-error: #ff757d;
  --issue-log-error-border: rgba(255, 117, 125, 0.48);
  --issue-log-error-soft: rgba(255, 117, 125, 0.12);
}

.issue-log-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 22px; }
.issue-log-heading .ant-typography { color: var(--legacy-text); }
.issue-log-heading .ant-typography-paragraph { max-width: 680px; margin-bottom: 0; color: var(--legacy-muted); }
.issue-log-actions { flex: 0 0 auto; }
.issue-log-summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
.issue-log-summary-card { display: grid; gap: 7px; min-height: 102px; padding: 17px 18px; border: 1px solid var(--legacy-border); border-radius: 8px; background: var(--legacy-card); }
.issue-log-summary-card span { color: var(--legacy-muted); font-size: 13px; }
.issue-log-summary-card strong { color: var(--legacy-text); font-size: 30px; line-height: 1; font-variant-numeric: tabular-nums; }
.issue-log-timeline { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.issue-log-entry { position: relative; display: grid; grid-template-columns: 42px minmax(0, 1fr); padding-bottom: 16px; }
.issue-log-entry:not(:last-child)::before { position: absolute; top: 42px; bottom: 0; left: 20px; width: 1px; background: var(--legacy-border-strong); content: ''; }
.issue-log-marker { position: relative; z-index: 1; display: grid; place-items: center; width: 42px; height: 42px; color: var(--legacy-muted); border: 1px solid var(--legacy-border-strong); border-radius: 50%; background: var(--legacy-card); }
.issue-log-entry-card { min-width: 0; padding: 15px 17px; border: 1px solid var(--legacy-border); border-radius: 8px; background: var(--legacy-card); }
.issue-log-entry-topline { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.issue-log-entry-topline > div { display: grid; gap: 4px; min-width: 0; }
.issue-log-kind { color: var(--legacy-text); font-size: 14px; font-weight: 700; }
.issue-log-entry time, .issue-log-meta { color: var(--legacy-muted); font-size: 12px; }
.issue-log-message { margin: 12px 0 10px; color: var(--legacy-text); line-height: 1.6; overflow-wrap: anywhere; }
.issue-log-meta { display: flex; flex-wrap: wrap; gap: 8px 14px; overflow-wrap: anywhere; }
.issue-log-status { flex: 0 0 auto; margin: 0 !important; color: var(--legacy-text) !important; border-color: var(--legacy-border-strong) !important; background: var(--legacy-card-hover) !important; font-variant-numeric: tabular-nums; }
.issue-log-entry--warning .issue-log-marker { color: var(--issue-log-warning); border-color: var(--issue-log-warning-border); background: var(--issue-log-warning-soft); }
.issue-log-entry--warning .issue-log-status { color: var(--issue-log-warning) !important; border-color: var(--issue-log-warning-border) !important; background: var(--issue-log-warning-soft) !important; }
.issue-log-entry--error .issue-log-marker { color: var(--issue-log-error); border-color: var(--issue-log-error-border); background: var(--issue-log-error-soft); }
.issue-log-entry--error .issue-log-status { color: var(--issue-log-error) !important; border-color: var(--issue-log-error-border) !important; background: var(--issue-log-error-soft) !important; }

[data-theme='light'] .issue-log-page {
  color: var(--legacy-text);
  --issue-log-warning: #9a5b00;
  --issue-log-warning-border: #efc781;
  --issue-log-warning-soft: #fff7e6;
  --issue-log-error: #b4232f;
  --issue-log-error-border: #f2b6bd;
  --issue-log-error-soft: #fff1f2;
}

@media (max-width: 720px) {
  .issue-log-page { padding: 18px 14px; }
  .issue-log-heading { align-items: stretch; flex-direction: column; gap: 12px; }
  .issue-log-actions { align-self: flex-start; }
  .issue-log-summary-grid { grid-template-columns: 1fr; }
  .issue-log-entry { grid-template-columns: 34px minmax(0, 1fr); }
  .issue-log-marker { width: 34px; height: 34px; }
  .issue-log-entry:not(:last-child)::before { top: 34px; left: 16px; }
  .issue-log-entry-card { padding: 13px; }
  .issue-log-entry-topline { align-items: stretch; flex-direction: column; gap: 8px; }
  .issue-log-status { align-self: flex-start; }
}
```

These variables deliberately live only on `.issue-log-page`; the project has no global warning/danger token family, so this keeps operational state colors isolated and makes both theme variants explicit.

- [x] **Step 2: Verify the scoped severity variables are complete before testing**

Run:

```bash
rg -n -- '--issue-log-(warning|error)' frontend/src/shared/styles/global.css
```

Expected: every severity token used by warning/error marker and status rules is declared on `.issue-log-page`, with light-theme overrides in `[data-theme='light'] .issue-log-page`.

- [x] **Step 3: Run focused contracts and full frontend build**

Run:

```bash
node --test tests/error-logging.test.js tests/theme-readability-contract.test.js
npm --prefix frontend run build
git diff --check
```

Expected: all tests pass, Vite exits `0`, and `git diff --check` prints no whitespace errors.

- [ ] **Step 4: Commit styles when working in a clean, dedicated change set**

```bash
git add frontend/src/shared/styles/global.css tests/error-logging.test.js
git commit -m "style: improve issue log timeline readability"
```

### Task 4: Verify the running interface in both themes

**Files:**
- Verify only: `frontend/src/user/pages/IssueLogPage.jsx`, `frontend/src/shared/styles/global.css`

- [x] **Step 1: Restart the local service and check route response**

Run:

```bash
launchctl kickstart -k gui/$(id -u)/com.ming.qiantie
curl -I http://127.0.0.1:3000/issues
```

Expected: `/issues` responds with HTTP `200`.

- [x] **Step 2: Browser-check the issue log in default and light themes**

At desktop and 390px mobile widths, open `/issues`, then toggle the platform theme. Confirm:

```text
- Header, refresh control, counters, timeline cards and empty state have readable text.
- 401/403 entries use warning treatment; network, 404 and 5xx entries use error treatment.
- Timeline rail stays aligned with its marker and no path/message/status text overlaps or escapes its card.
- Refresh still loads automatic entries; no feedback, filter, delete or manual reporting control appears.
- Browser console has no new error or warning from the page.
```

- [x] **Step 3: Review scoped diff before handoff**

Run:

```bash
git diff -- frontend/src/user/pages/IssueLogPage.jsx frontend/src/shared/styles/global.css tests/error-logging.test.js
git status --short
```

Expected: only intended page, scoped styles, test contract and approved design/plan documents are included; pre-existing unrelated modifications remain untouched.
