const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const page = fs.readFileSync(path.join(__dirname, '../frontend/src/user/pages/ScriptPage.jsx'), 'utf8');

test('script workflow loads notification sound settings and synchronizes updates', () => {
  assert.match(page, /import \{ getConfig \} from '\.\.\/\.\.\/shared\/api\/config';/);
  assert.match(page, /import \{ playTaskSound \} from '\.\.\/\.\.\/shared\/notifications\/taskSound';/);
  assert.match(page, /const \[soundEnabled, setSoundEnabled\] = useState\(true\)/);
  assert.match(page, /const \[soundVolume, setSoundVolume\] = useState\(60\)/);
  assert.match(page, /getConfig\(\)[\s\S]*?setSoundEnabled\(config\.notifications\?\.soundEnabled !== false\)[\s\S]*?setSoundVolume\(Number\.isFinite\(config\.notifications\?\.soundVolume\) \? config\.notifications\.soundVolume : 60\)/);
  assert.match(page, /window\.addEventListener\('qiantie:notifications-updated', handleNotificationsUpdated\)/);
  assert.match(page, /setSoundEnabled\(event\.detail\?\.soundEnabled !== false\)[\s\S]*?setSoundVolume\(Number\.isFinite\(event\.detail\?\.soundVolume\) \? event\.detail\.soundVolume : 60\)/);
  assert.match(page, /window\.removeEventListener\('qiantie:notifications-updated', handleNotificationsUpdated\)/);
});

test('script workflow plays success and warning sounds only at extraction and generation outcomes', () => {
  assert.match(page, /playTaskSound\('success', soundEnabled, soundVolume\)/);
  assert.match(page, /playTaskSound\('warning', soundEnabled, soundVolume\)/);
  assert.match(page, /已提取[\s\S]*?playTaskSound\('success'/);
  assert.match(page, /人物与场景提取失败[\s\S]*?playTaskSound\('warning'/);
  assert.match(page, /生成完成[\s\S]*?playTaskSound\('success'/);
  assert.match(page, /剧本生成失败[\s\S]*?playTaskSound\('warning'/);
});
