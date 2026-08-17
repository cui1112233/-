const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const source = path.join(root, '.worktrees', 'script-unified-shot-units');
const files = [
  'prompts/画布模式.md',
  'prompts/剧情模式.md',
  'prompts/分镜模式.md',
  'prompts/约束设置.md',
  'routes/chat.js',
  'frontend/src/user/pages/scriptShotOutput.js',
  'frontend/src/user/components/ShotOutputCards.jsx',
  'frontend/src/user/pages/ScriptPage.jsx',
  'tests/script-shot-prompt-contract.test.js',
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
