'use strict';

// The browser V77 helper remains unchanged. This Node module is the authoritative
// pre-write gate, so it rejects ambiguous or unbounded source references.
const MAX_SOURCE_REFERENCE_DEPTH = 8;
const MAX_SOURCE_REFERENCE_ITEMS = 512;
const MAX_METADATA_SOURCE_LINE_COUNT = 10000;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function list(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function unique(values) {
  const seen = new Set();
  const result = [];
  list(values).forEach(value => {
    const item = text(value);
    if (item && !seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  });
  return result;
}

function normalizeCompare(value) {
  return text(value)
    .replace(/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*\|[^\n|]*\|?/g, ' ')
    .replace(/[\s\u3000\r\n|｜,，。.!！？?；;：:"“”'‘’、()（）【】\[\]{}<>《》…—_\-]+/g, '')
    .toLowerCase()
    .slice(0, 5000);
}

function createReport() {
  const blockingIssues = [];
  return {
    ok: true,
    severity: 'pass',
    blockingIssues,
    blockers: blockingIssues,
    warnings: [],
    metrics: {}
  };
}

function refreshReportStatus(report) {
  report.ok = !report.blockingIssues.length;
  report.severity = report.blockingIssues.length ? 'blocker' : (report.warnings.length ? 'warning' : 'pass');
  return report;
}

function addIssue(report, type, code, message, details) {
  const target = type === 'blockers' || type === 'blockingIssues' ? report.blockingIssues : report.warnings;
  target.push({ code, message, ...(details && typeof details === 'object' ? details : {}) });
  refreshReportStatus(report);
}

function mergeReports(reports) {
  const report = createReport();
  reports.forEach(item => {
    list(item && (item.blockingIssues || item.blockers)).forEach(issue => addIssue(report, 'blockers', issue.code, issue.message, issue));
    list(item && item.warnings).forEach(issue => addIssue(report, 'warnings', issue.code, issue.message, issue));
    if (item && item.metrics) report.metrics = { ...report.metrics, ...item.metrics };
  });
  report.metrics.blockingIssueCount = report.blockingIssues.length;
  report.metrics.warningCount = report.warnings.length;
  return refreshReportStatus(report);
}

function contextSourceText(context) {
  return text(context && (context.novelText || context.source_text || context.sourceText || context.source));
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function sourceTextWasProvided(context) {
  return ['novelText', 'source_text', 'sourceText', 'source'].some(key => hasOwn(context, key));
}

function sourceLineInfo(context) {
  const lines = context && (context.source_lines || context.sourceLines);
  const actualLines = Array.isArray(lines)
    ? lines.map(line => text(line)).filter(Boolean)
    : sourceTextWasProvided(context)
      ? contextSourceText(context).split(/\r?\n/).filter(line => text(line))
      : null;
  const hasMetadata = hasOwn(context, 'source_line_count');
  const metadata = context && context.source_line_count;

  if (actualLines) {
    return {
      sourceLines: actualLines,
      sourceLineCount: actualLines.length,
      invalidMetadata: hasMetadata && (!Number.isSafeInteger(metadata) || metadata !== actualLines.length)
    };
  }

  if (!hasMetadata) return { sourceLines: [], sourceLineCount: 0, invalidMetadata: false };
  const validMetadata = Number.isSafeInteger(metadata) && metadata > 0 && metadata <= MAX_METADATA_SOURCE_LINE_COUNT;
  return {
    sourceLines: [],
    sourceLineCount: validMetadata ? metadata : 0,
    invalidMetadata: !validMetadata
  };
}

function sourceLinesArray(context) {
  return sourceLineInfo(context).sourceLines;
}

function expandSourceLineNumbers(value, sourceLineCount, {
  maxDepth = MAX_SOURCE_REFERENCE_DEPTH,
  maxItems = MAX_SOURCE_REFERENCE_ITEMS
} = {}) {
  const lines = new Set();
  let invalid = false;
  let itemCount = 0;

  function reject() {
    invalid = true;
  }

  function addLine(line) {
    if (!Number.isSafeInteger(line) || line < 1 || line > sourceLineCount || lines.size >= maxItems && !lines.has(line)) {
      reject();
      return;
    }
    lines.add(line);
  }

  function visit(item, depth) {
    if (invalid) return;
    if (depth > maxDepth) {
      reject();
      return;
    }
    if (Array.isArray(item)) {
      itemCount += item.length;
      if (itemCount > maxItems) {
        reject();
        return;
      }
      item.forEach(child => visit(child, depth + 1));
      return;
    }
    itemCount += 1;
    if (itemCount > maxItems) {
      reject();
      return;
    }
    if (typeof item === 'string') {
      const rangeMatch = item.match(/^\s*(\d+)\s*[-~—]\s*(\d+)\s*$/);
      if (rangeMatch) {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);
        const rangeSize = Math.abs(end - start) + 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < 1 || start > sourceLineCount || end > sourceLineCount || rangeSize > maxItems) {
          reject();
          return;
        }
        for (let line = Math.min(start, end); line <= Math.max(start, end); line += 1) addLine(line);
        return;
      }
    }
    const line = Number(item);
    if (!Number.isSafeInteger(line)) {
      reject();
      return;
    }
    addLine(line);
  }

  visit(value, 0);
  return { lines, invalid };
}

function outlineShots(result) {
  return Array.isArray(result && result.outline_shots) ? result.outline_shots : [];
}

function hasLineReference(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
}

function addSourceIndexCoverage(value, output, total, stats) {
  if (!hasLineReference(value)) return;
  stats.explicitMappingCount += 1;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.floor(numeric) !== numeric || numeric < 0) {
    stats.invalidSourceIndexCount += 1;
    stats.invalidSourceReferenceCount += 1;
    return;
  }
  const line = numeric === 0 ? 1 : numeric;
  if (total && (line < 1 || line > total)) {
    stats.invalidSourceIndexCount += 1;
    stats.invalidSourceReferenceCount += 1;
    return;
  }
  output.add(line);
}

function collectLineReferenceCoverage(value, output, total, stats) {
  if (hasLineReference(value)) stats.explicitMappingCount += 1;
  if (!hasLineReference(value)) return;
  const expanded = expandSourceLineNumbers(value, total);
  if (expanded.invalid) {
    stats.invalidSourceReferenceCount += 1;
    return;
  }
  expanded.lines.forEach(line => output.add(line));
}

function collectCoveredLines(result, total, stats) {
  const covered = new Set();
  outlineShots(result).forEach(shot => {
    addSourceIndexCoverage(shot && shot.source_index, covered, total, stats);
    collectLineReferenceCoverage(shot && (shot.source_lines || shot.sourceLines || shot.source_line || shot.line_number), covered, total, stats);
    collectLineReferenceCoverage(shot && (shot.start_line && shot.end_line ? [shot.start_line + '-' + shot.end_line] : []), covered, total, stats);
    list(shot && shot.timeline_segments).forEach(segment => {
      addSourceIndexCoverage(segment && segment.source_index, covered, total, stats);
      collectLineReferenceCoverage(segment && (segment.source_lines || segment.sourceLines || segment.source_line || segment.line_number), covered, total, stats);
    });
  });
  return covered;
}

function collectCoveredLinesBySourceBasis(result, context, stats) {
  const covered = new Set();
  const lines = sourceLinesArray(context).map(line => normalizeCompare(line));
  if (!lines.length) return covered;
  outlineShots(result).forEach(shot => {
    const candidates = [text(shot && (shot.source_basis || shot.source_text || shot.text))];
    list(shot && shot.timeline_segments).forEach(segment => {
      candidates.push(text(segment && (segment.source_basis || segment.source_text || segment.text)));
    });
    candidates.map(candidate => normalizeCompare(candidate)).filter(Boolean).forEach(candidate => {
      stats.explicitMappingCount += 1;
      const matchingLines = lines.reduce((matches, line, index) => {
        if (candidate === line) matches.push(index + 1);
        return matches;
      }, []);
      if (matchingLines.length === 1) covered.add(matchingLines[0]);
      if (matchingLines.length > 1) stats.ambiguousSourceBasisCount += 1;
    });
  });
  return covered;
}

function promptUnits(result) {
  const units = [];
  outlineShots(result).forEach((shot, shotIndex) => {
    const segments = Array.isArray(shot && shot.timeline_segments) && shot.timeline_segments.length ? shot.timeline_segments : [shot];
    segments.forEach((segment, segmentIndex) => {
      const prompt = text(segment && (segment.prompt || segment.visual_prompt || segment.description || segment.content));
      units.push({ prompt, shot, segment, shotIndex, segmentIndex });
    });
  });
  return units;
}

function sourceTextForUnit(unit, context) {
  const explicit = text(unit.segment && (unit.segment.source_basis || unit.segment.source_text || unit.segment.text))
    || text(unit.shot && (unit.shot.source_basis || unit.shot.source_text || unit.shot.text));
  if (explicit) return explicit;
  const lines = sourceLinesArray(context);
  const covered = new Set();
  [
    unit.segment && (unit.segment.source_lines || unit.segment.source_line || unit.segment.line_number),
    unit.shot && (unit.shot.source_lines || unit.shot.source_line || unit.shot.line_number)
  ].forEach(reference => {
    if (!hasLineReference(reference)) return;
    const expanded = expandSourceLineNumbers(reference, lines.length);
    if (!expanded.invalid) expanded.lines.forEach(line => covered.add(line));
  });
  return [...covered].map(line => lines[line - 1]).filter(Boolean).join('\n');
}

function promptCopiesSource(prompt, source) {
  const promptKey = normalizeCompare(prompt);
  const sourceKey = normalizeCompare(source);
  if (!promptKey || !sourceKey || sourceKey.length < 8) return false;
  if (promptKey === sourceKey) return true;
  if (promptKey.length >= 8 && sourceKey.includes(promptKey) && promptKey.length >= sourceKey.length * 0.72) return true;
  return sourceKey.length >= 12 && promptKey.includes(sourceKey) && sourceKey.length >= promptKey.length * 0.72;
}

function hasRuleContamination(prompt) {
  return /(?:scenes\[\]\.shots\[\]|timeline_segments|generation_rules|协议锁定|AI生成规则|只输出当前功能需要的结果|prompt\s*只写|prompt字段只写|必须严格填写|禁止返回|不得改变任何主功能接口|outline_shots\s*只作为|软件会按|最终展示仍使用)/i.test(prompt)
    || /(?:JSON\s*结构|字段名|系统消息).{0,24}(?:必须|禁止|不得|只输出|字段|协议|规则|返回)/i.test(prompt)
    || /(?:必须|禁止|不得|只输出|字段|协议|规则|返回).{0,24}(?:JSON\s*结构|字段名|系统消息)/i.test(prompt);
}

function cjkLength(value) {
  const match = text(value).match(/[\u4e00-\u9fff]/g);
  return match ? match.length : 0;
}

function isClearlyGenericPrompt(prompt) {
  const value = text(prompt);
  if (!value) return true;
  if (/^(?:人物|角色|主体|画面)?(?:动作|表情|情绪|状态)?(?:清楚|自然|明确)?(?:呈现|展示|表现)[。.!！]*$/.test(value)) return true;
  if (/^(?:人物动作清楚呈现|画面清楚呈现|人物自然呈现|动作自然展示)[。.!！]*$/.test(value)) return true;
  const compact = normalizeCompare(value);
  return cjkLength(value) <= 10 && /(?:人物|角色|动作|表情|场景|画面|清楚|自然|呈现|展示)/.test(compact);
}

function collectStructuredCharacterNames(value, names) {
  if (Array.isArray(value)) {
    value.forEach(item => collectStructuredCharacterNames(item, names));
    return;
  }
  if (typeof value === 'string') {
    names.push(value);
    return;
  }
  if (value && typeof value === 'object') {
    ['name', 'character_name', 'characterName'].forEach(key => {
      if (typeof value[key] === 'string') names.push(value[key]);
    });
  }
}

function outputStructuredCharacterNames(result) {
  const names = [];
  outlineShots(result).forEach(shot => {
    ['characters', 'visible_characters', 'scene_characters', 'cast', 'character', 'visibleCharacters', 'sceneCharacters'].forEach(key => {
      collectStructuredCharacterNames(shot && shot[key], names);
    });
    list(shot && shot.timeline_segments).forEach(segment => {
      ['characters', 'visible_characters', 'scene_characters', 'cast', 'character', 'visibleCharacters', 'sceneCharacters'].forEach(key => {
        collectStructuredCharacterNames(segment && segment[key], names);
      });
    });
  });
  return unique(names);
}

function contextCharacterList(context, keys) {
  for (let index = 0; index < keys.length; index += 1) {
    const value = context && context[keys[index]];
    if (value != null) {
      const names = [];
      collectStructuredCharacterNames(value, names);
      if (names.length) return unique(names);
    }
  }
  return [];
}

function validateOutlineCoverage(result, context) {
  const report = createReport();
  const shots = outlineShots(result);
  const sourceInfo = sourceLineInfo(context);
  report.metrics.shotCount = shots.length;
  report.metrics.sourceLineCount = sourceInfo.sourceLineCount;
  report.metrics.usedIndexFallback = false;
  report.metrics.coveredSourceLineCount = 0;
  if (sourceInfo.invalidMetadata) {
    addIssue(report, 'blockers', 'invalid_source_reference', '原文行数元数据无效或与实际原文行数不一致，不能应用 AI 结果。', {
      source_line_count: context && context.source_line_count,
      actual_source_line_count: sourceInfo.sourceLineCount
    });
  }
  if (!shots.length) {
    addIssue(report, 'blockers', 'outline_shots_empty', 'AI返回中没有 outline_shots，不能覆盖当前可用分镜。');
    return report;
  }
  const mode = text(context && context.mode) || 'outline';
  if (mode !== 'outline') return report;
  const total = report.metrics.sourceLineCount;
  if (!total || sourceInfo.invalidMetadata) return report;
  const coverageStats = { explicitMappingCount: 0, invalidSourceIndexCount: 0, invalidSourceReferenceCount: 0, ambiguousSourceBasisCount: 0 };
  const covered = collectCoveredLines(result, total, coverageStats);
  collectCoveredLinesBySourceBasis(result, context, coverageStats).forEach(line => covered.add(line));
  report.metrics.invalidSourceIndexCount = coverageStats.invalidSourceIndexCount;
  report.metrics.invalidSourceReferenceCount = coverageStats.invalidSourceReferenceCount;
  report.metrics.ambiguousSourceBasisCount = coverageStats.ambiguousSourceBasisCount;
  if (coverageStats.invalidSourceReferenceCount) {
    addIssue(report, 'blockers', 'invalid_source_reference', 'AI结果包含无效、越界或过深的原文行引用。', {
      count: coverageStats.invalidSourceReferenceCount
    });
  }
  if (coverageStats.ambiguousSourceBasisCount) {
    addIssue(report, 'blockers', 'ambiguous_source_basis', 'AI结果的 source_basis 对应多条相同原文，不能作为唯一覆盖依据。', {
      count: coverageStats.ambiguousSourceBasisCount
    });
  }
  report.metrics.coveredSourceLineCount = [...covered].filter(line => line >= 1 && line <= total).length;
  const missing = [];
  for (let line = 1; line <= total; line += 1) if (!covered.has(line)) missing.push(line);
  if (missing.length) {
    addIssue(report, 'blockers', 'outline_missing_source_lines', `AI结果遗漏原文行：${missing.slice(0, 8).join('、')}。`, { missing_lines: missing });
  }
  return report;
}

function validateShotDisplayability(result, context) {
  const report = createReport();
  report.metrics.shotCount = outlineShots(result).length;
  report.metrics.promptCount = 0;
  promptUnits(result).forEach(unit => {
    report.metrics.promptCount += 1;
    if (!unit.prompt) {
      addIssue(report, 'blockers', 'shot_prompt_empty', `第${unit.shotIndex + 1}条画面 prompt 为空。`, { shot_index: unit.shotIndex, segment_index: unit.segmentIndex });
      return;
    }
    if (isClearlyGenericPrompt(unit.prompt)) {
      addIssue(report, 'blockers', 'shot_prompt_too_generic', `第${unit.shotIndex + 1}条画面过短或过于通用，不能作为成品提示词应用。`, { shot_index: unit.shotIndex, segment_index: unit.segmentIndex });
      return;
    }
    if (promptCopiesSource(unit.prompt, sourceTextForUnit(unit, context))) {
      addIssue(report, 'blockers', 'shot_prompt_copies_source', `第${unit.shotIndex + 1}条画面疑似直接照抄原文，不能作为成品提示词应用。`, { shot_index: unit.shotIndex, segment_index: unit.segmentIndex });
    }
    if (hasRuleContamination(unit.prompt)) {
      addIssue(report, 'blockers', 'shot_rule_contamination', `第${unit.shotIndex + 1}条画面混入规则或协议文字。`, { shot_index: unit.shotIndex, segment_index: unit.segmentIndex });
    }
    if (cjkLength(unit.prompt) < 28 && !report.blockingIssues.some(issue => issue.shot_index === unit.shotIndex && issue.segment_index === unit.segmentIndex)) {
      addIssue(report, 'warnings', 'shot_prompt_low_density', `第${unit.shotIndex + 1}条画面描述偏短，建议人工复核密度。`, { shot_index: unit.shotIndex, segment_index: unit.segmentIndex });
    }
  });
  return report;
}

function validateManualCastAuthority(result, context) {
  const report = createReport();
  const scene = context && context.scene && typeof context.scene === 'object' ? context.scene : {};
  const manualMode = Boolean(context && (context.manual_cast_mode || context.manualCastMode || context.characters_mode === 'manual' || scene.characters_mode === 'manual'));
  const selected = unique([
    ...contextCharacterList(context, ['manual_selected_characters', 'manualSelectedCharacters', 'selected_characters', 'allowed_characters']),
    ...contextCharacterList(scene, ['characters'])
  ]);
  const forbidden = contextCharacterList(context, ['manual_forbidden_characters', 'manualForbiddenCharacters', 'forbidden_characters', 'excluded_characters']);
  if (!manualMode && !selected.length && !forbidden.length) return report;

  const names = outputStructuredCharacterNames(result);
  names.forEach(name => {
    if (forbidden.includes(name) || (selected.length && !selected.includes(name)) || (manualMode && !selected.includes(name))) {
      addIssue(report, 'blockers', 'manual_cast_forbidden_character', `手动选角不允许「${name}」出场，但 AI 结果的结构化人物字段仍包含该人物。`, { character: name });
    }
  });
  return report;
}

function flattenPrompts(value) {
  return promptUnits({ outline_shots: Array.isArray(value) ? value : outlineShots(value) })
    .map(unit => normalizeCompare(unit.prompt))
    .filter(Boolean)
    .join('|');
}

function validateRegenerationGuidance(result, context) {
  const report = createReport();
  const guidance = text(context && (context.user_guidance || context.guidance || context.regeneration_guidance || context.regenerationGuidance));
  if (!guidance) return report;
  const previous = context && (context.beforeShots || context.previousShots || context.previous_outline_shots || context.previousOutlineShots || context.current_outline_shots || context.currentOutlineShots);
  if (!Array.isArray(previous) || !previous.length) return report;
  const nextKey = flattenPrompts(result);
  const prevKey = flattenPrompts(previous);
  if (nextKey && prevKey && nextKey === prevKey) {
    addIssue(report, 'blockers', 'regenerate_unchanged', '已填写补充建议，但重新生成结果与原画面没有可识别变化。');
  }
  return report;
}

function validateOutlineApplyGate(result, context) {
  return mergeReports([
    validateOutlineCoverage(result, context),
    validateShotDisplayability(result, context),
    validateManualCastAuthority(result, context),
    validateRegenerationGuidance(result, context)
  ]);
}

function summarizeOutlineGateIssues(report) {
  const blockers = list(report && (report.blockingIssues || report.blockers)).map(issue => text(issue && issue.message)).filter(Boolean);
  const warnings = list(report && report.warnings).map(issue => text(issue && issue.message)).filter(Boolean);
  if (blockers.length) return blockers.slice(0, 3).concat(warnings.slice(0, Math.max(0, 3 - blockers.length))).join('；');
  if (warnings.length) return warnings.slice(0, 3).join('；');
  return 'AI结果通过验收。';
}

module.exports = {
  validateOutlineApplyGate,
  validateOutlineCoverage,
  validateShotDisplayability,
  validateManualCastAuthority,
  validateRegenerationGuidance,
  summarizeOutlineGateIssues
};
