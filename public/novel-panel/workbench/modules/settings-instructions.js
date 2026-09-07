(function () {
  'use strict';
  const registry = globalThis.__QIANTE_WORKBENCH_FEATURES__ ||= Object.create(null);
  const call = (context, name, ...args) => {
    const fn = context?.[name] || globalThis[name];
    if (typeof fn !== 'function') throw new Error('设置与指令中心加载失败，请点击重试。');
    return fn(...args);
  };
  registry['settings-instructions'] = {
    openInstructionCenter(context) {
      if (typeof globalThis.__openV23InstructionCenter === 'function') return globalThis.__openV23InstructionCenter();
      call(context, 'writeAiInstructionForm');
      document.querySelector('#promptSettingsDialog')?.showModal?.();
    },
    saveInstructions: context => call(context, 'saveAiInstructionSettings'),
    resetInstructions: context => call(context, 'resetAiInstructionSettings'),
    openSettings(context) {
      call(context, 'writeSettingsForm');
      document.querySelector('#settingsDialog')?.showModal?.();
    },
    saveSettings: context => call(context, 'saveSettings'),
    testSettings: context => call(context, 'testSettings'),
    clearSavedKey: context => call(context, 'clearSavedKey')
  };
})();
