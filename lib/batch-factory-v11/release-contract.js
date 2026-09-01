function assertImmutableImage(value, name) {
  if (!value || /:(?:latest|v\d*-?latest)$/i.test(value)) throw new Error(`${name} must use an immutable image tag`);
}
function validateRelease(input) {
  for (const [key, value] of Object.entries({ previousWeb: input.previousWeb, previousGo: input.previousGo, targetWeb: input.targetWeb, targetGo: input.targetGo })) assertImmutableImage(value, key);
  if (!input.release || !input.composeFile || !input.backupDir) throw new Error('release, composeFile and backupDir are required');
  return true;
}
function renderRollback(manifest) {
  if (!manifest?.previousWeb || !manifest?.previousGo) throw new Error('manifest prior images are required');
  if (manifest.schemaChanged && !manifest.backupId) throw new Error('schema rollback requires backupId');
  return `WEB_IMAGE=${manifest.previousWeb} GO_IMAGE=${manifest.previousGo} docker compose -f ${manifest.composeFile} up -d --no-build`;
}
module.exports = { assertImmutableImage, validateRelease, renderRollback };
