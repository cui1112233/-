import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(here, name), 'utf8');

test('Director revision refresh is controlled by batch.read and never invents a Director endpoint', () => {
  assert.equal(fs.existsSync(path.join(here, 'DirectorRefreshContext.jsx')), true);
  const panel = read('DirectorPanel.jsx');
  const page = read('BatchFactoryV11UiPage.jsx');
  const bridge = read('DirectorRefreshContext.jsx');
  assert.match(panel, /batch\.read/);
  assert.match(panel, /刷新编排记录/);
  assert.match(panel, /useDirectorRevisionRefresh/);
  assert.match(page, /DirectorRefreshProvider/);
  assert.match(page, /refreshDirectorRevision/);
  assert.match(page, /runtime\.load/);
  assert.doesNotMatch(bridge, /apiRequest|batchFactoryV11|fetch\(/);
  assert.doesNotMatch(panel, /apiRequest|fetch\(|\/api\/batch-factory\/v11/);
});
