const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const source = path.join(root, '.worktrees', 'script-segmented-opening-constraints');
const files = [
  'lib/system-preset-catalog.js',
  'lib/preset-store.js',
  'routes/chat.js',
  'routes/history.js',
  'frontend/src/shared/api/generation.js',
  'frontend/src/user/pages/scriptConstraints.js',
  'frontend/src/user/pages/scriptDraftStorage.js',
  'frontend/src/user/pages/ScriptPage.jsx',
  'frontend/src/shared/styles/global.css',
  'frontend/src/admin/pages/PresetLibraryPage.jsx',
  'frontend/src/admin/pages/PromptStrategyPage.jsx',
  'prompts/小说面板人物场景提取.md',
  'prompts/分段开头.md',
  'prompts/分镜模式.md',
  'prompts/约束设置.md'
];

for (const relativePath of files) {
  const from = path.join(source, relativePath);
  const to = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

process.stdout.write(`Synced ${files.length} files\n`);
