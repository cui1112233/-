import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractShotDurationSeconds,
  resolveShotVideoDuration,
} from './scriptVideoDuration.js';

test('extracts seconds from a full-width colon duration marker', () => {
  assert.equal(extractShotDurationSeconds('镜头内容\n总时长：8s'), 8);
});

test('extracts seconds from an ASCII colon duration marker', () => {
  assert.equal(extractShotDurationSeconds('镜头内容\n总时长: 15s'), 15);
});

test('returns null when no explicit total exists', () => {
  assert.equal(extractShotDurationSeconds('没有总时长'), null);
});

test('falls back to 10 seconds when no explicit total exists', () => {
  assert.deepEqual(
    resolveShotVideoDuration({ shotText: '没有总时长', fallbackDuration: 10 }),
    { ok: true, duration: 10, source: 'fallback' },
  );
});

test('accepts a 10-second fallback string', () => {
  assert.deepEqual(
    resolveShotVideoDuration({ shotText: '没有总时长', fallbackDuration: '10s' }),
    { ok: true, duration: 10, source: 'fallback' },
  );
});

test('accepts a 15-second fallback string', () => {
  assert.deepEqual(
    resolveShotVideoDuration({ shotText: '没有总时长', fallbackDuration: '15s' }),
    { ok: true, duration: 15, source: 'fallback' },
  );
});

test('accepts an explicit 15-second duration from the shot', () => {
  assert.deepEqual(
    resolveShotVideoDuration({ shotText: '总时长：15s', fallbackDuration: 10 }),
    { ok: true, duration: 15, source: 'shot' },
  );
});

test('gives explicit shot duration precedence over an invalid fallback', () => {
  assert.deepEqual(
    resolveShotVideoDuration({ shotText: '总时长：15s', fallbackDuration: 0 }),
    { ok: true, duration: 15, source: 'shot' },
  );
});

test('rejects an explicit duration above the H3 limit', () => {
  const result = resolveShotVideoDuration({ shotText: '总时长：16s', fallbackDuration: 10 });

  assert.equal(result.ok, false);
  assert.match(result.error, /超过 H3 单次 15 秒上限/);
});

test('rejects an explicit zero-second duration', () => {
  const result = resolveShotVideoDuration({ shotText: '总时长：0s', fallbackDuration: 10 });

  assert.equal(result.ok, false);
  assert.match(result.error, /至少 1 秒/);
});

test('rejects an explicit fractional duration because H3 requires an integer', () => {
  const result = resolveShotVideoDuration({ shotText: '总时长：7.5s', fallbackDuration: 10 });

  assert.equal(result.ok, false);
  assert.match(result.error, /整数/);
});
