import { apiRequest } from './client';

export function extractCharactersAndScenes(novelText) {
  return apiRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      promptType: 'extract',
      novelText,
      max_tokens: 4096,
      temperature: 0.3,
      stream: false
    })
  });
}

export function generateScript({ mode, format, duration, novelText, characters, scenes }) {
  return apiRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      promptType: 'script',
      mode,
      format,
      duration,
      novelText,
      characters,
      scenes,
      max_tokens: 8192,
      temperature: 0.7,
      stream: false
    })
  });
}
