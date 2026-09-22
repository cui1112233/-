# 人物参考图 TOS 访问修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留人物图片写入 TOS，同时让公网网页通过站内地址稳定预览新图，并兼容读取旧 TOS 图片。

**Architecture:** 上传和 AI 生图继续先保存本地参考图缓存并同步到 TOS，但接口优先返回站内参考图地址。站内读取接口先读取本地缓存；旧数据中的 TOS URL 通过受限的服务端 TOS 代理读取，禁止代理任意外部地址。前端区分加载中和加载失败状态。

**Tech Stack:** Node.js、Express、React、Ant Design、Node test runner、火山引擎 TOS SDK。

## Global Constraints

- Git `v88` 是唯一维护主线，生产服务器不是源码来源。
- 图片必须继续同步写入 TOS。
- 不把密钥、密码、令牌或供应商凭据写入源码或 Git。
- 不修改其他媒体上传流程。
- 不新增、恢复或修改 `.github/workflows/`。
- 新增代码和错误提示使用通俗中文。

---

### Task 1: 固定接口返回站内地址

**Files:**
- Modify: `routes/novel-panel.js:1010-1034`
- Modify: `routes/novel-panel.js:1129-1225`
- Test: `test/novel-panel-reference-assets.test.js`（若已有同名测试则在原文件追加）

**Interfaces:**
- Consumes: `premiumStore(req).referenceAssetPublicUrl(assetType, assetId, variant)`。
- Produces: 上传和 AI 生图接口的 `url` 始终是站内 `/api/novel-panel/reference-assets/file/...` 地址；TOS 同步继续执行，返回中保留 `storage: "tos"`。

- [ ] **Step 1: 写接口行为测试**

为上传和 AI 生图响应增加断言：即使 `syncReferenceAssetToTos()` 返回了 TOS 签名 URL，响应的 `url` 仍必须等于 `referenceAssetPublicUrl()`，不能是 `https://*.volces.com/...`。

```js
assert.equal(response.body.url, '/api/novel-panel/reference-assets/file/character/hero/source');
assert.equal(response.body.storage, 'tos');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/novel-panel-reference-assets.test.js`

Expected: FAIL，当前实现返回 TOS 签名地址。

- [ ] **Step 3: 做最小修改**

将两个接口中的：

```js
url: tosAsset?.url || assetStore.referenceAssetPublicUrl(...)
```

改为：

```js
url: assetStore.referenceAssetPublicUrl(assetType, assetId, revision)
```

