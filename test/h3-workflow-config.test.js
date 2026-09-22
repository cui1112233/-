const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeModelCatalog, publicModel } = require('../lib/model-catalog');
const { h3WorkflowForRequest } = require('../routes/script-video');

test('H3 platform preset persists a workflow id without exposing its credential', () => {
  const catalog = normalizeModelCatalog([{
    id: 'minimax-h3-video',
    kind: 'video',
    enabled: true,
    credential: 'secret-token',
    workflowId: 'minimax_h3_lightx2v_no_pic'
  }], { modelCatalogVersion: 1 });
  assert.equal(catalog[0].workflowId, 'minimax_h3_lightx2v_no_pic');
  const safe = publicModel(catalog[0]);
  assert.equal(safe.workflowId, 'minimax_h3_lightx2v_no_pic');
  assert.equal(safe.credential, undefined);
  assert.equal(safe.hasCredential, true);
});

test('H3 platform preset falls back to the image-audio workflow when workflow id is absent', () => {
  const catalog = normalizeModelCatalog([{
    id: 'minimax-h3-video',
    kind: 'video',
    enabled: true,
    credential: 'secret-token'
  }], { modelCatalogVersion: 1 });
  assert.equal(catalog[0].workflowId, 'minimax_h3_image_audio_to_video_v2');
});

test('script video resolves the saved H3 workflow id from the runtime config', () => {
  const workflow = h3WorkflowForRequest(
    { username: 'manager' },
    () => ({ modelCatalog: [{ id: 'minimax-h3-video', kind: 'video', workflowId: 'minimax_h3_lightx2v_no_pic' }] })
  );
  assert.equal(workflow, 'minimax_h3_lightx2v_no_pic');
});

test('batch factory forwards the saved H3 workflow id to the provider bridge', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes/batch-factory-v11.js'), 'utf8');
  assert.match(source, /runtimeModel\?\.workflowId \|\| options\.runtimeModel\?\.modelId/);
  assert.match(source, /runtimeModel\.workflowId \|\| runtimeModel\.modelId/);
});
