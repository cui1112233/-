const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDirectorOutput } = require('../lib/batch-factory/director-output');
const { compileVideoPrompt } = require('../lib/batch-factory/video-prompt-compiler');
const { normalizeSettings, normalizeSourceItem } = require('../lib/batch-factory/store');
const { canonicalModelSettings } = require('../routes/batch-factory');
const { boundModelError } = require('../routes/batch-factory-production');
const { createMySQLBatchFactoryStore } = require('../lib/batch-factory/mysql-store');
async function loadIntake() { return import('../frontend/src/user/pages/batch-factory/intake.js'); }

test('手动粘贴按编号拆分并把长数字识别为 Book ID', async () => {
  const { parseManualNovels } = await loadIntake();
  assert.deepEqual(parseManualNovels('1\n标题甲\n正文甲\n\n2、\n标题乙\n正文乙'), [
    { title: '标题甲', bookId: '', sourceText: '标题甲\n正文甲', txtText: '标题甲\n正文甲', sourceType: 'manual' },
    { title: '标题乙', bookId: '', sourceText: '标题乙\n正文乙', txtText: '标题乙\n正文乙', sourceType: 'manual' }
  ]);
  assert.deepEqual(parseManualNovels('10001\n标题丙\n正文丙'), [
    { title: '标题丙', bookId: '10001', sourceText: '标题丙\n正文丙', txtText: '标题丙\n正文丙', sourceType: 'manual' }
  ]);
});

test('上传文件按文件名推导书名或 Book ID，并标记重复项', async () => {
  const { fileToDraft, validateDraftItems } = await loadIntake();
  assert.deepEqual(fileToDraft('10002.txt', '标题丁\n正文丁'), {
    title: '标题丁', bookId: '10002', sourceText: '标题丁\n正文丁', txtText: '标题丁\n正文丁', sourceType: 'manual'
  });
  assert.equal(fileToDraft('都市-01.md', '标题戊\n正文戊').title, '都市-01');
  assert.deepEqual(validateDraftItems([
    { title: '同名', bookId: '9', sourceText: '正文一' },
    { title: '同名', bookId: '9', sourceText: '正文二' }
  ]).map(item => item.duplicateFields), [['bookId', 'title'], ['bookId', 'title']]);
  assert.throws(() => validateDraftItems([{ title: '空', bookId: 'x', sourceText: '' }]), /正文不能为空/);
});

function baseResult(videos) {
  return {
    characters: [{ name: '林晚', prompt: '18岁中国女性，黑色长发，现代服装。' }],
    scenes: [{ name: '林家客厅', prompt: '现代中式客厅，深色木质家具。' }],
    props: [{ name: '玻璃杯', prompt: '透明厚底玻璃杯。' }],
    storyboard: videos,
    source_coverage: { source_complete: true, source_end_marker: '结束', has_remaining_source: false }
  };
}

function video(id, duration, ranges, overrides = {}) {
  return {
    id,
    scene_id: id,
    duration_sec: duration,
    characters: ['林晚'],
    scene: '林家客厅',
    props: ['玻璃杯'],
    prefix_key: 'modern_conflict',
    shots: ranges.map(([start, end], index) => ({
      start_sec: start,
      end_sec: end,
      shot_type: index === 0 ? '中景' : '特写',
      camera: '缓慢推轨',
      description: `镜头 ${index + 1}`
    })),
    video_desc: '0-3秒：林晚走入客厅。',
    ...overrides
  };
}

test('小说获取交接保留超长书ID并固定 TXT 文件名', () => {
  const item = normalizeSourceItem({
    sourceTaskId: 174263,
    bookId: '2074141710842647315',
    title: '余生不逢云',
    platform: '知乎付费',
    sourceText: '用于制作的视频开篇文本',
    txtText: '需要后续原样上传的小说TXT',
    metadata: { gender: '女频' }
  }, 0, { sourceType: 'novel-fetch' });

  assert.equal(item.sourceTaskId, '174263');
  assert.equal(item.bookId, '2074141710842647315');
  assert.equal(item.platform, '知乎付费');
  assert.equal(item.txtFileName, '2074141710842647315.txt');
  assert.equal(item.txtText, '需要后续原样上传的小说TXT');
  assert.equal(item.sourceMetadata.gender, '女频');
});

test('小说获取交接缺少任务ID或书ID时拒绝进入批量工厂', () => {
  assert.throws(() => normalizeSourceItem({ bookId: '123', sourceText: '正文' }, 0, { sourceType: 'novel-fetch' }), /任务ID/);
  assert.throws(() => normalizeSourceItem({ sourceTaskId: '8', sourceText: '正文' }, 0, { sourceType: 'novel-fetch' }), /书ID/);
});

test('MySQL 批量工厂存储要求当前登录账号作为桥接身份', () => {
  assert.throws(() => createMySQLBatchFactoryStore(), /当前登录账号不可用/);
});

test('批量设置保存导演绑定的视频模型与时长能力快照', () => {
  const settings = normalizeSettings({
    videoModelId: 18,
    videoModelVersionId: 42,
    videoModelName: 'Seedance 2.0',
    maxVideoDuration: 15,
    fixedSingleVideo: true,
    aspectRatio: '9:16'
  });
  assert.equal(settings.videoModelId, 18);
  assert.equal(settings.videoModelVersionId, 42);
  assert.equal(settings.videoModelName, 'Seedance 2.0');
  assert.equal(settings.maxVideoDuration, 15);
  assert.equal(settings.exactDuration, 15);
});

