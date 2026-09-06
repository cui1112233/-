const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const runtimePath = path.resolve(__dirname, '../public/novel-panel/workbench/v783031-runtime.js');
assert.ok(fs.existsSync(runtimePath), 'V78.3.0.31 runtime module must exist');
const source = fs.readFileSync(runtimePath, 'utf8');

const listeners = new Map();
function makeNode(value = '') {
  return { value, addEventListener(type, fn) { listeners.set(`${this.__id || ''}:${type}`, fn); } };
}
const nodes = {
  '#novelText': Object.assign(makeNode('原文A'), { __id: 'novelText' }),
  '#genre': Object.assign(makeNode('现实短剧'), { __id: 'genre' }),
  '#trailerStyle': Object.assign(makeNode('ARRI ALEXA 35，LogC4，避免高光死白，不压黑暗部'), { __id: 'trailerStyle' }),
  '#audioTotalSeconds': Object.assign(makeNode('28'), { __id: 'audioTotalSeconds' }),
};
const document = { readyState: 'complete', querySelector(sel) { return nodes[sel] || null; }, querySelectorAll() { return []; }, addEventListener() {} };
class FakeResponse {
  constructor(body) { this._body = body; this.ok = true; this.status = 200; }
  async json() { return JSON.parse(this._body); }
  async text() { return this._body; }
  clone() { return new FakeResponse(this._body); }
}
let lastFetchBody = '';
async function baseFetch(_url, options = {}) { lastFetchBody = String(options.body || ''); return new FakeResponse(JSON.stringify({ ok: true, scenes: [] })); }
const context = { console, document, window: null, globalThis: null, setTimeout, clearTimeout, queueMicrotask, Event: class Event { constructor(type) { this.type = type; } }, AbortController, AbortSignal, Response: FakeResponse, fetch: baseFetch };
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'v783031-runtime.js' });

const api = context.__V783031_RUNTIME__;
assert.ok(api, 'runtime API must be installed');
assert.equal(context.__V78_STYLE_FIELD_BOUNDARY_FIX__.version, 'v78.3.0.31');
for (const legal of ['无明显暗角', '避免高光死白', '不压黑暗部', '低数字锐化', '控制粗颗粒']) assert.equal(api.hasStyleFieldPollution(legal), false, `${legal} should be legal photography language`);
for (const illegal of ['添加水印', '加入字幕', '显示Logo', '最终导出负面提示', '人物外形要求：瓜子脸']) assert.equal(api.hasStyleFieldPollution(illegal), true, `${illegal} should remain cross-field pollution`);
assert.equal(api.hasDisallowedLatin('ARRI ALEXA 35，LogC4，T2.8，180° shutter，Black Pro-Mist 1/8'), false);
assert.equal(api.hasDisallowedLatin('cinematic random english prose'), true);
assert.equal(vm.runInContext("/(?:不要|禁止|避免|拒绝|不得|无水印|字幕|Logo|水印|负面提示|画面限制|画质约束|人物外形|人物形象精准描写|角色外形|提示词|\\bno\\b|\\bavoid\\b|\\bwithout\\b|\\bmust\\b)/i.test('避免高光死白')", context), false);
assert.equal(vm.runInContext("/(?:不要|禁止|避免|拒绝|不得|无水印|字幕|Logo|水印|负面提示|画面限制|画质约束|人物外形|人物形象精准描写|角色外形|提示词|\\bno\\b|\\bavoid\\b|\\bwithout\\b|\\bmust\\b)/i.test('最终导出负面提示')", context), true);
assert.equal(vm.runInContext("/[A-Za-z]/.test('ARRI ALEXA 35，LogC4，T2.8')", context), false);
assert.equal(vm.runInContext("/[A-Za-z]/.test('random english')", context), true);
assert.ok(api.directorGrammar.includes('Reaction Shot'));
assert.ok(api.directorGrammar.includes('L-cut/J-cut'));
assert.ok(api.directorGrammar.includes('Cut on Action'));
const locked = api.buildPatchTimingContract({ duration: 6, micro_shots: [{start:0,end:3},{start:3,end:6}] });
assert.equal(locked.preserve_total_duration, true);
assert.equal(locked.locked_duration, 6);
assert.deepEqual(JSON.parse(JSON.stringify(locked.locked_micro_slots)), [{start:0,end:3},{start:3,end:6}]);
assert.throws(() => api.assertPatchDurationLocked(locked, { duration: 7 }), /必须严格保持原卡6秒/);
assert.doesNotThrow(() => api.assertPatchDurationLocked(locked, { duration: 6, micro_shots:[{start:0,end:3},{start:3,end:6}] }));
const txA = api.currentSourceTransaction('test-a');
nodes['#novelText'].value = '原文B';
api.markSourceMutation('test-b');
assert.equal(api.sourceTransactionIsCurrent(txA), false);
nodes['#novelText'].value = '原文A';
api.markSourceMutation('test-a-again');
assert.equal(api.sourceTransactionIsCurrent(txA), false, 'A->B->A must still stale old source transaction');
const inputTx = api.currentGenerationTransaction('outline');
nodes['#trailerStyle'].value += '，Sony VENICE 2';
api.markGenerationMutation('style-change');
assert.equal(api.generationTransactionIsCurrent(inputTx), false);

(async () => {
  nodes['#novelText'].value = '原文C';
  api.markSourceMutation('source-c');
  const response = await context.fetch('/api/outline-scenes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: '请生成分镜。所有字符串字段必须为简体中文，不得出现任何英文字母。不得返回英文摄影术语，全部改写为中文。' }) });
  assert.ok(lastFetchBody.includes('专业摄影品牌/型号/标准术语/单位可保留国际通行写法'));
  assert.ok(lastFetchBody.includes('Reaction Shot'));
  nodes['#novelText'].value = '原文D';
  api.markSourceMutation('source-d');
  await assert.rejects(() => response.json(), (error) => error && error.code === 'SOURCE_TRANSACTION_STALE');
  console.log('V78.3.0.31 runtime regression: PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; });
