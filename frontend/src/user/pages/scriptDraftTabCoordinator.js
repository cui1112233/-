const channelName = 'qiantie:script-draft-tabs';

function createInstanceId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `instance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

export function startScriptDraftTabCoordination({
  tabId,
  createTabId,
  setTabId,
  BroadcastChannelClass = globalThis.BroadcastChannel,
  timeoutMs = 80
}) {
  const unchanged = { tabId, split: false };
  if (!tabId || typeof BroadcastChannelClass !== 'function') {
    return { ready: Promise.resolve(unchanged), cleanup() {} };
  }

  let channel;
  try {
    channel = new BroadcastChannelClass(channelName);
  } catch {
    return { ready: Promise.resolve(unchanged), cleanup() {} };
  }

  const instanceId = createInstanceId();
  let occupied = false;
  let cleanedUp = false;
  let timer;
  let resolveReady;
  const ready = new Promise(resolve => {
    resolveReady = resolve;
  });

  channel.onmessage = event => {
    const message = event?.data;
    if (!message || typeof message !== 'object' || message.tabId !== tabId) return;

    if (message.type === 'probe' && message.instanceId && message.instanceId !== instanceId) {
      channel.postMessage({ type: 'occupied', tabId, instanceId: message.instanceId });
      return;
    }

    if (message.type === 'occupied' && message.instanceId === instanceId) {
      occupied = true;
    }
  };

  channel.postMessage({ type: 'probe', tabId, instanceId });
  timer = setTimeout(() => {
    if (!occupied) {
      resolveReady(unchanged);
      return;
    }

    try {
      const nextTabId = createTabId();
      setTabId(nextTabId);
      resolveReady({ tabId: nextTabId, split: true });
    } catch {
      resolveReady(unchanged);
    }
  }, timeoutMs);

  return {
    ready,
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timer);
      channel.onmessage = null;
      channel.close();
    }
  };
}
