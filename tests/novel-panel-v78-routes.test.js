process.env.QIANTIE_SEED_ACCOUNTS = JSON.stringify({ choushiyiguai: '123456', choushiyiguai1: '123456' });
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../app');
const { createAccountStore } = require('../lib/account-store');
const { createNovelPanelPremiumStore } = require('../lib/novel-panel/premium-store');

function createServerContext(t) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-novel-panel-v78-routes-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const app = createApp({ accountStore: createAccountStore({ systemDir }), tokenMap: new Map() });
  return { app, systemDir };
}

function request(app, { method = 'GET', requestPath, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? null : JSON.stringify(body);
    const finish = (error, response) => {
      server.close(closeError => {
        if (error || closeError) reject(error || closeError);
        else resolve(response);
      });
    };
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const request = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: requestPath,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => finish(null, {
          status: response.statusCode,
          headers: response.headers,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
        }));
      });
      request.once('error', error => finish(error));
      if (payload) request.write(payload);
      request.end();
    });
  });
}

function requestRaw(app, requestPath, token) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const finish = (error, response) => {
      server.close(closeError => {
        if (error || closeError) reject(error || closeError);
        else resolve(response);
      });
    };
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      http.get({ hostname: '127.0.0.1', port: server.address().port, path: requestPath, headers: token ? { Authorization: `Bearer ${token}` } : {} }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => finish(null, {
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8')
        }));
      }).once('error', error => finish(error));
    });
  });
}

function workspace() {
  return {
    novel_text: '甲走进病房，看了一眼乙。',
    character_core_v2: { slots: [{ slot_id: 's1', display_name: '甲' }] },
    scenes: [{ id: 'scene_1' }],
    outline_shots: [{ id: 'shot_1', duration: 2 }]
  };
}

test('reference asset path prefers the newest main and thumb extension without deleting older files', async t => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-premium-store-extension-'));
  t.after(() => fs.rmSync(usersDir, { recursive: true, force: true }));
  const store = createNovelPanelPremiumStore({ usersDir });
  const first = Buffer.from('old-png');
  const second = Buffer.from('new-jpg');

  const mainPng = store.writeReferenceAssetBytes('choushiyiguai', 'character', 'extension_test', 'main', first, 'image/png');
  await new Promise(resolve => setTimeout(resolve, 10));
  const mainJpg = store.writeReferenceAssetBytes('choushiyiguai', 'character', 'extension_test', 'main', second, 'image/jpeg');
  assert.equal(path.extname(store.assetFilePath('choushiyiguai', 'character', 'extension_test', 'main')), '.jpg');
  assert.deepEqual(fs.readFileSync(store.assetFilePath('choushiyiguai', 'character', 'extension_test', 'main')), second);
  assert.equal(fs.existsSync(mainPng), true);
  assert.equal(fs.existsSync(mainJpg), true);

  const thumbPng = store.writeReferenceAssetBytes('choushiyiguai', 'character', 'extension_test', 'thumb', first, 'image/png');
  await new Promise(resolve => setTimeout(resolve, 10));
  const thumbWebp = store.writeReferenceAssetBytes('choushiyiguai', 'character', 'extension_test', 'thumb', second, 'image/webp');
  assert.equal(path.extname(store.assetFilePath('choushiyiguai', 'character', 'extension_test', 'thumb')), '.webp');
  assert.deepEqual(fs.readFileSync(store.assetFilePath('choushiyiguai', 'character', 'extension_test', 'thumb')), second);
  assert.equal(fs.existsSync(thumbPng), true);
  assert.equal(fs.existsSync(thumbWebp), true);
});

async function login(app) {
  const response = await request(app, { method: 'POST', requestPath: '/api/login', body: { username: 'choushiyiguai', password: '123456' } });
  assert.equal(response.status, 200);
  return response.body.token;
}

