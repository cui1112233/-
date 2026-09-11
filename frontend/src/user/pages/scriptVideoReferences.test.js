import test from 'node:test';
import assert from 'node:assert/strict';

test('matches only current-shot image-backed characters and scenes', async () => {
  const { collectShotReferenceDescriptors } = await import('./scriptVideoReferences.js');
  const refs = collectShotReferenceDescriptors({
    shotText: '张高走进医院走廊。',
    extractInfo: {
      characters: [
        { id: 'c1', data: { 名称: '张高' }, mainImageUrl: 'https://img.example/zhang.png' },
        { id: 'c2', data: { 名称: '林悦' }, mainImageUrl: 'https://img.example/lin.png' }
      ],
      scenes: [{ id: 's1', data: { 场景名称: '医院走廊' }, mainImageUrl: 'https://img.example/hospital.png' }]
    }
  });
  assert.deepEqual(refs.map(item => item.label), ['张高', '医院走廊']);
});

test('does not fall back to unrelated image-backed entities', async () => {
  const { collectShotReferenceDescriptors } = await import('./scriptVideoReferences.js');
  const refs = collectShotReferenceDescriptors({
    shotText: '一名年轻人抬头。',
    extractInfo: { characters: [{ data: { 名称: '张高' }, mainImageUrl: 'https://img.example/zhang.png' }] }
  });
  assert.deepEqual(refs, []);
});

test('matches aliases, removes duplicate URLs, and caps at nine references', async () => {
  const { collectShotReferenceDescriptors } = await import('./scriptVideoReferences.js');
  const characters = Array.from({ length: 10 }, (_, index) => ({
    data: { 名称: `人物${index + 1}`, 别名: index === 0 ? '小张' : '' },
    mainImageUrl: `https://img.example/${index + 1}.png`
  }));
  const refs = collectShotReferenceDescriptors({
    shotText: `小张 ${characters.slice(1).map(item => item.data.名称).join(' ')}`,
    extractInfo: {
      characters: [{ ...characters[0], mainImageUrl: 'https://img.example/1.png' }, ...characters.slice(1)],
      scenes: [{ data: { 名称: '客厅' }, mainImageUrl: 'https://img.example/1.png' }]
    }
  });
  assert.equal(refs.length, 9);
  assert.equal(new Set(refs.map(item => item.url)).size, 9);
  assert.equal(refs[0].label, '人物1');
});
