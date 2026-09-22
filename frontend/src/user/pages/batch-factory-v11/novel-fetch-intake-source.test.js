import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = relative => fs.readFileSync(path.join(here, relative), 'utf8');

test('Novel Fetch transfer targets the unified V12 intake and preserves source fields', () => {
  const source = read('../../../../public/batch-rewrite/app.js');
  assert.match(source, /platformApi\(["']\/api\/batch-factory\/v12\/intakes\/novel-fetch/);
  assert.match(source, /books:\s*items\.map/);
  assert.match(source, /sourceTaskId/);
  assert.match(source, /txtText/);
  assert.match(source, /sourceContentVersion/);
  assert.match(source, /ai_texts/);
  assert.doesNotMatch(source, /platformApi\(["']\/api\/batch-factory\/intakes\/novel-fetch/);
  assert.match(source, /redirectTo.*shuihuo-production\?intake/);
});
