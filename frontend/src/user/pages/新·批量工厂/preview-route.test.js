import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pages = path.resolve(here, '..');
const userSource = path.resolve(here, '../..');

test('the /batch-factory entry opens the shared Shuihuo page and its batch intake modal', () => {
  const app = fs.readFileSync(path.join(userSource, 'App.jsx'), 'utf8');
  const page = fs.readFileSync(path.join(pages, 'ShuihuoProductionPage.jsx'), 'utf8');
  const projects = fs.readFileSync(path.join(pages, 'shuihuo/ProjectsView.jsx'), 'utf8');

  assert.match(app, /BatchFactoryFromShuihuoPage = lazy\(\(\) => import\('\.\/pages\/ShuihuoProductionPage'\)\.then/);
  assert.match(app, /openBatchOnLoad/);
  assert.match(app, /'\/batch-factory': BatchFactoryFromShuihuoPage/);
  assert.doesNotMatch(app, /pages\/新·批量工厂\/ShuihuoProductionPage/);
  assert.match(page, /ShuihuoProductionPage\(\{ openBatchOnLoad = false \}\)/);
  assert.match(page, /openCreateOnLoad=\{openBatchOnLoad\}/);
  assert.match(projects, /openCreateOnLoad/);
  assert.match(projects, /<BatchFactoryCreateModal/);
});

test('the shared personal-works page keeps the two entry buttons', () => {
  const projects = fs.readFileSync(path.join(pages, 'shuihuo/ProjectsView.jsx'), 'utf8');
  assert.match(projects, />创作漫剧</);
  assert.match(projects, />批量工厂</);
});
