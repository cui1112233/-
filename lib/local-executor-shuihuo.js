const fs = require('node:fs');
const path = require('node:path');

const LOCAL_EXECUTOR_VIDEO_MODEL = Object.freeze({
  id: 7801001,
  name: '豆包本地执行器',
  kind: 'video',
  adapterKind: 'local_executor_video',
  enabled: true
});

const LOCAL_MEDIA_PREFIX = 'lexmedia_';

function buildLocalVideoPayload({ projectId, segment, videoSettings = {} } = {}) {
  const project = Number(projectId);
  const segmentId = Number(segment?.id);
  const prompt = String(segment?.videoPrompt || segment?.sourceText || '').trim();
  if (!Number.isFinite(project) || project <= 0 || !Number.isFinite(segmentId) || segmentId <= 0) {
    throw new Error('projectId and segment.id are required');
  }
  if (!prompt) throw new Error('视频提示词不能为空');
  const images = Array.isArray(videoSettings.images)
    ? videoSettings.images.map(value => String(value || '').trim()).filter(Boolean)
    : [];
  const payload = { projectId: project, segmentId, prompt, images };
  const duration = videoSettings.duration;
  const ratio = String(videoSettings.ratio || videoSettings.aspectRatio || '').trim();
  const model = String(videoSettings.model || '').trim();
  if (duration !== undefined && duration !== null && duration !== '') payload.duration = duration;
  if (ratio) payload.ratio = ratio;
  if (model) payload.model = model;
  return payload;
}

function localJobStatus(state) {
  switch (String(state || '')) {
    case 'queued': return 'queued';
    case 'succeeded': return 'succeeded';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'leased':
    case 'preparing':
    case 'submitting':
    case 'acceptance_unknown':
    case 'accepted':
    case 'generating':
    case 'downloading':
    case 'uploading':
      return 'running';
    default:
      return 'queued';
  }
}

function localTaskView(mapping, job = {}) {
  return {
    id: mapping.sourceTaskId,
    projectId: mapping.projectId,
    segmentId: mapping.segmentId,
    modelId: mapping.modelId ?? LOCAL_EXECUTOR_VIDEO_MODEL.id,
    kind: 'video',
    status: localJobStatus(job.state),
    provider: 'local_executor_video',
    providerTaskId: job.id || mapping.localJobId,
    ...(job.errorCode ? { errorCode: job.errorCode } : {}),
    ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
    createdAt: job.createdAt || mapping.createdAt,
    updatedAt: job.updatedAt || mapping.updatedAt || mapping.createdAt
  };
}

function localMediaView(mapping, job = {}) {
  if (job.state !== 'succeeded' || !job.artifactId) return null;
  return {
    id: `${LOCAL_MEDIA_PREFIX}${job.artifactId}`,
    projectId: mapping.projectId,
    segmentId: mapping.segmentId,
    taskId: mapping.sourceTaskId,
    kind: 'video',
    filename: `doubao-${mapping.sourceTaskId}.mp4`,
    mediaType: 'video/mp4',
    isPrimary: true,
    createdAt: job.updatedAt || job.createdAt || mapping.updatedAt || mapping.createdAt
  };
}

function artifactIdFromLocalMediaId(mediaId) {
  const value = String(mediaId || '').trim();
  if (!value.startsWith(LOCAL_MEDIA_PREFIX)) return '';
  const artifactId = value.slice(LOCAL_MEDIA_PREFIX.length);
  return /^lea_[A-Za-z0-9_-]+$/.test(artifactId) ? artifactId : '';
}

function localExecutorAvailability(executors = []) {
  const online = (Array.isArray(executors) ? executors : []).filter(item => item?.online === true);
  if (!online.length) return { ready: false, reason: '豆包本地执行器未在线' };
  const runnable = online.some(item => {
    const accounts = item?.accounts || {};
    return Number(accounts.available || 0) + Number(accounts.busy || 0) > 0;
  });
  if (!runnable) return { ready: false, reason: '豆包账号当前不可用，请先登录或处理验证/额度' };
  return { ready: true, reason: '' };
}

function createLocalExecutorTaskStore({ filePath, now = () => new Date() } = {}) {
  if (!filePath) throw new Error('filePath is required');

  function readState() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return { version: 1, tasks: Array.isArray(parsed?.tasks) ? parsed.tasks : [] };
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: 1, tasks: [] };
      throw error;
    }
  }

  function writeState(state) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2));
    fs.renameSync(temp, filePath);
  }

  function normalizeOwner(owner) {
    return String(owner || '').trim();
  }

  return {
    list(owner, projectId) {
      const username = normalizeOwner(owner);
      const project = projectId === undefined || projectId === null ? null : Number(projectId);
      return readState().tasks
        .filter(item => item.ownerUsername === username && (project === null || Number(item.projectId) === project))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    },
    find(owner, sourceTaskId) {
      const username = normalizeOwner(owner);
      const source = String(sourceTaskId || '').trim();
      return readState().tasks.find(item => item.ownerUsername === username && item.sourceTaskId === source) || null;
    },
    upsert(owner, mapping) {
      const username = normalizeOwner(owner);
      const source = String(mapping?.sourceTaskId || '').trim();
      const localJobId = String(mapping?.localJobId || '').trim();
      if (!username || !source || !localJobId) throw new Error('owner, sourceTaskId and localJobId are required');
      const state = readState();
      const index = state.tasks.findIndex(item => item.ownerUsername === username && item.sourceTaskId === source);
      const timestamp = now().toISOString();
      const previous = index >= 0 ? state.tasks[index] : null;
      const next = {
        ...(previous || {}),
        ...mapping,
        ownerUsername: username,
        sourceTaskId: source,
        localJobId,
        createdAt: previous?.createdAt || mapping.createdAt || timestamp,
        updatedAt: timestamp
      };
      if (index >= 0) state.tasks[index] = next;
      else state.tasks.push(next);
      writeState(state);
      return next;
    }
  };
}

module.exports = {
  LOCAL_EXECUTOR_VIDEO_MODEL,
  LOCAL_MEDIA_PREFIX,
  buildLocalVideoPayload,
  localJobStatus,
  localTaskView,
  localMediaView,
  artifactIdFromLocalMediaId,
  localExecutorAvailability,
  createLocalExecutorTaskStore
};
