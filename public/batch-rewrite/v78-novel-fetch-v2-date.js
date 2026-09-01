(() => {
  const taskFilters = { date: '' };

  function byId(id) { return document.getElementById(id); }
  function tokenHeaders() {
    const token = localStorage.getItem('auth_token') || '';
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }
  function todayDateKey() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  async function loadDateFilteredTasks() {
    const params = new URLSearchParams();
    if (taskFilters.date) params.set('date', taskFilters.date);
    const response = await fetch(`/api/batch-rewrite/tasks${params.toString() ? `?${params}` : ''}`, { headers: tokenHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
    renderTasks(data.tasks || []);
    const summary = byId('summaryText');
    if (summary) summary.textContent = `${taskFilters.date || '今天 + 历史未完成'} 显示 ${state.tasks.length} 个任务`;
    return data;
  }
  function v78TaskToday() {
    taskFilters.date = todayDateKey();
    const input = byId('taskDateFilter');
    if (input) input.value = taskFilters.date;
    void loadDateFilteredTasks();
  }
  function bindLegacyTaskDateFilter() {
    const input = byId('taskDateFilter');
    if (input && input.dataset.v78DateBound !== '1') {
      input.dataset.v78DateBound = '1';
      input.addEventListener('change', event => {
        event.stopPropagation();
        taskFilters.date = input.value || '';
        void loadDateFilteredTasks();
      }, true);
    }
    const today = byId('taskTodayBtn');
    if (today) today.onclick = v78TaskToday;
  }
  function install() {
    if (typeof renderTasks !== 'function' || typeof state !== 'object') return false;
    loadTasks = loadDateFilteredTasks;
    bindLegacyTaskDateFilter();
    return true;
  }

  if (!install()) {
    let attempts = 0;
    const timer = window.setInterval(() => {
      if (install() || ++attempts >= 20) window.clearInterval(timer);
    }, 250);
  }
})();