import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pages = path.resolve(here, '..');
const userSource = path.resolve(here, '../..');

test('the /batch-factory entry opens the identical shared Shuihuo workbench without forcing a new batch dialog', () => {
  const app = fs.readFileSync(path.join(userSource, 'App.jsx'), 'utf8');
  const page = fs.readFileSync(path.join(pages, 'ShuihuoProductionPage.jsx'), 'utf8');
  const projects = fs.readFileSync(path.join(pages, 'shuihuo/ProjectsView.jsx'), 'utf8');

  assert.match(app, /'\/batch-factory': ShuihuoProductionPage/);
  assert.doesNotMatch(app, /BatchFactoryFromShuihuoPage/);
  assert.doesNotMatch(app, /openBatchOnLoad/);
  assert.doesNotMatch(app, /pages\/新·批量工厂\/ShuihuoProductionPage/);
  assert.match(projects, /openCreateOnLoad/);
  assert.match(projects, /<BatchFactoryCreateModal/);
});

test('the shared personal-works page keeps the two entry buttons', () => {
  const projects = fs.readFileSync(path.join(pages, 'shuihuo/ProjectsView.jsx'), 'utf8');
  assert.match(projects, />创作漫剧</);
  assert.match(projects, />批量工厂</);
});
