import { apiRequest } from './client';

export function listPlatformProjects(limit = 100) {
  return apiRequest(`/api/platform-projects?limit=${encodeURIComponent(limit)}`);
}
