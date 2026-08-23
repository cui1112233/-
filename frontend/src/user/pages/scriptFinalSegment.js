// 剧本生成“最终分段”：模型只管输出提示词（画面内容），
// 程序把「已提取的人物/场景生成的基础设定 + 用户约束设置」注入每个分段卡片，
// 与小说面板“按秒数分段并合并”的最终组装逻辑一致。
import { getShotCards, splitContinuousTimeline, splitTimelineBlocks } from './scriptShotOutput.js';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function targetSeconds(duration) {
  return Number.parseInt(String(duration), 10) || 10;
}

// 程序从已提取的人物/场景生成【基础设定】文本
export function buildBaseSetupText(extractInfo) {
  const characters = Array.isArray(extractInfo?.characters) ? extractInfo.characters : [];
  const scenes = Array.isArray(extractInfo?.scenes) ? extractInfo.scenes : [];
  const lines = ['【基础设定】生成视频不带字幕 | 9:16'];
  characters.forEach(item => {
    const data = item?.data && typeof item.data === 'object' ? item.data : item;
    const name = text(data?.角色名称) || text(data?.名称) || text(data?.name);
    const appearance = text(data?.外观描述) || text(data?.外形);
    if (name) lines.push(`${name}：${appearance}`);
  });
  const scene = scenes[0]?.data && typeof scenes[0].data === 'object' ? scenes[0].data : scenes[0];
  const sceneName = text(scene?.场景名称) || text(scene?.名称) || text(scene?.name);
  const sceneDesc = text(scene?.场景描述) || text(scene?.氛围概述) || text(scene?.描述);
  if (sceneDesc) lines.push(`场景环境：${sceneName ? `${sceneName}。` : ''}${sceneDesc}`);
  return lines.filter(Boolean).join('\n');
}

function enabledBody(layer) {
  return layer?.enabled === true ? text(layer?.body) : '';
}

function buildConstraintParts(constraints) {
  // 显式关闭总开关时，所有文字约束都不应出现在最终分镜卡中。
  // 未带此字段的旧记录保持原有行为，避免历史内容意外丢失。
  if (constraints?.enabled === false) return { leading: '', negative: '' };
  const prefix = enabledBody(constraints?.prefix);
  const quality = enabledBody(constraints?.quality);
  const restriction = enabledBody(constraints?.restriction);
  const negative = enabledBody(constraints?.negative);
  return {
    leading: [
    prefix && `【画面前缀】\n${prefix}`,
      (quality || restriction) && `【画质约束】\n${[quality, restriction].filter(Boolean).join('\n')}`
    ].filter(Boolean).join('\n\n'),
    negative: negative ? `负面提示词：\n${negative}` : ''
  };
}

// 程序按约束设置生成完整约束文本；供规则预览和兼容调用使用。
export function buildConstraintText(constraints) {
  const { leading, negative } = buildConstraintParts(constraints);
  return [leading, negative].filter(Boolean).join('\n\n');
}

