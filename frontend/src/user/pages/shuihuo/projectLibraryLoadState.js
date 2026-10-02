function projectsFromWater(result) {
  if (result.status !== 'fulfilled') return [];
  const payload = result.value;
  if (Array.isArray(payload?.projects)) return payload.projects;
  if (Array.isArray(payload?.data?.projects)) return payload.data.projects;
  return [];
}

function batchesFromResult(result) {
  if (result.status !== 'fulfilled') return [];
  const payload = result.value;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.batches)) return payload.batches;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.batches)) return payload.data.batches;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  return [];
}

export function projectLibraryRefreshResult({ previousProjects, water, batch, batchProjectsFrom = () => [] }) {
  if (batch.status === 'rejected' && water.status === 'rejected') {
    return {
      projects: previousProjects,
      batchProjects: [],
      error: '作品库暂时无法读取，请稍后重试。已保留当前显示的作品。'
    };
  }
  if (batch.status === 'rejected') {
    return {
      projects: previousProjects,
      batchProjects: [],
      error: '批量工厂工程暂时无法读取，请稍后重试。已保留当前显示的作品。'
    };
  }
  if (water.status === 'rejected') {
    return {
      projects: previousProjects,
      batchProjects: [],
      error: '漫剧作品暂时无法读取，请稍后重试。已保留当前显示的作品。'
    };
  }

  const waterProjects = projectsFromWater(water);
  const batchProjects = batchProjectsFrom(batchesFromResult(batch));
  return { projects: [...waterProjects, ...batchProjects], batchProjects, error: '' };
}
