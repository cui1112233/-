(() => {
  const API_ROOT = '/api/batch-rewrite';
  const LAYOUT_ID = 'v78ImageAlignedStyles';
  const POLL_MS = 3000;
  let pollTimer = null;
  let mounted = false;

  const $ = id => document.getElementById(id);
  const list = value => Array.isArray(value) ? value : [];
  const text = value => String(value == null ? '' : value);
  const safe = value => text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  function headers(extra = {}) {
    const token = localStorage.getItem('auth_token') || '';
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
  }

  async function api(path) {
    const response = await fetch(`${API_ROOT}${path}`, { headers: headers() });
    const body = await response.text();
    let data = {};
    try { data = body ? JSON.parse(body) : {}; } catch (_) { data = {}; }
    if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
    return data;
  }

  function installStyles() {
    if ($(LAYOUT_ID)) return;
    const style = document.createElement('style');
    style.id = LAYOUT_ID;
    style.textContent = `
      /* Approved image-aligned V78 processing layout */
      #work{--v78-status-ok:var(--ok,#45bd77);--v78-status-running:#4a8cff;--v78-status-fail:var(--danger,#ff6868);--v78-status-warn:#a77bf3}
      #work .workspace#v78ImageWorkGrid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(360px,1fr);gap:14px;align-items:stretch}
      #v78ImageInputPanel,#v78ImageStatusPanel{min-height:612px;border-radius:8px;padding:16px;background:linear-gradient(180deg,var(--panel),color-mix(in srgb,var(--panel) 94%,var(--bg)));box-shadow:none}
      #v78ImageInputPanel .section-title,#v78ImageStatusPanel .section-title{margin-bottom:12px}
      #v78ImageInputPanel .section-title h2,#v78ImageStatusPanel .section-title h2{font-size:17px;color:var(--accent)}
      #v78ImageInputPanel .control-grid{grid-template-columns:repeat(4,minmax(120px,1fr));gap:10px}
      #v78ImageInputPanel .input-area{min-height:160px;max-height:240px;margin-top:12px;border-radius:7px}
      #v78TargetVersions{margin-top:12px!important;padding:12px 0 0!important;border:0!important;border-top:1px solid var(--line)!important;border-radius:0!important;background:transparent!important}
      #v78TargetVersions .v78-inline-head h3{font-size:16px;color:var(--accent)}
      #v78TargetVersions .v78-inline-head .v78-muted{display:none}
      #v78TargetVersions .v78-version-grid{grid-template-columns:repeat(6,minmax(92px,1fr));gap:8px}
      #v78TargetVersions .v78-version-item{min-height:42px;background:var(--panel-soft);border-radius:7px;padding:8px 9px;color:var(--text)}
      #v78TargetVersions .v78-version-item:has(input:checked){border-color:color-mix(in srgb,var(--accent) 72%,var(--line));background:var(--accent-soft)}
      #v78TargetVersions .v78-version-item small{display:block;margin-left:auto;font-size:11px;white-space:nowrap}
      .v78-run-meta{display:grid;grid-template-columns:minmax(150px,220px) minmax(0,1fr);gap:12px;align-items:end;margin:10px 0 4px}
      .v78-run-meta label{display:flex;gap:6px}.v78-run-hint{font-size:12px;color:var(--muted);padding-bottom:9px}
      .v78-settings-cards{display:grid;grid-template-columns:minmax(180px,.7fr) minmax(220px,1fr);gap:10px;margin-top:12px}
      .v78-setting-card{min-height:72px;padding:11px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel-soft)}
      .v78-setting-card-title{font-size:13px;font-weight:700;color:var(--accent);margin-bottom:8px}
      .v78-setting-card .inline-check{flex-direction:row;align-items:center;color:var(--text);gap:8px}
      .v78-setting-card #webLoginStatus{margin:0;min-height:28px;display:inline-flex;align-items:center;cursor:pointer}
      #v78ImageInputPanel>.actions{display:none!important}
      #v78ImageInputPanel>#webLoginStatus,#v78ImageInputPanel>#webSubmitMount{display:none!important}
      #v78ImageStatusPanel{display:flex;flex-direction:column}
      #v78ImageStatusPanel .section-title>span{display:none}
      #v78StatusMetrics{display:grid;grid-template-columns:repeat(5,minmax(72px,1fr));gap:8px;margin-bottom:14px}
      .v78-status-metric{padding:10px 9px;border:1px solid var(--line);border-radius:8px;background:var(--panel-soft);min-width:0}
      .v78-status-metric span{display:block;font-size:12px;color:var(--muted);white-space:nowrap}.v78-status-metric strong{display:block;margin-top:5px;font-size:18px;color:var(--text)}
      .v78-status-metric.ok strong{color:var(--v78-status-ok)}.v78-status-metric.running strong{color:var(--v78-status-running)}.v78-status-metric.fail strong{color:var(--v78-status-fail)}
      .v78-status-divider{height:1px;background:var(--line);margin:0 0 12px}
      .v78-status-subtitle{font-size:14px;font-weight:700;color:var(--accent);margin:0 0 10px}
      #v78ProgressRows{display:grid;gap:10px;margin-bottom:12px}
      .v78-progress-row{display:grid;grid-template-columns:88px minmax(0,1fr) 68px;gap:10px;align-items:center;font-size:12px}
      .v78-progress-track{height:7px;border:1px solid var(--line);border-radius:999px;background:var(--bg);overflow:hidden}.v78-progress-fill{height:100%;border-radius:999px;background:var(--accent);transition:width .25s ease}.v78-progress-fill.ok{background:var(--v78-status-ok)}.v78-progress-fill.web{background:var(--v78-status-warn)}
      .v78-log-head{display:flex;justify-content:space-between;align-items:center;margin-top:4px;margin-bottom:7px}.v78-log-head b{font-size:14px;color:var(--accent)}
      #v78ImageStatusPanel #processResult{flex:1;min-height:270px;max-height:360px;margin:0;padding:12px;background:color-mix(in srgb,var(--bg) 76%,#000 24%);border:1px solid var(--line);border-radius:7px;overflow:auto;white-space:pre-wrap}
      #v78WorkActionBar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:10px 2px 10px;flex-wrap:wrap}
      #v78WorkActionBar .v78-action-group{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
      #v78WorkActionBar button{min-height:38px;padding:8px 15px}
      #v78WorkActionBar #processBtn{min-width:150px}
      #v78CurrentBatchPanel{margin-top:0!important;padding:0!important;overflow:hidden;background:var(--panel);border:1px solid var(--line);border-radius:8px}
      #v78CurrentBatchPanel>.v78-inline-head{padding:11px 14px;border-bottom:1px solid var(--line)}
      #v78CurrentBatchPanel #v78CurrentBatchSummary,#v78CurrentBatchPanel #v78CurrentBatchBooks{display:none!important}
      #v78CurrentBatchTable{width:100%;overflow:auto}
      #v78CurrentBatchTable table{width:100%;border-collapse:collapse;min-width:920px;font-size:12px}
      #v78CurrentBatchTable th,#v78CurrentBatchTable td{padding:9px 10px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);text-align:center;white-space:nowrap}
      #v78CurrentBatchTable th{background:var(--panel-soft);font-weight:700}#v78CurrentBatchTable tr:last-child td{border-bottom:0}#v78CurrentBatchTable th:last-child,#v78CurrentBatchTable td:last-child{border-right:0}
      .v78-cell-ok{color:var(--v78-status-ok);font-weight:700}.v78-cell-run{color:var(--v78-status-running)}.v78-cell-fail{color:var(--v78-status-fail);font-weight:700}.v78-cell-muted{color:var(--muted)}
      .v78-table-view{padding:4px 8px!important;min-height:auto!important;color:var(--accent)}
      .topbar{padding:12px 20px}.topbar h1{font-size:20px}.topbar #summaryText{font-size:11px}.tabs{gap:5px}.tab{border-color:transparent;background:transparent}.tab.active{border-color:transparent;border-bottom:2px solid var(--accent);border-radius:0}
      @media(max-width:1120px){#work .workspace#v78ImageWorkGrid{grid-template-columns:1fr}#v78ImageInputPanel,#v78ImageStatusPanel{min-height:auto}.v78-settings-cards{grid-template-columns:1fr}#v78TargetVersions .v78-version-grid{grid-template-columns:repeat(3,minmax(110px,1fr))}}
      @media(max-width:720px){#v78ImageInputPanel .control-grid{grid-template-columns:1fr 1fr}#v78StatusMetrics{grid-template-columns:repeat(2,1fr)}.v78-run-meta{grid-template-columns:1fr}#v78TargetVersions .v78-version-grid{grid-template-columns:repeat(2,1fr)}}
    `;
    document.head.appendChild(style);
  }

  function syncRunMaxTxt() {
    const proxy = $('v78RunMaxTxt');
    const source = $('fetchMaxTxt');
    if (!proxy || !source) return;
    if (!proxy.dataset.bound) {
      proxy.value = source.value || '4000';
      proxy.addEventListener('input', () => { source.value = proxy.value; source.dispatchEvent(new Event('input', { bubbles: true })); });
      source.addEventListener('input', () => { if (document.activeElement !== proxy) proxy.value = source.value; });
      proxy.dataset.bound = '1';
    }
  }

  function moveRunSettings() {
    const target = $('v78TargetVersions');
    if (!target) return false;
    const heading = target.querySelector('.v78-inline-head h3');
    if (heading) heading.textContent = '本次处理设置';

    if (!$('v78RunMeta')) {
      const meta = document.createElement('div');
      meta.id = 'v78RunMeta';
      meta.className = 'v78-run-meta';
      meta.innerHTML = `<label>截取字数<input id="v78RunMaxTxt" type="number" min="1" value="4000" /></label><div class="v78-run-hint">本次版本只选择一次；未选择的 AI 不生成、不显示、不提交网络。</div>`;
      const grid = target.querySelector('.v78-version-grid');
      target.insertBefore(meta, grid || target.firstChild);
    }
    syncRunMaxTxt();

    if (!$('v78SettingsCards')) {
      const cards = document.createElement('div');
      cards.id = 'v78SettingsCards';
      cards.className = 'v78-settings-cards';
      cards.innerHTML = `<div id="v78SensitiveCard" class="v78-setting-card"><div class="v78-setting-card-title">敏感处理</div></div><div id="v78LoginCard" class="v78-setting-card"><div class="v78-setting-card-title">121 登录</div></div>`;
      const parsed = $('v78ParsedBooks');
      target.insertBefore(cards, parsed || null);
    }
    const sensitive = $('sensitiveAiProcessEnabled')?.closest('label');
    if (sensitive && sensitive.parentElement?.id !== 'v78SensitiveCard') $('v78SensitiveCard')?.appendChild(sensitive);
    const login = $('webLoginStatus');
    if (login && login.parentElement?.id !== 'v78LoginCard') $('v78LoginCard')?.appendChild(login);
    return true;
  }

  function ensureStatusPanel() {
    const statusPanel = document.querySelector('#work .workspace .process-status-section');
    if (!statusPanel) return false;
    statusPanel.id = 'v78ImageStatusPanel';
    if (!$('v78StatusMetrics')) {
      const metrics = document.createElement('div');
      metrics.id = 'v78StatusMetrics';
      metrics.innerHTML = [
        ['v78MetricTotal', '总数量', ''],
        ['v78MetricParsed', '已解析', 'ok'],
        ['v78MetricRunning', '处理中', 'running'],
        ['v78MetricDone', '已完成', 'ok'],
        ['v78MetricFailed', '失败', 'fail']
      ].map(([id, label, cls]) => `<div class="v78-status-metric ${cls}"><span>${label}</span><strong id="${id}">0</strong></div>`).join('');
      const title = statusPanel.querySelector('.section-title');
      title?.insertAdjacentElement('afterend', metrics);
    }
    if (!$('v78ProgressRows')) {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<div class="v78-status-divider"></div><div class="v78-status-subtitle">实时进度</div><div id="v78ProgressRows"></div><div class="v78-log-head"><b>实时日志</b></div>`;
      const result = $('processResult');
      statusPanel.insertBefore(wrap, result || null);
    }
    return true;
  }

  function makeShortcut(id, label, targetId, primary = false) {
    if ($(id)) return $(id);
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.textContent = label;
    if (primary) button.className = 'primary';
    button.addEventListener('click', () => {
      const target = $(targetId);
      const tasksTab = document.querySelector('.tab[data-tab="tasks"]');
      tasksTab?.click();
      window.setTimeout(() => {
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target?.focus?.();
      }, 80);
    });
    return button;
  }

  function ensureActionBar(workspace) {
    if ($('v78WorkActionBar')) return;
    const bar = document.createElement('div');
    bar.id = 'v78WorkActionBar';
    bar.innerHTML = `<div id="v78WorkPrimaryActions" class="v78-action-group"></div><div id="v78WorkTaskActions" class="v78-action-group"></div>`;
    workspace.insertAdjacentElement('afterend', bar);
    const primary = $('v78WorkPrimaryActions');
    const processBtn = $('processBtn');
    const refreshBtn = $('refreshBtn');
    if (processBtn) primary.appendChild(processBtn);
    if (refreshBtn) primary.appendChild(refreshBtn);
    const secondary = $('v78WorkTaskActions');
    secondary.appendChild(makeShortcut('v78QuickRetry', '重试失败', 'retryFailedBtn'));
    secondary.appendChild(makeShortcut('v78QuickRules', '规则处理', 'applyRulesSelectedBtn'));
    secondary.appendChild(makeShortcut('v78QuickSubmit', '提交网络', 'openWebSubmitBtn'));
    secondary.appendChild(makeShortcut('v78QuickFactory', '进入批量工厂', 'transferBatchFactoryBtn', true));
  }

  function mountImageAlignedLayout() {
    installStyles();
    const workspace = document.querySelector('#work .workspace');
    if (!workspace) return false;
    workspace.id = 'v78ImageWorkGrid';
    const sections = workspace.querySelectorAll(':scope > .section');
    if (sections[0]) sections[0].id = 'v78ImageInputPanel';
    if (sections[1]) sections[1].id = 'v78ImageStatusPanel';
    const title = sections[0]?.querySelector('.section-title h2');
    if (title) title.textContent = '批量输入';
    moveRunSettings();
    ensureStatusPanel();
    ensureActionBar(workspace);
    ensureCurrentBatchTable();
    mounted = Boolean($('v78TargetVersions') && $('v78CurrentBatchPanel'));
    return mounted;
  }

  function statusClass(status) {
    const value = text(status).toLowerCase();
    if (/done|complete|submitted|confirmed|已完成|成功/.test(value)) return 'v78-cell-ok';
    if (/fail|error|timeout|partial|失败|错误|超时|异常/.test(value)) return 'v78-cell-fail';
    if (/run|process|queue|pending|处理中|等待|排队/.test(value)) return 'v78-cell-run';
    return 'v78-cell-muted';
  }

  function statusMark(status, ready = false) {
    const value = text(status);
    if (ready || /done|complete|submitted|confirmed|已完成|成功/i.test(value)) return '<span class="v78-cell-ok">✓</span>';
    if (/fail|error|timeout|partial|失败|错误|超时|异常/i.test(value)) return '<span class="v78-cell-fail">×</span>';
    if (/run|process|queue|pending|处理中|等待|排队/i.test(value)) return '<span class="v78-cell-run">○</span>';
    return '<span class="v78-cell-muted">-</span>';
  }

  function taskId(task) { return text(task?.book_id || task?.bookId || task?.id); }
  function targetVersions(batch) {
    const settings = batch?.settingsSnapshot || {};
    return list(settings.target_versions || settings.targetVersions).map(value => text(value).toLowerCase()).filter(Boolean);
  }
  function generatedVersions(task) {
    const values = [
      ...list(task?.ai_generated_versions),
      ...list(task?.ai_files),
      ...list(task?.generated_versions)
    ];
    return new Set(values.map(value => typeof value === 'string' ? value.toLowerCase() : text(value?.version || value?.name).toLowerCase()).filter(Boolean));
  }
  function confirmedVersions(task) {
    return new Set([
      ...list(task?.site_submit_confirmed_versions),
      ...list(task?.siteSubmitConfirmedVersions),
      ...list(task?.confirmed_versions)
    ].map(value => text(value).toLowerCase()).filter(Boolean));
  }

  function ensureCurrentBatchTable() {
    const panel = $('v78CurrentBatchPanel');
    if (!panel) return false;
    if (!$('v78CurrentBatchTable')) {
      const wrap = document.createElement('div');
      wrap.id = 'v78CurrentBatchTable';
      wrap.innerHTML = '<div class="v78-cell-muted" style="padding:16px">正在读取当前批次...</div>';
      panel.appendChild(wrap);
    }
    const actionBar = $('v78WorkActionBar');
    if (actionBar && panel.previousElementSibling !== actionBar) actionBar.insertAdjacentElement('afterend', panel);
    return true;
  }

  function dateLabel(value) {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : text(value);
  }

  function wordLabel(task, versions) {
    const raw = task?.word_count || task?.wordCount || task?.original_chars || task?.originalChars || task?.chars;
    if (raw != null && raw !== '') return safe(raw);
    const pieces = [];
    if (versions.includes('original') && task?.original_chars != null) pieces.push(task.original_chars);
    for (const version of versions.filter(v => /^ai[1-5]$/.test(v))) {
      const value = task?.[`${version}_chars`] ?? task?.[`${version}Chars`];
      if (value != null) pieces.push(value);
    }
    return pieces.length ? pieces.map(safe).join('/') : '-';
  }

  function renderCurrentBatchTable(batch, tasks) {
    const wrap = $('v78CurrentBatchTable');
    if (!wrap) return;
    if (!batch) {
      wrap.innerHTML = '<div class="v78-cell-muted" style="padding:16px">暂无当前批次</div>';
      return;
    }
    const targets = targetVersions(batch);
    const showOriginal = targets.includes('original');
    const aiTargets = targets.filter(version => /^ai[1-5]$/.test(version));
    const map = new Map(list(tasks).map(task => [taskId(task), task]));
    const states = new Map(list(batch.taskStates).map(task => [taskId(task), task]));
    const ids = list(batch.taskIds).length ? list(batch.taskIds) : [...states.keys()];
    const versionHeads = `${showOriginal ? '<th>原文</th>' : ''}${aiTargets.map(version => `<th>${version.toUpperCase()}</th>`).join('')}`;
    const rows = ids.map((id, index) => {
      const live = map.get(text(id)) || {};
      const snap = states.get(text(id)) || {};
      const task = { ...snap, ...live };
      const generated = generatedVersions(task);
      const confirmed = confirmedVersions(task);
      const originalStatus = task.original_status || task.originalStatus || '';
      const aiStatus = task.ai_status || task.aiStatus || '';
      const siteStatus = task.site_submit_status || task.siteSubmitStatus || '';
      const status = task.status || snap.status || '';
      const versionCells = `${showOriginal ? `<td>${statusMark(originalStatus, /done|complete|成功|已完成/i.test(text(originalStatus)))}</td>` : ''}${aiTargets.map(version => `<td>${statusMark(aiStatus, generated.has(version))}</td>`).join('')}`;
      const targetReadyCount = targets.filter(version => version === 'original' ? /done|complete|成功|已完成/i.test(text(originalStatus)) : generated.has(version)).length;
      const submitReady = targets.length > 0 && (confirmed.size ? targets.every(version => confirmed.has(version)) : /submitted|confirmed|done|success|成功|已提交/i.test(text(siteStatus)));
      const submitCell = statusMark(siteStatus, submitReady);
      return `<tr data-v78-current-id="${safe(id)}"><td>${index + 1}</td><td>${safe(task.book_name || task.bookName || '-')}</td><td>${safe(id)}</td>${versionCells}<td>${submitCell}</td><td class="${statusClass(status || siteStatus || aiStatus || originalStatus)}">${safe(status || (targetReadyCount === targets.length && targets.length ? '已完成' : '处理中'))}</td><td>${wordLabel(task, targets)}</td><td>${dateLabel(task.created_at || task.createdAt || batch.createdAt)}</td><td><button type="button" class="v78-table-view" data-v78-open-task="${safe(id)}">查看</button></td></tr>`;
    }).join('');
    wrap.innerHTML = `<table><thead><tr><th>ID</th><th>书名</th><th>Book ID</th>${versionHeads}<th>网站提交</th><th>状态</th><th>字数</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${rows || `<tr><td colspan="${8 + aiTargets.length + (showOriginal ? 1 : 0)}" class="v78-cell-muted">本批次任务尚未生成</td></tr>`}</tbody></table>`;
    wrap.onclick = event => {
      const button = event.target.closest('[data-v78-open-task]');
      if (!button) return;
      openTask(button.dataset.v78OpenTask || '');
    };
  }

  function openTask(id) {
    document.querySelector('.tab[data-tab="tasks"]')?.click();
    window.setTimeout(() => {
      const checker = [...document.querySelectorAll('#tasksBody .task-check')].find(node => text(node.dataset.id) === text(id));
      const row = checker?.closest('tr');
      const view = [...(row?.querySelectorAll('button') || [])].find(button => /查看/.test(button.textContent || ''));
      if (view) view.click();
      else row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  function taskCounters(batch) {
    const states = list(batch?.taskStates);
    const total = list(batch?.taskIds).length || states.length;
    let running = 0;
    let done = 0;
    let failed = 0;
    for (const task of states) {
      const joined = [task.status, task.originalStatus, task.aiStatus, task.siteSubmitStatus, task.error].filter(Boolean).join(' ');
      if (/fail|error|timeout|partial|失败|错误|超时|异常/i.test(joined)) failed += 1;
      else if (/done|complete|已完成|成功/i.test(text(task.status))) done += 1;
      else if (/run|process|queue|pending|处理中|等待|排队/i.test(joined)) running += 1;
    }
    if (!states.length && batch?.status === 'running') running = total;
    return { total, parsed: total, running, done, failed };
  }

  function progressCounts(batch, tasks) {
    const targets = targetVersions(batch);
    const ids = list(batch?.taskIds);
    const map = new Map(list(tasks).map(task => [taskId(task), task]));
    const states = new Map(list(batch?.taskStates).map(task => [taskId(task), task]));
    const totalBooks = ids.length;
    let originalDone = 0;
    let aiDone = 0;
    let submitDone = 0;
    const aiTargets = targets.filter(version => /^ai[1-5]$/.test(version));
    const uploadTargets = targets.length;
    for (const id of ids) {
      const task = { ...(states.get(text(id)) || {}), ...(map.get(text(id)) || {}) };
      const originalStatus = task.original_status || task.originalStatus || '';
      if (/done|complete|成功|已完成/i.test(text(originalStatus))) originalDone += 1;
      const generated = generatedVersions(task);
      aiDone += aiTargets.filter(version => generated.has(version)).length;
      const confirmed = confirmedVersions(task);
      if (confirmed.size) submitDone += targets.filter(version => confirmed.has(version)).length;
      else if (/submitted|confirmed|done|success|成功|已提交/i.test(text(task.site_submit_status || task.siteSubmitStatus))) submitDone += uploadTargets;
    }
    return {
      original: { done: originalDone, total: totalBooks },
      ai: { done: aiDone, total: totalBooks * aiTargets.length },
      submit: { done: submitDone, total: totalBooks * uploadTargets }
    };
  }

  function percent(done, total) { return total > 0 ? Math.max(0, Math.min(100, Math.round(done * 100 / total))) : 0; }
  function progressRow(label, data, cls = '') {
    const pct = percent(data.done, data.total);
    return `<div class="v78-progress-row"><span>${label}</span><div class="v78-progress-track"><div class="v78-progress-fill ${cls}" style="width:${pct}%"></div></div><span>${data.done} / ${data.total}</span></div>`;
  }

  function updateStatus(batch, tasks) {
    const counters = taskCounters(batch);
    const map = {
      v78MetricTotal: counters.total,
      v78MetricParsed: counters.parsed,
      v78MetricRunning: counters.running,
      v78MetricDone: counters.done,
      v78MetricFailed: counters.failed
    };
    for (const [id, value] of Object.entries(map)) if ($(id)) $(id).textContent = `${value} 本`;
    const rows = $('v78ProgressRows');
    if (rows) {
      const progress = progressCounts(batch, tasks);
      rows.innerHTML = [
        progressRow('原文获取', progress.original, 'ok'),
        progressRow('AI文案生成', progress.ai, ''),
        progressRow('网站提交', progress.submit, 'web')
      ].join('');
    }
  }

  async function refreshImageLayoutData() {
    if (!mounted) mountImageAlignedLayout();
    if (!$('v78CurrentBatchTable') || !$('v78StatusMetrics')) return;
    try {
      const [batchData, taskData] = await Promise.all([api('/batches/current'), api('/tasks')]);
      const batch = batchData.batch || null;
      const tasks = list(taskData.tasks);
      renderCurrentBatchTable(batch, tasks);
      updateStatus(batch, tasks);
    } catch (error) {
      const wrap = $('v78CurrentBatchTable');
      if (wrap && !wrap.querySelector('table')) wrap.innerHTML = `<div class="v78-cell-fail" style="padding:16px">${safe(error.message)}</div>`;
    }
  }

  function boot() {
    let attempts = 0;
    const waiter = window.setInterval(() => {
      mountImageAlignedLayout();
      attempts += 1;
      if (mounted || attempts >= 40) {
        window.clearInterval(waiter);
        void refreshImageLayoutData();
        if (!pollTimer) pollTimer = window.setInterval(refreshImageLayoutData, POLL_MS);
      }
    }, 200);
  }

  window.V78NovelFetchLayout = { mountImageAlignedLayout, refreshImageLayoutData };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();