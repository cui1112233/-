import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryCreateModal.jsx'), 'utf8');

test('uses a full novel-fetch metadata preset by default', () => {
  // 输入格式/列顺序固定为默认值，不再暴露控件（AI 自动分析男女频/风格）
  assert.match(source, /const DEFAULT_COLUMN_PRESET_ID = 'full_metadata'/);
  assert.match(source, /const DEFAULT_COLUMN_ORDER = '书籍ID,书名,男女频,风格,标签,推荐理由,评级'/);
  assert.doesNotMatch(source, /自定义列顺序/);
  assert.doesNotMatch(source, /列顺序预设/);
});

test('platform group tags use theme-aware css classes, not antd preset colors', () => {
  // 暗色主题下 antd color="blue" 对比度太低看不清，改用 CSS 类控制配色
  assert.match(source, /className=\{editingPlatformId === group\.platformId \? 'platform-group-tag is-editing' : 'platform-group-tag'\}/);
  assert.doesNotMatch(source, /color=\{editingPlatformId/);
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

test('grouped submit surfaces failed book cities and counts only fetched pending books', () => {
  // I3：失败书城可见——catch 里记录书城名并 console.warn，最终 warning 带出具体书城
  assert.match(source, /const failedPlatforms = \[\]/);
  assert.match(source, /failedPlatforms\.push\(group\.platformName \|\| group\.platformId\)/);
  assert.match(source, /console\.warn\('分组抓取失败', group\.platformId, error\)/);
  assert.match(source, /以下书城抓取失败：\$\{failedPlatforms\.join\('、'\)\}/);
  assert.match(source, /失败的书已在列表中标红，可单独重试/);
  // 全部成功但有书没正文时，沿用原来的 X/Y 文案
  assert.match(source, /\} else if \(fetchedCount < totalCount\) \{/);
  // #6：fetchedCount 只对本组 pending id 中真正拿到非空正文的计数
  assert.match(source, /let fetchedCount = 0/);
  assert.match(source, /for \(const bookId of pending\) \{\s*if \(String\(groupSources\[bookId\] \|\| ''\)\.trim\(\)\) fetchedCount \+= 1;/);
});

test('offers giant material intake through the resident executor', () => {
  assert.match(source, /GIANT_MATERIAL_PLATFORM_OPTION/);
  assert.match(source, /resolveGiantMaterialForBatch/);
  assert.match(source, /createGiantMaterialJob/);
  assert.match(source, /waitForGiantMaterialJob/);
  assert.match(source, /BatchFactoryGiantMaterialExecutorStatus/);
  assert.match(source, /正在 OCR 读取滚屏正文/);
  assert.match(source, /buildGiantMaterialIntake/);
  assert.doesNotMatch(source, /extractGiantMaterial\(/);
});
