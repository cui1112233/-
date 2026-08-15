const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const source = path.join(root, '.worktrees', 'script-shot-card-output');
const files = [
  'frontend/src/user/pages/scriptShotOutput.js',
  'frontend/src/user/components/ShotOutputCards.jsx',
  'frontend/src/user/pages/ScriptPage.jsx',
  'frontend/src/shared/styles/global.css',
  'tests/script-shot-output.test.js',
  'tests/script-shot-output-ui-contract.test.js'
];

for (const relativePath of files) {
  const from = path.join(source, relativePath);
  const to = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

process.stdout.write(`Published ${files.length} files\n`);
