const SHOT_ARRAY_KEYS = ['shots', 'scenes', 'storyboard', '分镜'];
// 分镜模式预设可能输出 "### 分镜一（总时长：10s）" 或 "镜头一：" 两种标题，都识别为分镜单元
const UNIT_HEADING = /^(?:#{3,6}\s*分镜\s*[第#]?\s*(?:\d+|[一二三四五六七八九十百千万两]+)[（(：:].*|镜头\s*[第#]?\s*(?:\d+|[一二三四五六七八九十百千万两]+)[：:].*)$/gim;

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
  return matches
    .map((match, index) => output.slice(match.index, matches[index + 1]?.index).replace(/\n?---\s*$/m, '').trim())
    .filter(Boolean);
}

export function parseShotOutput(output) {
  const text = String(output || '').trim();
  if (!text) return [];
  const jsonShots = parseJsonShots(text);
  return jsonShots.length ? jsonShots : parseShotUnits(text);
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
