const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const drawer = fs.readFileSync('frontend/src/user/pages/batch-factory-v11/BatchFactoryV11SettingsDrawers.jsx', 'utf8');
const page = fs.readFileSync('frontend/src/user/pages/batch-factory-v11/BatchFactoryV11UiPage.jsx', 'utf8');
const adapter = fs.readFileSync('frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.js', 'utf8');
const workbench = fs.readFileSync('frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx', 'utf8');

test('V11 UI exposes H3 as a selectable provider and model', () => {
  assert.match(drawer, /autodl_comfyui/);
  assert.match(drawer, /minimax-h3-video/);
  assert.match(drawer, /AutoDL H3/);
  assert.match(page, /provider === 'autodl_comfyui'/);
  assert.match(adapter, /h3/);
  assert.match(workbench, /autodl_comfyui/);
});
