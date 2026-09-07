(function () {
  'use strict';
  const registry = globalThis.__QIANTE_WORKBENCH_FEATURES__ ||= Object.create(null);
  registry['legacy:diagnostics-runtime'] = {
    open() {
      const api = globalThis.__V77_DIAGNOSTICS__;
      const dialog = document.querySelector('#v35DiagnosticsDialog');
      if (!api?.run || !dialog) throw new Error('诊断中心加载失败，请点击重试。');
      dialog.showModal?.();
      api.run();
      api.refreshTraces?.();
    },
    ready() { return true; }
  };
})();
