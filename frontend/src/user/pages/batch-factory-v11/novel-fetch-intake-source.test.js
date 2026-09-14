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

test('novel fetch shares one 121 environment probe across the legacy client and login hotfix', () => {
  const app = read('../../../../public/batch-rewrite/app.js');
  const hotfix = read('../../../../public/batch-rewrite/121-login-hotfix.js');
  assert.match(app, /__qiantieWebLoginEnvironmentPromise/);
  assert.match(app, /qiantieEnsureWebLoginEnvironment/);
  assert.doesNotMatch(app.slice(app.indexOf('await loadConfig()')), /api\("\/api\/web-submit\/environment"\)/);
  assert.match(hotfix, /window\.qiantieEnsureWebLoginEnvironment/);
});

test('novel fetch gates the initial render until saved choices and login status hydrate', () => {
  const app = read('../../../../public/batch-rewrite/app.js');
  const styles = read('../../../../public/batch-rewrite/styles.css');
  assert.match(app, /document\.documentElement\.classList\.add\("qiantie-novel-fetch-hydrating"\)/);
  assert.match(app, /finally \{\s*document\.documentElement\.classList\.remove\("qiantie-novel-fetch-hydrating"\)/);
  assert.match(styles, /html\.qiantie-novel-fetch-hydrating body > \*\s*\{\s*visibility: hidden/);
  assert.match(styles, /正在读取当前配置/);
});
