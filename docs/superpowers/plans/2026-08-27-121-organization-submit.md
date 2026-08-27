# 121 组织归属提交 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在小说获取的“提交文案与提交方式”中提供来自 121 的组织归属下拉，并在真实提交时使用该账户对应的字段和值。

**Architecture:** 121 组织目录随配置档同步，保存字段名、option 值和显示名；前端只保存选项值。预览和上传均在服务端校验选择仍属于最新目录。

**Tech Stack:** Node.js、Express、原生浏览器 JavaScript、Node test runner、121 HTTP 客户端。

## Global Constraints

- 不写死组织名称、组织值或 121 multipart 字段名。
- 组织归属控件在“提交文案与提交方式”内；两个同步按钮在该区块外。
- 同步批量后台配置同时刷新配置档和组织目录；同步批量风格类型不改组织目录。
- 无会话、目录缺失、未选择或伪造选择均不得发送上传。
- 响应不得返回 cookie、密码或其他凭据。

---

### Task 1: 解析和同步组织目录

**Files:**

- Modify: `routes/batch-rewrite.js:160-190,763-887,1217-1224`
- Test: `tests/batch-rewrite-upload-plan.test.js`

**Interfaces:** `parseTargetOrganizationCatalog(html)` 返回 `{ field_name, options: [{ id, name }] }`；`POST /web-submit/sync-configs` 增加 `organizations`。

- [ ] **Step 1: 写入失败测试**

```js
test('同步后台配置同时同步组织归属', async () => {
  // 121 页面有 <label>组织归属<select name="organization_id">...</select></label>
  assert.deepEqual(response.body.organizations, {
    field_name: 'organization_id', options: [{ id: '7', name: '第一组织' }]
  });
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/batch-rewrite-upload-plan.test.js`

Expected: FAIL，响应没有 `organizations`。

- [ ] **Step 3: 实现最小同步逻辑**

```js
function parseTargetOrganizationCatalog(html) {
  // 仅匹配标签文本含“组织归属”的 select，field_name 取 name 或 id。
  // 丢弃空值和“请选择”占位项。
}
```

在 `sync121Profiles` 内并行读取配置档 API 与 `TARGET_CHECK_PATH`，组织值仍存在才保留 `selected_organization`。

- [ ] **Step 4: 验证并提交**

Run: `node --test tests/batch-rewrite-upload-plan.test.js`

Expected: PASS。

Commit: `git add routes/batch-rewrite.js tests/batch-rewrite-upload-plan.test.js && git commit -m "feat: sync 121 organization catalog"`

### Task 2: 校验选择并向 121 透传字段

**Files:**

- Modify: `lib/target-upload.js:84-109`
- Modify: `routes/batch-rewrite.js:763-835,890-1022`
- Test: `tests/target-upload.test.js`
- Test: `tests/batch-rewrite-upload-plan.test.js`

**Interfaces:** `target.buildUploadFields({ ..., organization })` 消费 `{ field_name, id }`，返回对应 multipart 字段。

- [ ] **Step 1: 写入失败测试**

```js
const fields = buildUploadFields({
  platformId: 3, gender: '女', style: '现代虐文',
  organization: { field_name: 'organization_id', id: '7' }
});
assert.equal(fields.organization_id, '7');

assert.equal(previewWithoutSelection.status, 400);
assert.match(previewWithoutSelection.body.error, /请选择组织归属/);
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/target-upload.test.js tests/batch-rewrite-upload-plan.test.js`

Expected: FAIL，字段和选择校验不存在。

- [ ] **Step 3: 实现最小校验和透传**

```js
function selectedOrganization(cfg) {
  const catalog = normalizeOrganizationCatalog(cfg.organization_catalog);
  const option = catalog.options.find(item => item.id === String(cfg.selected_organization || ''));
  if (!catalog.field_name || !option) throw new Error('请选择组织归属');
  return { field_name: catalog.field_name, id: option.id };
}
```

在上传 `buildUploadFields` 调用中传入 `organization: selectedOrganization(webConfig)`。

- [ ] **Step 4: 验证并提交**

Run: `node --test tests/target-upload.test.js tests/batch-rewrite-upload-plan.test.js`

Expected: PASS。

Commit: `git add lib/target-upload.js routes/batch-rewrite.js tests/target-upload.test.js tests/batch-rewrite-upload-plan.test.js && git commit -m "feat: require 121 organization on submit"`

### Task 3: 渲染提交方式内的组织下拉

**Files:**

- Modify: `frontend/public/batch-rewrite/index.html:505-560`
- Modify: `frontend/public/batch-rewrite/app.js:1460-1745,3268-3270`
- Modify: `frontend/public/batch-rewrite/styles.css`（仅现有布局需要时）
- Test: `tests/batch-rewrite-flow-ui.test.js`

**Interfaces:** `select#webOrganization`；`syncFormToWebSubmitConfig()` 发送 `selected_organization`；配置档同步后重新渲染目录。

- [ ] **Step 1: 写入失败契约测试**

```js
assert.match(html, /id="webOrganization"/);
assert.match(html, /请选择组织归属/);
assert.match(appJs, /selected_organization/);
assert.match(appJs, /syncWebSubmit\("configs"\)/);
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/batch-rewrite-flow-ui.test.js`

Expected: FAIL，组织控件和配置映射不存在。

- [ ] **Step 3: 实现下拉和同步状态**

```html
<label>组织归属
  <select id="webOrganization"><option value="">请选择组织归属</option></select>
</label>
```

在 `syncFormToWebSubmitConfig()` 写入 `selected_organization`；配置档同步成功后重新渲染组织下拉并显示“配置档和组织归属已更新”。

- [ ] **Step 4: 验证并提交**

Run: `node --test tests/batch-rewrite-flow-ui.test.js && npm --prefix frontend run build`

Expected: PASS。

Commit: `git add frontend/public/batch-rewrite/index.html frontend/public/batch-rewrite/app.js frontend/public/batch-rewrite/styles.css tests/batch-rewrite-flow-ui.test.js && git commit -m "feat: select 121 organization in submit settings"`

### Task 4: 集成验证与 Docker 发布

**Files:** 无。

- [ ] **Step 1: 运行完整定向测试**

Run: `node --test tests/target-upload.test.js tests/batch-rewrite-upload-plan.test.js tests/batch-rewrite-flow-ui.test.js`

Expected: PASS。

- [ ] **Step 2: 构建、部署和验证入口**

Run: `npm --prefix frontend run build && bash scripts/deploy-test-docker.sh up`

Run: `curl -fsS http://127.0.0.1:14000/healthz && curl -sS -o /dev/null -w '%{http_code}\\n' http://10.0.101.164:3000/novel-fetch`

Expected: 健康检查成功，小说获取页面返回 `200`。
