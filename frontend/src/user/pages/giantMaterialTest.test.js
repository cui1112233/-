import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGiantMaterialId,
  normalizeGiantMaterialResponse,
  stageState
} from './giantMaterialTest.js';

test('accepts only a 10 to 25 digit giant material ID', () => {
  assert.equal(normalizeGiantMaterialId(' 7689285397448523826 '), '7689285397448523826');
  assert.equal(normalizeGiantMaterialId('abc-7689285397448523826'), '');
  assert.equal(normalizeGiantMaterialId('123'), '');
});

test('normalizes only safe material metadata', () => {
  assert.deepEqual(normalizeGiantMaterialResponse({ data: { material_id: 10122315, giant_material_id: '7689285397448523826', title: '事不过三', book_id: 'book-1', platform_name: '七猫', video_url: 'https://material.hnqingyuwen.top/a.mp4', width: 720, height: 1280, duration: 281.03 } }), {
    materialId: '10122315', giantMaterialId: '7689285397448523826', title: '事不过三', platformBookId: 'book-1', platformName: '七猫', videoUrl: 'https://material.hnqingyuwen.top/a.mp4', width: 720, height: 1280, durationSeconds: 281.03
  });
});

test('describes an unresolved stage without pretending it succeeded', () => {
  assert.deepEqual(stageState('ocr', 'QINGYU_AUTH_NOT_CONFIGURED'), {
    tone: 'warning', label: '未执行', detail: '当前未配置青语服务令牌'
  });
});
