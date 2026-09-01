(() => {
  const API_ROOT = '/api/batch-rewrite';
  const STYLE_ID = 'v78RunControlsStyles';
  const METHOD_OPTIONS = [
    ['', '自动轮换'],
    ['instruction', '指令改文'],
    ['opening_instruction', '开头词+指令'],
    ['high_imitation', '高仿文章']
  ];
  let mounted = false;
  let fetchPatched = false;

  const $ = id => document.getElementById(id);
  const text = value => String(value == null ? '' : value);

  function headers(extra = {}) {
    const token = localStorage.getItem('auth_token') || '';
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
  }

  async function api(path, options = {}) {
    const response = await fetch(`${API_ROOT}${path}`, { ...options, headers: headers(options.headers || {}) });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = { raw }; }
    if (!response.ok) throw new Error(data.error || data.message || data.raw || `HTTP ${response.status}`);
    return data;
  }

  function installStyles() {
    if ($(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #v78TargetVersions .v78-version-item small{display:none!important}
      .v78-run-ai-label{margin:8px 0 4px;font-size:12px;color:var(--muted)}
      #v78RunMethodGrid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:10px 0 2px}
      #v78RunMethodGrid label{display:grid;gap:6px;min-width:0;font-size:11px;color:var(--muted)}
      #v78RunMethodGrid select{width:100%;min-height:34px;padding:6px 8px;border-radius:6px}
      #v78RunMethodGrid select:disabled{opacity:.48;cursor:not-allowed}
      #v78ScheduleBtn,#v78SensitiveRepairBtn{min-height:37px}
      #v78ScheduleDialog{width:min(420px,calc(100vw - 32px));border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--text);padding:0;box-shadow:0 24px 80px rgba(0,0,0,.5)}
      #v78ScheduleDialog::backdrop{background:rgba(0,0,0,.58)}
      #v78ScheduleDialog .v78-schedule-form{display:grid;gap:12px;padding:18px}
      #v78ScheduleDialog h3{margin:0;color:var(--v78-blue,#1677ff);font-size:17px}
      #v78ScheduleDialog label{display:grid;gap:7px;font-size:12px;color:var(--muted)}
      #v78ScheduleDialog input{min-height:38px;padding:7px 9px;border:1px solid var(--line);border-radius:6px;background:var(--panel-soft);color:var(--text)}
      #v78ScheduleDialog .v78-schedule-actions{display:flex;justify-content:flex-end;gap:8px}
      #v78ScheduleResult{min-height:18px;font-size:12px;color:var(--muted)}
      @media(max-width:900px){#v78RunMethodGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;
    document.head.appendChild(style);
  }

  function configuredMethods() {
    try {
      if (typeof state === 'object') {
        const methods = state?.config?.app_config?.rewrite?.ai_slot_methods;
        if (methods && typeof methods === 'object') return { ...methods };
      }
    } catch (_) {}
    return {};
  }

  function collectRunMethods() {
    const result = {};
    for (let index = 1; index <= 5; index += 1) {
      const value = text($(`v78RunAiMethod${index}`)?.value).trim();
      if (value) result[`ai${index}`] = value;
    }
    return result;
  }

  function syncMethodsIntoV78() {
    try {
      if (typeof state !== 'object' || !state) return;
      state.config = state.config || {};
      state.config.app_config = state.config.app_config || {};
      state.config.app_config.rewrite = state.config.app_config.rewrite || {};
      state.config.app_config.rewrite.ai_slot_methods = collectRunMethods();
    } catch (_) {}
  }

  function applyMethodSnapshot(methods = {}) {
    for (let index = 1; index <= 5; index += 1) {
      const select = $(`v78RunAiMethod${index}`);
      if (!select) continue;
      const value = text(methods[`ai${index}`]).trim();
      select.value = [...select.options].some(option => option.value === value) ? value : '';
    }
    syncMethodsIntoV78();
    syncMethodAvailability();
  }

  function selectedTargets() {
    const versions = [];
    if ($('v78TargetOriginal')?.checked) versions.push('original');
    for (let index = 1; index <= 5; index += 1) {
      if ($(`v78TargetAi${index}`)?.checked) versions.push(`ai${index}`);
    }
    return versions;
  }

  function selectedPreviewIds() {
    const inputs = [...document.querySelectorAll('[data-v78-preview-id]')];
    if (!inputs.length) return [];
    return inputs.filter(input => input.checked).map(input => text(input.dataset.v78PreviewId).trim()).filter(Boolean);
  }

  function buildCurrentRunSnapshot() {
    const targets = selectedTargets();
    return {
      platform_id: $('platformSelect')?.value || '2',
      parse_mode: $('parseModeSelect')?.value || 'smart',
      column_preset_id: $('columnPresetSelect')?.value || '',
      column_order: $('columnOrderInput')?.value || '书籍ID,书名,推荐理由,男女频,标签,评级',
      input_text: $('inputText')?.value || '',
      max_txt: Number($('v78RunMaxTxt')?.value || $('fetchMaxTxt')?.value || 4000) || 4000,
      target_versions: targets,
      targetVersions: targets,
      ai_slot_methods_snapshot: collectRunMethods(),
      task_ids: selectedPreviewIds(),
      sensitive_ai_enabled: $('sensitiveAiProcessEnabled')?.checked === true
    };
  }

  function syncMethodAvailability() {
    for (let index = 1; index <= 5; index += 1) {
      const checkbox = $(`v78TargetAi${index}`);
      const select = $(`v78RunAiMethod${index}`);
      if (!select) continue;
      select.disabled = checkbox ? !checkbox.checked : false;
      if (checkbox && !checkbox.dataset.v78RunMethodBound) {
        checkbox.addEventListener('change', syncMethodAvailability);
        checkbox.dataset.v78RunMethodBound = '1';
      }
    }
  }

  function mountMethodSelectors() {
    const target = $('v78TargetVersions');
    const versionGrid = $('v78CompactTargets') || target?.querySelector('.v78-version-grid');
    if (!target || !versionGrid) return false;
    if (!$('v78RunAiLabel')) {
      const label = document.createElement('div');
      label.id = 'v78RunAiLabel';
      label.className = 'v78-run-ai-label';
      label.textContent = 'AI文案（选择本次需要生成的版本）';
      versionGrid.insertAdjacentElement('beforebegin', label);
    }
    if (!$('v78RunMethodGrid')) {
      const grid = document.createElement('div');
      grid.id = 'v78RunMethodGrid';
      for (let index = 1; index <= 5; index += 1) {
        const label = document.createElement('label');
        label.textContent = `AI${index} 改文方式`;
        const select = document.createElement('select');
        select.id = `v78RunAiMethod${index}`;
        for (const [value, name] of METHOD_OPTIONS) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = name;
          select.appendChild(option);
        }
        select.addEventListener('change', syncMethodsIntoV78);
        label.appendChild(select);
        grid.appendChild(label);
      }
      versionGrid.insertAdjacentElement('afterend', grid);
      applyMethodSnapshot(configuredMethods());
    }
    syncMethodAvailability();
    return true;
  }

  function setWorkMessage(message) {
    const preview = $('v78PreviewStatus');
    if (preview) preview.textContent = message;
    const result = $('processResult');
    if (result && !result.textContent.trim()) result.textContent = message;
  }

  function ensureScheduleDialog() {
    if ($('v78ScheduleDialog')) return $('v78ScheduleDialog');
    const dialog = document.createElement('dialog');
    dialog.id = 'v78ScheduleDialog';
    dialog.innerHTML = `
      <form method="dialog" class="v78-schedule-form">
        <h3>定时处理</h3>
        <label>开始时间<input id="v78ScheduleRunAt" type="datetime-local" required></label>
        <div id="v78ScheduleSummary" class="v78-run-ai-label"></div>
        <div id="v78ScheduleResult"></div>
        <div class="v78-schedule-actions"><button value="cancel">取消</button><button id="v78ScheduleConfirm" value="default" class="primary">确认定时</button></div>
      </form>`;
    document.body.appendChild(dialog);
    dialog.addEventListener('submit', async event => {
      if (event.submitter?.id !== 'v78ScheduleConfirm') return;
      event.preventDefault();
      const result = $('v78ScheduleResult');
      const runAtValue = $('v78ScheduleRunAt')?.value || '';
      const runAt = new Date(runAtValue);
      if (!Number.isFinite(runAt.getTime())) { result.textContent = '请选择处理时间'; return; }
      if (runAt.getTime() <= Date.now()) { result.textContent = '定时时间需要晚于现在'; return; }
      const snapshot = buildCurrentRunSnapshot();
      if (!text(snapshot.input_text).trim()) { result.textContent = '请先填写批量输入'; return; }
      if (!snapshot.target_versions.length) { result.textContent = '请至少选择一个文案版本'; return; }
      const previewInputs = [...document.querySelectorAll('[data-v78-preview-id]')];
      if (previewInputs.length && !snapshot.task_ids.length) { result.textContent = '请至少选择一本小说'; return; }
      const button = $('v78ScheduleConfirm');
      button.disabled = true;
      result.textContent = '正在保存定时任务...';
      try {
        await api('/schedules', {
          method: 'POST',
          body: JSON.stringify({ runAt: runAt.toISOString(), inputSnapshot: snapshot })
        });
        result.textContent = `已定时：${runAt.toLocaleString()}`;
        setWorkMessage(`定时处理已创建：${runAt.toLocaleString()}`);
        window.setTimeout(() => dialog.close(), 650);
      } catch (error) {
        result.textContent = error.message || '定时处理创建失败';
      } finally {
        button.disabled = false;
      }
    });
    return dialog;
  }

  function openScheduleDialog() {
    const snapshot = buildCurrentRunSnapshot();
    if (!text(snapshot.input_text).trim()) { setWorkMessage('请先填写批量输入'); return; }
    if (!snapshot.target_versions.length) { setWorkMessage('请至少选择一个文案版本'); return; }
    const dialog = ensureScheduleDialog();
    const date = new Date(Date.now() + 10 * 60 * 1000);
    const pad = value => String(value).padStart(2, '0');
    $('v78ScheduleRunAt').value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    $('v78ScheduleSummary').textContent = `本次版本：${snapshot.target_versions.map(version => version === 'original' ? '原文' : version.toUpperCase()).join('、')}`;
    $('v78ScheduleResult').textContent = '';
    dialog.showModal();
  }

  async function repairCurrentBatchSensitive() {
    const button = $('v78SensitiveRepairBtn');
    if (button) button.disabled = true;
    setWorkMessage('正在进行敏感词 AI 修复...');
    try {
      const current = await api('/batches/current');
      const ids = Array.isArray(current?.batch?.taskIds) ? current.batch.taskIds.map(text).filter(Boolean) : [];
      if (!ids.length) throw new Error('当前批次还没有可处理的小说');
      const result = await api('/tasks/reprocess-sensitive', {
        method: 'POST',
        body: JSON.stringify({ mode: 'selected', ids, restore_from_backup: false, sensitive_ai_enabled: true })
      });
      setWorkMessage(`敏感词 AI 修复完成：已处理 ${Number(result.processed || 0)} 本，失败 ${Number(result.failed || 0)} 本`);
      if (typeof loadTasks === 'function') await loadTasks();
      $('v78CurrentBatchRefresh')?.click();
    } catch (error) {
      setWorkMessage(error.message || '敏感词 AI 修复失败');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function mountActionButtons() {
    const primary = $('v78WorkPrimaryActions');
    const processBtn = $('processBtn');
    const refreshBtn = $('refreshBtn');
    if (!primary || !processBtn) return false;
    if (!$('v78ScheduleBtn')) {
      const button = document.createElement('button');
      button.id = 'v78ScheduleBtn';
      button.type = 'button';
      button.textContent = '定时处理';
      button.addEventListener('click', openScheduleDialog);
      processBtn.insertAdjacentElement('afterend', button);
    }
    if (!$('v78SensitiveRepairBtn')) {
      const button = document.createElement('button');
      button.id = 'v78SensitiveRepairBtn';
      button.type = 'button';
      button.textContent = '敏感词 AI 修复';
      button.addEventListener('click', () => void repairCurrentBatchSensitive());
      $('v78ScheduleBtn').insertAdjacentElement('afterend', button);
    }
    if (refreshBtn && refreshBtn.parentElement === primary) primary.appendChild(refreshBtn);
    return true;
  }

  function patchProcessRequests() {
    if (fetchPatched) return;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async function(input, init = {}) {
      const url = typeof input === 'string' ? input : text(input?.url);
      let nextInit = init;
      if (/\/api\/batch-rewrite\/process\/start(?:\?|$)/.test(url) && text(init.method || 'GET').toUpperCase() === 'POST' && typeof init.body === 'string') {
        try {
          const body = JSON.parse(init.body);
          const targets = selectedTargets();
          if (targets.length) {
            body.target_versions = targets;
            body.targetVersions = targets;
          }
          body.ai_slot_methods_snapshot = collectRunMethods();
          nextInit = { ...init, body: JSON.stringify(body) };
        } catch (_) {}
      }
      const response = await nativeFetch(input, nextInit);
      if (/\/api\/batch-rewrite\/batches\/[^/]+\/rerun(?:\?|$)/.test(url) && response.ok) {
        response.clone().json().then(data => {
          const methods = data?.payload?.ai_slot_methods_snapshot;
          if (methods && typeof methods === 'object') window.setTimeout(() => applyMethodSnapshot(methods), 0);
        }).catch(() => {});
      }
      return response;
    };
    fetchPatched = true;
  }

  function mount() {
    installStyles();
    patchProcessRequests();
    const methodsReady = mountMethodSelectors();
    const actionsReady = mountActionButtons();
    mounted = methodsReady && actionsReady;
    return mounted;
  }

  function boot() {
    mount();
    let attempts = 0;
    const timer = window.setInterval(() => {
      mount();
      attempts += 1;
      if (mounted || attempts >= 40) window.clearInterval(timer);
    }, 250);
  }

  window.v78NovelFetchRunControls = { buildCurrentRunSnapshot, collectRunMethods, repairCurrentBatchSensitive, openScheduleDialog };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
  window.addEventListener('load', mount, { once: true });
})();
