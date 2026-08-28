const test = require('node:test');
const assert = require('node:assert/strict');

test('parses Chinese titled storyboard cards and fields', async () => {
  const { parseStoryboardCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const cards = parseStoryboardCards('### 分镜一\n画面：雨夜街头\n动作：她抬头\n\n### 分镜 2\n画面：门打开');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].fields['画面'], '雨夜街头');
  assert.equal(cards[0].needsReview, false);
  assert.equal(cards[1].title, '### 分镜 2');
});

test('recognizes legacy English Shot headings', async () => {
  const { parseStoryboardCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const cards = parseStoryboardCards('### Shot 1\nVisual: alley\n### Shot 2\nVisual: door');
  assert.deepEqual(cards.map(card => card.id), ['shot-1', 'shot-2']);
});

test('preserves missing headings or fields and marks needsReview', async () => {
  const { parseStoryboardCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const untitled = parseStoryboardCards('只有一段模型原文，没有标题');
  assert.equal(untitled.length, 1);
  assert.equal(untitled[0].needsReview, true);
  assert.match(untitled[0].text, /只有一段/);
  const empty = parseStoryboardCards('### 分镜一\n');
  assert.equal(empty[0].needsReview, true);
  assert.equal(empty[0].text, '### 分镜一');
});
