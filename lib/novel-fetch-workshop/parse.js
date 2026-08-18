// 改文工作台：批量清单解析（纯函数模块，无任何文件读写）
// 逻辑照搬已逆向分析的 Python 批量原文改文系统（字段、别名、mode、规范化规则均来自真实系统）。

// ===== 常量（逐字） =====
const STANDARD_FIELDS = ['book_id','paid_book_id','free_book_id','book_name','gender','style','tags','reason','rating'];
const RATING_VALUES = ['S','S+','A','A+','B','B+','C','C+'];
const PARSE_MODES = ['smart','header','multi_header','fixed_full_11','fixed_from_b','fixed_paid_basic','custom'];

const HEADER_ALIASES = {
  book_id:    ['书籍ID','书籍id','书ID','书id','ID','id','book_id','bookid','book id'],
  paid_book_id: ['付费书籍ID','付费ID','paid_book_id','paidid'],
  free_book_id: ['免费书籍ID','免费ID','free_book_id','freeid'],
  book_name:  ['书籍名称','书名','名称','标题','小说名','作品名','book_name','name','title'],
  gender:     ['男女频','性别','频道','男频女频','频类','gender'],
  style:      ['风格','风格类型','类型','分类','AI识别类型','识别类型','ai类型','style','type'],
  tags:       ['标签','题材','关键词','卖点','tag','tags'],
  reason:     ['推荐理由','理由','推荐语','简介','文案','卖点文案','reason','desc'],
  rating:     ['内容评级','评级','等级','rating','rank']
};

const FIXED_MODE_COLUMNS = {
  fixed_full_11:  ['ignore','free_book_id','paid_book_id','book_name','rating','ignore','ignore','ignore','ignore','gender','reason'],
  fixed_from_b:   ['free_book_id','paid_book_id','book_name','rating','ignore','ignore','ignore','ignore','gender','reason'],
  fixed_paid_basic: ['paid_book_id','book_name','gender','reason']
};

const COLUMN_PRESETS = [
  { id: 'paid_name_reason', name: '付费ID/书名/推荐理由', columns: ['paid_book_id','book_name','reason'] },
  { id: 'paid_name_gender_reason', name: '付费ID/书名/男女频/推荐理由', columns: ['paid_book_id','book_name','gender','reason'] },
  { id: 'free_paid_name_gender_reason', name: '免费ID/付费ID/书名/男女频/推荐理由', columns: ['free_book_id','paid_book_id','book_name','gender','reason'] },
  { id: 'sample_input', name: '书籍ID/书名/推荐理由/男女频/标签/评级', columns: ['book_id','book_name','reason','gender','tags','rating'] },
  { id: 'full_11', name: '完整11列', columns: FIXED_MODE_COLUMNS.fixed_full_11 }
];

// ===== 基础工具 =====

// 清洗单元格：去掉 BOM 并 trim
function cleanCell(value) {
  return String(value == null ? '' : value).replace(/^\uFEFF+/, '').trim();
}

// 表头归一化：小写并去掉空格/下划线/连字符，用于别名比对
function normalizeHeader(value) {
  return cleanCell(value).toLowerCase().replace(/ /g, '').replace(/_/g, '').replace(/-/g, '');
}

// 表头文本 → 标准字段名（别名命中则返回字段名，否则 ''）
function aliasToField(value) {
  const normalized = normalizeHeader(value);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      if (normalizeHeader(alias) === normalized) return field;
    }
  }
  return '';
}

// 行中可识别字段的数量（去重）
function headerScore(cells) {
  return new Set(cells.map(aliasToField).filter(Boolean)).size;
}

// 是否为表头行：命中 ≥2 个可识别字段
function rowHasHeader(cells) {
  return headerScore(cells) >= 2;
}

// 是否为 ID 单元格：10~25 位纯数字
function isIdCell(value) {
  return /^\d{10,25}$/.test(cleanCell(value));
}

// 行切分：按优先级 \t → | → 连续2+空白 → ,（逗号）→ 整行作为单个单元格
// 每个单元格都去掉 BOM 并 trim；\t / | 保留空单元格，2+ 空白丢弃空段
function splitCsvLine(line) {
  // 简易 CSV 行切分（兼容双引号包裹含逗号/引号转义），与 Python csv.reader 行为一致
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map(cleanCell);
}

