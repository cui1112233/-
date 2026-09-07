const fs = require('node:fs');

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`未找到待修复代码：${label}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`待修复代码出现多次：${label}`);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function patchMysqlStore(file) {
  let source = fs.readFileSync(file, 'utf8');
  if (!source.includes('function limitProcessedOriginal(')) {
    source = replaceOnce(
      source,
      "function cleanText(text) { return dropEmptyLines(normalizeNewlines(text)); }",
      `function cleanText(text) { return dropEmptyLines(normalizeNewlines(text)); }\nfunction normalizeMaxTxt(value, fallback = META_DEFAULTS.maxTxt) {\n  const number = Number(value);\n  const fallbackNumber = Number(fallback);\n  const safeFallback = Number.isFinite(fallbackNumber) && fallbackNumber > 0 ? Math.floor(fallbackNumber) : META_DEFAULTS.maxTxt;\n  return Number.isFinite(number) && number > 0 ? Math.floor(number) : safeFallback;\n}\nfunction limitProcessedOriginal(text, maxTxt) {\n  return cleanText(text).slice(0, normalizeMaxTxt(maxTxt));\n}`,
      'mysql-store helpers'
    );
  }

  source = replaceOnce(
    source,
    `        status: record.status,\n        error: record.error`,
    `        status: record.status,\n        error: record.error,\n        maxTxt: normalizeMaxTxt(record.meta.maxTxt, META_DEFAULTS.maxTxt),\n        originalChars: record.original ? record.original.length : (Number(record.meta.originalChars) || 0),\n        originalRawChars: record.originalRaw ? record.originalRaw.length : (Number(record.meta.originalRawChars) || 0)`,
    'listTasks real character counts'
  );

  source = replaceOnce(
    source,
    `      const fetchConfig = isPlainObject(configured.fetch) ? configured.fetch : {};\n      const policy = normalizeFetchPolicy(fetchConfig);`,
    `      const fetchConfig = isPlainObject(configured.fetch) ? configured.fetch : {};\n      const effectiveMaxTxt = normalizeMaxTxt(maxTxt, document.meta.maxTxt || fetchConfig.default_max_txt || META_DEFAULTS.maxTxt);\n      const policy = normalizeFetchPolicy(fetchConfig);`,
    'fetch effective maxTxt'
  );

  source = replaceOnce(
    source,
    `        maxTxt,\n        fetchConfig,`,
    `        maxTxt: effectiveMaxTxt,\n        fetchConfig,`,
    'fetch policy maxTxt'
  );

  source = replaceOnce(
    source,
    `      const raw = result.text;\n      document.originalRaw = raw;\n      document.original = cleanText(raw);\n      document.meta = {\n        ...document.meta,\n        platformAutoDetected: false,\n        originalStatus: 'done', originalRawChars: raw.length, originalChars: document.original.length,`,
    `      const raw = result.text;\n      document.originalRaw = raw;\n      document.original = limitProcessedOriginal(raw, effectiveMaxTxt);\n      document.meta = {\n        ...document.meta,\n        maxTxt: effectiveMaxTxt,\n        platformAutoDetected: false,\n        originalStatus: 'done', originalRawChars: raw.length, originalChars: document.original.length,`,
    'fetch local truncation'
  );

  source = replaceOnce(
    source,
    `    document.original = cleanText(document.originalRaw);\n    document.meta = { ...document.meta, originalChars: document.original.length, originalProcessedAt: now(), status: 'original_restored', updatedAt: now() };`,
    `    const effectiveMaxTxt = normalizeMaxTxt(document.meta.maxTxt, META_DEFAULTS.maxTxt);\n    document.original = limitProcessedOriginal(document.originalRaw, effectiveMaxTxt);\n    document.meta = { ...document.meta, maxTxt: effectiveMaxTxt, originalChars: document.original.length, originalProcessedAt: now(), status: 'original_restored', updatedAt: now() };`,
    'restore local truncation'
  );

  source = replaceOnce(
    source,
    `module.exports = { createMySQLWorkshopStore, DEFAULT_CONFIG, DEFAULT_FETCH_ENDPOINT, buildFetchURL, extractFetchedText, upstreamFetchError, normalizeNewlines, dropEmptyLines, cleanText };`,
    `module.exports = { createMySQLWorkshopStore, DEFAULT_CONFIG, DEFAULT_FETCH_ENDPOINT, buildFetchURL, extractFetchedText, upstreamFetchError, normalizeNewlines, dropEmptyLines, cleanText, normalizeMaxTxt, limitProcessedOriginal };`,
    'mysql-store exports'
  );

  fs.writeFileSync(file, source);
}

function patchLegacyApp(file) {
  let source = fs.readFileSync(file, 'utf8');

  source = replaceOnce(
    source,
    `function originalStatusText(task) {\n  if (task.original_status === \"done\") return \`\${task.original_chars || 0}字\`;`,
    `function originalStatusText(task) {\n  if (task.original_status === \"done\") {\n    const raw = Number(task.original_raw_chars ?? task.originalRawChars ?? 0);\n    const maxTxt = Number(task.max_txt ?? task.maxTxt ?? 0);\n    const processed = raw > 0 && maxTxt > 0 ? Math.min(maxTxt, raw) : Number(task.original_chars ?? task.originalChars ?? 0);\n    return raw > 0 ? \`\${processed}/\${raw}\` : \`\${processed}字\`;\n  }`,
    'legacy original ratio'
  );

  source = replaceOnce(
    source,
    `    created: \"待处理\", queued: \"等待处理\", running: \"处理中\", classified: \"已完成判断\", classifying: \"正在判断\", classify_failed: \"判断失败\",\n    fetching: \"正在抓取\", fetched: \"已抓取\", done: \"已完成\", original_done: \"原文已就绪\", original_failed: \"原文抓取失败\",\n    generating: \"正在生成\", generated: \"已生成\", ai_done: \"AI文案已生成\", ai_failed: \"AI生成失败\", process_failed: \"处理失败\",`,
    `    created: \"待处理\", queued: \"排队中\", running: \"正在执行中…\", processing: \"正在执行中…\", input_ready: \"分类信息已就绪\", classified: \"已完成判断\", classifying: \"AI判断中…\", classify_failed: \"判断失败\",\n    fetching: \"正在抓取\", fetched: \"已抓取\", done: \"已完成\", original_done: \"原文已就绪\", original_failed: \"原文抓取失败\",\n    generating: \"正在生成AI文案…\", generated: \"已生成\", ai_done: \"AI文案已生成\", ai_failed: \"AI生成失败\", process_failed: \"处理失败\",`,
    'legacy Chinese task statuses'
  );

  source = source.replace('    queued: "排队中", uploading:', '    uploading:');
  fs.writeFileSync(file, source);
}

function patchV2(file) {
  let source = fs.readFileSync(file, 'utf8');

  if (!source.includes("input_ready: '分类信息已就绪'")) {
    source = replaceOnce(
      source,
      `  function taskFilterLabel() {\n    const parts = [];`,
      `  const TASK_STATUS_LABELS = {\n    input_ready: '分类信息已就绪',\n    queued: '排队中',\n    running: '正在执行中…',\n    processing: '正在执行中…',\n    classifying: 'AI判断中…',\n    generating: '正在生成AI文案…'\n  };\n  function taskStatusLabel(value, fallback = '') {\n    const text = String(value || '').trim();\n    if (!text) return fallback;\n    if (TASK_STATUS_LABELS[text]) return TASK_STATUS_LABELS[text];\n    return /^[a-z0-9_:-]+$/i.test(text) ? (fallback || '处理中') : text;\n  }\n  function originalCountLabel(task = {}) {\n    const meta = task.meta && typeof task.meta === 'object' ? task.meta : {};\n    const raw = Number(task.original_raw_chars ?? task.originalRawChars ?? meta.original_raw_chars ?? meta.originalRawChars ?? 0);\n    const maxTxt = Number(task.max_txt ?? task.maxTxt ?? meta.max_txt ?? meta.maxTxt ?? 0);\n    const actual = Number(task.original_chars ?? task.originalChars ?? meta.original_chars ?? meta.originalChars ?? 0);\n    const processed = raw > 0 && maxTxt > 0 ? Math.min(maxTxt, raw) : actual;\n    return raw > 0 ? \`\${processed}/\${raw}\` : (actual > 0 ? \`\${actual}字\` : '');\n  }\n\n  function taskFilterLabel() {\n    const parts = [];`,
      'V2 display helpers'
    );
  }

  source = replaceOnce(
    source,
    `    const legacyRenderTasks = renderTasks;\n    const legacyTaskDateKey = taskDateKey;\n    renderTasks = function(tasks) {\n      const marker = '2099-12-31';\n      const previousDate = state.taskDate;\n      const previousInputValue = byId('taskDateFilter')?.value || '';\n      taskDateKey = () => marker;\n      state.taskDate = marker;\n      try {\n        const result = legacyRenderTasks(tasks);\n        patchTaskTableForV78(tasks);\n        return result;\n      } finally {\n        taskDateKey = legacyTaskDateKey;\n        state.taskDate = previousDate;\n        if (byId('taskDateFilter')) byId('taskDateFilter').value = previousInputValue;\n      }\n    };`,
    `    const legacyRenderTasks = renderTasks;\n    renderTasks = function(tasks) {\n      const result = legacyRenderTasks(tasks);\n      patchTaskTableForV78(state.tasks || []);\n      return result;\n    };`,
    'V2 real date filtering'
  );

  source = replaceOnce(
    source,
    `    const pushIndex = headers.findIndex(th => th.textContent.trim() === '推送日期');\n    const aiIndex = headers.findIndex(th => th.textContent.trim() === 'AI文案');\n    const taskById = new Map(asArray(tasks).map(task => [String(task.id || task.book_id || ''), task]));`,
    `    const pushIndex = headers.findIndex(th => th.textContent.trim() === '推送日期');\n    const classifyIndex = headers.findIndex(th => th.textContent.trim() === 'AI判断');\n    const originalIndex = headers.findIndex(th => th.textContent.trim() === '原文');\n    const aiIndex = headers.findIndex(th => th.textContent.trim() === 'AI文案');\n    const taskById = new Map(asArray(tasks).map(task => [String(task.id || task.book_id || task.bookId || ''), task]));`,
    'V2 table indexes'
  );

  source = replaceOnce(
    source,
    `      const selected = selectedAiVersions(task);`,
    `      if (classifyIndex >= 0 && row.children[classifyIndex]) {\n        row.children[classifyIndex].textContent = taskStatusLabel(task.classify_status ?? task.classifyStatus, task.classifier_model || task.classifierModel ? '已完成判断' : '待判断');\n      }\n      if (originalIndex >= 0 && row.children[originalIndex]) {\n        const label = originalCountLabel(task);\n        if (label) row.children[originalIndex].textContent = label;\n      }\n      const selected = selectedAiVersions(task);`,
    'V2 task presentation'
  );

  fs.writeFileSync(file, source);
}

patchMysqlStore('lib/novel-fetch-workshop/mysql-store.js');
patchLegacyApp('frontend/dist/batch-rewrite/app.js');
patchV2('public/batch-rewrite/v78-novel-fetch-v2.js');
console.log('V88_NOVEL_FETCH_CONSOLIDATION_APPLIED');
