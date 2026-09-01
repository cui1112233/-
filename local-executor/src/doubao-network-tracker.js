const STABLE_ID_KEYS = new Set([
  'conversationid',
  'messageid',
  'taskid',
  'generationid',
  'mediaid',
  'videoid'
]);

class DoubaoNetworkTracker {
  constructor({ webContents }) {
    if (!webContents?.debugger) throw new Error('Doubao webContents debugger is required');
    this.webContents = webContents;
    this.debugger = webContents.debugger;
    this.attachedByUs = false;
    this.listening = false;
    this.attempt = null;
    this.onMessage = (_event, method, params) => {
      this.handleMessage(method, params).catch(() => {});
    };
  }

  async startAttempt({ prompt }) {
    const promptNeedle = normalizeText(prompt);
    if (!promptNeedle) throw new Error('prompt is required for network acceptance tracking');
    await this.ensureAttached();
    if (!this.listening) {
      this.debugger.on('message', this.onMessage);
      this.listening = true;
    }
    await this.debugger.sendCommand('Network.enable');
    this.attempt = {
      prompt: promptNeedle,
      requests: new Map(),
      identities: [],
      accepted: false,
      endpoint: null
    };
  }

  async ensureAttached() {
    if (this.debugger.isAttached?.()) return;
    this.debugger.attach('1.3');
    this.attachedByUs = true;
  }

  async handleMessage(method, params = {}) {
    if (!this.attempt) return;
    if (method === 'Network.requestWillBeSent') {
      const request = params.request || {};
      if (!postDataContainsPrompt(request.postData, this.attempt.prompt)) return;
      const identities = extractIdentityEvidence(request.postData);
      this.attempt.requests.set(params.requestId, {
        status: null,
        mimeType: '',
        endpoint: sanitizeNetworkUrl(request.url),
        identities
      });
      this.mergeIdentities(identities);
      return;
    }

    const tracked = this.attempt.requests.get(params.requestId);
    if (!tracked) return;

    if (method === 'Network.responseReceived') {
      const response = params.response || {};
      tracked.status = Number(response.status) || 0;
      tracked.mimeType = String(response.mimeType || '');
      tracked.endpoint = sanitizeNetworkUrl(response.url || tracked.endpoint);
      if (tracked.status >= 200 && tracked.status < 300 && tracked.identities.length > 0) {
        this.attempt.accepted = true;
        this.attempt.endpoint = tracked.endpoint;
      }
      return;
    }

    if (method === 'Network.loadingFinished') {
      if (!(tracked.status >= 200 && tracked.status < 300)) return;
      if (/json|text|javascript/i.test(tracked.mimeType || '')) {
        try {
          const bodyResult = await this.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId });
          const text = decodeResponseBody(bodyResult);
          const identities = extractIdentityEvidence(text);
          tracked.identities = unique([...tracked.identities, ...identities]);
          this.mergeIdentities(identities);
        } catch {
          // A missing/expired response body does not mean the submit was rejected.
        }
      }
      if (this.attempt.identities.length > 0) {
        this.attempt.accepted = true;
        this.attempt.endpoint = tracked.endpoint;
      }
    }
  }

  mergeIdentities(values) {
    this.attempt.identities = unique([...this.attempt.identities, ...values]);
  }

  getEvidence() {
    if (!this.attempt) return { accepted: false, identities: [] };
    const evidence = {
      accepted: Boolean(this.attempt.accepted),
      identities: [...this.attempt.identities]
    };
    if (this.attempt.endpoint) evidence.endpoint = this.attempt.endpoint;
    return evidence;
  }

  stop() {
    this.attempt = null;
    if (this.listening) {
      this.debugger.removeListener?.('message', this.onMessage);
      this.listening = false;
    }
    if (this.attachedByUs && this.debugger.isAttached?.()) {
      try { this.debugger.detach(); } catch {}
    }
    this.attachedByUs = false;
  }
}

function extractIdentityEvidence(input) {
  if (input === null || input === undefined) return [];
  if (typeof input === 'string') {
    const text = input.slice(0, 2_000_000);
    try {
      return extractIdentityEvidence(JSON.parse(text));
    } catch {
      const ids = [];
      const re = /["']?(conversation[_-]?id|message[_-]?id|task[_-]?id|generation[_-]?id|media[_-]?id|video[_-]?id)["']?\s*[:=]\s*["']([^"'\s,}]{1,160})["']/gi;
      let match;
      while ((match = re.exec(text))) ids.push(match[2]);
      return unique(ids);
    }
  }

  const ids = [];
  walk(input, (key, value) => {
    if (!STABLE_ID_KEYS.has(normalizeKey(key))) return;
    if (typeof value !== 'string' && typeof value !== 'number') return;
    const identity = String(value).trim();
    if (identity && identity.length <= 160) ids.push(identity);
  });
  return unique(ids);
}

function walk(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    visit(key, child);
    walk(child, visit);
  }
}

function normalizeKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function postDataContainsPrompt(postData, prompt) {
  const text = String(postData || '');
  if (!text) return false;
  if (normalizeText(text).includes(prompt)) return true;
  try {
    return normalizeText(decodeURIComponent(text)).includes(prompt);
  } catch {
    return false;
  }
}

function decodeResponseBody(result = {}) {
  const body = String(result.body || '');
  if (!result.base64Encoded) return body.slice(0, 2_000_000);
  return Buffer.from(body, 'base64').toString('utf8').slice(0, 2_000_000);
}

function sanitizeNetworkUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(value || '').split(/[?#]/, 1)[0];
  }
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

module.exports = {
  DoubaoNetworkTracker,
  extractIdentityEvidence,
  sanitizeNetworkUrl,
  postDataContainsPrompt,
  decodeResponseBody
};