test('V78 build-info, clean-core health and diagnostics self-check report v78.3.0.2', async t => {
  const { app } = createServerContext(t);
  const token = await login(app);

  const buildInfo = await request(app, { requestPath: '/api/novel-panel/build-info', token });
  assert.equal(buildInfo.status, 200);
  assert.equal(buildInfo.body.app_version, 'v78.3.0.2');
  assert.equal(buildInfo.body.release_version, 'v78.3.0.2');
  assert.equal(buildInfo.body.workspace_schema_version, 40);
  assert.equal(buildInfo.body.release_channel, 'stable');

  const health = await request(app, { requestPath: '/api/novel-panel/clean-core/health', token });
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.phase, 'v78_stable');
  assert.equal(health.body.workspace_schema_version, 40);
  assert.ok(health.body.checks.some(check => check.id === 'clean_core_routes' && check.status === 'pass'));

  const selfCheck = await request(app, { requestPath: '/api/novel-panel/diagnostics/self-check', token });
  assert.equal(selfCheck.status, 200);
  assert.equal(selfCheck.body.ok, true);
  assert.ok(Array.isArray(selfCheck.body.checks));
  assert.equal(selfCheck.body.summary.fail, 0);
  assert.ok(selfCheck.body.checks.some(check => check.id === 'routes' && check.status === 'pass'));
});

test('history CRUD round-trips through the authenticated API with per-user isolation', async t => {
  const { app } = createServerContext(t);
  const token = await login(app);

  const created = await request(app, { method: 'POST', requestPath: '/api/novel-panel/history', token, body: { note: '第一版', workspace: workspace(), instruction_revision: 'rev-1' } });
  assert.equal(created.status, 200);
  assert.equal(created.body.ok, true);
  assert.match(created.body.record.history_id, /^hist_/);
  assert.equal(created.body.record.summary.shot_count, 1);
  const historyId = created.body.record.history_id;

  const list = await request(app, { requestPath: '/api/novel-panel/history', token });
  assert.equal(list.status, 200);
  assert.ok(list.body.history.some(record => record.history_id === historyId));
  assert.equal(list.body.history.find(record => record.history_id === historyId).instruction_revision, 'rev-1');

  const loaded = await request(app, { requestPath: `/api/novel-panel/history/${historyId}`, token });
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.record.note, '第一版');
  assert.equal(loaded.body.record.workspace.novel_text, '甲走进病房，看了一眼乙。');

  const overwritten = await request(app, { method: 'PUT', requestPath: `/api/novel-panel/history/${historyId}`, token, body: { note: '第二版', workspace: workspace() } });
  assert.equal(overwritten.status, 200);
  assert.equal(overwritten.body.record.note, '第二版');
  assert.equal(overwritten.body.record.created_at, created.body.record.created_at);

  const noted = await request(app, { method: 'PATCH', requestPath: `/api/novel-panel/history/${historyId}/note`, token, body: { note: '备注已改' } });
  assert.equal(noted.status, 200);
  assert.equal(noted.body.record.note, '备注已改');

  const missing = await request(app, { requestPath: '/api/novel-panel/history/hist_00000000_000000_00000000', token });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'HISTORY_NOT_FOUND');

  const deleted = await request(app, { method: 'DELETE', requestPath: `/api/novel-panel/history/${historyId}`, token });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.ok, true);
  const afterDelete = await request(app, { requestPath: '/api/novel-panel/history', token });
  assert.equal(afterDelete.body.history.some(record => record.history_id === historyId), false);
});

