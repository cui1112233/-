const test = require('node:test');
const assert = require('node:assert/strict');

const { repairMojibakeText } = require('../lib/novel-fetch-workshop/text-encoding');

test('repairs UTF-8 text that was decoded as Latin-1 once', () => {
  const mojibake = String.fromCodePoint(
    0xe4, 0xbd, 0xa0, 0xe6, 0x02dc, 0xaf, 0xe7, 0x0178, 0xad,
    0xe8, 0xa7, 0x2020, 0xe9, 0xa2, 0x2018, 0xe5, 0xb0, 0x8f,
    0xe8, 0xaf, 0xb4
  );
  assert.equal(repairMojibakeText(mojibake), '你是短视频小说');
  assert.equal(repairMojibakeText(String.fromCodePoint(0xef, 0xbc, 0x178, 0xe3, 0x80, 0x201a)), '？。');
});

test('leaves valid Chinese and ordinary ASCII unchanged', () => {
  assert.equal(repairMojibakeText('你是短视频小说'), '你是短视频小说');
  assert.equal(repairMojibakeText('plain prompt 123'), 'plain prompt 123');
});
