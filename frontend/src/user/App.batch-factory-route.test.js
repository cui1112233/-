import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(here, 'App.jsx'), 'utf8');

test('keeps Shuihuo as the project shell and Batch Factory as its production entry', () => {
  assert.match(app, /const BatchFactoryWorkbenchPage = lazy\(\(\) => import\('\.\/pages\/BatchFactoryWorkbenchPage'\)\)/);
  assert.match(app, /'\/batch-factory': BatchFactoryWorkbenchPage/);
  assert.match(app, /'\/shuihuo-production': ShuihuoProductionPage/);
  assert.match(app, /'\/shuihuo-production\/creative': ShuihuoProductionPage/);
  assert.doesNotMatch(app, /BatchFactoryFromShuihuoPage/);
});
