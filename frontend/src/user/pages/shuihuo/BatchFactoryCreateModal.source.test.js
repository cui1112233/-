import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryCreateModal.jsx'), 'utf8');

test('uses a full novel-fetch metadata preset by default', () => {
  assert.match(source, /value: 'full_metadata'/);
  assert.match(source, /useState\('full_metadata'\)/);
  assert.match(source, /书籍ID,书名,男女频,风格,标签,推荐理由,评级/);
});
