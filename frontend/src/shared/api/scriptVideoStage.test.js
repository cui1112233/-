import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { isScriptVideoTaskActive, scriptVideoStageLabel } from './scriptVideoStage.js';

test('maps local executor stages to precise user-facing labels', () => {
  const cases = {
    queued: '等待执行器领取',
    leased: '执行器已领取',
    preparing: '正在准备豆包页面',
    submitting: '正在提交豆包任务',
    acceptance_unknown: '正在确认豆包是否接单',
    accepted: '豆包已接单',
    generating: '豆包正在生成视频',
    downloading: '正在下载视频',
    uploading: '正在回传视频',
    succeeded: '已完成',
    failed: '失败',
    cancelled: '已取消'
  };
  for (const [stage, label] of Object.entries(cases)) {
    assert.equal(scriptVideoStageLabel(stage, stage === 'succeeded' ? 'succeeded' : stage === 'failed' ? 'failed' : 'processing'), label);
  }
});

test('generic processing without a real local stage does not pretend video generation has started', () => {
  assert.equal(scriptVideoStageLabel('', 'processing'), '视频任务处理中');
  assert.notEqual(scriptVideoStageLabel('queued', 'processing'), '豆包正在生成视频');
  assert.notEqual(scriptVideoStageLabel('acceptance_unknown', 'processing'), '豆包正在生成视频');
  assert.equal(scriptVideoStageLabel('generating', 'processing'), '豆包正在生成视频');
});

test('only non-terminal tasks are considered active for polling', () => {
  assert.equal(isScriptVideoTaskActive({ taskId: 'a', status: 'processing', stage: 'queued' }), true);
  assert.equal(isScriptVideoTaskActive({ taskId: 'a', status: 'processing', stage: 'uploading' }), true);
  assert.equal(isScriptVideoTaskActive({ taskId: 'a', status: 'succeeded', stage: 'succeeded' }), false);
  assert.equal(isScriptVideoTaskActive({ taskId: 'a', status: 'failed', stage: 'failed' }), false);
  assert.equal(isScriptVideoTaskActive({ taskId: 'a', status: 'cancelled', stage: 'cancelled' }), false);
  assert.equal(isScriptVideoTaskActive({ status: 'processing', stage: 'queued' }), false);
});

test('ScriptPage consumes the real local-executor list field and persists intermediate task stages', async () => {
  const source = await readFile(new URL('../../user/pages/ScriptPage.jsx', import.meta.url), 'utf8');
  assert.match(source, /result\?\.executors/);
  assert.doesNotMatch(source, /result\?\.items/);
  assert.match(source, /isScriptVideoTaskActive/);
  assert.match(source, /stage:\s*result\.stage\s*\|\|\s*'queued'/);
  assert.match(source, /setShotVideoTasks\(current\s*=>\s*\(\{[\s\S]*\.\.\.task/);
});

test('ShotOutputCards renders precise task stage labels instead of generic 视频生成中', async () => {
  const source = await readFile(new URL('../../user/components/ShotOutputCards.jsx', import.meta.url), 'utf8');
  assert.match(source, /scriptVideoStageLabel/);
  assert.match(source, /isScriptVideoTaskActive/);
  assert.doesNotMatch(source, /视频生成中/);
});
