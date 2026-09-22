import assert from 'node:assert/strict';
import test from 'node:test';
import { publicationMetadataValue } from './batchFactoryPublicationMetadata.js';

test('labels a missing publication field as pending AI classification', () => {
  assert.equal(publicationMetadataValue({}, 'style'), '待 AI 判断');
  assert.equal(publicationMetadataValue({ gender: '女频' }, 'gender'), '女频');
});
