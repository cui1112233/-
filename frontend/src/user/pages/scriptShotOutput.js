// 剧本生成只使用一个外层协议：每个“### 分镜N”区块就是一张卡片。
// 时间轴、---、镜头标题和 JSON 只能是卡内内容，不能参与外层拆卡。
const UNIFIED_OUTER_HEADING = /^###\s+分镜(?:\d+|[一二三四五六七八九十百千万两]+)(?:[ \t]*(?:（[^\n]*）|\([^\n]*\)))?[ \t]*$/gim;

function parseUnifiedOuterCards(output) {
  const text = String(output || '').trim();
  if (!text) return [];

  const matches = [...text.matchAll(UNIFIED_OUTER_HEADING)];
  if (!matches.length) return [];

  return matches
    .map((match, index) => text.slice(match.index, matches[index + 1]?.index ?? text.length).trim())
    .filter(Boolean);
}

// 保留旧函数签名，避免页面调用方和历史草稿升级时出现格式分支；所有格式现在都走同一协议。
export function isShotCardFormat() {
  return true;
}

export function parseShotOutput(output) {
  return parseUnifiedOuterCards(output);
}

export function getShotCards(_format, output) {
  return parseShotOutput(output);
}

// duration 仅保留兼容参数，不再对 AI 已生成的卡片进行 10s/15s 二次拆分。
export function getShotCardsWithinDuration(format, output, _duration) {
  return getShotCards(format, output);
}

export function joinShotCards(cards, selectedIndexes) {
  return cards.filter((_, index) => selectedIndexes.has(index)).join('\n\n');
}