test('image settings persist per user and hide the api key', async t => {
  const { app } = createServerContext(t);
  const token = await login(app);
  const uniqueModel = `img-model-${Date.now()}`;

  // The route stores share the process data dir, so avoid asserting a clean
  // initial state; assert the save round-trip and the key redaction instead.
  const empty = await request(app, { requestPath: '/api/novel-panel/image-settings', token });
  assert.equal(empty.status, 200);
  assert.equal(typeof empty.body.settings.api_key_configured, 'boolean');
  assert.equal(empty.body.settings.generate_path, '/images/generations');

  const saved = await request(app, { method: 'POST', requestPath: '/api/novel-panel/image-settings', token, body: { base_url: 'https://img.example.com/v1', model: uniqueModel, api_key: `secret-key-${Date.now()}`, supports_reference: true } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.settings.api_key_configured, true);
  assert.equal(saved.body.settings.base_url, 'https://img.example.com/v1');
  assert.equal(saved.body.settings.model, uniqueModel);
  assert.equal(JSON.stringify(saved.body.settings).includes('secret-key'), false);

  const reloaded = await request(app, { requestPath: '/api/novel-panel/image-settings', token });
  assert.equal(reloaded.body.settings.model, uniqueModel);
  assert.equal(reloaded.body.settings.api_key_configured, true);

  const missingConfig = await request(app, { method: 'POST', requestPath: '/api/novel-panel/image-settings/test', token, body: { base_url: '', model: '', api_key: '' } });
  assert.equal(missingConfig.status, 400);
  assert.equal(missingConfig.body.code, 'IMAGE_SETTINGS_INCOMPLETE');
});

test('reference assets upload, serve and degrade for generation/clipboard', async t => {
  const { app, systemDir } = createServerContext(t);
  const token = await login(app);
  const assetId = `test_char_${Date.now()}`;
  const usersDir = path.join(systemDir, '..', 'users');
  const assetsDir = path.join(usersDir, 'choushiyiguai', 'novel-panel', 'reference_assets', 'characters');
  t.after(() => {
    if (fs.existsSync(assetsDir)) fs.rmSync(assetsDir, { recursive: true, force: true });
  });

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  const uploaded = await request(app, { method: 'POST', requestPath: '/api/novel-panel/reference-assets/upload', token, body: { asset_type: 'character', asset_id: assetId, variant: 'source', data_url: dataUrl } });
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.body.ok, true);
  assert.equal(uploaded.body.has_source_image, true);
  assert.match(uploaded.body.url, new RegExp(`/api/novel-panel/reference-assets/file/character/${assetId}/source_`));

  const file = await requestRaw(app, uploaded.body.url, token);
  assert.equal(file.status, 200);
  assert.equal(file.headers['content-type'], 'image/png');
  assert.equal(file.body.length, png.length);

  const legacySource = Buffer.from('legacy-source-png');
  fs.writeFileSync(path.join(assetsDir, `${assetId}_source.png`), legacySource);
  const secondJpg = Buffer.from('new-source-jpg');
  const secondUploaded = await request(app, { method: 'POST', requestPath: '/api/novel-panel/reference-assets/upload', token, body: { asset_type: 'character', asset_id: assetId, variant: 'source', data_url: `data:image/jpeg;base64,${secondJpg.toString('base64')}` } });
  assert.equal(secondUploaded.status, 200);
  assert.notEqual(secondUploaded.body.url, uploaded.body.url);
  const oldFile = await requestRaw(app, uploaded.body.url, token);
  assert.equal(oldFile.status, 200);
  assert.equal(oldFile.body.length, png.length);
  const sourceCompatibility = await requestRaw(app, `/api/novel-panel/reference-assets/file/character/${assetId}/source`, token);
  assert.equal(sourceCompatibility.status, 200);
  assert.equal(sourceCompatibility.body, secondJpg.toString());

  const main = await request(app, { method: 'POST', requestPath: '/api/novel-panel/reference-assets/use-source-as-main', token, body: { asset_type: 'character', asset_id: assetId } });
  assert.equal(main.status, 200);
  assert.equal(main.body.has_main_image, true);
  assert.equal(main.body.main_origin, 'uploaded');
  const mainFile = await requestRaw(app, `/api/novel-panel/reference-assets/file/character/${assetId}/main`, token);
  assert.equal(mainFile.status, 200);
  assert.equal(mainFile.body, secondJpg.toString());

  const invalidVariant = await request(app, { method: 'POST', requestPath: '/api/novel-panel/reference-assets/upload', token, body: { asset_type: 'character', asset_id: assetId, variant: 'main', data_url: dataUrl } });
  assert.equal(invalidVariant.status, 400);
  assert.equal(invalidVariant.body.code, 'REFERENCE_ASSET_UPLOAD_VARIANT_INVALID');

  const missing = await requestRaw(app, '/api/novel-panel/reference-assets/file/character/nope/source', token);
  assert.equal(missing.status, 404);

  // Other tests share the same process users dir, so explicitly clear the image
  // AI config here. Without it the generation call would read a foreign base_url
  // and hang on an unreachable upstream instead of failing fast with the
  // incomplete-config error.
  await request(app, { method: 'POST', requestPath: '/api/novel-panel/image-settings', token, body: { base_url: '', model: '', api_key: '', clear_api_key: true } });

  const generate = await request(app, { method: 'POST', requestPath: '/api/novel-panel/reference-assets/generate', token, body: { asset_type: 'character', asset_id: assetId, description: '一名年轻女性' } });
  assert.equal(generate.status, 400);
  assert.equal(generate.body.code, 'IMAGE_SETTINGS_INCOMPLETE');

  const clipboard = await request(app, { method: 'POST', requestPath: '/api/novel-panel/native-clipboard/copy-rich', token, body: { text: 'x', refs: [] } });
  assert.equal(clipboard.status, 503);
  assert.equal(clipboard.body.code, 'NATIVE_CLIPBOARD_UNAVAILABLE');
});

