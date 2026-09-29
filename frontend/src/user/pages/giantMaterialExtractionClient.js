import { getToken } from '../../shared/api/client.js';

export async function resolveGiantMaterial(giantMaterialId, { signal } = {}, fetchImpl = fetch) {
  const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ giantMaterialId }), signal };
  const response = await fetchImpl('/__local/giant-material-test/resolve', options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) throw new Error(payload.code || `HTTP_${response.status}`);
  return payload.material;
}

export async function resolveGiantMaterialForBatch(giantMaterialId, { signal } = {}, fetchImpl = fetch) {
  const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ giantMaterialId }), signal };
  try {
    const token = getToken();
    if (token) options.headers.Authorization = `Bearer ${token}`;
  } catch (_) { /* the local development fallback does not have browser storage */ }
  const response = await fetchImpl('/api/shuihuo-production/giant-material-resolve', options);
  if (response.status === 404 || response.status === 405) return resolveGiantMaterial(giantMaterialId, { signal }, fetchImpl);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) throw new Error(payload.code || payload.error || `HTTP_${response.status}`);
  if (!payload.material) throw new Error('QINGYU_MATERIAL_RESPONSE_INVALID');
  return payload.material;
}

export async function extractGiantMaterial(giantMaterialId, { signal, onProgress = () => {}, onComplete = () => {} } = {}, fetchImpl = fetch) {
  const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ giantMaterialId }), signal };
  const extraction = await fetchImpl('/__local/giant-material-test/extract', options);
  return readExtractionStream(extraction, event => {
    if (event.type === 'progress') onProgress(event);
    if (event.type === 'complete') onComplete(event.result);
  });
}

export async function readGiantMaterialContent(giantMaterialId, { signal, onResolved = () => {}, onProgress = () => {}, onComplete = () => {} } = {}, fetchImpl = fetch) {
  const material = await resolveGiantMaterial(giantMaterialId, { signal }, fetchImpl);
  onResolved(material);
  return extractGiantMaterial(giantMaterialId, { signal, onProgress, onComplete }, fetchImpl);
}

export async function readExtractionStream(response, onEvent = () => {}) {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.code || `HTTP_${response.status}`);
  }
  if (!response.body) throw new Error('OCR_STREAM_INCOMPLETE');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '', result;
  const accept = raw => {
    if (!raw.trim()) return;
    let event;
    try { event = JSON.parse(raw); } catch { throw new Error('OCR_STREAM_INVALID'); }
    if (event.type === 'error') throw new Error(event.code || 'OCR_EXECUTION_FAILED');
    if (event.type === 'complete') {
      if (typeof event.result?.text !== 'string' || !event.result.text.trim()) throw new Error('OCR_STREAM_INVALID');
      result = event.result;
    } else if (event.type !== 'progress') throw new Error('OCR_STREAM_INVALID');
    onEvent(event);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (pending.length > 2 * 1024 * 1024) throw new Error('OCR_STREAM_INVALID');
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        accept(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
      if (done) { accept(pending); break; }
    }
    if (!result) throw new Error('OCR_STREAM_INCOMPLETE');
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
