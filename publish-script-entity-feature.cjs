const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const source = path.join(root, '.worktrees', 'script-entity-protagonist-management');
const files = [
  'frontend/src/user/pages/scriptEntities.js',
  'frontend/src/user/pages/scriptDraftStorage.js',
  'frontend/src/user/pages/ScriptPage.jsx',
  'frontend/src/shared/api/generation.js',
  'frontend/src/shared/styles/global.css',
  'routes/chat.js',
  'tests/script-entity-management.test.js',
  'tests/script-entity-ui-contract.test.js',
  'tests/script-protagonist-generation-contract.test.js'
];

for (const relativePath of files) {
  const from = path.join(source, relativePath);
  const to = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

process.stdout.write(`Published ${files.length} files\n`);
