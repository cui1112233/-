import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScriptVideoPayload,
  collectShotReferenceImages,
  getEntityMedia,
  setEntityMainImage,
  toggleShotReferenceState
} from './scriptVideoReferences.js';

function entity(id, name, imageUrls = [], mainImageUrl = '') {
  return { id, data: { 名称: name }, imageUrls, mainImageUrl };
}

function info(characters = [], scenes = []) {
  return { characters, scenes };
}

test('does not infer a main image from the first candidate image', () => {
  const candidate = entity('lin', '林溪', ['https://img.example/first.png', 'https://img.example/second.png']);

  assert.deepEqual(getEntityMedia(candidate), {
    imageUrls: ['https://img.example/first.png', 'https://img.example/second.png'],
    mainImageUrl: ''
  });
  assert.deepEqual(collectShotReferenceImages({ shotText: '林溪站在门口', extractInfo: info([candidate]) }), []);
});

test('changes only the explicitly selected entity main image', () => {
  const lin = entity('lin', '林溪', ['https://img.example/first.png', 'https://img.example/second.png']);
  const wei = entity('wei', '卫铭', ['https://img.example/wei.png'], 'https://img.example/wei.png');
  const next = setEntityMainImage(info([lin, wei]), 'characters', 'lin', 'https://img.example/second.png');

  assert.equal(next.characters[0].mainImageUrl, 'https://img.example/second.png');
  assert.equal(next.characters[1].mainImageUrl, 'https://img.example/wei.png');
  assert.equal(lin.mainImageUrl, '');
});

test('shot reference state is isolated and disabling a shot does not clear global main images', () => {
  const lin = entity('lin', '林溪', [], 'https://img.example/lin.png');
  const states = toggleShotReferenceState({}, 0, { enabled: false });
  const nextStates = toggleShotReferenceState(states, 1, { enabled: true });
  const extractInfo = info([lin]);

  assert.deepEqual(collectShotReferenceImages({ shotText: '林溪推门', extractInfo, shotIndex: 0, shotReferenceStates: nextStates }), []);
  assert.deepEqual(collectShotReferenceImages({ shotText: '林溪推门', extractInfo, shotIndex: 1, shotReferenceStates: nextStates }), ['https://img.example/lin.png']);
  assert.equal(extractInfo.characters[0].mainImageUrl, 'https://img.example/lin.png');
  assert.deepEqual(nextStates[0], { enabled: false, disabledImageUrls: [] });
  assert.deepEqual(nextStates[1], { enabled: true, disabledImageUrls: [] });
});

test('collects only current-shot entities in character-first then scene order', () => {
  const lin = entity('lin', '林溪', [], 'https://img.example/lin.png');
  const wei = entity('wei', '卫铭', [], 'https://img.example/wei.png');
  const hotel = entity('hotel', '酒店房间', [], 'https://img.example/hotel.png');
  const office = entity('office', '公司办公室', [], 'https://img.example/office.png');

  assert.deepEqual(collectShotReferenceImages({
    shotText: '林溪推开酒店房间的门，看见卫铭站在窗边。',
    extractInfo: info([lin, wei], [hotel, office])
  }), [
    'https://img.example/lin.png',
    'https://img.example/wei.png',
    'https://img.example/hotel.png'
  ]);
});

test('deduplicates URLs and caps H3 references at nine', () => {
  const characters = Array.from({ length: 10 }, (_, index) => entity(`character-${index}`, `角色${index + 1}`, [], `https://img.example/${index}.png`));
  const scenes = [
    entity('scene-1', '场景一', [], 'https://img.example/0.png'),
    entity('scene-2', '场景二', [], 'https://img.example/scene-2.png'),
    entity('scene-3', '场景三', [], 'https://img.example/scene-3.png')
  ];
  const shotText = [...characters.map(item => item.data.名称), ...scenes.map(item => item.data.名称)].join(' ');

  assert.deepEqual(collectShotReferenceImages({ shotText, extractInfo: info(characters, scenes) }), [
    'https://img.example/0.png',
    'https://img.example/1.png',
    'https://img.example/2.png',
    'https://img.example/3.png',
    'https://img.example/4.png',
    'https://img.example/5.png',
    'https://img.example/6.png',
    'https://img.example/7.png',
    'https://img.example/8.png'
  ]);
});

test('disabled individual references are excluded without changing other shots', () => {
  const lin = entity('lin', '林溪', [], 'https://img.example/lin.png');
  const wei = entity('wei', '卫铭', [], 'https://img.example/wei.png');
  const states = toggleShotReferenceState({}, 0, { disabledImageUrls: ['https://img.example/lin.png'] });

  assert.deepEqual(collectShotReferenceImages({ shotText: '林溪和卫铭', extractInfo: info([lin, wei]), shotIndex: 0, shotReferenceStates: states }), ['https://img.example/wei.png']);
  assert.deepEqual(collectShotReferenceImages({ shotText: '林溪和卫铭', extractInfo: info([lin, wei]), shotIndex: 1, shotReferenceStates: states }), ['https://img.example/lin.png', 'https://img.example/wei.png']);
});

test('all video payloads carry selected references while capping at nine', () => {
  const imageUrls = Array.from({ length: 12 }, (_, index) => `https://img.example/${index}.png`);

  assert.deepEqual(buildScriptVideoPayload({
    prompt: '林溪转身',
    modelKey: 'minimax-h3-video',
    duration: 15,
    resolution: '480p竖',
    imageUrls
  }), {
    prompt: '林溪转身',
    modelKey: 'minimax-h3-video',
    duration: 15,
    resolution: '480p竖',
    imageUrls: imageUrls.slice(0, 9)
  });
  assert.deepEqual(buildScriptVideoPayload({ prompt: '林溪转身', modelKey: 'yd2-mini-video', imageUrls }), {
    prompt: '林溪转身',
    modelKey: 'yd2-mini-video',
    imageUrls: imageUrls.slice(0, 9)
  });
});
