import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchPetApply, dispatchPetContext, dispatchPetState } from './stacky.js';
import { cmDraftToApply, cmInteractionView } from './cmInteraction.js';
import { applyCmDraft } from '../../user/pages/scriptPetInteractions.js';

function installEventWindow() {
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;
  const target = new EventTarget();
  globalThis.window = target;
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, options = {}) {
      super(type);
      this.detail = options.detail;
    }
  };
  return () => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = previousCustomEvent;
  };
}

test('CM context dispatch renders completed script bubble and seven quick actions', () => {
  const restore = installEventWindow();
  let context = {};
  let state = 'idle';
  window.addEventListener('qiantie:pet-context', event => { context = event.detail; });
  window.addEventListener('qiantie:pet-state', event => { state = event.detail.state; });

  try {
    dispatchPetContext({ pagePath: '/script', entities: { hasOutput: true } });
    dispatchPetState('success');

    const view = cmInteractionView(state, context, () => 0);
    assert.equal(view.bubbleText, '剧本生成好了。要 CM 帮您检查哪里还能更好吗~');
    assert.equal(view.quickActions.length, 7);
    assert.deepEqual(view.quickActions.map(action => action.label), [
      '分析整体质量', '找出最弱的段落', '优化开头 10 秒', '检查人物一致性',
      '检查场景与画面感', '强化冲突与反转', '生成修改稿'
    ]);
  } finally {
    restore();
  }
});

test('CM marked draft exposes apply action and applies through the pet event to ScriptPage adapter', () => {
  const restore = installEventWindow();
  const updates = [];
  const editing = [];
  const notices = [];
  const message = '分析完成。\n【修改稿】\n新的剧本文本';
  const onApply = event => applyCmDraft(event, {
    updateOutputDraft: content => updates.push(content),
    setEditingOutput: value => editing.push(value),
    success: text => notices.push(text)
  });
  window.addEventListener('qiantie:pet-apply', onApply);

  try {
    assert.equal(cmDraftToApply(message, true), '新的剧本文本');
    assert.equal(cmDraftToApply(message, false), '');
    dispatchPetApply(cmDraftToApply(message, true));
    assert.deepEqual(updates, ['新的剧本文本']);
    assert.deepEqual(editing, [true]);
    assert.deepEqual(notices, ['CM 的修改稿已写入当前剧本，请继续检查后保存。']);
  } finally {
    window.removeEventListener('qiantie:pet-apply', onApply);
    restore();
  }
});
