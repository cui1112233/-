import test from 'node:test';
import assert from 'node:assert/strict';

import { getShotCardsWithinDuration, splitContinuousTimeline } from './scriptShotOutput.js';

const oversizedModelOutput = `### 分镜一（总时长：12s）
镜头画面：
00:00-00:12 | 中景｜50mm｜平视｜中心构图｜缓慢推进｜直切 | 林晚走进房间并完成当前动作。

---

### 分镜二（总时长：5s）
镜头画面：
00:00-00:05 | 近景｜85mm｜平视｜人物构图｜固定｜直切 | 陆沉抬头看向林晚。`;

test('分镜一 / 分镜二 headings are the authoritative card boundaries', () => {
  const cards = getShotCardsWithinDuration('shotlist', oversizedModelOutput, '10s');

  assert.equal(cards.length, 2);
  assert.match(cards[0], /分镜一/);
  assert.doesNotMatch(cards[0], /分镜二/);
  assert.match(cards[1], /分镜二/);
  assert.match(cards[0], /总时长：12s/);
  assert.match(cards[0], /00:00-00:12/);
});

test('10s / 15s never mechanically re-segment parsed AI shot cards after generation', () => {
  const cards = getShotCardsWithinDuration('shotlist', oversizedModelOutput, '10s');
  assert.equal(cards.length, 2);
  assert.match(cards[0], /总时长：12s/);
  assert.match(cards[1], /总时长：5s/);
});

test('continuous timeline without explicit shot headings is not auto-split into cards', () => {
  const legacy = `00:00-00:12 | 中景｜动作连续`;
  const segments = splitContinuousTimeline(legacy, 10);
  assert.deepEqual(segments, []);
});

test('legacy mechanical splitter remains available only through explicit opt-in', () => {
  const legacy = `00:00-00:12 | 中景｜动作连续`;
  const segments = splitContinuousTimeline(legacy, 10, { allowMechanicalSplit: true });
  assert.equal(segments.length, 2);
});
