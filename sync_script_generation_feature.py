from pathlib import Path
from shutil import copy2

source = Path(r'F:\脚本测试\chengming\qiantie\.worktrees\script-segmented-opening-constraints')
target = Path(r'F:\脚本测试\chengming\qiantie')
files = [
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
    'tests/system-preset-catalog.test.js',
    'tests/script-generation-message-contract.test.js',
    'tests/script-history-contract.test.js',
    'tests/script-page-contract.test.js',
    'tests/script-draft-persistence-contract.test.js',
    'tests/constraint-preset-contract.test.js',
    'tests/constraint-preset-admin-contract.test.js',
    'prompts/\u5c0f\u8bf4\u9762\u677f\u4eba\u7269\u573a\u666f\u63d0\u53d6.md',
    'prompts/\u5206\u6bb5\u5f00\u5934.md',
    'prompts/\u5206\u955c\u6a21\u5f0f.md',
    'prompts/\u7ea6\u675f\u8bbe\u7f6e.md',
]

for relative in files:
    destination = target / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    copy2(source / relative, destination)

print(f'Synced {len(files)} files')
