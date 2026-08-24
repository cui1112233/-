const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { withJsonLock } = require('./system-store');

function normalizeToken(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function normalizeUsage(value) {
  const usage = value && typeof value === 'object' ? value : {};
  const inputTokens = normalizeToken(usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens);
  const outputTokens = normalizeToken(usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens);
  const explicitTotal = normalizeToken(usage.total_tokens ?? usage.totalTokens);
  const totalTokens = explicitTotal || inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    usageKnown: totalTokens > 0 || inputTokens > 0 || outputTokens > 0
  };
}

function isBillableEntry(entry) {
  if (!entry || !entry.usageKnown) return false;
  if (entry.status === 'success') return true;
  // A cancelled/error request may still be billed upstream. Count it only when
  // the provider actually reported usage; never charge quota from an estimate.
  return entry.metadata?.usageEstimated === false;
}

function monthBounds(reference = new Date()) {
  const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 1);
  return { start: start.getTime(), end: end.getTime() };
}

function dayBounds(reference = new Date()) {
  const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const end = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

function createUsageStore({ systemDir } = {}) {
  if (!systemDir) throw new Error('systemDir is required');
  const filePath = path.join(systemDir, 'model-usage.jsonl');
  const lockPath = path.join(systemDir, 'model-usage.lock');

  function readAllUnsafe() {
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      if (!text.trim()) return [];
      return text.split('\n').filter(Boolean).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  function record({
    username,
    billedTo,
    teamOwner = null,
    feature = 'unknown',
    provider = '',
    model = '',
    status = 'success',
    usage,
    metadata = null
  } = {}) {
    if (!username || !billedTo) return null;
    const normalized = normalizeUsage(usage);
    const entry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      username,
      billedTo,
      teamOwner,
      feature,
      provider: String(provider || ''),
      model: String(model || ''),
      status,
      ...normalized,
      metadata: metadata && typeof metadata === 'object' ? metadata : null
    };
    withJsonLock(lockPath, () => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
      fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
    });
    return entry;
  }

  function filterEntries({ usernames, start, end, billedTo } = {}) {
    const names = usernames ? new Set(Array.isArray(usernames) ? usernames : [usernames]) : null;
    const startTime = start instanceof Date ? start.getTime() : Number(start);
    const endTime = end instanceof Date ? end.getTime() : Number(end);
    return withJsonLock(lockPath, () => readAllUnsafe().filter(entry => {
      const time = Date.parse(entry.at);
      if (names && !names.has(entry.username)) return false;
      if (billedTo && entry.billedTo !== billedTo) return false;
      if (Number.isFinite(startTime) && time < startTime) return false;
      if (Number.isFinite(endTime) && time >= endTime) return false;
      return true;
    }));
  }

  function summarize(entries) {
    const byFeature = {};
    const byModel = {};
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let knownUsageCalls = 0;
    let successfulCalls = 0;
    let billableCalls = 0;
    for (const entry of entries) {
      if (entry.usageKnown) knownUsageCalls += 1;
      if (entry.status === 'success') successfulCalls += 1;
      if (!isBillableEntry(entry)) continue;

      const entryInput = normalizeToken(entry.inputTokens);
      const entryOutput = normalizeToken(entry.outputTokens);
      const entryTotal = normalizeToken(entry.totalTokens);
      inputTokens += entryInput;
      outputTokens += entryOutput;
      totalTokens += entryTotal;
      billableCalls += 1;
      const feature = entry.feature || 'unknown';
      const model = entry.model || 'unknown';
      byFeature[feature] = (byFeature[feature] || 0) + entryTotal;
      byModel[model] = (byModel[model] || 0) + entryTotal;
    }
    return {
      calls: entries.length,
      successfulCalls,
      billableCalls,
      knownUsageCalls,
      inputTokens,
      outputTokens,
      totalTokens,
      byFeature,
      byModel
    };
  }

  function summaryForUser(username, period = 'month') {
    const bounds = period === 'day' ? dayBounds() : monthBounds();
    return summarize(filterEntries({ usernames: username, start: bounds.start, end: bounds.end }));
  }

  function summariesForUsers(usernames, period = 'month') {
    const bounds = period === 'day' ? dayBounds() : monthBounds();
    const entries = filterEntries({ usernames, start: bounds.start, end: bounds.end });
    const result = Object.fromEntries((usernames || []).map(username => [username, summarize([])]));
    for (const username of usernames || []) {
      result[username] = summarize(entries.filter(entry => entry.username === username));
    }
    return result;
  }

  function recentForUser(username, limit = 20) {
    const count = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100);
    return filterEntries({ usernames: username }).slice(-count).reverse();
  }

  return {
    filePath,
    record,
    normalizeUsage,
    summaryForUser,
    summariesForUsers,
    recentForUser,
    filterEntries,
    summarize,
    monthBounds,
    dayBounds
  };
}

module.exports = { createUsageStore, normalizeUsage, isBillableEntry, monthBounds, dayBounds };
