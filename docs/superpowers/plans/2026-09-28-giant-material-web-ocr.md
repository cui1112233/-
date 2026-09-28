# 巨量素材网页 OCR Implementation Plan

> **For agentic workers:** Use executing-plans inline for this user-authorized continuation; no delegation is requested.

**Goal:** 点击 `/giant-material-test` 的“开始读取”后自动返回视频正文初稿。

**Architecture:** 复用已验证的素材解析接口，在本机内存中保存已解析素材；新增回环专用 NDJSON OCR 接口，只接受巨量 ID，从内存记录取得可信视频地址。macOS AVFoundation 流式解码、Vision 本地中文 OCR、相邻画面去重；前端显示进度、正文、复制与下载。

**Tech Stack:** Node、Vite、React、macOS AVFoundation/Vision、Swift Command Line Tools。

## Global Constraints

- 本次只交付本机测试页，不写正式批量工厂书籍、不推送公网。
- 令牌只用于青语解析请求，OCR 子进程不继承令牌。
- 不保存 MP4、帧图片或逐帧 OCR 文件；正文保留在本次响应及页面内存。
- 一次只运行一个提取任务；取消、断开及十分钟超时停止子进程。
- 视频必须为青语已返回的 HTTPS `material.hnqingyuwen.top` 地址。
- 最长支持 1800 秒视频，以 2 秒间隔抽帧。当前适配已验证的滚屏布局，输出均为需要校对的 OCR 初稿。
- 巨量 ID 不代表书籍关联唯一。展示所有关联书籍；不自动选第一本。
- 视频片段不等于平台整本小说，页面必须明确说明。

### Task 1: Native streaming extractor

**Files:** `lib/giant-material/scroll-merge.mjs`, `scroll-extractor.mjs`, `scroll-video-ocr.swift`, and colocated `.test.mjs` files.

**Interfaces:** `appendFrame(body, previous, next)` returns merged text and overlap evidence. `filterFrameLines(frame)` removes only the measured screen-border and overlay regions. `extractScrollText(material, {signal,onProgress})` returns `{text,characters,frames,durationSeconds,issues,frameReadFailures,requiresProofreading:true,sourceCompleteness:'video_excerpt'}`. Progress contains numeric counters only.

- [x] Promote the five independently verified merge tests. Add crop and invalid URL/duration/abort tests first.

```js
assert.equal(filterFrameLines({seconds:26,lines:[{text:'页脚',y:0,height:0.02},{text:'正文',y:0.5,height:0.03}]}), '正文');
assert.throws(()=>validateMaterial({videoUrl:'http://127.0.0.1/a.mp4',durationSeconds:281}), {code:'OCR_VIDEO_NOT_ALLOWED'});
```

- [x] Run `node --test lib/giant-material/*.test.mjs`, observe missing interface failures, implement adapters around the proven native extraction, and rerun.
- [x] Assert unknown/failed frame coverage is reported, not synthesized; cancelled subprocesses cannot emit a complete result.

### Task 2: Loopback streaming API

**Files:** `frontend/vite.config.js`, `frontend/vite.config.test.js`.

**Interfaces:** `createGiantMaterialTestHandler({onResolved})` adds a metadata callback. `createGiantMaterialExtractionHandler({getMaterial,extract})` handles `POST /__local/giant-material-test/extract` with `{giantMaterialId}`. Its NDJSON records are `progress`, `complete`, or `error`; only complete includes正文. `getMaterial` is a bounded 20-record, 15-minute metadata cache maintained by the Vite plugin.

- [x] Add behavior tests first: uncached IDs return 409 without OCR; valid cached metadata emits progress then complete; runner errors emit only allowlisted codes; non-loopback callers are rejected; a second concurrent task returns 409.

```js
assert.equal(response.statusCode, 409);
assert.equal(JSON.parse(response.body).code, 'MATERIAL_RESOLVE_REQUIRED');
```

- [x] Implement the handler using existing JSON size checks. Validate cached URL and duration before opening a response stream. Abort on disconnect and timeout; always release the active-task lock.
- [x] Run `node --test frontend/vite.config.test.js lib/giant-material/*.test.mjs`; include source only in the final integration commit.

### Task 3: One-click web flow

**Files:** `frontend/src/user/pages/giantMaterialExtractionClient.js`, corresponding `.test.js`, `GiantMaterialTestPage.jsx`, `giant-material-test.css`.

**Interfaces:** `readExtractionStream(response,onEvent)` decodes split UTF-8 NDJSON and returns only a valid complete result; EOF without completion is `OCR_STREAM_INCOMPLETE`.

- [x] Test split Chinese UTF-8, error records, malformed streams, and missing completion before implementing the parser.
- [x] After existing resolve succeeds, POST the same ID to extract. Preserve successful metadata if OCR fails. Keep button busy throughout OCR, provide cancellation, and abort fetch on unmount.
- [x] Display progress, character count, readable textarea, copy and TXT download. Explain video-only scope and OCR proofreading. Do not add batch registration.
- [x] Run targeted tests and build to a temporary directory outside tracked `frontend/dist`.
- [x] Use the real webpage to submit `7689285397448523826`; wait for nonempty正文, verify opening/ending and both book records. Save a screenshot of the actual result. Do not read a pre-generated TXT as a replacement for live OCR.
- [ ] Commit and fast-forward into local `v88`, preserving prior generated artifacts and unrelated changes. No push or public deployment.

## Verification evidence

- Targeted suite: 31/31 tests passed. Existing frontend default suite: 30/30 passed.
- Vite production build succeeded using a temporary output directory; existing brand-image warnings remain.
- Real IAB form submission returned 141 frames and 4,220 non-whitespace characters, with zero reported frame failures or unaligned boundaries. Both associated platform book IDs remained visible.
- Opening: `我没有正常的心理认知。`; ending: `从现在起，该轮到我教他什么 / 叫规矩了。` The result remains an OCR draft, not verified platform full text.
- Real Chrome cancellation left successful metadata intact and no OCR child process running. Retrying via the actual button again returned 141 frames / 4,220 characters.
- Browser automation did not return a Blob-download event, including Chrome. The real Chrome click nevertheless saved `/Users/ming/Downloads/7689285397448523826-OCR.txt` (13,002 bytes); filesystem comparison confirmed it equals the verified OCR text. This is download evidence, not merely an implemented button.
- Chrome copy button displayed `已复制正文`, with no console errors.
- Independent read-only review identified an unknown-coverage gap for empty/cropped OCR frames. A first-failing regression now verifies `emptyBodyFrames` timestamps and count; UI explains possible blank/advertisement/unrecognized text separately from frame failures. Follow-up review found no remaining Critical or Important issue within the Mac prototype scope.
