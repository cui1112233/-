const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const target = require('./target-upload');

test('builds one 121 book package with an ID-named TXT and custom AI-head MP4', () => {
  const multipart = target.buildMultipart({ jieya_ai_head: '3' }, [
    { field: 'files[]', filename: target.buildTargetUploadFilename('2080310440299710279'), content: '单书正文', contentType: 'text/plain; charset=utf-8' },
    { field: 'ai_head_videos[]', filename: '2080310440299710279.mp4', content: Buffer.from([0, 1, 2, 3]), contentType: 'video/mp4' }
  ]);

  const body = multipart.body.toString('latin1');
  assert.match(body, /name="jieya_ai_head"\r\n\r\n3\r\n/);
  assert.match(body, /name="files\[\]"; filename="2080310440299710279\.txt"/);
  assert.match(body, /name="ai_head_videos\[\]"; filename="2080310440299710279\.mp4"/);
  assert.match(body, /Content-Type: video\/mp4/);
});

test('keeps the legacy TXT upload call compatible while allowing custom AI head mode', () => {
  assert.equal(target.normalizeAdvanced({ jieyaAiHead: 3 }).jieyaAiHead, 3);
  const multipart = target.buildMultipart({}, { filename: '123.txt', content: '正文' });
  assert.match(multipart.body.toString('utf8'), /name="files\[\]"; filename="123\.txt"/);
});

test('uses HTTPS default port 443 for a 121 pre-signed asset URL', async () => {
  const originalRequest = https.request;
  let options;
  https.request = (requestOptions, callback) => {
    options = requestOptions;
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.write = () => true;
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = {};
      callback(response);
      response.emit('end');
    };
    return request;
  };
  try {
    await target.requestHttp({ method: 'PUT', url: 'https://assets.example.test/object.mp4', body: Buffer.from('video') });
    assert.equal(options.port, 443);
  } finally {
    https.request = originalRequest;
  }
});
