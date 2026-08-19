const SHOT_ARRAY_KEYS = ['shots', 'scenes', 'storyboard', '分镜'];
// 卡片边界 = 完整视频单元（一个完整 10s/15s 分镜），不是单元内部的镜头小节：
//   - 预设格式的 Markdown 单元标题：### 分镜一（总时长：10s）、### 分镜二
//   - 普通“分镜/镜头”编号标题，只有携带“总时长”标记或时间范围跨度达到目标秒数
//     才视为完整单元（画布：分镜1：xxx（0-10s）；剧情：[00:00-00:10]镜头1:xxx）
//   - 裸标签“镜头一：/镜头二：”（动态拆分规则 v5/v6 结构）：其后紧跟时间轴行
//     `00:00-00:03 | ...` 时，视为统领一段连续时间轴的完整单元边界
// 单元内部镜头如“分镜1：超近景特写（0-4s）”“分镜2：中景拉开（4-10s）”不会拆成卡片。
const MARKDOWN_UNIT_HEADING = /^#{1,6}\s*分镜\s*[第#]?\s*(?:\d+|[一二三四五六七八九十百千万两]+)/;
const SHOT_LABEL_LINE = /(?:分镜|镜头)\s*[第#]?\s*(?:\d+|[一二三四五六七八九十百千万两]+)\s*[：:]/;
const TIMELINE_LINE_RE = /^\d{1,2}:\d{2}\s*[-—~]\s*\d{1,2}:\d{2}\s*\|/;

function isShotCardFormat(format) {
  return format !== 'shortdrama';
}

function targetSeconds(duration) {
  return Number.parseInt(String(duration), 10) || 10;
}

function timeSpanFromHeading(line) {
  const sec = line.match(/[（(](\d+)\s*[-—~]\s*(\d+)\s*(?:s|秒)[)）]/);
  if (sec) return Number(sec[2]) - Number(sec[1]);
  const mm = line.match(/\[(\d{1,2}):(\d{2})\s*[-—~]\s*(\d{1,2}):(\d{2})\]/);
  if (mm) return (Number(mm[3]) * 60 + Number(mm[4])) - (Number(mm[1]) * 60 + Number(mm[2]));
  return null;
}

function isCompleteUnitHeading(line, nextLine, target) {
  const clean = String(line).trim();
  if (MARKDOWN_UNIT_HEADING.test(clean)) return true;
  if (!SHOT_LABEL_LINE.test(clean)) return false;
  if (/总时长\s*[：:]?\s*\d+\s*s/.test(clean)) return true;
  const span = timeSpanFromHeading(clean);
  if (span !== null && span >= target) return true;
  // 裸标签（如“镜头一：”）：后接 `00:00-00:03 | ...` 时间轴行 → 完整单元边界
  return nextLine !== undefined && TIMELINE_LINE_RE.test(String(nextLine || '').trim());
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

function parseShotUnits(output, target) {
  const lines = String(output).split('\n');
  const boundaryIndexes = [];
  lines.forEach((line, index) => {
    // 下一非空行（跳过空行与分隔线），用于裸标签边界判断
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const candidate = lines[nextIndex].trim();
      if (candidate === '' || /^---+\s*$/.test(candidate)) nextIndex += 1;
      else break;
    }
    if (isCompleteUnitHeading(line, nextIndex < lines.length ? lines[nextIndex] : undefined, target)) {
      boundaryIndexes.push(index);
    }
  });
  if (!boundaryIndexes.length) return [];
  // 头部共享基础设定（第一个单元标题之前的内容）复制到每一张卡，保证可独立复制提交。
  const preamble = lines.slice(0, boundaryIndexes[0]).join('\n').replace(/\n?---\s*$/m, '').trim();
  return boundaryIndexes
    .map((lineIndex, index) => {
      const unit = lines.slice(lineIndex, boundaryIndexes[index + 1]).join('\n').replace(/\n?---\s*$/m, '').trim();
      return preamble ? `${preamble}\n\n${unit}` : unit;
    })
    .filter(Boolean);
}

export function parseShotOutput(output, duration) {
  const text = String(output || '').trim();
  if (!text) return [];
  const jsonShots = parseJsonShots(text);
  return jsonShots.length ? jsonShots : parseShotUnits(text, targetSeconds(duration));
}

export function getShotCards(format, output, duration) {
  if (!isShotCardFormat(format)) return [];
  const cards = parseShotOutput(output, duration);
  return cards.length ? cards : [];
}

// 分段开头：没有完整单元标题的连续时间轴，按所选秒数自动切成 ≤10s/15s 的卡
// （与工具栏“按秒分段并合并”一致）；其余模式仅按完整单元标题拆卡。
export function getDisplayCards({ mode, format, output, duration }) {
  const cards = getShotCards(format, output, duration);
  if (cards.length) return cards;
  if (mode === 'segmented' && isShotCardFormat(format)) {
    const segments = splitContinuousTimeline(output, targetSeconds(duration));
    if (segments.length >= 2) return segments;
  }
  return [];
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

// 块级时间轴切分（剧情模式）：识别 `00:00-00:03 | ...` 与 `[00:00-00:03]镜头N:...` 两种时间轴行，
// 每个时间轴行连同其后正文行作为一个画面块，按目标秒数切段，段内时间从 00:00 重新排布。
const BLOCK_TIME_RE = /^\s*\[?(\d{1,2}:\d{2})\s*[-—~]\s*(\d{1,2}:\d{2})\]?\s*(?:\||(?:分镜|镜头))/;
const MODULE_HEADING_RE = /^\s*(?:#{1,6}\s*)?(?:分镜|镜头)\s*[第#]?\s*(?:\d+|[一二三四五六七八九十百千万两]+)\s*[：:]?/;

export function splitTimelineBlocks(output, maxSeconds) {
  const limit = Math.max(1, Number.parseInt(maxSeconds, 10) || 10);
  const text = String(output || '').trim();
  if (!text) return [];
  const lines = text.split('\n');
  const blocks = [];
  let current = null;
  let module = 0;
  lines.forEach(line => {
    const trimmed = line.trim();
    if (MODULE_HEADING_RE.test(trimmed)) {
      if (current) blocks.push(current);
      current = null;
      module += 1;
      return;
    }
    const match = trimmed.match(BLOCK_TIME_RE);
    if (match) {
      if (current) blocks.push(current);
      current = { start: toSeconds(match[1]), end: toSeconds(match[2]), lines: [trimmed], module };
    } else if (current) {
      current.lines.push(trimmed);
    }
  });
  if (current) blocks.push(current);
  const valid = blocks.filter(block => block.start !== null && block.end !== null && block.end > block.start);
  if (valid.length < 2) return [];

  const groups = [];
  let group = [];
  let groupStart = 0;
  let groupEnd = 0;
  let groupModule = null;
  const flush = () => {
    if (!group.length) return;
    groups.push({ blocks: group, start: groupStart, end: groupEnd });
    group = [];
    groupModule = null;
  };
  valid.forEach(block => {
    if (!group.length) {
      group = [block];
      groupStart = block.start;
      groupEnd = block.end;
      groupModule = block.module;
      return;
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
  });
  flush();
  if (groups.length < 2) return [];

  return groups.map((group, index) => {
    const totalSeconds = Math.max(1, Math.round(group.end - group.start));
    const offset = group.start;
    const body = group.blocks.map(block => block.lines.map(line =>
      line.replace(/^\[?(\d{1,2}:\d{2})\s*[-—~]\s*(\d{1,2}:\d{2})\]?/,
        `[${formatSeconds(Math.max(0, block.start - offset))}-${formatSeconds(Math.max(0, block.end - offset))}]`)
    ).join('\n')).join('\n');
    return `### 分镜${['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][index] || (index + 1)}（总时长：${totalSeconds}s）\n${body}`;
  });
}
