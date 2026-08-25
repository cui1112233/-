const SHOT_ARRAY_KEYS = ['shots', 'scenes', 'storyboard', '分镜'];
// 三种格式预设的镜头/分镜标题都识别为分镜单元：
//   - 分镜模式：### 分镜一（总时长：10s） / 镜头一：
//   - 画布模式：分镜1：xxx（0-10s）
//   - 剧情模式：[00:00-00:10]镜头1:xxx(...)
const UNIT_HEADING = /^(?:#{3,6}\s*分镜\s*[第#]?\s*(?:\d+|[一二三四五六七八九十百千万两]+)[（(：:].*|\[?[X\d]{1,2}:[X\d]{2}-[X\d]{1,2}:[X\d]{2}\]?\s*(?:分镜|镜头)\s*[第#]?\s*(?:\d+|[一二三四五六七八九十百千万两]+)[：:].*|(?:分镜|镜头)\s*[第#]?\s*(?:\d+|[一二三四五六七八九十百千万两]+)[：:].*)$/gim;

export function isShotCardFormat(format) {
  return format !== 'shortdrama';
}

function parseJsonShots(output) {
  try {
    const parsed = JSON.parse(output);
    const shots = Array.isArray(parsed)
      ? parsed
      : SHOT_ARRAY_KEYS.map(key => parsed?.[key]).find(Array.isArray);
    return Array.isArray(shots) ? shots.map(item => typeof item === 'string' ? item : JSON.stringify(item, null, 2)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseShotUnits(output) {
  const matches = [...output.matchAll(UNIT_HEADING)];
  if (matches.length < 2) return [];
  // 头部共享基础设定：第一个标题之前的非空内容（【基础设定】人物/场景等），
  // 复制到每一张卡，保证每张卡可独立复制提交，与小说面板“镜头画面”一致。
  const preamble = output.slice(0, matches[0].index).replace(/\n?---\s*$/m, '').trim();
  return matches
    .map((match, index) => {
      const unit = output.slice(match.index, matches[index + 1]?.index).replace(/\n?---\s*$/m, '').trim();
      return preamble ? `${preamble}\n\n${unit}` : unit;
    })
    .filter(Boolean);
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
  const text = String(output || '').trim();
  if (!text) return [];
  const jsonShots = parseJsonShots(text);
  if (jsonShots.length) return jsonShots;
  const headedUnits = parseShotUnits(text);
  return headedUnits.length ? headedUnits : parseDividerUnits(text);
}

export function getShotCards(format, output) {
  if (!isShotCardFormat(format)) return [];
  const cards = parseShotOutput(output);
  return cards.length >= 2 ? cards : [];
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

// 把一条连续时间轴按所选秒数机械切段（对齐小说面板“按秒数分段并合并”）：
// 每段时长不超过 maxSeconds，段内时间轴从 00:00 重新排布，返回多个"### 分镜N"块。
// 输出开头第一个时间轴行之前的内容（人物/场景/负面提示词等前言）会复制到每一段，
// 保证每段可独立复制提交，与小说面板的“镜头画面”一致。
export function splitContinuousTimeline(output, maxSeconds) {
  const limit = Math.max(1, Number.parseInt(maxSeconds, 10) || 10);
  const text = String(output || '').trim();
  if (!text) return [];

  const rows = text.split('\n').map(line => {
    const match = line.match(TIMELINE_RE);
    if (!match) return { line, start: null, end: null };
    return { line, start: toSeconds(match[1]), end: toSeconds(match[2]) };
  });
  const timelineRows = rows.filter(row => row.start !== null && row.end !== null && row.end > row.start);
  if (timelineRows.length === 0) return [];

  // 前言：第一个时间轴行之前的所有非空行（统一人物/场景/负面提示词等）
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