test('创建批次时服务端模型能力覆盖客户端伪造值', () => {
  const settings = canonicalModelSettings({
    videoModelId: 18,
    videoModelVersionId: 1,
    videoModelName: '伪造名称',
    maxVideoDuration: 60,
    aspectRatio: '9:16'
  }, {
    id: 18,
    versionId: 42,
    name: 'Seedance 2.0',
    maxVideoDuration: 15
  });
  assert.equal(settings.videoModelId, 18);
  assert.equal(settings.videoModelVersionId, 42);
  assert.equal(settings.videoModelName, 'Seedance 2.0');
  assert.equal(settings.maxVideoDuration, 15);
  assert.equal(settings.aspectRatio, '9:16');
});

test('生成阶段拒绝把已导演批次换成另一视频模型', () => {
  const batch = { settings: { videoModelId: 18, videoModelName: 'Seedance 2.0' } };
  assert.equal(boundModelError(batch, 18), '');
  assert.match(boundModelError(batch, 19), /已绑定 Seedance 2\.0/);
  assert.equal(boundModelError({ settings: {} }, 19), '');
});

test('普通 15s 模式允许按剧情输出 13s、12s、10s 多个 VIDEO', () => {
  const result = normalizeDirectorOutput(baseResult([
    video(1, 13, [[0, 4], [4, 8], [8, 13]]),
    video(2, 12, [[0, 4], [4, 7], [7, 12]]),
    video(3, 10, [[0, 3], [3, 6], [6, 10]])
  ]), {
    maxVideoDuration: 15,
    fixedSingleVideo: false,
    aspectRatio: '9:16',
    allowedPrefixKeys: ['modern_conflict']
  });
  assert.deepEqual(result.storyboard.map(item => item.duration_sec), [13, 12, 10]);
});

test('普通模式拒绝超过模型最大时长', () => {
  assert.throws(() => normalizeDirectorOutput(baseResult([
    video(1, 11, [[0, 5], [5, 11]])
  ]), {
    maxVideoDuration: 10,
    fixedSingleVideo: false,
    aspectRatio: '9:16',
    allowedPrefixKeys: ['modern_conflict']
  }), /1-10/);
});

test('最终 duration_sec 必须是整数', () => {
  assert.throws(() => normalizeDirectorOutput(baseResult([
    video(1, 9.5, [[0, 4], [4, 9]])
  ]), {
    maxVideoDuration: 15,
    fixedSingleVideo: false,
    aspectRatio: '9:16',
    allowedPrefixKeys: ['modern_conflict']
  }), /整数/);
});

test('固定单镜头只允许一个 VIDEO 且必须严格等于选择时长', () => {
  assert.throws(() => normalizeDirectorOutput(baseResult([
    video(1, 15, [[0, 5], [5, 10], [10, 15]]),
    video(2, 15, [[0, 5], [5, 10], [10, 15]])
  ]), {
    maxVideoDuration: 15,
    exactDuration: 15,
    fixedSingleVideo: true,
    aspectRatio: '9:16',
    allowedPrefixKeys: ['modern_conflict']
  }), /只能输出一个视频单元/);

  assert.throws(() => normalizeDirectorOutput(baseResult([
    video(1, 13, [[0, 4], [4, 8], [8, 13]])
  ]), {
    maxVideoDuration: 15,
    exactDuration: 15,
    fixedSingleVideo: true,
    aspectRatio: '9:16',
    allowedPrefixKeys: ['modern_conflict']
  }), /严格输出 15 秒/);
});

test('镜头时间轴不得留空、重叠，最后必须等于 VIDEO 时长', () => {
  assert.throws(() => normalizeDirectorOutput(baseResult([
    video(1, 10, [[0, 3], [4, 10]])
  ]), {
    maxVideoDuration: 10,
    fixedSingleVideo: false,
    aspectRatio: '9:16',
    allowedPrefixKeys: ['modern_conflict']
  }), /必须连续/);

  assert.throws(() => normalizeDirectorOutput(baseResult([
    video(1, 10, [[0, 4], [4, 9]])
  ]), {
    maxVideoDuration: 10,
    fixedSingleVideo: false,
    aspectRatio: '9:16',
    allowedPrefixKeys: ['modern_conflict']
  }), /结束在 10 秒/);
});

test('视频 Prompt 编译时同时注入秒数、画幅、人物场景道具和前缀', () => {
  const directorResult = normalizeDirectorOutput(baseResult([
    video(1, 9, [[0, 3], [3, 6], [6, 9]])
  ]), {
    maxVideoDuration: 10,
    fixedSingleVideo: false,
    aspectRatio: '16:9',
    allowedPrefixKeys: ['modern_conflict']
  });
  const payload = compileVideoPrompt({
    directorResult,
    video: directorResult.storyboard[0],
    settings: {
      aspectRatio: '16:9',
      prefixMode: 'auto',
      customPrefix: '禁止Q版',
      quality: '4K超清',
      restriction: '禁止无关字幕',
      negative: '禁止水印'
    },
    autoPrefix: '高情绪现代都市动漫短剧'
  });

  assert.equal(payload.duration, 9);
  assert.equal(payload.aspect_ratio, '16:9');
  assert.match(payload.prompt, /【视频时长：9秒】/);
  assert.match(payload.prompt, /【画幅：16:9】/);
  assert.match(payload.prompt, /高情绪现代都市动漫短剧/);
  assert.match(payload.prompt, /禁止Q版/);
  assert.match(payload.prompt, /林晚：18岁中国女性/);
  assert.match(payload.prompt, /林家客厅：现代中式客厅/);
  assert.match(payload.prompt, /玻璃杯：透明厚底玻璃杯/);
  assert.match(payload.prompt, /4K超清/);
  assert.match(payload.prompt, /禁止无关字幕/);
  assert.match(payload.prompt, /禁止水印/);
});
