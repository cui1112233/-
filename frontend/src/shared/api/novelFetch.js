import { apiRequest } from './client';

export function fetchNovelContent({ platform, bookIds, maxTxt }) {
  return apiRequest('/api/novel-fetch', {
    method: 'POST',
    body: JSON.stringify({ platform, bookIds, maxTxt })
  });
}
