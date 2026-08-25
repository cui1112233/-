const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createUsageStore } = require('../lib/usage-store');

test('usage summaries expose billable calls grouped by feature', t => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-usage-feature-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const store = createUsageStore({ systemDir });

  store.record({
    username: 'member01',
    billedTo: 'manager01',
    feature: 'script',
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  });
  store.record({
    username: 'member01',
    billedTo: 'manager01',
    feature: 'image',
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }
  });
  store.record({
    username: 'member01',
    billedTo: 'manager01',
    feature: 'script',
    status: 'completed_error',
    metadata: { usageEstimated: true },
    usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 }
  });

  const summary = store.summaryForUser('member01', 'month');
  assert.deepEqual(summary.callsByFeature, { script: 1, image: 1 });
  assert.equal(summary.calls, 3);
  assert.equal(summary.billableCalls, 2);
});
