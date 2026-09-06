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

test('parsed AI shot cards are never mechanically re-segmented by the 10s/15s UI switch', () => {
  const cards = getShotCardsWithinDuration('shotlist', oversizedModelOutput, '10s');

  // 10s is an input rule for the AI. If the model violates it, the UI must not
  // silently rewrite the source result into new semantic shots after generation.
  assert.equal(cards.length, 2);
  assert.match(cards[0], /总时长：12s/);
  assert.match(cards[0], /00:00-00:12/);
  assert.match(cards[1], /总时长：5s/);
});

test('legacy timeline splitter remains available as an explicit utility, not an automatic post-generation step', () => {
  const legacy = `00:00-00:12 | 中景｜动作连续`; 
  const segments = splitContinuousTimeline(legacy, 10);
  assert.equal(segments.length, 2);
});
