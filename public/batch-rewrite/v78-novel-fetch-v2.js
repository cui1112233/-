(() => {
  const API_ROOT = '/api/batch-rewrite';
  const taskFilters = { date: '', bookId: '', status: '' };
  let realtimeTimer = null;
  let legacyTaskBridgeInstalled = false;

  function byId(id) { return document.getElementById(id); }
  function value(id, fallback = '') { return byId(id)?.value ?? fallback; }
  function tokenHeaders(extra = {}) {
    const token = localStorage.getItem('auth_token') || '';
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
  }
  async function v2Api(path, options = {}) {
    const response = await fetch(`${API_ROOT}${path}`, { ...options, headers: tokenHeaders(options.headers || {}) });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
    if (!response.ok) throw new Error(data.error || data.message || data.raw || `HTTP ${response.status}`);
    return data;
  }
  function setText(id, text) { const node = byId(id); if (node) node.textContent = String(text || ''); }
  function currentWorkSnapshot() {
    return {
      platform_id: value('platformSelect', '2'),
      input_text: value('inputText'),
      max_txt: Number(value('fetchMaxTxt', 4000)) || 4000,
      selected_versions: [...document.querySelectorAll('.process-version:checked')].map(node => node.value),
      ai_slot_methods: Object.fromEntries([1, 2, 3, 4, 5].map(index => [`ai${index}`, value(`processAiMethod${index}`)]).filter(([, method]) => method)),
      sensitive_ai_enabled: Boolean(byId('sensitiveAiProcessEnabled')?.checked)
    };
  }
  function selectedTaskIds() {
    return [...document.querySelectorAll('.task-check:checked')]
      .map(node => String(node.dataset.id || '').trim()).filter(Boolean);
  }
  function refreshLegacyTasks() {
    if (typeof loadTasks === 'function') void loadTasks().catch(() => {});
    else byId('taskRefreshBtn')?.click();
  }
  function escapeText(value) { return String(value ?? ''); }
  function buildTaskQuery(filters = taskFilters) {
    const params = new URLSearchParams();
    const date = String(filters.date || '').trim();
    const bookId = String(filters.bookId || '').trim();
    const status = String(filters.status || '').trim();
    if (date) params.set('date', date);
    if (bookId) params.set('bookId', bookId);
    if (status) params.set('status', status);
    const query = params.toString();
    return query ? `?${query}` : '';
  }
  function taskFilterLabel() {
    const parts = [];
    if (taskFilters.date) parts.push(taskFilters.date);
    if (taskFilters.bookId) parts.push(`ID ${taskFilters.bookId}`);
    if (taskFilters.status) parts.push(`状态 ${taskFilters.status}`);
    return parts.length ? parts.join(' · ') : '今天 + 历史未完成';
  }

  function installLegacyTaskListBridge() {
    if (legacyTaskBridgeInstalled) return true;
    if (typeof loadTasks !== 'function' || typeof renderTasks !== 'function' || typeof taskDateKey !== 'function' || typeof state !== 'object') return false;
    const legacyRenderTasks = renderTasks;
    const legacyTaskDateKey = taskDateKey;

    renderTasks = function(tasks) {
      const marker = '2099-12-31';
      const previousDate = state.taskDate;
      const previousInputValue = byId('taskDateFilter')?.value || '';
      taskDateKey = () => marker;
      state.taskDate = marker;
      try {
        return legacyRenderTasks(tasks);
      } finally {
        taskDateKey = legacyTaskDateKey;
        state.taskDate = previousDate;
        if (byId('taskDateFilter')) byId('taskDateFilter').value = previousInputValue;
      }
    };

    loadTasks = async function() {
      const data = await v2Api(`/tasks${buildTaskQuery(taskFilters)}`);
      renderTasks(data.tasks || []);
      setText('summaryText', `${taskFilterLabel()} 显示 ${state.tasks.length} 个任务`);
      setText('v78TaskOpsStatus', `显示 ${state.tasks.length} 个任务`);
      return data;
    };

    legacyTaskBridgeInstalled = true;
    return true;
  }

  function enforceFixedPlatformUi() {
    const toggle = byId('fetchAutoDetectPlatform');
    if (!toggle) return;
    toggle.checked = false;
    toggle.disabled = true;
    const label = toggle.closest('label');
    if (label) label.hidden = true;
    const container = label?.parentElement || document.querySelector('.toggles');
    if (!container || byId('v78FixedPlatformNotice')) return;
    const notice = document.createElement('span');
    notice.id = 'v78FixedPlatformNotice';
    notice.className = 'form-hint';
    notice.textContent = 'V78：原文抓取固定使用当前选择的平台，不会自动切换到其他平台。';
    container.appendChild(notice);
  }

  function injectStyles() {
    if (byId('v78NovelFetchV2Styles')) return;
    const style = document.createElement('style');
    style.id = 'v78NovelFetchV2Styles';
    style.textContent = `
      .v78-v2-panel{border:1px solid var(--border,#3a3a3a);border-radius:12px;padding:14px;margin-top:14px;background:var(--panel,#171717)}
      .v78-v2-head{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:10px}
      .v78-v2-head h3{margin:0;font-size:15px}.v78-v2-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .v78-v2-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-top:8px}
      .v78-v2-card{padding:9px;border:1px solid var(--border,#333);border-radius:9px}.v78-v2-muted{opacity:.72;font-size:12px}
      .v78-v2-list{display:grid;gap:6px;margin-top:8px;max-height:300px;overflow:auto}.v78-v2-row{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:8px;border:1px solid var(--border,#333);border-radius:8px;flex-wrap:wrap}
      .v78-v2-row code{font-size:12px}.v78-v2-error{color:#ff7875}.v78-v2-ok{color:#73d13d}
      .v78-v2-panel input,.v78-v2-panel select{min-height:32px}
    `;
    document.head.appendChild(style);
  }

  function mountAutomationPanel() {
    if (byId('v78AutomationPanel')) return;
    const workspace = document.querySelector('#work .workspace');
    if (!workspace) return;
    const panel = document.createElement('section');
    panel.id = 'v78AutomationPanel';
    panel.className = 'section v78-v2-panel';
    panel.innerHTML = `
      <div class="v78-v2-head"><div><h3>V78 自动处理队列</h3><div class="v78-v2-muted">使用当前批量输入快照；暂停不会中断正在执行的原子步骤。</div></div>
        <div class="v78-v2-actions">
          <button id="v78QueueStart" class="primary">开启全自动</button><button id="v78QueuePause">暂停</button><button id="v78QueueResume">继续</button><button id="v78QueueStop" class="danger">停止</button>
        </div>
      </div>
      <div id="v78RealtimeStatus" class="v78-v2-grid"></div>
      <div class="v78-v2-head" style="margin-top:14px"><div><h3>定时执行</h3><div class="v78-v2-muted">V78 Docker 服务端 one-shot scheduler；错过时间后启动会补跑一次。</div></div>
        <div class="v78-v2-actions"><input id="v78ScheduleRunAt" type="datetime-local"/><button id="v78ScheduleCreate">添加定时</button><button id="v78ScheduleRefresh">刷新</button></div>
      </div>
      <div id="v78ScheduleStatus" class="v78-v2-muted"></div><div id="v78ScheduleList" class="v78-v2-list"></div>`;
    const statusSection = workspace.querySelector('.process-status-section');
    if (statusSection) workspace.insertBefore(panel, statusSection); else workspace.appendChild(panel);

    byId('v78QueueStart').onclick = () => queueAction('start');
    byId('v78QueuePause').onclick = () => queueAction('pause');
    byId('v78QueueResume').onclick = () => queueAction('resume');
    byId('v78QueueStop').onclick = () => queueAction('stop');
    byId('v78ScheduleCreate').onclick = createSchedule;
    byId('v78ScheduleRefresh').onclick = loadSchedules;
    byId('v78ScheduleList').onclick = handleScheduleClick;
  }

  async function queueAction(action) {
    try {
      if (action === 'start') {
        const payload = currentWorkSnapshot();
        if (!String(payload.input_text || '').trim()) throw new Error('请先填写批量输入，再开启全自动');
        await v2Api('/process/queue/start', { method: 'POST', body: JSON.stringify({ items: [payload] }) });
      } else {
        await v2Api(`/process/queue/${action}`, { method: 'POST', body: '{}' });
      }
      await loadRealtimeStatus();
    } catch (error) { setText('v78RealtimeStatus', error.message); }
  }

  function renderRealtime(data = {}) {
    const box = byId('v78RealtimeStatus');
    if (!box) return;
    const c = data.counts || {};
    const cards = [
      ['队列', data.state || 'idle'], ['等待', c.queued || 0], ['处理中', c.running || 0], ['等待重试', c.waiting_retry || 0], ['完成', c.done || 0], ['失败', c.failed || 0]
    ];
    box.innerHTML = '';
    for (const [label, val] of cards) {
      const card = document.createElement('div'); card.className = 'v78-v2-card';
      const b = document.createElement('b'); b.textContent = label; const span = document.createElement('div'); span.textContent = escapeText(val);
      card.append(b, span); box.appendChild(card);
    }
  }
  async function loadRealtimeStatus() {
    try { renderRealtime(await v2Api('/realtime/status')); }
    catch (error) { const box = byId('v78RealtimeStatus'); if (box) { box.textContent = error.message; box.classList.add('v78-v2-error'); } }
  }

  async function createSchedule() {
    try {
      const raw = value('v78ScheduleRunAt');
      const runAt = new Date(raw);
      if (!raw || !Number.isFinite(runAt.getTime())) throw new Error('请选择有效的定时时间');
      const snapshot = currentWorkSnapshot();
      if (!String(snapshot.input_text || '').trim()) throw new Error('请先填写批量输入再创建定时任务');
      await v2Api('/schedules', { method: 'POST', body: JSON.stringify({ runAt: runAt.toISOString(), inputSnapshot: snapshot }) });
      setText('v78ScheduleStatus', '定时任务已保存');
      await loadSchedules();
    } catch (error) { setText('v78ScheduleStatus', error.message); }
  }
  async function loadSchedules() {
    try {
      const data = await v2Api('/schedules');
      const box = byId('v78ScheduleList');
      if (!box) return;
      box.innerHTML = '';
      for (const item of (data.schedules || [])) {
        const row = document.createElement('div');
        row.className = 'v78-v2-row';
        const text = document.createElement('span');
        text.textContent = `${new Date(item.runAt).toLocaleString()} · ${item.status || 'scheduled'}`;
        const actions = document.createElement('span');
        actions.innerHTML = `<button data-v78-schedule-cancel="${item.id}">取消</button> <button data-v78-schedule-delete="${item.id}" class="danger">删除</button>`;
        row.append(text, actions);
        box.appendChild(row);
      }
      if (!box.childNodes.length) box.textContent = '暂无定时任务';
    } catch (error) { setText('v78ScheduleStatus', error.message); }
  }
  async function handleScheduleClick(event) {
    const cancel = event.target.closest('[data-v78-schedule-cancel]');
    const remove = event.target.closest('[data-v78-schedule-delete]');
    try {
      if (cancel) await v2Api(`/schedules/${encodeURIComponent(cancel.dataset.v78ScheduleCancel)}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled', enabled: false }) });
      if (remove) await v2Api(`/schedules/${encodeURIComponent(remove.dataset.v78ScheduleDelete)}`, { method: 'DELETE' });
      if (cancel || remove) await loadSchedules();
    } catch (error) { setText('v78ScheduleStatus', error.message); }
  }

  function mountAdvancedTaskPanel() {
    if (byId('v78TaskOpsPanel')) return;
    const host = document.querySelector('#tasks .section.full');
    const listDetails = byId('taskListDetails');
    if (!host || !listDetails) return;

    const legacyDate = byId('taskDateFilter');
    if (legacyDate?.closest('label')) legacyDate.closest('label').hidden = true;
    if (byId('taskTodayBtn')) byId('taskTodayBtn').hidden = true;

    const panel = document.createElement('div');
    panel.id = 'v78TaskOpsPanel';
    panel.className = 'v78-v2-panel';
    panel.innerHTML = `
      <div class="v78-v2-head"><div><h3>V78 高级任务管理</h3><div class="v78-v2-muted">默认查询：今天任务 + 历史未完成；筛选语义由服务端统一判断，结果直接显示在下方原任务表。</div></div>
        <div class="v78-v2-actions"><button id="v78PrevDay">上一天</button><button id="v78TaskToday">今天</button><input id="v78TaskDate" type="date"/><button id="v78NextDay">下一天</button><input id="v78BookIdSearch" placeholder="书籍ID搜索"/><select id="v78TaskStatus"><option value="">全部状态</option><option value="failed">失败</option><option value="waiting">等待</option><option value="done">完成</option></select><button id="v78TaskSearch">查询</button><button id="v78TaskReset">默认视图</button></div>
      </div>
      <div class="v78-v2-actions"><button id="v78PermanentDelete" class="danger">永久删除已选</button><input id="v78RestoreBookId" placeholder="恢复永久删除的书籍ID"/><button id="v78RestoreTombstone">恢复ID</button><span id="v78TaskOpsStatus" class="v78-v2-muted"></span></div>`;
    host.insertBefore(panel, listDetails);

    byId('v78TaskSearch').onclick = loadAdvancedTasks;
    byId('v78TaskReset').onclick = resetTaskFilters;
    byId('v78TaskToday').onclick = () => {
      byId('v78TaskDate').value = localDateKey(new Date());
      loadAdvancedTasks();
    };
    byId('v78PrevDay').onclick = () => shiftTaskDate(-1);
    byId('v78NextDay').onclick = () => shiftTaskDate(1);
    byId('v78PermanentDelete').onclick = permanentDeleteSelected;
    byId('v78RestoreTombstone').onclick = restoreTombstone;
  }

  function localDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function syncTaskFiltersFromControls() {
    taskFilters.date = String(value('v78TaskDate')).trim();
    taskFilters.bookId = String(value('v78BookIdSearch')).trim();
    taskFilters.status = String(value('v78TaskStatus')).trim();
  }
  function resetTaskFilters() {
    taskFilters.date = '';
    taskFilters.bookId = '';
    taskFilters.status = '';
    if (byId('v78TaskDate')) byId('v78TaskDate').value = '';
    if (byId('v78BookIdSearch')) byId('v78BookIdSearch').value = '';
    if (byId('v78TaskStatus')) byId('v78TaskStatus').value = '';
    void loadAdvancedTasks();
  }
  function shiftTaskDate(delta) {
    const raw = value('v78TaskDate');
    const date = raw ? new Date(`${raw}T12:00:00`) : new Date();
    date.setDate(date.getDate() + delta);
    byId('v78TaskDate').value = localDateKey(date);
    void loadAdvancedTasks();
  }
  async function loadAdvancedTasks() {
    try {
      syncTaskFiltersFromControls();
      if (!installLegacyTaskListBridge()) throw new Error('任务列表尚未就绪，请稍后重试');
      await loadTasks();
    } catch (error) { setText('v78TaskOpsStatus', error.message); }
  }
  async function permanentDeleteSelected() {
    try {
      const ids = selectedTaskIds();
      if (!ids.length) throw new Error('请先在原任务列表勾选任务');
      if (!window.confirm(`永久删除 ${ids.length} 个任务？相同书籍ID后续会被阻止重新导入，直到手动恢复。`)) return;
      const result = await v2Api('/tasks/batch-delete-permanent', { method: 'POST', body: JSON.stringify({ ids }) });
      setText('v78TaskOpsStatus', `已永久删除 ${result.deleted || ids.length} 个任务`);
      refreshLegacyTasks();
    } catch (error) { setText('v78TaskOpsStatus', error.message); }
  }
  async function restoreTombstone() {
    try {
      const id = String(value('v78RestoreBookId')).trim();
      if (!id) throw new Error('请输入要恢复的书籍ID');
      const result = await v2Api(`/tasks/${encodeURIComponent(id)}/restore-tombstone`, { method: 'POST', body: '{}' });
      setText('v78TaskOpsStatus', result.restored ? `已恢复 ${id}` : `${id} 没有永久删除记录`);
    } catch (error) { setText('v78TaskOpsStatus', error.message); }
  }

  function boot() {
    installLegacyTaskListBridge();
    injectStyles();
    enforceFixedPlatformUi();
    mountAutomationPanel();
    mountAdvancedTaskPanel();
    let attempts = 0;
    const mountTimer = window.setInterval(() => {
      installLegacyTaskListBridge();
      enforceFixedPlatformUi();
      mountAutomationPanel();
      mountAdvancedTaskPanel();
      attempts += 1;
      if (attempts >= 20) window.clearInterval(mountTimer);
    }, 250);
    loadRealtimeStatus();
    loadSchedules();
    loadAdvancedTasks();
    if (!realtimeTimer) realtimeTimer = window.setInterval(loadRealtimeStatus, 2000);
  }

  installLegacyTaskListBridge();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
  window.addEventListener('load', () => {
    installLegacyTaskListBridge();
    enforceFixedPlatformUi();
    mountAutomationPanel();
    mountAdvancedTaskPanel();
  }, { once: true });
})();
