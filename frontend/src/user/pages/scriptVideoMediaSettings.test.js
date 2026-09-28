import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const pagePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ScriptPage.jsx');
const source = fs.readFileSync(pagePath, 'utf8');
const payloadStart = source.indexOf('const videoPayload = buildScriptVideoPayload');
const payloadEnd = source.indexOf('const result = await createScriptVideo(videoPayload);', payloadStart);
const payloadSource = source.slice(payloadStart, payloadEnd);

test('passes the independent video configuration to every script video request', () => {
  assert.ok(payloadStart >= 0);
  assert.ok(payloadEnd > payloadStart);
  assert.match(payloadSource, /resolution:\s*scriptVideoResolution/);
  assert.match(payloadSource, /aspectRatio:\s*scriptVideoAspectRatio/);
  assert.doesNotMatch(payloadSource, /scriptImageAspectRatio/);
  assert.doesNotMatch(payloadSource, /minimax-h3-video'\s*\?\s*'480p竖'/);
});

test('explains the H3 768p tier while retaining the selected orientation', () => {
  assert.match(source, /H3.*横竖画幅/);
  assert.match(source, /720p.*1080p.*768p/);
});