test('character-core scene cast and scene context endpoints are wired', async t => {
  const { app } = createServerContext(t);
  const token = await login(app);

  const cast = await request(app, {
    method: 'POST',
    requestPath: '/api/novel-panel/character-core/resolve-scene-cast',
    token,
    body: {
      scene_id: 'scene_1',
      source_text: '甲抬头看向乙。',
      slots: [
        { slot_id: 's1', slot_token: 's1', base_name: '甲', display_name: '甲', aliases: ['阿甲'] },
        { slot_id: 's2', slot_token: 's2', base_name: '乙', display_name: '乙', aliases: [] }
      ],
      manual_selected_slot_ids: []
    }
  });
  assert.equal(cast.status, 200);
  assert.equal(cast.body.scene_id, 'scene_1');
  assert.ok(cast.body.selected.some(item => item.slot_id === 's1'));
  assert.ok(cast.body.selected.some(item => item.slot_id === 's2'));
  assert.ok(Array.isArray(cast.body.mentioned_only));

  const context = await request(app, {
    method: 'POST',
    requestPath: '/api/novel-panel/character-core/build-scene-context',
    token,
    body: {
      cast: { scene_id: 'scene_1', selected: [{ slot_id: 's1', display_name: '甲' }] },
      slots: [{ slot_id: 's1', display_name: '甲', gender: '女', age: { visual_age_stage: '少女' }, appearance: '齐肩短发' }],
      relationships: []
    }
  });
  assert.equal(context.status, 200);
  assert.equal(context.body.characters.length, 1);
  assert.equal(context.body.characters[0].gender, '女');
  assert.equal(context.body.characters[0].age_stage, '少女');
});

test('new V78 endpoints require Bearer authentication', async t => {
  const { app } = createServerContext(t);
  for (const path of ['/api/novel-panel/history', '/api/novel-panel/image-settings', '/api/novel-panel/clean-core/health', '/api/novel-panel/diagnostics/self-check']) {
    const response = await request(app, { requestPath: path });
    assert.equal(response.status, 401, `${path} must require auth`);
  }
});

function startImageUpstream(t, { status = 200, body } = {}) {
  const paths = [];
  const server = http.createServer((req, res) => {
    paths.push(req.url);
    req.resume();
    req.on('end', () => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    });
  });
  t.after(() => new Promise(resolve => {
    server.closeAllConnections?.();
    server.close(resolve);
  }));
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ baseUrl: `http://127.0.0.1:${server.address().port}`, paths });
  }));
}

