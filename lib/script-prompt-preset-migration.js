const crypto = require('node:crypto');
const { defaultBody } = require('./system-preset-catalog');

// These are Git blob SHAs of the exact legacy source prompt files that were active
// before the 2026-09-06 prompt architecture cleanup.  We only auto-upgrade a
// published preset when its body still hashes to one of these untouched defaults.
// Any administrator edit, even one character, changes the hash and is preserved.
const LEGACY_SCRIPT_PROMPT_BLOB_SHA = Object.freeze({
  'script-segmented': '899729b47dc34601fd212487c54104d5ba220e43',
  'script-format-shotlist': '41d634208a3d662a83f3dcb8d09041bfcc4af186',
  'script-general': 'ccc7bdcad77302ae150b057a79eca7b4f1c0cd34'
});

const BASE_SETUP_GUARD_HEADING = '## 基础设定开关守卫 v1（最高优先级）';
const BASE_SETUP_GUARD_SEPARATOR = `\n\n---\n\n${BASE_SETUP_GUARD_HEADING}`;

function gitBlobSha(value) {
  const body = Buffer.from(String(value ?? ''), 'utf8');
  return crypto.createHash('sha1')
    .update(Buffer.from(`blob ${body.length}\0`, 'utf8'))
    .update(body)
    .digest('hex');
}

function splitCompatibilitySuffix(id, value) {
  const body = String(value ?? '');
  if (id !== 'script-format-shotlist') return { baseBody: body, suffix: '' };
  const index = body.indexOf(BASE_SETUP_GUARD_SEPARATOR);
  if (index < 0) return { baseBody: body, suffix: '' };
  return {
    baseBody: body.slice(0, index),
    suffix: body.slice(index)
  };
}

function sourceEquivalentBody(value) {
  const body = String(value ?? '');
  // Legacy prompt sources were committed with one terminal newline.  Existing
  // preset guard migration may have trimEnd()'d that newline before appending a
  // compatibility guard, so restore exactly one newline for source comparison.
  return body.endsWith('\n') ? body : `${body}\n`;
}

function legacyComparableBlobSha(id, value) {
  const { baseBody } = splitCompatibilitySuffix(id, value);
  return gitBlobSha(sourceEquivalentBody(baseBody));
}

function isUntouchedLegacyBody(id, value, legacyHashes = LEGACY_SCRIPT_PROMPT_BLOB_SHA) {
  const expected = legacyHashes?.[id];
  if (!expected) return false;
  return legacyComparableBlobSha(id, value) === expected;
}

function migrateLegacyScriptPromptPresets(store, actor, {
  legacyHashes = LEGACY_SCRIPT_PROMPT_BLOB_SHA,
  defaultBodyReader = defaultBody
} = {}) {
  if (!store || typeof store.getPublished !== 'function' || typeof store.createDraft !== 'function' || typeof store.publish !== 'function') {
    throw new Error('preset store is required');
  }

  const upgraded = [];
  const preserved = [];

  for (const id of Object.keys(legacyHashes)) {
    const current = store.getPublished(id);
    if (!current) continue;
    if (!isUntouchedLegacyBody(id, current.body, legacyHashes)) {
      preserved.push(id);
      continue;
    }

    const { suffix } = splitCompatibilitySuffix(id, current.body);
    const currentDefaultBody = String(defaultBodyReader(id) || '').trimEnd();
    if (!currentDefaultBody) continue;
    const nextBody = currentDefaultBody + suffix;
    if (String(current.body || '') === nextBody) continue;

    const draft = store.createDraft(actor, {
      id: current.id,
      module: current.module,
      name: current.name,
      kind: current.kind,
      description: current.description,
      compatibleBaseIds: Array.isArray(current.compatibleBaseIds) ? current.compatibleBaseIds : [],
      body: nextBody,
      protocolLock: current.protocolLock
    });
    store.publish(actor, draft.id, draft.version);
    upgraded.push(id);
  }

  return { upgraded, preserved };
}

module.exports = {
  LEGACY_SCRIPT_PROMPT_BLOB_SHA,
  migrateLegacyScriptPromptPresets,
  _private: {
    gitBlobSha,
    splitCompatibilitySuffix,
    sourceEquivalentBody,
    legacyComparableBlobSha,
    isUntouchedLegacyBody
  }
};
