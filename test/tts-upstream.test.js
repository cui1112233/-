const assert = require('node:assert/strict');
const test = require('node:test');

const { TTS_UPSTREAM } = require('../routes/tts');

test('TTS proxy uses the tts3.121w.com upstream for speech synthesis', () => {
  assert.equal(TTS_UPSTREAM.origin, 'http://tts3.121w.com');
  assert.equal(TTS_UPSTREAM.hostname, 'tts3.121w.com');
  assert.equal(TTS_UPSTREAM.path, '/v1/audio/speech');
});
