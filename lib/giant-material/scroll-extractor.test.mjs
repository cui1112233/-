import test from 'node:test';
import assert from 'node:assert/strict';
import * as extractor from './scroll-extractor.mjs';

const line = (text, y = .5, height = .04) => ({ text, y, height });
test('validates the cached video domain and bounded duration', () => {
  assert.equal(extractor.validateMaterial({ videoUrl: 'https://material.hnqingyuwen.top/a.mp4', durationSeconds: 281 }).durationSeconds, 281);
  for (const videoUrl of ['http://material.hnqingyuwen.top/a', 'https://evil.example/a', 'https://user:secret@material.hnqingyuwen.top/a']) {
    assert.throws(() => extractor.validateMaterial({ videoUrl, durationSeconds: 281 }), { code: 'OCR_VIDEO_NOT_ALLOWED' });
  }
  assert.throws(() => extractor.validateMaterial({ videoUrl: 'https://material.hnqingyuwen.top/a', durationSeconds: 1801 }), { code: 'OCR_DURATION_NOT_SUPPORTED' });
});
test('removes clipped borders and known promotional overlays, not body text', () => {
  const text = extractor.filterFrameLines({ seconds: 26, lines: [line('章节标题', .916, .083), line('正常正文'), line('底部截断', .07), line('本故事纯属虚构', .2), line('点击下方链接', .4)] });
  assert.equal(text, '正常正文');
});
test('collects scrolling frames into a draft with numeric progress and review issues', async () => {
  const overlap = '姥姥怕我长大进去尝试改变我的想法发现无用无奈妥协老话说得好事不过三';
  async function* frames() {
    yield { seconds: 0, lines: [line('我没有正常的心理认知。' + overlap)] };
    yield { seconds: 2, lines: [line(overlap + '新的正文')] };
    yield { seconds: 4, error: 'FRAME_READ_FAILED' };
    yield { seconds: 6, lines: [line('没有重叠也要保留的段落')] };
  }
  const progress = [];
  const result = await extractor.collectScrollText(frames(), { durationSeconds: 8, onProgress: event => progress.push(event) });
  assert.equal(result.frames, 4);
  assert.equal(result.text, '我没有正常的心理认知。' + overlap + '新的正文\n\n没有重叠也要保留的段落');
  assert.deepEqual(result.frameReadFailures, [4]);
  assert.equal(result.issues.length, 1);
  assert.equal(result.requiresProofreading, true);
  assert.equal(result.sourceCompleteness, 'video_excerpt');
  assert.equal(progress.at(-1).characters, result.characters);
  assert.equal(progress.some(event => Object.hasOwn(event, 'text')), false);
});
test('does not complete empty or aborted extraction', async () => {
  async function* empty() { yield { seconds: 0, lines: [] }; }
  await assert.rejects(() => extractor.collectScrollText(empty(), { durationSeconds: 1 }), { code: 'OCR_NO_TEXT' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => extractor.collectScrollText(empty(), { durationSeconds: 1, signal: controller.signal }), { name: 'AbortError' });
});
test('reports unrecognized or fully cropped frames rather than silently marking coverage clean', async () => {
  async function* frames() {
    yield { seconds: 0, lines: [line('可见的正文')] };
    yield { seconds: 2, lines: [] };
    yield { seconds: 4, lines: [line('点击下方链接')] };
  }
  const progress = [];
  const result = await extractor.collectScrollText(frames(), { durationSeconds: 6, onProgress: p => progress.push(p) });
  assert.equal(result.text, '可见的正文');
  assert.deepEqual(result.emptyBodyFrames, [2, 4]);
  assert.deepEqual(result.frameReadFailures, []);
  assert.equal(progress.at(-1).emptyBodyFrames, 2);
});
