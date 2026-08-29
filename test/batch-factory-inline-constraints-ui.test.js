const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'frontend/src/user/pages/BatchFactoryPageV10.jsx'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'frontend/src/user/pages/batch-factory/BatchFactorySettingsModals.jsx'), 'utf8');

test('current-book constraints are an anchored popover instead of a settings modal', () => {
  assert.match(settings, /export function BookConstraintPopover\s*\(/);
  assert.match(settings, /BookConstraintPopover[\s\S]*?<Popover/);
  assert.match(page, /BookConstraintPopover/);
  assert.doesNotMatch(page, /BookSettingsModal/);
});

test('constraint UI exposes one basic-settings switch for character and scene injection', () => {
  assert.match(settings, /打开基础设定（人物 \/ 场景）/);
  assert.doesNotMatch(settings, /ScopedBooleanRow label="人物 Prompt"/);
  assert.doesNotMatch(settings, /ScopedBooleanRow label="场景 Prompt"/);
});

test('book constraint popover keeps sparse inheritance save semantics', () => {
  assert.match(settings, /恢复继承/);
  assert.match(settings, /onSave\(local, inheritKeys\)/);
  assert.match(settings, /initialOverride=\{item\?\.settingsOverride \|\| \{\}\}/);
});
