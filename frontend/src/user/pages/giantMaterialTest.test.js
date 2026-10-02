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
    materialId: '10122315', giantMaterialId: '7689285397448523826', title: '事不过三', platformBookId: 'book-1', platformName: '七猫', videoUrl: 'https://material.hnqingyuwen.top/a.mp4', width: 720, height: 1280, durationSeconds: 281.03, materialTitle: '', books: []
  });
});

test('reads Qingyu list metadata and preserves both associated platform books', () => {
  const result = normalizeGiantMaterialResponse({ code: 'SUCCESS', data: { list: [{
    id: 10122315, material_id: 0, name: '文韬0925-事不过三,过三遭殃',
    path: 'https://material.hnqingyuwen.top/auto_tool/video/20260925/cc261336bb0d306809f09f0de73ee7ff.mp4',
    width: 720, height: 1280, duration: 281,
    works: [
      { id: 936738, cp_work_id: '748725', cp_type: 'QM', name: '事不过三,过三遭殃' },
      { id: 936739, cp_work_id: '1240820', cp_type: 'QM', name: '事不过三，过三遭殃' }
    ]
  }] } });
  assert.equal(result.materialId, '10122315');
  assert.equal(result.videoUrl, 'https://material.hnqingyuwen.top/auto_tool/video/20260925/cc261336bb0d306809f09f0de73ee7ff.mp4');
  assert.equal(result.platformBookId, '');
  assert.equal(result.platformName, '七猫');
  assert.equal(result.materialTitle, '文韬0925-事不过三,过三遭殃');
  assert.deepEqual(result.books, [
    { platformBookId: '748725', platformName: '七猫', title: '事不过三,过三遭殃' },
    { platformBookId: '1240820', platformName: '七猫', title: '事不过三，过三遭殃' }
  ]);
});

test('shows verified Qingyu platform codes as bookstore names', () => {
  const result = normalizeGiantMaterialResponse({ code: 'SUCCESS', data: { list: [{
    id: 10122318,
    works: [
      { cp_work_id: '748725', cp_type: 'qm', name: '七猫测试书' },
      { cp_work_id: '2053423598178718885', cp_type: 'zh', name: '知乎测试书' }
    ]
  }] } });
  assert.deepEqual(result.books, [
    { platformBookId: '748725', platformName: '七猫', title: '七猫测试书' },
    { platformBookId: '2053423598178718885', platformName: '知乎', title: '知乎测试书' }
  ]);
  assert.equal(result.platformName, '七猫 / 知乎');
});

test('does not select a material arbitrarily from multiple results', () => {
  assert.equal(normalizeGiantMaterialResponse({ data: { list: [{ id: 1 }, { id: 2 }] } }).materialId, '');
});

test('describes an unresolved stage without pretending it succeeded', () => {
  assert.deepEqual(stageState('ocr', 'QINGYU_AUTH_NOT_CONFIGURED'), {
    tone: 'warning', label: '未执行', detail: '当前未配置青语服务令牌'
  });
});
