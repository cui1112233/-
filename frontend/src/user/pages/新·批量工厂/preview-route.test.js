import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('the live /batch-factory route creates and opens V11-owned batch factory works', () => {
  const app = fs.readFileSync(path.resolve(here, '../../App.jsx'), 'utf8');
  const page = fs.readFileSync(path.join(here, 'ShuihuoProductionPage.jsx'), 'utf8');
  const projects = fs.readFileSync(path.join(here, 'shuihuo/ProjectsView.jsx'), 'utf8');
  const vite = fs.readFileSync(path.resolve(here, '../../../../vite.config.js'), 'utf8');

  assert.match(app, /BatchFactoryFromShuihuoPage = lazy\(\(\) => import\('\.\/pages\/新·批量工厂\/ShuihuoProductionPage'\)\)/);
  assert.match(app, /'\/batch-factory': BatchFactoryFromShuihuoPage/);
  assert.match(app, /'\/batch-factory-preview': BatchFactoryPage/);
  assert.match(page, /createBatchFactoryLibrary\(batchFactoryV11\)/);
  assert.match(page, /BatchFactoryV11UiPage key=\{activeBatchId\} initialBatchId=\{activeBatchId\}/);
  assert.doesNotMatch(page, /shared\/api\/shuihuoProduction/);
  assert.doesNotMatch(page, /createProject\(|listProjects\(|importProject\(/);
  assert.match(projects, /await onCreate\(\{ name: normalizedName, sourceText: importedText, filename:/);
  assert.match(vite, /'\/api': 'http:\/\/127\.0\.0\.1:13190'/);
  assert.doesNotMatch(vite, /127\.0\.0\.1:18081/);
  assert.match(page, /ProjectsView/);
  assert.doesNotMatch(app, /'\/batch-factory': NewBatchFactoryPreviewPage/);
});