function splitPastedLine(line) {
  const text = String(line == null ? '' : line).replace(/[\r\n]+$/, '');
  if (text.includes('\t')) return text.split('\t').map(cleanCell);
  if (text.includes('|')) return text.split('|').map(cleanCell);
  if (/\s{2,}/.test(text)) return text.split(/\s{2,}/).map(cleanCell).filter(Boolean);
  if (text.includes(',')) return splitCsvLine(text);
  return [cleanCell(text)];
}

// 自定义列顺序文本 → 字段名数组（含 'ignore'）
function parseColumnOrder(text) {
  const result = [];
  for (const token of String(text || '').split(/[\n\r\t,，、\/|]+/)) {
    const cell = cleanCell(token);
    if (!cell) continue;
    let field = aliasToField(cell);
    if (!field && ['忽略', '跳过', '空', 'ignore', '-'].includes(normalizeHeader(cell))) field = 'ignore';
    if (field) result.push(field);
  }
  return result;
}

// 列预设 → 列名数组
function presetColumns(presetId) {
  for (const preset of COLUMN_PRESETS) {
    if (preset.id === presetId) return [...preset.columns];
  }
  return [];
}

// ===== 规范化 =====

// 男女频规范化：精确命中或包含命中
function normalizeGender(value) {
  const text = cleanCell(value);
  if (!text) return '';
  const male = ['男', '男频', '男性', '男生', '男向', '男频文'];
  const female = ['女', '女频', '女性', '女生', '女向', '女频文'];
  if (male.includes(text)) return '男频';
  if (female.includes(text)) return '女频';
  if (text.includes('男频') && !text.includes('女频')) return '男频';
  if (text.includes('女频') && !text.includes('男频')) return '女频';
  return '';
}

// 风格规范化：先精确匹配 styles，再子串包含匹配（某 style 是 value 的子串或反之），取第一个命中
function normalizeStyle(value, styles) {
  const text = cleanCell(value);
  if (!text) return '';
  const list = Array.isArray(styles) ? styles.map(cleanCell) : [];
  for (const style of list) {
    if (text === style) return style;
  }
  for (const style of list) {
    if (style && (text.includes(style) || style.includes(text))) return style;
  }
  return '';
}

// ===== 解析主流程 =====

// 空行结构（内部以 snake_case 字段承载，输出任务时再转 camelCase）
function emptyRow() {
  const row = {};
  for (const field of STANDARD_FIELDS) row[field] = '';
  return row;
}

// bookId 最终选择：book_id → paid_book_id → free_book_id → sourceLine 中第一个 10~25 位数字
function chooseBookId(row) {
  for (const key of ['book_id', 'paid_book_id', 'free_book_id']) {
    const value = cleanCell(row[key] ?? '');
    if (value) return value;
  }
  const match = String(row.source_line || '').match(/\d{10,25}/);
  return match ? match[0] : '';
}

// 行富化：规范化字段、选择 bookId、记录 gender/style 来源与解析元信息
function enrichRow(row, styles, parseMode, columns) {
  const result = { ...row };
  for (const field of STANDARD_FIELDS) result[field] = cleanCell(result[field] ?? '');
  result.book_id = chooseBookId(result);
  result.gender = normalizeGender(result.gender);
  result.style = normalizeStyle(result.style, styles);
  result.gender_source = result.gender ? 'input' : '';
  result.style_source = result.style ? 'input' : '';
  result.parse_mode = parseMode;
  result.parse_columns = (columns || []).filter(item => item && item !== 'ignore');
  return result;
}

