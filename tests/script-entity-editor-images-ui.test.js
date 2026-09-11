import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('entity image panel defines the double-column image controls', () => {
  const component = read('frontend/src/user/components/EntityImagePanel.jsx');
  const styles = read('frontend/src/shared/styles/global.css');

  assert.match(component, /entity-editor-image-panel/);
  assert.match(component, /主图预览/);
  assert.match(component, /上传图片/);
  assert.match(component, /AI生成/);
  assert.match(component, /type="file"/);
  assert.match(component, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(component, /entity-editor-image-thumbnail/);
  assert.match(component, /删除图片/);
  assert.match(component, /loadReferenceAssetImage/);
  assert.match(component, /URL\.createObjectURL/);
  assert.match(component, /URL\.revokeObjectURL/);
  assert.match(component, /createEntityImagePreviewLoader/);
  assert.doesNotMatch(component, /<span\s+[^>]*role="button"/);
  assert.match(component, /entity-editor-image-delete-control/);
  assert.match(styles, /\.entity-editor-layout/);
  assert.match(styles, /\.entity-editor-image-panel/);
});

test('preview loader retains late successful previews after an early rejection', async () => {
  const { createEntityImagePreviewLoader } = await import('../frontend/src/user/components/entityImagePreviewLoader.js');
  let resolveLate;
  const revoked = [];
  const loader = createEntityImagePreviewLoader(['bad', 'late'], {
    loadImage(url) {
      if (url === 'bad') return Promise.reject(new Error('expired image'));
      return new Promise(resolve => { resolveLate = resolve; });
    },
    createObjectUrl: () => 'blob:late-preview',
    revokeObjectUrl: url => revoked.push(url)
  });

  await Promise.resolve();
  resolveLate({ type: 'image/png' });
  assert.deepEqual(await loader.promise, { late: 'blob:late-preview' });
  assert.deepEqual(revoked, []);

  loader.cancel();
  assert.deepEqual(revoked, ['blob:late-preview']);
});

test('preview loader revokes a URL created after cancellation', async () => {
  const { createEntityImagePreviewLoader } = await import('../frontend/src/user/components/entityImagePreviewLoader.js');
  let resolveLate;
  const revoked = [];
  const loader = createEntityImagePreviewLoader(['bad', 'late'], {
    loadImage(url) {
      if (url === 'bad') return Promise.reject(new Error('expired image'));
      return new Promise(resolve => { resolveLate = resolve; });
    },
    createObjectUrl: () => 'blob:late-after-cancel',
    revokeObjectUrl: url => revoked.push(url)
  });

  loader.cancel();
  resolveLate({ type: 'image/png' });
  assert.deepEqual(await loader.promise, {});
  assert.deepEqual(revoked, ['blob:late-after-cancel']);
});

test('request guard ignores stale entity completion after switch or cancel', async () => {
  const { createEntityImageRequestGuard } = await import('../frontend/src/user/components/entityImageRequestGuard.js');
  const applied = [];
  const guard = createEntityImageRequestGuard('session-a:asset-a');
  const entityARequest = guard.begin();
  let resolveEntityA;
  const lateEntityACompletion = new Promise(resolve => { resolveEntityA = resolve; })
    .then(value => guard.commit(entityARequest, () => applied.push(value)));

  guard.activate('session-b:asset-b');
  const entityBRequest = guard.begin();

  assert.equal(guard.commit(entityBRequest, () => applied.push('entity-b')), true);
  resolveEntityA('entity-a');
  assert.equal(await lateEntityACompletion, false);

  const cancelledRequest = guard.begin();
  guard.invalidate();
  assert.equal(guard.commit(cancelledRequest, () => applied.push('cancelled')), false);
  assert.deepEqual(applied, ['entity-b']);
});

test('entity image panel defines the empty state and image API contracts', () => {
  const component = read('frontend/src/user/components/EntityImagePanel.jsx');

  assert.match(component, /暂无主图/);
  assert.match(component, /entity-editor-image-empty/);
  assert.match(component, /uploadReferenceAsset/);
  assert.match(component, /generateReferenceAsset/);
  assert.match(component, /selectEntityImage/);
  assert.match(component, /removeEntityImage/);
  assert.match(component, /data_url/);
  assert.match(component, /novel_text/);
  assert.match(component, /createEntityImageRequestGuard/);
  assert.match(component, /requestGuard\.current\.commit/);
});
