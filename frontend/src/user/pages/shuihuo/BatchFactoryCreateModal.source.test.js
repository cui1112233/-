import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryCreateModal.jsx'), 'utf8');

test('uses a full novel-fetch metadata preset by default', () => {
  assert.match(source, /value: 'full_metadata'/);
  assert.match(source, /useState\('full_metadata'\)/);
  assert.match(source, /书籍ID,书名,男女频,风格,标签,推荐理由,评级/);
});

test('offers immediate and Beijing-time automation with a frozen concurrency limit', () => {
  assert.match(source, /开始定时/);
  assert.match(source, /立即执行/);
  assert.match(source, /listAutomationPresets/);
  assert.match(source, /automationPresetID/);
  assert.match(source, /automationRunMode/);
  assert.match(source, /选择已保存预设/);
  assert.match(source, /只生成分镜/);
  assert.match(source, /生成视频不提交/);
  assert.match(source, /自动启动时间（北京时间 UTC\+8）/);
  assert.match(source, /到点启动自动生产；生成、合成与上传按后续流程继续，不会在此时间直接提交。/);
  assert.match(source, /全自动生成并提交（成片完成后上传）/);
  assert.match(source, /presetId: automationPresetID/);
  assert.match(source, /runMode: automationRunMode/);
  assert.match(source, /automationConcurrency/);
  assert.match(source, /同时处理书籍/);
  assert.match(source, /parseBeijingDatetimeLocal/);
  assert.match(source, /定时任务/);
  assert.doesNotMatch(source, /<strong>自动补抓正文<\/strong>/);
  assert.doesNotMatch(source, /<strong>自动生产<\/strong>/);
  assert.doesNotMatch(source, /自动上传视频管理系统/);
  assert.doesNotMatch(source, /<strong>定时自动执行<\/strong>/);
  assert.doesNotMatch(source, /开启后，点击创建会先真实抓取/);
  assert.match(source, /batch-factory-create-toolbar/);
  assert.doesNotMatch(source, /内容范围决定本次配音、H3 导演和 VIDEO 编译/);
});

test('immediate execution defaults to the end-to-end upload automation mode', () => {
  assert.match(source, /const \[automationRunMode, setAutomationRunMode\] = useState\('full_submit'\)/);
	assert.match(source, /if \(!scheduled\) setAutomationRunMode\('full_submit'\);/);
});