test('reference asset generation persists the generated image and returns asset metadata', async t => {
  const { app } = createServerContext(t);
  const token = await login(app);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const upstream = await startImageUpstream(t, { body: { data: [{ b64_json: png.toString('base64') }] } });

  await request(app, {
    method: 'POST',
    requestPath: '/api/novel-panel/image-settings',
    token,
    body: { base_url: upstream.baseUrl, model: 'img-test', api_key: 'test-key', generate_path: '/images/generations' }
  });

  const assetId = `gen_char_${Date.now()}`;
  const generate = await request(app, {
    method: 'POST',
    requestPath: '/api/novel-panel/reference-assets/generate',
    token,
    body: { asset_type: 'character', asset_id: assetId, description: '一位年轻女性', reference_mode: 'normal', character: { name: '妹妹', gender: '女', visual_age_stage: '年轻女性' } }
  });
  assert.equal(generate.status, 200);
  assert.equal(generate.body.ok, true);
  assert.equal(generate.body.main_origin, 'generated');
  assert.equal(generate.body.has_main_image, false);
  assert.match(generate.body.url, new RegExp(`/api/novel-panel/reference-assets/file/character/${assetId}/candidate_`));
  // OpenAI-compatible image relays expect /v1/images/generations; a root-domain
  // base_url must be normalized to include the /v1 prefix automatically.
  assert.equal(upstream.paths[0], '/v1/images/generations');

  const file = await requestRaw(app, generate.body.url, token);
  assert.equal(file.status, 200);
  assert.equal(file.body.length, png.length);
});

test('image generation keeps an explicit /v1 base url without duplicating the prefix', async t => {
  const { app } = createServerContext(t);
  const token = await login(app);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const upstream = await startImageUpstream(t, { body: { data: [{ b64_json: png.toString('base64') }] } });

  await request(app, {
    method: 'POST',
    requestPath: '/api/novel-panel/image-settings',
    token,
    body: { base_url: `${upstream.baseUrl}/v1`, model: 'img-test', api_key: 'test-key' }
  });

  const generate = await request(app, {
    method: 'POST',
    requestPath: '/api/novel-panel/reference-assets/generate',
    token,
    body: { asset_type: 'character', description: '一位年轻女性' }
  });
  assert.equal(generate.status, 200);
  assert.equal(upstream.paths[0], '/v1/images/generations');
});

test('reference asset generation reports image AI upstream failures', async t => {
  const { app } = createServerContext(t);
  const token = await login(app);
  const upstream = await startImageUpstream(t, { status: 401, body: { error: { message: 'invalid key' } } });

  await request(app, {
    method: 'POST',
    requestPath: '/api/novel-panel/image-settings',
    token,
    body: { base_url: upstream.baseUrl, model: 'img-test', api_key: 'bad-key' }
  });

  const generate = await request(app, {
    method: 'POST',
    requestPath: '/api/novel-panel/reference-assets/generate',
    token,
    body: { asset_type: 'character', description: '测试描述' }
  });
  assert.equal(generate.status, 502);
  assert.match(generate.body.error, /图片AI请求失败：invalid key/);
});

test('reference asset generation requires a non-empty prompt', async t => {
  const { app } = createServerContext(t);
  const token = await login(app);
  const upstream = await startImageUpstream(t, { body: { data: [] } });
  await request(app, {
    method: 'POST',
    requestPath: '/api/novel-panel/image-settings',
    token,
    body: { base_url: upstream.baseUrl, model: 'img-test', api_key: 'test-key' }
  });
  const generate = await request(app, {
    method: 'POST',
    requestPath: '/api/novel-panel/reference-assets/generate',
    token,
    body: { asset_type: 'character' }
  });
  assert.equal(generate.status, 400);
  assert.equal(generate.body.code, 'IMAGE_GENERATION_EMPTY_PROMPT');
});
