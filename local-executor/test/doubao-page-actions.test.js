const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DoubaoPageActions, DoubaoControlError } = require('../src/doubao-page-actions');

test('setPrompt uses the live prompt editor and fails closed when none exists', async () => {
  const calls = [];
  const webContents = {
    async executeJavaScript(script, userGesture) {
      calls.push([script, userGesture]);
      return { ok: true, kind: 'contenteditable' };
    }
  };
  const result = await new DoubaoPageActions().setPrompt(webContents, '雨夜城市');
  assert.equal(result.kind, 'contenteditable');
  assert.equal(calls[0][1], true);
  assert.equal(calls[0][0].includes('雨夜城市'), true);

  const missing = { async executeJavaScript() { return { ok: false, reason: 'not_found' }; } };
  await assert.rejects(() => new DoubaoPageActions().setPrompt(missing, 'x'), error => error instanceof DoubaoControlError && error.code === 'PROMPT_INPUT_NOT_FOUND');
});

test('exact option click fails when zero or multiple live controls match', async () => {
  const actions = new DoubaoPageActions();
  await assert.rejects(() => actions.clickExactControl({ async executeJavaScript() { return { count: 0 }; } }, '10秒'), error => error.code === 'CONTROL_NOT_FOUND');
  await assert.rejects(() => actions.clickExactControl({ async executeJavaScript() { return { count: 2 }; } }, '10秒'), error => error.code === 'CONTROL_AMBIGUOUS');
  const clicked = await actions.clickExactControl({ async executeJavaScript() { return { count: 1, clicked: true }; } }, '10秒');
  assert.equal(clicked, true);
});

test('reference image upload uses CDP file input assignment without a file chooser', async () => {
  const debug = new EventEmitter();
  debug.isAttached = () => true;
  const commands = [];
  debug.sendCommand = async (method, params) => {
    commands.push([method, params]);
    if (method === 'Runtime.evaluate') return { result: { objectId: 'object-file-input' } };
    return {};
  };
  const actions = new DoubaoPageActions();
  await actions.setReferenceImages({ debugger: debug }, ['/tmp/a.png', '/tmp/b.jpg']);
  assert.ok(commands.some(([method]) => method === 'Runtime.evaluate'));
  assert.ok(commands.some(([method, params]) => method === 'DOM.setFileInputFiles'
    && params.objectId === 'object-file-input'
    && params.files.length === 2));
});

test('normal confirmation is limited to explicit generation confirmation labels', async () => {
  const actions = new DoubaoPageActions();
  const none = await actions.confirmNormal({ async executeJavaScript(script) {
    assert.equal(script.includes('确认生成'), true);
    assert.equal(script.includes('继续生成'), true);
    return { count: 0, clicked: false };
  } });
  assert.equal(none, false);
});
