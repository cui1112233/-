# 小说生产正文编辑与下载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在小说详情的正文区域提供生产内容编辑入口和当前有效正文 TXT 下载。

**Architecture:** 详情视图继续使用已有的生产内容编辑弹窗与保存链路。新增浏览器下载帮助函数，只接收标题与当前有效正文，生成本地 UTF-8 文件；不调用原文或 121 接口。

**Tech Stack:** React、Ant Design、Blob/URL API、Node test runner。

## Global Constraints

- 编辑只保存 `working-front-content` 和 `productionContentMode`，不得写入 `sourceText`。
- 下载当前有效生产正文；无正文时禁用下载。
- 不新增后端接口，也不得发起 121 上传请求。

---

### Task 1: TXT 下载帮助函数

**Files:**
- Create: `frontend/src/user/pages/shuihuo/batchFactoryContentDownload.js`
- Test: `frontend/src/user/pages/BatchFactoryNovelList.layout.test.js`

**Interfaces:**
- Produces: `downloadProductionContent({ title, content, documentRef, urlApi }) => boolean`。

- [ ] **Step 1: Write failing test**

```js
test('downloads the current production content as a UTF-8 TXT file', async () => {
  const { downloadProductionContent } = await import('./shuihuo/batchFactoryContentDownload.js');
  const clicks = []; const urls = []; const link = { click: () => clicks.push(link), remove: () => {} };
  const ok = downloadProductionContent({ title: '野藤盛开', content: '可下载的生产正文', documentRef: { createElement: () => link, body: { appendChild: () => {} } }, urlApi: { createObjectURL: blob => { urls.push(blob); return 'blob:book'; }, revokeObjectURL: url => urls.push(url) } });
  assert.equal(ok, true); assert.equal(link.download, '野藤盛开-生产正文.txt');
  assert.equal(await urls[0].text(), '可下载的生产正文'); assert.equal(clicks.length, 1);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm --prefix frontend run test -- --test-name-pattern='downloads the current production content'`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement minimal helper**

```js
export function downloadProductionContent({ title, content, documentRef = document, urlApi = URL }) {
  const text = String(content || '').trim(); if (!text) return false;
  const url = urlApi.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = documentRef.createElement('a'); link.href = url;
  link.download = `${String(title || '小说').trim() || '小说'}-生产正文.txt`;
  documentRef.body?.appendChild?.(link); link.click(); link.remove?.(); urlApi.revokeObjectURL(url); return true;
}
```

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm --prefix frontend run test -- --test-name-pattern='downloads the current production content'`

Expected: PASS.

Commit: `git add frontend/src/user/pages/shuihuo/batchFactoryContentDownload.js frontend/src/user/pages/BatchFactoryNovelList.layout.test.js && git commit -m "feat(shuihuo): add production-content TXT download"`

### Task 2: 小说详情正文操作区

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`
- Modify: `frontend/src/user/pages/BatchFactoryNovelList.layout.test.js`

**Interfaces:**
- Consumes: Task 1 `downloadProductionContent` 和现有 `openContentEditor(book)`。
- Produces: “编辑正文”“下载 TXT”按钮。

- [ ] **Step 1: Write failing UI contract test**

```js
test('book detail exposes production-content edit and TXT download actions', () => {
  const source = readFileSync(new URL('./shuihuo/BatchFactoryNovelList.jsx', import.meta.url), 'utf8');
  assert.match(source, /编辑正文/); assert.match(source, /下载 TXT/);
  assert.match(source, /downloadProductionContent\(/); assert.match(source, /openContentEditor\(viewingBook\)/);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm --prefix frontend run test -- --test-name-pattern='book detail exposes production-content'`

Expected: FAIL because the body section lacks those controls.

- [ ] **Step 3: Implement controls**

Import the helper and render both buttons beside “小说正文”. The edit button calls `openContentEditor(viewingBook)`; the download button passes the same effective text displayed in `<pre>`, and disables when absent.

- [ ] **Step 4: Verify and commit**

Run: `npm --prefix frontend run test`

Expected: PASS.

Run: `npm --prefix frontend run build`

Expected: Vite build succeeds.

Commit: `git add frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx frontend/src/user/pages/BatchFactoryNovelList.layout.test.js && git commit -m "feat(shuihuo): expose production content actions"`