// 移除模型输出中已有的【基础设定】段落（由程序生成版本替换，避免重复）
export function stripBaseSetupSection(text) {
  const lines = String(text).split('\n');
  const out = [];
  let inSetup = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^【基础设定】/.test(trimmed)) {
      inSetup = true;
      continue;
    }
    if (inSetup) {
      const boundary = /^【/.test(trimmed)
        || /^(?:#{1,6}\s*)?(?:镜头|分镜)\s*[第#]?\s*(?:\d+|[一二三四五六七八九十百千万两]+)/.test(trimmed)
        || /^\[?\d{1,2}:\d{2}\s*[-—~]/.test(trimmed)
        || /^[（(]?\d+\s*[-—~]\s*\d+\s*(?:s|秒)[)）]/.test(trimmed)
        || trimmed === '';
      if (boundary) inSetup = false;
      else continue; // 跳过基础设定段内的人物/场景行
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 移除模型输出中已有的约束行（由程序生成版本替换）
export function stripConstraintLines(text) {
  return String(text)
    .replace(/(^|\n)【画面前缀】[^\n]*\n?/g, '$1')
    .replace(/(^|\n)【画质约束】[^\n]*\n?/g, '$1')
    .replace(/(^|\n)【画面限制】[^\n]*\n?/g, '$1')
    .replace(/(^|\n)负面提示词：[^\n]*\n?/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const CHINESE_ORDINALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function chineseOrdinal(index) {
  return CHINESE_ORDINALS[index] || String(index + 1);
}

// 模块标题统一由程序判断：剥离模型输出的“### 分镜N”与行首“镜头N：/分镜N：”模块标题，
// 最终由 buildFinalSegmentCard 重新命名为“### 分镜一（总时长：Xs）”。
// 剧情模式内部镜头行（[00:00-00:03]镜头N:...）不属于模块标题，原样保留。
export function stripUnitHeading(text) {
  return String(text)
    .replace(/\n?#{1,6}\s*分镜[^\n]*\n+/, '\n')
    .replace(/^(?:分镜|镜头)\s*[第#]?\s*(?:\d+|[一二三四五六七八九十百千万两]+)[：:][^\n]*\n+/, '')
    .trim();
}

// 从卡片内容推算该模块总时长（标题“总时长：Xs”、mm:ss 时间轴、或（Ns）范围）
export function unitTotalSeconds(text) {
  const total = String(text).match(/总时长[：:]\s*(\d+)s/);
  if (total) return Number(total[1]);
  const ranges = [...String(text).matchAll(/(\d{1,2}):(\d{2})\s*[-—~]\s*(\d{1,2}):(\d{2})/g)];
  if (ranges.length) {
    const starts = ranges.map(match => Number(match[1]) * 60 + Number(match[2]));
    const ends = ranges.map(match => Number(match[3]) * 60 + Number(match[4]));
    return Math.max(1, Math.round(Math.max(...ends) - Math.min(...starts)));
  }
  const secRanges = [...String(text).matchAll(/[（(](\d+)\s*[-—~]\s*(\d+)\s*(?:s|秒)[)）]/g)];
  if (secRanges.length) {
    const starts = secRanges.map(match => Number(match[1]));
    const ends = secRanges.map(match => Number(match[2]));
    return Math.max(1, Math.round(Math.max(...ends) - Math.min(...starts)));
  }
  return null;
}

// 把一张模型输出卡组装为最终分段卡：程序统一命名 + 基础设定 + 约束 + 画面内容
export function buildFinalSegmentCard(card, { extractInfo, constraints, index = 0 }) {
  const baseOn = constraints?.baseSetup?.enabled !== false;
  const { leading: leadingConstraints, negative: negativeConstraint } = buildConstraintParts(constraints);
  // 模块标题统一由程序命名：剥离基础设定与模块标题后重新生成“### 分镜一（总时长：Xs）”
  let body = card;
  if (baseOn) body = stripBaseSetupSection(body);
  const total = unitTotalSeconds(card) ?? unitTotalSeconds(body);
  body = stripUnitHeading(body);
  if (leadingConstraints || negativeConstraint) body = stripConstraintLines(body);
  const parts = [`### 分镜${chineseOrdinal(index)}${total ? `（总时长：${total}s）` : ''}`];
  if (baseOn) parts.push(buildBaseSetupText(extractInfo));
  if (leadingConstraints) parts.push(leadingConstraints);
  if (body) parts.push(body);
  if (negativeConstraint) parts.push(negativeConstraint);
  return parts.join('\n\n');
}

// 最终分段：模型输出 → 切段 → 每段注入基础设定与约束 → 多张卡（每段可单独复制）
export function buildFinalSegments({ output, extractInfo, constraints, format, duration, mode }) {
  const textOutput = String(output || '').trim();
  if (!textOutput) return [];
  const target = targetSeconds(duration);
  let cards = [];
  if (mode === 'segmented' || mode === undefined) {
    // 分段开头（或未指定 mode）：优先保留 AI 的剧情单元边界（### 分镜N 标题），兜底按目标秒数切段
    // 剧情模式的 [时间]镜头N 是单元内部镜头，先按模块/目标时长归并，避免一段剧情被拆成多张卡。
    if (format === 'screenplay') {
      const blocks = splitTimelineBlocks(textOutput, target);
      if (blocks.length >= 2) cards = blocks;
    }
    if (!cards.length) cards = getShotCards(format, textOutput, duration);
    if (!cards.length && format !== 'shortdrama') {
      const segments = splitContinuousTimeline(textOutput, target);
      if (segments.length >= 2) cards = segments;
    }
    if (!cards.length && format !== 'shortdrama') {
      const blocks = splitTimelineBlocks(textOutput, target);
      if (blocks.length >= 2) cards = blocks;
    }
  } else if (format !== 'shortdrama') {
    // 非分段模式：AI 按小说面板规则输出连续总时间轴，系统按 10s/15s 切分为独立分镜卡。
    // 即使 AI 误输出 ### 分镜N 标题，也统一按目标秒数切卡，保证单卡不超过模型生成能力。
    const segments = splitContinuousTimeline(textOutput, target);
    if (segments.length >= 2) cards = segments;
    else {
      const blocks = splitTimelineBlocks(textOutput, target);
      if (blocks.length >= 2) cards = blocks;
    }
  }
  if (!cards.length) cards = [textOutput];
  return cards
    .map((card, index) => buildFinalSegmentCard(card, { extractInfo, constraints, index }))
    .filter(Boolean);
}
