import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(here, name), 'utf8');

test('final V78 workbench contains the approved production regions', () => {
  const source = read('BatchFactoryV11Workbench.jsx');
  for (const marker of [
    'data-bf-region="batch-header"',
    'data-bf-region="status-center"',
    'data-bf-region="current-filter"',
    'data-bf-card="book-list"',
    'data-bf-card="book-workbench"',
    'data-bf-card="preview"',
    'data-bf-card="batch-tools"'
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('layout editing exposes explicit edit save and restore controls', () => {
  const source = read('BatchFactoryV11Workbench.jsx');
  assert.match(source, /编辑布局/);
  assert.match(source, /保存布局/);
  assert.match(source, /恢复默认布局/);
  assert.match(source, /WORKSPACE_STORAGE_KEY/);
});

test('the V11 UI path does not import legacy Batch Factory business APIs', () => {
  const sources = ['BatchFactoryV11Workbench.jsx', 'WorkbenchCard.jsx', 'showcaseData.js']
    .map(name => read(name)).join('\n');
  for (const forbidden of [
    "shared/api/batchFactory",
    "shared/api/generation",
    "shared/api/shuihuoProduction",
    "/api/batch-factory/",
    "/api/shuihuo-production/"
  ]) assert.equal(sources.includes(forbidden), false, `forbidden legacy source: ${forbidden}`);
});

test('workbench has a single unified preview surface rather than per-video players', () => {
  const source = read('BatchFactoryV11Workbench.jsx');
  const matches = source.match(/data-bf-player="unified"/g) || [];
  assert.equal(matches.length, 1);
  assert.match(source, /最终合并/);
  assert.match(source, /VIDEO \$\{String\(index \+ 1\)\.padStart\(2, '0'\)\}/);
});

test('current novel source is a real editable module with stale-result warning', () => {
  const workbench = read('BatchFactoryV11Workbench.jsx');
  const source = read('NovelSourceModule.jsx');
  assert.match(workbench, /NovelSourceModule/);
  assert.match(workbench, /onSaveSource/);
  assert.match(source, /downstreamStale/);
});
