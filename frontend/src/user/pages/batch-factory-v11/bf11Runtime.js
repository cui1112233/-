function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function settingsStateFrom(value) {
  const source = object(value);
  const patch = object(source.patch);
  return {
    patch: { ...patch },
    revision: Number.isFinite(Number(source.revision)) ? Number(source.revision) : 0,
    snapshot: source.snapshot || null,
    compatibility: Array.isArray(source.compatibility) ? source.compatibility : []
  };
}

function subjectSettingsState(subject) {
  const source = object(subject);
  for (const key of ['settingsState', 'settings', 'overrideState', 'override']) {
    const candidate = source[key];
    if (candidate && typeof candidate === 'object') return settingsStateFrom(candidate);
  }
  return settingsStateFrom(null);
}

export function createdBatchIdFrom(value) {
  const source = object(value);
  return source?.batch?.id || source?.id || '';
}

export function workbenchStateFromLoad(loadResult) {
  const load = object(loadResult);
  const batch = load.selectedBatch || null;
  const batchObject = object(batch);
  const rawBooks = Array.isArray(batchObject.books)
    ? batchObject.books
    : (Array.isArray(batchObject.items) ? batchObject.items : []);
  const books = rawBooks.map(book => ({
    ...book,
    settingsState: subjectSettingsState(book),
    videos: (Array.isArray(book?.videos) ? book.videos : []).map(video => ({
      ...video,
      settingsState: subjectSettingsState(video)
    }))
  }));
  return {
    phase: 'ready',
    capabilities: object(load.capabilities),
    batches: Array.isArray(load.batches) ? load.batches : [],
    batch: batch ? { ...batchObject, settingsState: subjectSettingsState(batch), books } : null,
    books,
    intake: load.intake || null,
    productionStatus: load.productionStatus || null,
    mergeStatus: load.mergeStatus || null,
    configVersions: Array.isArray(load.configVersions) ? load.configVersions : [],
    configVersionsError: load.configVersionsError || null,
    selectedBatchId: load.selectedBatchId || batchObject.id || ''
  };
}

function loadFailure(error) {
  return {
    phase: 'error',
    status: Number(error?.status || 0),
    message: error?.message || 'Batch Factory V11 暂时不可用'
  };
}

function saveFailure(error) {
  const conflict = Number(error?.status) === 409;
  return {
    ok: false,
    conflict,
    status: Number(error?.status || 0),
    message: conflict
      ? '配置已被其他操作更新，请刷新最新配置后再保存。'
      : (error?.message || '保存失败，请稍后重试。')
  };
}

function createFailure(error) {
  return {
    ok: false,
    status: Number(error?.status || 0),
    message: error?.message || '创建 V11 批次失败，请稍后重试。',
    startsDirector: false
  };
}

function impactFailure(error) {
  return {
    ok: false,
    status: Number(error?.status || 0),
    message: error?.message || '读取变更影响失败，请稍后重试。'
  };
}

function actionFailure(error, fallback) {
  return { ok: false, status: Number(error?.status || 0), message: error?.message || fallback };
}

export function createBf11Runtime({ adapter }) {
  if (!adapter) throw new Error('V11 UI adapter is required');
  return {
    async load(params = {}) {
      try {
        return workbenchStateFromLoad(await adapter.loadWorkbench(params));
      } catch (error) {
        return loadFailure(error);
      }
    },

    async createBatchFromIntake(input) {
      try {
        const result = await adapter.createBatchFromIntake(input);
        return { ok: true, raw: result, startsDirector: false };
      } catch (error) {
        return createFailure(error);
      }
    },

    async listBatches() {
      try { return { ok: true, batches: await adapter.listBatches() }; }
      catch (error) { return actionFailure(error, '历史批次读取失败，请稍后重试。'); }
    },

    async createBatch(input) {
      try { return { ok: true, raw: await adapter.createBatch(input) }; }
      catch (error) { return actionFailure(error, '新建批次失败，请检查批次内容。'); }
    },

    async saveDraft(input) {
      try { return { ok: true, raw: await adapter.saveDraft(input) }; }
      catch (error) { return actionFailure(error, '草稿保存失败，请稍后重试。'); }
    },

    async createPrompt(input) {
      try { return { ok: true, raw: await adapter.createPrompt(input) }; }
      catch (error) { return actionFailure(error, '个人提示词保存失败，请稍后重试。'); }
    },

    async previewChangeImpact(input) {
      try {
        const impact = await adapter.previewChangeImpact(input);
        return { ok: true, impact };
      } catch (error) {
        return impactFailure(error);
      }
    },

    async save(input) {
      try {
        const result = await adapter.saveDrawer(input);
        const state = settingsStateFrom(result?.settingsState || result?.settings || result);
        return { ok: true, state, raw: result };
      } catch (error) {
        return saveFailure(error);
      }
    },

    async runHook(input) {
      try { return { ok: true, raw: await adapter.runHook(input) }; }
      catch (error) { return actionFailure(error, '生成 Hook 失败，请检查小说模式和模型配置。'); }
    },

    async approveHook(input) {
      try { return { ok: true, raw: await adapter.approveHook(input) }; }
      catch (error) { return actionFailure(error, '批准 Hook 失败，请刷新后重试。'); }
    },

    async runDirector(input) {
      try { return { ok: true, raw: await adapter.runDirector(input) }; }
      catch (error) { return actionFailure(error, 'Director 执行失败，请检查 Hook、模型和时长设置。'); }
    },

    async runBatchDirector(input) {
      try { return { ok: true, raw: await adapter.runBatchDirector(input) }; }
      catch (error) { return actionFailure(error, '批量 Director 执行失败，请检查批次设置。'); }
    },

    async saveVideoPrompt(input) {
      try { return { ok: true, raw: await adapter.saveVideoPrompt(input) }; }
      catch (error) { return saveFailure(error); }
    },

    async previewFinalPrompt(input) {
      try { return { ok: true, raw: await adapter.previewFinalPrompt(input) }; }
      catch (error) { return actionFailure(error, '最终提示词预览失败，请检查 Director revision 和 VIDEO 设置。'); }
    },

    async runProduction(input) {
      try { return { ok: true, raw: await adapter.runProduction(input) }; }
      catch (error) { return actionFailure(error, '视频生成提交失败，请检查 Director revision 和生产配置。'); }
    },

    async runMerge(input) {
      try { return { ok: true, raw: await adapter.runMerge(input) }; }
      catch (error) { return actionFailure(error, '批量合并提交失败，请确认所有 VIDEO 已生成完成。'); }
    }
  };
}
