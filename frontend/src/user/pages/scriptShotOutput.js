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

function expandLongTimelineRows(rows, limit) {
  const expanded = [];
  rows.forEach(row => {
    if (row.start === null || row.end === null || row.end - row.start <= limit) {
      expanded.push(row);
      return;
    }
    // 仅供显式调用旧时间轴切分工具时使用。普通剧本/分镜生成不再自动调用该逻辑。
    let cursor = row.start;
    while (cursor < row.end) {
      const next = Math.min(row.end, cursor + limit);
      const start = formatSeconds(cursor);
      const end = formatSeconds(next);
      const suffix = cursor === row.start ? '' : '（动作延续）';
      expanded.push({
        ...row,
        line: row.line.replace(/^\s*\d{1,2}:\d{2}\s*[-—~]\s*\d{1,2}:\d{2}/, `${start}-${end}`) + suffix,
        start: cursor,
        end: next
      });
      cursor = next;
    }
  });
  return expanded;
}

// Q 版等预设会要求每个独立镜头单元用 --- 分隔。但模型有时会省略
// “镜头一：/分镜一：”标题，只保留每单元的画面结构；此前这种合规输出
// 被当成一整段普通文本，无法显示为独立卡片。
function parseDividerUnits(output) {
  const parts = String(output || '')
    .split(/^\s*---+\s*$/m)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return [];

  const isShotUnit = part => {
    UNIT_HEADING.lastIndex = 0;
    return UNIT_HEADING.test(part)
      || /^\s*\d{1,2}:\d{2}\s*[-—~]\s*\d{1,2}:\d{2}\s*\|/m.test(part)
      || /【(?:画面主体描述|环境光影|迷你小人细节|迷你内心小人)】/.test(part);
  };

  // 通常每段都是完整分镜。若第一段只是共享基础设定，则复制进每张卡，
  // 保持“复制本分镜”仍可直接用于生成。
  if (parts.every(isShotUnit)) return parts;
  if (!isShotUnit(parts[0]) && parts.slice(1).every(isShotUnit)) {
    return parts.slice(1).map(part => `${parts[0]}\n\n${part}`);
  }
  return [];
}

export function parseShotOutput(output) {
  return parseUnifiedOuterCards(output);
}

export function getShotCards(_format, output) {
  return parseShotOutput(output);
}

export function getShotCardsWithinDuration(format, output, duration) {
  // 10s / 15s 是发给 AI 的“单条外层分镜最大时长”规则，而不是生成后的切刀。
  // 模型已经按当前开头策略完成语义分段后，前端只负责解析/展示原结果；
  // 即使模型偶发违反上限，也不能在这里机械重切并改变已经生成的剧情边界。
  void duration;
  return getShotCards(format, output);
}

