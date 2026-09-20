import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourceURL = new URL('./BatchFactoryNovelList.jsx', import.meta.url);

test('VIDEO prompt panel exposes frozen H3 submission prompt and compile trace', async () => {
  const source = await readFile(sourceURL, 'utf8');
  assert.match(source, /查看 H3 Trace/);
  assert.match(source, /实际提交视频模型的 H3 最终 Prompt/);
  assert.match(source, /h3Segment\.compiled_prompt/);
  assert.match(source, /h3Segment\.compile_trace/);
  assert.match(source, /h3Trace\?\.legacy/);
});
