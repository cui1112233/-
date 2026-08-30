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

function normalizePrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1_000_000 ? number : 0;
}

function normalizePricing(value) {
  if (!value || typeof value !== 'object') return null;
  const inputPerMillion = normalizePrice(value.inputPerMillion);
  const outputPerMillion = normalizePrice(value.outputPerMillion);
  if (inputPerMillion === 0 && outputPerMillion === 0) return null;
  const currency = typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency.trim().toUpperCase())
    ? value.currency.trim().toUpperCase()
    : 'USD';
  return { currency, inputPerMillion, outputPerMillion };
}

function estimateCost(normalizedUsage, pricing) {
  const snapshot = normalizePricing(pricing);
  if (!snapshot || !normalizedUsage?.usageKnown) {
    return { costKnown: false, estimatedCost: 0, costCurrency: null, pricingSnapshot: null };
  }
  const amount = (normalizedUsage.inputTokens / 1_000_000) * snapshot.inputPerMillion
    + (normalizedUsage.outputTokens / 1_000_000) * snapshot.outputPerMillion;
  return {
    costKnown: true,
    estimatedCost: Number(amount.toFixed(8)),
    costCurrency: snapshot.currency,
    pricingSnapshot: snapshot
  };
}

function isBillableEntry(entry) {
  if (!entry || !entry.usageKnown) return false;
  if (entry.status === 'success') return true;
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
    pricing = null,
    metadata = null
  } = {}) {
    if (!username || !billedTo) return null;
    const normalized = normalizeUsage(usage);
    const cost = estimateCost(normalized, pricing);
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
      ...cost,
      metadata: metadata && typeof metadata === 'object' ? metadata : null
    };
    withJsonLock(lockPath, () => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
      fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
    });
    return entry;
  }

  function filterEntries({ usernames, start, end, billedTo, teamOwner } = {}) {
    const names = usernames ? new Set(Array.isArray(usernames) ? usernames : [usernames]) : null;
    const startTime = start instanceof Date ? start.getTime() : Number(start);
    const endTime = end instanceof Date ? end.getTime() : Number(end);
    return withJsonLock(lockPath, () => readAllUnsafe().filter(entry => {
      const time = Date.parse(entry.at);
      if (names && !names.has(entry.username)) return false;
      if (billedTo && entry.billedTo !== billedTo) return false;
      if (teamOwner && entry.teamOwner !== teamOwner) return false;
      if (Number.isFinite(startTime) && time < startTime) return false;
      if (Number.isFinite(endTime) && time >= endTime) return false;
      return true;
    }));
  }

  function summarize(entries) {
    const byFeature = {};
    const callsByFeature = {};
    const byModel = {};
    const costByCurrency = {};
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let knownUsageCalls = 0;
    let successfulCalls = 0;
    let billableCalls = 0;
    let pricedCalls = 0;
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
      callsByFeature[feature] = (callsByFeature[feature] || 0) + 1;
      byFeature[feature] = (byFeature[feature] || 0) + entryTotal;
      byModel[model] = (byModel[model] || 0) + entryTotal;
      if (entry.costKnown && entry.costCurrency && Number.isFinite(Number(entry.estimatedCost))) {
        pricedCalls += 1;
        costByCurrency[entry.costCurrency] = Number(((costByCurrency[entry.costCurrency] || 0) + Number(entry.estimatedCost)).toFixed(8));
      }
    }
    const currencies = Object.keys(costByCurrency);
    return {
      calls: entries.length,
      successfulCalls,
      billableCalls,
      knownUsageCalls,
      pricedCalls,
      inputTokens,
      outputTokens,
      totalTokens,
      byFeature,
      callsByFeature,
      byModel,
      costByCurrency,
      estimatedCost: currencies.length === 1 ? costByCurrency[currencies[0]] : null,
      costCurrency: currencies.length === 1 ? currencies[0] : null
    };
  }

  function periodBounds(period) {
    return period === 'day' ? dayBounds() : monthBounds();
  }

  function summaryForUser(username, period = 'month', { teamOwner } = {}) {
    const bounds = periodBounds(period);
    return summarize(filterEntries({ usernames: username, start: bounds.start, end: bounds.end, teamOwner }));
  }

  function summaryForTeam(teamOwner, period = 'month') {
    const bounds = periodBounds(period);
    return summarize(filterEntries({ teamOwner, start: bounds.start, end: bounds.end }));
  }

  function summariesForUsers(usernames, period = 'month', { teamOwner } = {}) {
    const bounds = periodBounds(period);
    const entries = filterEntries({ usernames, start: bounds.start, end: bounds.end, teamOwner });
    const result = Object.fromEntries((usernames || []).map(username => [username, summarize([])]));
    for (const username of usernames || []) {
      result[username] = summarize(entries.filter(entry => entry.username === username));
    }
    return result;
  }

  function recentForUser(username, limit = 20, { teamOwner } = {}) {
    const count = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100);
    return filterEntries({ usernames: username, teamOwner }).slice(-count).reverse();
  }

  return {
    filePath,
    record,
    normalizeUsage,
    summaryForUser,
    summaryForTeam,
    summariesForUsers,
    recentForUser,
    filterEntries,
    summarize,
    monthBounds,
    dayBounds
  };
}

module.exports = {
  createUsageStore,
  normalizeUsage,
  normalizePricing,
  estimateCost,
  isBillableEntry,
  monthBounds,
  dayBounds
};
