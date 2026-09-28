import test from 'node:test';
import assert from 'node:assert/strict';
import * as client from './giantMaterialExtractionClient.js';

function response(raw, width = 7) {
  const bytes = new TextEncoder().encode(raw);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += width) controller.enqueue(bytes.slice(i, i + width));
    controller.close();
  } }));
}
test('reads split UTF-8 NDJSON and returns only completed text', async () => {
  const events = [];
  const result = await client.readExtractionStream(response('{"type":"progress","frames":1}\n{"type":"complete","result":{"text":"正常中文正文","characters":6}}\n', 1), e => events.push(e));
  assert.equal(result.text, '正常中文正文');
  assert.equal(events[0].frames, 1);
});
test('rejects error events and incomplete streams', async () => {
  await assert.rejects(() => client.readExtractionStream(response('{"type":"error","code":"OCR_NO_TEXT"}\n')), { message: 'OCR_NO_TEXT' });
  await assert.rejects(() => client.readExtractionStream(response('{"type":"progress","frames":1}\n')), { message: 'OCR_STREAM_INCOMPLETE' });
  await assert.rejects(() => client.readExtractionStream(response('not json\n')), { message: 'OCR_STREAM_INVALID' });
});

test('one read resolves metadata first then extracts the same ID', async () => {
  const requests = [], stages = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, id: JSON.parse(options.body).giantMaterialId, signal: options.signal });
    if (url.endsWith('/resolve')) return Response.json({ ok: true, material: { materialId: '10122315', books: [{ title: '书名' }] } });
    assert.deepEqual(stages, ['resolved']);
    return response('{"type":"complete","result":{"text":"按钮获取的正文","characters":8}}\n');
  };
  const controller = new AbortController();
  const result = await client.readGiantMaterialContent('7689285397448523826', { signal: controller.signal, onResolved: () => stages.push('resolved') }, fetchImpl);
  assert.equal(result.text, '按钮获取的正文');
  assert.deepEqual(requests.map(r => r.url), ['/__local/giant-material-test/resolve', '/__local/giant-material-test/extract']);
  assert.equal(requests.every(r => r.id === '7689285397448523826' && r.signal === controller.signal), true);
});
test('does not start OCR after metadata authentication fails', async () => {
  let calls = 0;
  await assert.rejects(() => client.readGiantMaterialContent('7689285397448523826', {}, async () => { calls++; return Response.json({ code: 'QINGYU_AUTH_FAILED' }, { status: 401 }); }), { message: 'QINGYU_AUTH_FAILED' });
  assert.equal(calls, 1);
});

test('keeps upstream authorization failures as safe stable error codes', async () => {
  await assert.rejects(
    () => client.resolveGiantMaterial('7689285397448523826', {}, async () => Response.json({ code: 'QINGYU_AUTH_FAILED', detail: 'N8-Admin-Token=secret-value' }, { status: 401 })),
    error => error.message === 'QINGYU_AUTH_FAILED' && !error.message.includes('secret-value') && !error.message.includes('N8-Admin-Token')
  );
  await assert.rejects(
    () => client.resolveGiantMaterial('7689285397448523826', {}, async () => Response.json({ code: 'QINGYU_UPSTREAM_FAILED', detail: 'Authorization: Bearer secret-value' }, { status: 503 })),
    error => error.message === 'QINGYU_UPSTREAM_FAILED' && !error.message.includes('secret-value') && !error.message.includes('Authorization')
  );
});