// 按列顺序映射：单元格按顺序一一对应；最后一列是 reason/tags 时吸收其后所有剩余单元格
function mapRowByOrder(cells, order, styles, parseMode) {
  const row = emptyRow();
  const cleanCells = cells.map(cleanCell);
  for (let index = 0; index < order.length; index++) {
    const field = order[index];
    if (index >= cleanCells.length) break;
    if (!field || field === 'ignore' || !(field in row)) continue;
    if ((field === 'reason' || field === 'tags') && index === order.length - 1) {
      row[field] = cleanCells.slice(index).filter(Boolean).join(' ');
      break;
    }
    if (row[field] && (field === 'reason' || field === 'tags')) {
      row[field] = `${row[field]} ${cleanCells[index]}`.trim();
    } else {
      row[field] = cleanCells[index];
    }
  }
  row.source_line = cleanCells.join('\t');
  // 性别兜底：gender 列未命中有效性别时，扫描整行单元格找性别词（与无表头智能推断的元数据扫描一致）
  if (!normalizeGender(row.gender)) {
    for (const cell of cleanCells) {
      const gender = normalizeGender(cell);
      if (gender) { row.gender = gender; break; }
    }
  }
  return enrichRow(row, styles, parseMode, order);
}

// 连续表头行合并：同一列出现可识别字段就采用该字段名
function mergeHeaderRows(headerRows) {
  const width = headerRows.reduce((max, row) => Math.max(max, row.length), 0);
  const headers = new Array(width).fill('');
  for (const row of headerRows) {
    for (let index = 0; index < row.length; index++) {
      const field = aliasToField(row[index]);
      if (field) headers[index] = field;
    }
  }
  return headers;
}

// 表头识别：扫描前 N 行找表头行，跳过表头行后按合并表头映射数据行
function parseWithHeaders(rawRows, styles, parseMode, maxScanRows) {
  let firstHeaderIndex = -1;
  for (let index = 0; index < Math.min(rawRows.length, maxScanRows); index++) {
    if (rowHasHeader(rawRows[index])) { firstHeaderIndex = index; break; }
  }
  if (firstHeaderIndex < 0) return null;

  let lastHeaderIndex = firstHeaderIndex;
  const scanLimit = Math.min(rawRows.length, maxScanRows);
  while (lastHeaderIndex + 1 < scanLimit && rowHasHeader(rawRows[lastHeaderIndex + 1])) {
    lastHeaderIndex++;
  }

  const headers = mergeHeaderRows(rawRows.slice(0, lastHeaderIndex + 1));
  if (headers.filter(Boolean).length < 2) return null;

  const rows = [];
  for (const cells of rawRows.slice(lastHeaderIndex + 1)) {
    if (rowHasHeader(cells)) continue;
    rows.push(mapRowByOrder(cells, headers, styles, parseMode));
  }
  return rows;
}

// 无表头智能推断：行内找 10~25 位数字 ID、日期双 ID、性别词与评级元数据列
function inferNoHeaderRow(cells, styles, parseMode) {
  const cleanCells = cells.map(cleanCell).filter(Boolean);
  const row = emptyRow();
  row.source_line = cleanCells.join('\t');
  if (!cleanCells.length) return enrichRow(row, styles, parseMode);

  const idPositions = [];
  cleanCells.forEach((cell, index) => { if (isIdCell(cell)) idPositions.push(index); });

  let idIndex;
  if (idPositions.length >= 2 && /\d{4}[-/年]\d{1,2}/.test(cleanCells[0])) {
    row.free_book_id = cleanCells[idPositions[0]];
    row.paid_book_id = cleanCells[idPositions[1]];
    row.book_id = row.paid_book_id;
    idIndex = idPositions[1];
  } else if (idPositions.length) {
    row.book_id = cleanCells[idPositions[0]];
    idIndex = idPositions[0];
  } else {
    idIndex = -1;
  }

  // 元数据列：性别词与评级
  const metadataIndexes = new Set(idPositions);
  for (let index = 0; index < cleanCells.length; index++) {
    const gender = normalizeGender(cleanCells[index]);
    if (gender && !row.gender) { row.gender = gender; metadataIndexes.add(index); }
    const rating = cleanCell(cleanCells[index]).toUpperCase();
    if (RATING_VALUES.includes(rating) && !row.rating) { row.rating = rating; metadataIndexes.add(index); }
  }

  // ID 后第一个非元数据单元格作为书名
  for (let index = idIndex + 1; index < cleanCells.length; index++) {
    if (metadataIndexes.has(index)) continue;
    row.book_name = cleanCells[index];
    metadataIndexes.add(index);
    break;
  }

  // 其余单元格合并为推荐理由
  const remaining = cleanCells.filter((cell, index) => !metadataIndexes.has(index) && cell);
  if (remaining.length) {
    row.reason = remaining.join(' ');
    row.tags = remaining.join(' ');
  }
  return enrichRow(row, styles, parseMode);
}

