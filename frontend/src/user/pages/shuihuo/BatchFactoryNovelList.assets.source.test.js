import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryNovelList.jsx'), 'utf8');

test('asset popup uses durable book-asset APIs instead of draft prompts', () => {
  assert.match(source, /listBookAssets/);
  assert.match(source, /createBookAsset/);
  assert.match(source, /updateBookAsset/);
  assert.doesNotMatch(source, /kind:\s*'asset-prompt'/);
});
