(function () {
  'use strict';
  const registry = globalThis.__QIANTE_WORKBENCH_FEATURES__ ||= Object.create(null);
  const safeError = () => { throw new Error('历史记录与导出加载失败，请点击重试。'); };
  const pick = (context, name) => context?.[name] || globalThis[name];

  function exportTxt(context = {}) {
    const content = pick(context, 'allEnhancedSegmentText')?.();
    const clean = pick(context, 'text') || (value => String(value || '').trim());
    const report = pick(context, 'apiError') || (() => {});
    if (!clean(content)) return report('请先完成分段合并。');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = (clean(pick(context, 'readFieldValue')?.('#projectName')) || '视频画面提示词') + '.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportResult(context = {}) {
    const currentState = context.state || globalThis.state || {};
    const report = pick(context, 'apiError') || (() => {});
    if (!currentState.projectId) return report('请先保存项目，再导出结果。');
    try {
      const path = '/api/novel-panel/' + encodeURIComponent(currentState.projectId) + '/export';
      const data = await pick(context, 'requestJSON')(path, { method: 'POST', timeoutMs: 30000, timeoutLabelSeconds: 30 });
      if (data?.saved) {
        const projectName = pick(context, 'text')?.(pick(context, 'readFieldValue')?.('#projectName')) || '未命名项目';
        alert('已保存到 制作工程/' + projectName + '/输出结果.md');
      } else {
        alert('未配置本地存储文件夹');
      }
    } catch (error) {
      report(error.message);
    }
  }

  async function v24LoadHistoryRecord(context = {}, historyId) {
    const clean = context.v24Text || (value => String(value ?? '').trim());
    const currentState = context.state || globalThis.state || {};
    const request = context.requestJSON || globalThis.requestJSON;
    const data = await request('/api/history/' + encodeURIComponent(historyId));
    const record = data?.record || {};
    const workspace = JSON.parse(JSON.stringify(record.workspace || {}));
    delete workspace.ai_instructions;
    context.applyProjectData?.(null, '视频画面提示词', workspace);
    currentState.projectId = null;
    currentState.currentHistoryId = clean(record.history_id || historyId) || null;
    currentState.currentHistoryNote = clean(record.note);
    return record;
  }

  async function v24SaveHistory(context = {}, mode = 'new') {
    const clean = context.v24Text || (value => String(value ?? '').trim());
    const currentState = context.state || globalThis.state || {};
    const status = document.querySelector('#historySaveStatus');
    const note = clean(document.querySelector('#historySaveNote')?.value);
    const payload = {
      note,
      workspace: context.v24HistoryWorkspace?.() || {},
      instruction_revision: context.V24_INSTRUCTION_REVISION || 23
    };
    try {
      const request = context.requestJSON || globalThis.requestJSON;
      const data = mode === 'overwrite' && currentState.currentHistoryId
        ? await request('/api/history/' + encodeURIComponent(currentState.currentHistoryId), { method: 'PUT', body: JSON.stringify(payload) })
        : await request('/api/history', { method: 'POST', body: JSON.stringify(payload) });
      const record = data?.record || {};
      currentState.currentHistoryId = clean(record.history_id) || currentState.currentHistoryId;
      currentState.currentHistoryNote = clean(record.note);
      currentState.projectId = null;
      if (status) {
        status.className = 'settings-message success';
        status.textContent = mode === 'overwrite' ? '已覆盖当前历史记录。' : '已保存为新的历史记录。';
      }
      return record;
    } catch (error) {
      if (status) {
        status.className = 'settings-message error';
        status.textContent = error?.message || String(error);
      } else {
        (context.apiError || globalThis.apiError)?.(error?.message || String(error));
      }
      return undefined;
    }
  }

  registry['legacy:history-save-export'] = {
    exportTxt,
    exportResult,
    v24LoadHistoryRecord,
    v24SaveHistory,
    save() {
      const action = globalThis.__QIANTE_WORKBENCH_HISTORY_LEGACY__?.openSaveDialog;
      return typeof action === 'function' ? action() : safeError();
    },
    history() {
      const action = globalThis.__QIANTE_WORKBENCH_HISTORY_LEGACY__?.openHistoryPage;
      return typeof action === 'function' ? action() : safeError();
    }
  };
})();
