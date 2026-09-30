import assert from 'node:assert/strict';
import test from 'node:test';
import { realVideoDurationSeconds } from './batchFactoryVideoMeta.js';

test('sums every scene duration marker in the SD card body', () => {
  const prompt = `段内执行约束：按场景编号依次完成。
[场景 1｜对应原文第 1 行｜总时长 2.200 秒]
[镜头 1｜时长 2.200 秒]
全景，林晚推开大门。
[场景 2｜对应原文第 2 行｜总时长 2.000 秒]
[镜头 1｜时长 2.000 秒]
近景，林晚转身。`;
  assert.ok(Math.abs(realVideoDurationSeconds(prompt) - 4.2) < 1e-9);
});

test('returns null when the card has no scene duration markers', () => {
  assert.equal(realVideoDurationSeconds('镜头画面：\n00:00-00:03 | 中景 | 动作'), null);
  assert.equal(realVideoDurationSeconds(''), null);
  assert.equal(realVideoDurationSeconds(null), null);
});
