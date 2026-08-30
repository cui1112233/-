import { apiRequest } from './client';

export function listPlatformProjects(limit = 100, options = {}) {
  return apiRequest(`/api/platform-projects?limit=${encodeURIComponent(limit)}`, options);
}
