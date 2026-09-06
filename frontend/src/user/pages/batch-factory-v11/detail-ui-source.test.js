import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(here, name), 'utf8');

test('current book UI keeps progressive detail and direct prompt editing', () => {
  const source = read('BatchFactoryV11Workbench.jsx');
  assert.match(source, /Collapse/);
  for (const label of ['人物提示词', '场景提示词', '道具提示词', '画面提示词', '本次提交预览']) {
    assert.match(source, new RegExp(label));
  }
});

test('batch tools contain production progress and approved merge timing UI', () => {
  const source = read('BatchFactoryV11Workbench.jsx');
  for (const label of ['视频生成进度', '跟随音频时长', 'TTS 只测时', '合并待合并', '开启发布']) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /1\.7/);
});

test('showcase data represents a full 100-book batch', async () => {
  const module = await import('./showcaseData.js');
  assert.equal(module.SHOWCASE_BATCH.count, 100);
  assert.equal(module.SHOWCASE_BOOKS.length, 100);
});
