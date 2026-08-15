const test = require('node:test');
const assert = require('node:assert/strict');

class FakeBroadcastChannel {
  static channels = [];

  static reset() {
    FakeBroadcastChannel.channels = [];
  }

  constructor(name) {
    this.name = name;
    this.closed = false;
    this.onmessage = null;
    FakeBroadcastChannel.channels.push(this);
  }

  postMessage(message) {
    for (const channel of FakeBroadcastChannel.channels) {
      if (channel !== this && !channel.closed && channel.name === this.name) {
        channel.onmessage?.({ data: message });
      }
    }
  }

  close() {
    this.closed = true;
  }
}

async function loadCoordinator() {
  return import('../frontend/src/user/pages/scriptDraftTabCoordinator.js');
}

test('splits a duplicated script tab while preserving the original tab id', async () => {
  FakeBroadcastChannel.reset();
  const { startScriptDraftTabCoordination } = await loadCoordinator();
  const original = startScriptDraftTabCoordination({
    tabId: 'tab-original',
    createTabId: () => 'unused',
    setTabId: () => assert.fail('original tab must not be reassigned'),
    BroadcastChannelClass: FakeBroadcastChannel,
    timeoutMs: 0
  });
  await original.ready;

  const writes = [];
  const duplicate = startScriptDraftTabCoordination({
    tabId: 'tab-original',
    createTabId: () => 'tab-copy',
    setTabId: id => writes.push(id),
    BroadcastChannelClass: FakeBroadcastChannel,
    timeoutMs: 0
  });

  assert.deepEqual(await duplicate.ready, { tabId: 'tab-copy', split: true });
  assert.deepEqual(writes, ['tab-copy']);
  original.cleanup();
  duplicate.cleanup();
});

test('keeps the tab id when no existing page reports it occupied', async () => {
  FakeBroadcastChannel.reset();
  const { startScriptDraftTabCoordination } = await loadCoordinator();
  const coordinator = startScriptDraftTabCoordination({
    tabId: 'tab-a',
    createTabId: () => 'tab-b',
    setTabId: () => assert.fail('tab id must not change'),
    BroadcastChannelClass: FakeBroadcastChannel,
    timeoutMs: 0
  });

  assert.deepEqual(await coordinator.ready, { tabId: 'tab-a', split: false });
  coordinator.cleanup();
});

test('degrades without BroadcastChannel support', async () => {
  const { startScriptDraftTabCoordination } = await loadCoordinator();
  const coordinator = startScriptDraftTabCoordination({
    tabId: 'tab-a',
    createTabId: () => 'tab-b',
    setTabId: () => assert.fail('tab id must not change'),
    BroadcastChannelClass: null
  });

  assert.deepEqual(await coordinator.ready, { tabId: 'tab-a', split: false });
  coordinator.cleanup();
});

test('degrades when constructing BroadcastChannel throws', async () => {
  const { startScriptDraftTabCoordination } = await loadCoordinator();
  class ThrowingBroadcastChannel {
    constructor() {
      throw new Error('unavailable');
    }
  }

  const coordinator = startScriptDraftTabCoordination({
    tabId: 'tab-a',
    createTabId: () => 'tab-b',
    setTabId: () => assert.fail('tab id must not change'),
    BroadcastChannelClass: ThrowingBroadcastChannel
  });

  assert.deepEqual(await coordinator.ready, { tabId: 'tab-a', split: false });
  coordinator.cleanup();
});

test('ignores unrelated or invalid occupancy messages', async () => {
  FakeBroadcastChannel.reset();
  const { startScriptDraftTabCoordination } = await loadCoordinator();
  let probe;
  const sender = new FakeBroadcastChannel('qiantie:script-draft-tabs');
  sender.onmessage = event => {
    if (event.data.type === 'probe') probe = event.data;
  };
  const writes = [];
  const coordinator = startScriptDraftTabCoordination({
    tabId: 'tab-a',
    createTabId: () => 'tab-b',
    setTabId: id => writes.push(id),
    BroadcastChannelClass: FakeBroadcastChannel,
    timeoutMs: 0
  });

  sender.postMessage({ type: 'unknown', tabId: 'tab-a', instanceId: probe.instanceId });
  sender.postMessage({ type: 'occupied', tabId: 'tab-other', instanceId: probe.instanceId });
  sender.postMessage({ type: 'occupied', tabId: 'tab-a', instanceId: 'different-instance' });

  assert.deepEqual(await coordinator.ready, { tabId: 'tab-a', split: false });
  assert.deepEqual(writes, []);
  coordinator.cleanup();
  sender.close();
});

test('cleanup closes the channel and stops an original page from reporting occupancy', async () => {
  FakeBroadcastChannel.reset();
  const { startScriptDraftTabCoordination } = await loadCoordinator();
  const original = startScriptDraftTabCoordination({
    tabId: 'tab-a',
    createTabId: () => 'unused',
    setTabId: () => assert.fail('original tab must not be reassigned'),
    BroadcastChannelClass: FakeBroadcastChannel,
    timeoutMs: 0
  });
  await original.ready;
  original.cleanup();
  original.cleanup();

  const duplicate = startScriptDraftTabCoordination({
    tabId: 'tab-a',
    createTabId: () => 'tab-b',
    setTabId: () => assert.fail('closed page must not report occupancy'),
    BroadcastChannelClass: FakeBroadcastChannel,
    timeoutMs: 0
  });

  assert.deepEqual(await duplicate.ready, { tabId: 'tab-a', split: false });
  assert.equal(FakeBroadcastChannel.channels[0].closed, true);
  assert.equal(FakeBroadcastChannel.channels[0].onmessage, null);
  duplicate.cleanup();
});
