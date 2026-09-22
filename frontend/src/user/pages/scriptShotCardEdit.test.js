import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceRawShotCard } from './scriptShotCardEdit.js';

test('replaces only the selected raw shot card while preserving adjacent cards', () => {
  const output = '### 分镜 1\n林溪进门\n\n### 分镜 2\n卫铭回头';
  const cards = ['### 分镜 1\n林溪进门', '### 分镜 2\n卫铭回头'];
  assert.equal(
    replaceRawShotCard(output, cards, 0, '### 分镜 1\n@林溪 进门'),
    '### 分镜 1\n@林溪 进门\n\n### 分镜 2\n卫铭回头'
  );
});
