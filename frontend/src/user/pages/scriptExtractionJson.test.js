import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractJSON } from './scriptExtractionJson.js';

const extractionPromptPath = new URL('../../../../prompts/%E4%BA%BA%E7%89%A9%E5%9C%BA%E6%99%AF%E6%8F%90%E5%8F%96.md', import.meta.url);

test('script extraction accepts a fenced JSON reply with trailing commas', () => {
  assert.deepEqual(extractJSON('说明如下：\n```json\n{\n  "人物设定": [{"角色名称": "妻子",}],\n  "场景设定": [],\n}\n```'), {
    人物设定: [{ 角色名称: '妻子' }],
    场景设定: []
  });
});

test('the bundled character and scene extraction example is strict JSON', () => {
  const prompt = readFileSync(extractionPromptPath, 'utf8');
  const sample = prompt.match(/```json\s*([\s\S]*?)```/i)?.[1];

  assert.ok(sample, 'expected the extraction prompt to include one JSON example');
  assert.doesNotThrow(() => JSON.parse(sample));
});
