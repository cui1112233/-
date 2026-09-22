# 分镜卡 @人物 / @场景引用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能在单张剧本分镜中输入或插入 `@人物`、`@场景`，并把当前剧本中同名实体的主图补充为视频参考图。

**Architecture:** 在纯前端参考图工具中解析显式 `@名称`，再与现有正文名称匹配结果合并并按图片 URL 去重。分镜卡提供单卡编辑和快捷插入；页面把编辑内容替换回原始剧本文本，现有历史保存、视频请求和参考图开关继续复用。

**Tech Stack:** React、Ant Design、Node `node:test`、现有 `ScriptPage` 分镜工具与 `scriptVideoReferences`。

**Spec:** `docs/superpowers/specs/2026-09-22-script-shot-at-mentions-design.md`

## Global Constraints

- 只匹配当前剧本 `extractInfo.characters` 与 `extractInfo.scenes`，不访问账户或全站资产。
- 只使用实体已选定的 `mainImageUrl`；`@名称` 原文必须保留在视频 `prompt`。
- 保留正文名称自动识别、卡片/单图关闭和 URL 去重。
- 没有匹配资产不得阻止视频生成；H3 与其他模型继续最多发送 9 张参考图。
- 不修改 API、数据库结构、模型配置或部署文件；所有代码先提交到 V88 lineage，禁止直接修改公网。

## Review Focus

- 连续 `@林溪@公司办公室` 与中文标点后的引用应分别识别，不能吞掉相邻引用；由 Task 1 单测覆盖。
- 同名人物和场景必须都保留为引用候选，且 UI 标签显示类型；由 Task 1 单测和 Task 2 渲染断言覆盖。
- 没有主图、未知名称、空 `@` 必须保留原提示词且不向请求加入无效 URL；由 Task 1 单测覆盖。
- 单张图片或整卡被关闭后，显式 `@` 不得绕过关闭状态；由 Task 1 单测覆盖。
- 保存单卡编辑时只能替换原始输出中的目标卡，其他卡及当前选择必须保留；由 Task 2 单测覆盖。

---

### Task 1: 显式引用解析与参考图合并

**Files:**

- Modify: `frontend/src/user/pages/scriptVideoReferences.js:1-121`
- Modify: `frontend/src/user/pages/scriptVideoReferences.test.js:1-140`

**Interfaces:**

- Consumes: `extractInfo.characters`、`extractInfo.scenes`，每个实体通过既有 `entityLabel` 和 `getEntityMedia` 提供名称与主图。
- Produces: `extractShotMentionNames(shotText): string[]` 与 `collectShotReferenceDescriptors(options): Array<{ url, label, type, source }>`。
- Guarantees: `collectShotReferenceImages(options)` 仍只返回经当前卡片关闭状态过滤后的 URL 数组。

- [ ] **Step 1: Write the failing test**

~~~js
test('adds current-script main images named by @mentions and keeps text matches deduplicated', () => {
  const lin = entity('lin', '林溪', [], 'https://img.example/lin.png');
  const office = entity('office', '公司办公室', [], 'https://img.example/office.png');
  assert.deepEqual(
    collectShotReferenceDescriptors({ shotText: '林溪走入@公司办公室，随后@林溪转身。', extractInfo: info([lin], [office]) })
      .map(({ url, source }) => ({ url, source })),
    [
      { url: 'https://img.example/lin.png', source: 'text' },
      { url: 'https://img.example/office.png', source: 'mention' }
    ]
  );
});

test('does not add image URLs for empty, unknown, or no-main-image mentions', () => {
  const lin = entity('lin', '林溪', [], '');
  assert.deepEqual(collectShotReferenceImages({ shotText: '@ @未知 @林溪', extractInfo: info([lin]) }), []);
});
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/user/pages/scriptVideoReferences.test.js`

Expected: FAIL，因为 `@名称` 尚未被解析或并入参考图描述符。

- [ ] **Step 3: Write minimal implementation**

~~~js
export function extractShotMentionNames(shotText) {
  return [...new Set(
    [...String(shotText || '').matchAll(/@([\u4e00-\u9fffA-Za-z0-9_-]+)/g)]
      .map(match => match[1])
  )];
}
~~~

在 `collectShotReferenceDescriptors` 中合并既有正文命中与 `extractShotMentionNames(shotText)` 的人物、场景主图，描述符携带 `source: 'text' | 'mention'`，最终仍以 `url` 去重。保持既有 `disabledImageUrls`、卡片关闭和 `buildScriptVideoPayload` 的参数与上限逻辑不变。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test frontend/src/user/pages/scriptVideoReferences.test.js`

Expected: PASS，主图、逐图禁用、H3/Seedance 请求结构测试均保持通过。

- [ ] **Step 5: Commit**

~~~bash
git add frontend/src/user/pages/scriptVideoReferences.js frontend/src/user/pages/scriptVideoReferences.test.js
git commit -m "feat(script): resolve at-mentions as references"
~~~

### Task 2: 单卡编辑与 @ 快捷插入

**Files:**

- Create: `frontend/src/user/pages/scriptShotCardEdit.js`
- Create: `frontend/src/user/pages/scriptShotCardEdit.test.js`
- Modify: `frontend/src/user/components/ShotOutputCards.jsx:9-52`
- Modify: `frontend/src/user/pages/ScriptPage.jsx:21-28, 330-370, 1391-1424`

**Interfaces:**

