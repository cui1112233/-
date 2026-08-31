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
    }
  };
}
