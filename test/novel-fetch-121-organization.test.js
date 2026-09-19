const test = require('node:test');
const assert = require('node:assert/strict');
const target = require('../lib/target-upload');

test('121 upload fields include the selected organization ownership', () => {
  const fields = target.buildUploadFields({
    platformId: 15,
    gender: '女',
    style: '现代甜文',
    organization: 1,
    advanced: {}
  });

  assert.equal(fields.organization, '1');
});
