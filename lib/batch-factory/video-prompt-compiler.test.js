const test = require('node:test');
const assert = require('node:assert/strict');
const { compileVideoPrompt } = require('./video-prompt-compiler');

test('compiles video with its own ratio and resolution, not image ratio', () => {
  const result = compileVideoPrompt({
    directorResult: { characters: [], scenes: [], props: [] },
    video: { duration_sec: 10, visualPrompt: '人物走进房间', characters: [], props: [] },
    settings: { imageAspectRatio: '1:1', videoAspectRatio: '16:9', videoResolution: '1080p' }
  });
  assert.equal(result.aspect_ratio, '16:9');
  assert.equal(result.resolution, '1080p');
  assert.doesNotMatch(result.compiledPrompt, /1:1/);
});