export function joinShotCards(cards, selectedIndexes) {
  return cards.filter((_, index) => selectedIndexes.has(index)).join('\n\n');
}
const TIMELINE_RE = /^\s*(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\s*\|/;

function toSeconds(value) {
  const [m, s] = String(value).split(':').map(Number);
  if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
  return m * 60 + s;
}

function formatSeconds(value) {
  const m = Math.floor(value / 60);
  const s = value % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 旧兼容工具：只有显式 opt-in 才允许重排历史连续时间轴。
// 普通剧本/分镜生成路径即使仍保留旧调用，也会得到空数组，因此不会自动机械切卡。
// 10s/15s 分段必须由 AI 在生成前完成；最终卡牌边界以“分镜一 / 分镜二 ……”为准。
export function splitContinuousTimeline(output, maxSeconds, { allowMechanicalSplit = false } = {}) {
  if (!allowMechanicalSplit) return [];

  const limit = Math.max(1, Number.parseInt(maxSeconds, 10) || 10);
  const text = String(output || '').trim();
  if (!text) return [];

  const rows = text.split('\n').map(line => {
    const match = line.match(TIMELINE_RE);
    if (!match) return { line, start: null, end: null };
    return { line, start: toSeconds(match[1]), end: toSeconds(match[2]) };
  });
  const timelineRows = expandLongTimelineRows(
    rows.filter(row => row.start !== null && row.end !== null && row.end > row.start),
    limit
  );
  if (timelineRows.length === 0) return [];

  const firstTimelineIndex = rows.findIndex(row => row.start !== null);
  const preamble = rows
    .slice(0, Math.max(0, firstTimelineIndex))
    .map(row => row.line.trim())
    .filter(Boolean)
    .join('\n');

  const groups = [];
  let current = [];
  let groupStart = 0;
  let groupEnd = 0;
  const flush = () => {
    if (!current.length) return;
    groups.push({ rows: current, start: groupStart, end: groupEnd });
    current = [];
  };
  timelineRows.forEach(row => {
    if (!current.length) {
      current = [row];
      groupStart = row.start;
      groupEnd = row.end;
      return;
    }
    const proposedEnd = Math.max(groupEnd, row.end);
    if (proposedEnd - groupStart > limit) {
      flush();
      current = [row];
      groupStart = row.start;
      groupEnd = row.end;
    } else {
      current.push(row);
      groupEnd = proposedEnd;
    }
  });
  flush();

  return groups.map((group, index) => {
    const totalSeconds = Math.max(1, Math.round(group.end - group.start));
    const shifted = group.rows.map(row => {
      const offset = group.start;
      const start = formatSeconds(Math.max(0, row.start - offset));
      const end = formatSeconds(Math.max(0, row.end - offset));
      return row.line.replace(TIMELINE_RE, `${start}-${end} |`);
    });
    const body = [preamble, ...shifted].filter(Boolean).join('\n');
    return `### 分镜${['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][index] || (index + 1)}（总时长：${totalSeconds}s）\n${body}`;
  });
}

// Split block-level screenplay timelines while preserving the current script-final-segment contract.
const BLOCK_TIME_RE = /^\s*\[?(\d{1,2}:\d{2})\s*[-—~]\s*(\d{1,2}:\d{2})\]?\s*(?:\||(?:分镜|镜头))/;
const MODULE_HEADING_RE = /^\s*(?:#{1,6}\s*)?(?:分镜|镜头)\s*[第#]?\s*(?:\d+|[一二三四五六七八九十百千万两]+)\s*[：:]?/;

export function splitTimelineBlocks(output, maxSeconds) {
  const limit = Math.max(1, Number.parseInt(maxSeconds, 10) || 10);
  const text = String(output || '').trim();
  if (!text) return [];
  const blocks = [];
  let current = null;
  let module = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (MODULE_HEADING_RE.test(trimmed)) {
      if (current) blocks.push(current);
      current = null;
      module += 1;
      continue;
    }
    const match = trimmed.match(BLOCK_TIME_RE);
    if (match) {
      if (current) blocks.push(current);
      current = { start: toSeconds(match[1]), end: toSeconds(match[2]), lines: [trimmed], module };
    } else if (current) {
      current.lines.push(trimmed);
    }
  }
  if (current) blocks.push(current);
  const valid = blocks.filter(block => block.start !== null && block.end !== null && block.end > block.start);
  if (valid.length < 2) return [];

  const groups = [];
  let group = [];
  let groupStart = 0;
  let groupEnd = 0;
  let groupModule = null;
  const flush = () => {
    if (group.length) groups.push({ blocks: group, start: groupStart, end: groupEnd });
    group = [];
    groupModule = null;
  };
  for (const block of valid) {
    if (!group.length) {
      group = [block];
      groupStart = block.start;
      groupEnd = block.end;
      groupModule = block.module;
      continue;
    }
    const proposedEnd = Math.max(groupEnd, block.end);
    if (block.module !== groupModule || proposedEnd - groupStart > limit) {
      flush();
      group = [block];
      groupStart = block.start;
      groupEnd = block.end;
      groupModule = block.module;
    } else {
      group.push(block);
      groupEnd = proposedEnd;
    }
  }
  flush();
  if (groups.length < 2) return [];

  return groups.map((item, index) => {
    const offset = item.start;
    const totalSeconds = Math.max(1, Math.round(item.end - item.start));
    const body = item.blocks.map(block => block.lines.map(line => line.replace(
      /^\[?(\d{1,2}:\d{2})\s*[-—~]\s*(\d{1,2}:\d{2})\]?/,
      `[${formatSeconds(Math.max(0, block.start - offset))}-${formatSeconds(Math.max(0, block.end - offset))}]`
    )).join('\n')).join('\n');
    const name = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][index] || String(index + 1);
    return `### 分镜${name}（总时长：${totalSeconds}s）\n${body}`;
  });
}