// 批量清单解析入口
// 返回 { parsed, emptyIdCount, uniqueTasks, duplicateCount, tasks }
function parseBooks({ inputText, parseMode = 'smart', columnPresetId, columnOrder = '', styles = [] }) {
  const fixedStyles = Array.isArray(styles) ? styles : [];
  const lines = String(inputText == null ? '' : inputText).split('\n').filter(line => cleanCell(line));
  const rawRows = lines.map(splitPastedLine);

  const emptyResult = () => ({ parsed: 0, emptyIdCount: 0, uniqueTasks: 0, duplicateCount: 0, tasks: [] });
  if (!rawRows.length) return emptyResult();

  const mode = cleanCell(parseMode) || 'smart';
  const validMode = PARSE_MODES.includes(mode) ? mode : 'smart';

  // 解析模式 → 列顺序
  let order = [];
  if (Object.prototype.hasOwnProperty.call(FIXED_MODE_COLUMNS, validMode)) {
    order = [...FIXED_MODE_COLUMNS[validMode]];
  } else if (columnPresetId) {
    order = presetColumns(columnPresetId);
  } else if (validMode === 'custom') {
    order = parseColumnOrder(columnOrder);
  }

  // 非表头行集合
  const dataRows = rawRows.filter(cells => !rowHasHeader(cells));

  let parsedRows;
  if (['header', 'multi_header', 'smart'].includes(validMode)) {
    const headerRows = parseWithHeaders(rawRows, fixedStyles, validMode, validMode === 'multi_header' ? 8 : 5);
    if (headerRows !== null) {
      parsedRows = headerRows;
    } else if (order.length) {
      parsedRows = dataRows.map(cells => mapRowByOrder(cells, order, fixedStyles, validMode));
    } else {
      parsedRows = dataRows.map(cells => inferNoHeaderRow(cells, fixedStyles, validMode));
    }
  } else if (order.length) {
    parsedRows = dataRows.map(cells => mapRowByOrder(cells, order, fixedStyles, validMode));
  } else {
    parsedRows = dataRows.map(cells => inferNoHeaderRow(cells, fixedStyles, validMode));
  }

  // 合并去重：按最终 bookId 合并，同 ID 多行合并为一行，非空值补齐（后出现的非空字段覆盖）
  const emptyIdCount = parsedRows.filter(row => !row.book_id).length;
  const rowsWithId = parsedRows.filter(row => row.book_id);

  const merged = new Map();
  let duplicateCount = 0;
  for (const row of rowsWithId) {
    const bookId = row.book_id;
    if (merged.has(bookId)) {
      duplicateCount++;
      const current = merged.get(bookId);
      for (const [key, value] of Object.entries(row)) {
        if (cleanCell(value)) current[key] = value;
      }
    } else {
      merged.set(bookId, { ...row });
    }
  }

  const tasks = [...merged.values()].map(row => ({
    bookId: row.book_id,
    paidBookId: row.paid_book_id,
    freeBookId: row.free_book_id,
    bookName: row.book_name,
    gender: row.gender,
    genderSource: row.gender_source,
    style: row.style,
    styleSource: row.style_source,
    tags: row.tags,
    reason: row.reason,
    rating: row.rating,
    sourceLine: row.source_line,
    parseMode: row.parse_mode,
    parseColumns: row.parse_columns
  }));

  return {
    parsed: parsedRows.length,
    emptyIdCount,
    uniqueTasks: tasks.length,
    duplicateCount,
    tasks
  };
}

module.exports = {
  STANDARD_FIELDS,
  RATING_VALUES,
  PARSE_MODES,
  COLUMN_PRESETS,
  HEADER_ALIASES,
  FIXED_MODE_COLUMNS,
  normalizeGender,
  normalizeStyle,
  parseBooks
};
