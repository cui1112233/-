const modelLabels = { image: '图片', video: '视频', audio: '配音', text: '文本' };

export function textReadiness(snapshot) {
  if (!snapshot?.database?.ready) return { ready: false, reason: '数据库未就绪' };
  if (!(snapshot.enabledModelKinds || []).includes('text')) {
    return { ready: false, reason: '管理员尚未启用文本模型' };
  }
  return { ready: true, reason: '' };
}

export function taskReadiness(snapshot, kind, { confirmed = true, hasPrimaryImage = true } = {}) {
  if (!confirmed) return { ready: false, reason: '请先确认分镜' };
  if (!snapshot?.database?.ready) return { ready: false, reason: '数据库未就绪' };
  if (!snapshot?.redis?.ready) return { ready: false, reason: 'Redis 队列未配置或不可用' };
  if (!snapshot?.storage?.ready) return { ready: false, reason: '素材存储未就绪' };
  if (!(snapshot.enabledModelKinds || []).includes(kind)) {
    return { ready: false, reason: `管理员尚未启用${modelLabels[kind] || '对应'}模型` };
  }
  if (kind === 'video' && !hasPrimaryImage) return { ready: false, reason: '请先上传或选择主图片' };
  return { ready: true, reason: '' };
}