- Consumes: 原始 `rawShotCards`、`output`、卡片索引与当前 `extractInfo`。
- Produces: `replaceRawShotCard(output, rawShotCards, cardIndex, nextCard): string`；`ShotOutputCards` 新增 `onEditPrompt(cardIndex)`。
- Guarantees: 编辑写回原始卡片文本，而不是 `buildFinalSegmentCard` 拼接后的展示文本；保存调用 `updateOutputDraft(nextOutput, true)`。

- [ ] **Step 1: Write the failing test**

~~~js
test('replaces only the selected raw shot card while preserving adjacent cards', () => {
  const output = '### 分镜 1\n林溪进门\n\n### 分镜 2\n卫铭回头';
  const cards = ['### 分镜 1\n林溪进门', '### 分镜 2\n卫铭回头'];
  assert.equal(
    replaceRawShotCard(output, cards, 0, '### 分镜 1\n@林溪进门'),
    '### 分镜 1\n@林溪进门\n\n### 分镜 2\n卫铭回头'
  );
});
~~~

增加静态组件契约断言：卡片有“编辑提示词”按钮并回传正确索引；页面保存路径调用 `updateOutputDraft(nextOutput, true)`。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/user/pages/scriptShotCardEdit.test.js`

Expected: FAIL，原因是 `scriptShotCardEdit.js` 与 `replaceRawShotCard` 尚不存在。

- [ ] **Step 3: Write minimal implementation**

~~~js
export function replaceRawShotCard(output, rawShotCards, cardIndex, nextCard) {
  const currentCard = rawShotCards[cardIndex];
  const start = String(output).indexOf(currentCard);
  if (start < 0) return output;
  return output.slice(0, start) + nextCard + output.slice(start + currentCard.length);
}
~~~

在 `ScriptPage` 保存 `editingShotIndex` 与 `editingShotText`。卡片“编辑提示词”操作载入 `rawShotCards[index]`，以 `Modal` 与 `Input.TextArea` 展示。用“@人物”“@场景”菜单从当前 `extractInfo` 插入 `@<名称>` 到文本框光标；用户也可直接键入。保存时调用 `replaceRawShotCard` 和 `updateOutputDraft(nextOutput, true)`。

在 `ShotOutputCards` 中添加“编辑提示词”按钮。参考图标签显示实体类型；显式引用以 `@` 前缀显示，便于区别于正文自动识别。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test frontend/src/user/pages/scriptShotCardEdit.test.js frontend/src/user/pages/scriptVideoReferences.test.js`

Expected: PASS；仅目标卡变更，手动或菜单插入的 `@名称` 都会参与参考图合并。

- [ ] **Step 5: Commit**

~~~bash
git add frontend/src/user/pages/scriptShotCardEdit.js frontend/src/user/pages/scriptShotCardEdit.test.js frontend/src/user/components/ShotOutputCards.jsx frontend/src/user/pages/ScriptPage.jsx
git commit -m "feat(script): edit shot prompts with at-mentions"
~~~

### Task 3: 未匹配反馈、回归和构建验证

**Files:**

- Modify: `frontend/src/user/components/ShotOutputCards.jsx:34-52`
- Modify: `frontend/src/user/pages/scriptVideoReferences.js:82-99`
- Modify: `frontend/src/user/pages/scriptVideoReferences.test.js:1-160`
- Modify: `frontend/src/user/pages/scriptShotCardEdit.test.js:1-100`

**Interfaces:**

- Consumes: `extractShotMentionNames` 与当前实体主图状态。
- Produces: `collectShotReferenceDiagnostics({ shotText, extractInfo }): Array<{ name, reason }>`。
- Guarantees: 诊断不参与 `imageUrls`，不改变视频提交成功路径，也不修改提示词内容。

- [ ] **Step 1: Write the failing test**

~~~js
test('reports unresolved @mentions without adding reference images', () => {
  const lin = entity('lin', '林溪', [], '');
  assert.deepEqual(
    collectShotReferenceDiagnostics({ shotText: '@林溪 @未知', extractInfo: info([lin]) }),
    [
      { name: '林溪', reason: 'missing_main_image' },
      { name: '未知', reason: 'missing_entity' }
    ]
  );
});
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/user/pages/scriptVideoReferences.test.js`

Expected: FAIL，因为 `collectShotReferenceDiagnostics` 尚未定义。

- [ ] **Step 3: Write minimal implementation**

~~~js
export function collectShotReferenceDiagnostics({ shotText, extractInfo } = {}) {
  // 仅遍历 @ 名称：找不到实体时返回 missing_entity；
  // 找到实体却没有 mainImageUrl 时返回 missing_main_image。
  // 不抛错，也不修改 collectShotReferenceImages 的结果。
}
~~~

在卡片参考图区渲染 `@名称：未找到当前剧本素材` 或 `@名称：尚未选择主图`。无诊断时不渲染占位；视频生成按钮与 payload 不读取诊断。

- [ ] **Step 4: Run full verification**

Run: `node --test frontend/src/user/pages/scriptVideoReferences.test.js frontend/src/user/pages/scriptShotCardEdit.test.js frontend/src/user/pages/scriptShotOutput.test.js frontend/src/user/pages/scriptShotVideoTasks.test.js && npm --prefix frontend run build && git diff --check`

Expected: 所有定向 Node 测试通过、前端构建退出码为 0、`git diff --check` 无输出。

- [ ] **Step 5: Commit**

~~~bash
git add frontend/src/user/components/ShotOutputCards.jsx frontend/src/user/pages/scriptVideoReferences.js frontend/src/user/pages/scriptVideoReferences.test.js frontend/src/user/pages/scriptShotCardEdit.test.js
git commit -m "feat(script): show unresolved at-mention assets"
~~~
