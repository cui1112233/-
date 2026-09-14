import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = relative => fs.readFileSync(path.join(here, relative), 'utf8');

test('Novel Fetch transfer targets the V11 intake and preserves source fields', () => {
  const source = read('../../../../public/batch-rewrite/app.js');
  assert.match(source, /platformApi\(["']\/api\/batch-factory\/v11\/intakes\/novel-fetch/);
  assert.match(source, /books:\s*items\.map/);
  assert.match(source, /sourceTaskId/);
  assert.match(source, /txtText/);
  assert.doesNotMatch(source, /platformApi\(["']\/api\/batch-factory\/intakes\/novel-fetch/);
  assert.match(source, /redirectTo.*batch-factory\?intake/);
});

test('novel fetch persists every processing choice immediately when changed', () => {
  const source = read('../../../../public/batch-rewrite/app.js');
  assert.match(source, /platform_id:\s*\$\("platformSelect"\)\?\.value/);
  assert.match(source, /selected_versions:\s*selectedProcessVersions\(\)/);
  assert.match(source, /ai_slot_methods:\s*processAiMethods\(\)/);
  assert.match(source, /sensitive_ai_enabled:\s*sensitiveAiProcessEnabled\(\)/);
  const toggleStart = source.indexOf('const sensitiveAiToggle = $("sensitiveAiProcessEnabled");');
  const toggleEnd = source.indexOf('const persistVersionSelection', toggleStart);
  assert.ok(toggleStart >= 0 && toggleEnd > toggleStart, 'sensitive-word toggle persistence handler must remain present');
  assert.match(source.slice(toggleStart, toggleEnd), /persistWorkFormChoiceNow/);
});
