const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routePath = path.join(__dirname, '..', 'routes', 'script-constraint-prompts.js');
const appPath = path.join(__dirname, '..', 'app.js');

test('V88 personal script constraint prompts remain authenticated and user-scoped', () => {
  const route = fs.readFileSync(routePath, 'utf8');
  const app = fs.readFileSync(appPath, 'utf8');

  assert.match(route, /const \{ apiAuth \} = require\('\.\.\/middleware\/auth'\);/);
  assert.match(route, /router\.use\(apiAuth\);/);
  assert.doesNotMatch(route, /skipAuth/);
  assert.match(route, /promptStore\.list\(req\.username, req\.query\.category\)/);
  assert.match(
    app,
    /app\.use\('\/api\/script-constraint-prompts', createScriptConstraintPromptsRouter\(\{ promptStore: resolvedScriptConstraintPromptStore \}\)\);/
  );
});