TOS 同步结果只用于判断 `storage: 'tos'`，不再直接暴露给浏览器。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/novel-panel-reference-assets.test.js`

Expected: PASS。

- [ ] **Step 5: 检查变更范围**

Run: `git diff --check`

Expected: 无空白错误，且只涉及参考图接口和对应测试。

---

### Task 2: 增加旧 TOS 图片受限代理

**Files:**
- Modify: `lib/novel-panel/tos-reference-assets.js:46-101`
- Modify: `lib/novel-panel/premium-store.js:191-218`
- Modify: `routes/novel-panel.js:1055-1071`
- Test: `test/tos-reference-assets.test.js`
- Test: `test/reference-asset-public-url.test.js` 或新增 `test/reference-asset-proxy.test.js`

**Interfaces:**
- Consumes: 已保存的旧 TOS URL、当前用户、TOS 配置和服务端 TOS 凭据。
- Produces: `premiumStore` 提供安全的旧 URL 解析和代理读取方法；代理只接受配置的 TOS endpoint/bucket host。

- [ ] **Step 1: 写安全校验测试**

覆盖三种情况：

```js
assert.equal(parseAllowedTosObjectUrl('https://qiantie.tos-cn-beijing.volces.com/reference-assets/user/character/hero/source.png').key, 'reference-assets/user/character/hero/source.png');
assert.throws(() => parseAllowedTosObjectUrl('https://example.com/a.png'), /不支持/);
assert.throws(() => parseAllowedTosObjectUrl('https://qiantie.tos-cn-beijing.volces.com/other-user-secret.png'), /对象地址无效/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/tos-reference-assets.test.js test/reference-asset-proxy.test.js`

Expected: FAIL，因为解析和读取接口尚未提供。

- [ ] **Step 3: 增加 TOS 读取能力**

在 `createTosReferenceAssetStore()` 中增加明确的 `getObject` 能力：

- 使用现有 TOS SDK client 的 `getObject` 方法。
- 只接受当前配置 bucket 和配置 endpoint 对应的对象 key。
- 返回图片字节和 `contentType`。
- 不允许把用户提交的任意 URL直接交给 `fetch`。

在 premium store 中增加 `readLegacyTosAsset(username, value)`：

- 解析 URL 的 host 和 pathname。
- 校验 host 属于当前 TOS bucket host 或配置 endpoint host。
- 校验 key 前缀为 `reference-assets/`。
- 调用 TOS store 读取对象。
- TOS 未配置或读取失败时抛出可识别错误。

- [ ] **Step 4: 接入图片读取路由**

在现有 `GET /reference-assets/file/:assetType/:assetId/:variant` 中：

1. 先按当前逻辑读取本地缓存。
2. 本地文件不存在且请求带有旧 TOS URL 参数时，调用受限 TOS 读取方法。
3. 成功时返回图片字节、正确 `Content-Type` 和私有缓存头。
4. 失败时返回 404 和 `REFERENCE_ASSET_NOT_FOUND`，不返回内部凭据或完整异常堆栈。

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test test/tos-reference-assets.test.js test/reference-asset-proxy.test.js`

Expected: PASS，非法域名和非法对象 key 均被拒绝。

- [ ] **Step 6: 检查安全边界**

Run: `git diff --check`

并确认代码中不存在把用户传入 URL直接传给 `fetch()` 的逻辑。

---

### Task 3: 前端显示图片读取失败

**Files:**
- Modify: `frontend/src/user/components/entityImagePreviewLoader.js`
- Modify: `frontend/src/user/components/EntityImagePanel.jsx`
- Test: `frontend/src/user/components/entityImagePreviewLoader.test.js`

**Interfaces:**
- Consumes: 图片 URL 列表和 `loadReferenceAssetImage()` 的成功或失败结果。
- Produces: 加载器返回成功预览、失败 URL 集合；面板显示成功、加载中或失败三种状态。

- [ ] **Step 1: 写加载器失败测试**

```js
const result = await createEntityImagePreviewLoader(['ok', 'bad'], {
  loadImage: async url => {
    if (url === 'bad') throw new Error('404');
    return new Blob(['image']);
  },
  createObjectUrl: () => 'blob:ok',
  revokeObjectUrl: () => {}
}).promise;
assert.deepEqual(result.previews, { ok: 'blob:ok' });
assert.deepEqual(result.failed, ['bad']);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend; npm test -- --runInBand`（按项目现有测试脚本调整参数）

Expected: FAIL，因为当前加载器只返回成功映射。

- [ ] **Step 3: 修改加载器保留失败信息**

保持现有逐图加载行为，不让一张坏图阻塞其他图片；返回：

```js
{ previews: { ... }, failed: ['url'] }
```

保留现有 `cancel()` 和对象 URL 回收逻辑。

- [ ] **Step 4: 修改面板状态**

增加 `failedPreviewUrls` 状态：

- 主图 URL 在失败集合中时显示“图片读取失败，请重新上传”。
- 缩略图失败时显示失败占位，不再一直显示 Spin。
- 上传成功后清除对应失败状态。

- [ ] **Step 5: 运行前端测试**

Run: `cd frontend; npm test`

Expected: PASS。

---

### Task 4: 回归验证与构建

**Files:**
- Modify: 仅在前面任务需要时修改相关测试文件。
- Do not modify: `.github/workflows/`。

- [ ] **Step 1: 运行 Node 参考图测试**

Run: `node --test test/tos-reference-assets.test.js test/reference-asset-public-url.test.js test/novel-panel-reference-assets.test.js`

Expected: 全部 PASS。

- [ ] **Step 2: 运行前端测试和构建**

Run: `cd frontend; npm test`

Run: `cd frontend; npm run build`

Expected: 测试通过，构建退出码为 0。

- [ ] **Step 3: 检查最终差异**

Run: `git diff --check`

确认最终 diff 只包含参考图上传、TOS 代理、前端预览状态及测试文件。

- [ ] **Step 4: 人工公网验收**

使用 `http://115.190.156.223:3000/script`：

1. 打开人物编辑窗口。
2. 上传 PNG/JPG/WebP 图片。
3. 确认主图正常显示。
4. 确认浏览器网络请求的新图片地址是本站 `/api/novel-panel/reference-assets/file/...`，不是 TOS 临时 URL。
5. 确认 TOS 中仍有对应对象。
6. 用已有旧人物图片验证：能读则显示，不能读则显示“图片读取失败，请重新上传”。

- [ ] **Step 5: 记录提交信息**

按照仓库 `v88` 规则，完成测试后先提交 Git，再决定是否发布公网；不直接修改正在运行的服务器文件。
