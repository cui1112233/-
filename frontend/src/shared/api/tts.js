import { apiRequest } from './client';

export function textToSpeech({ input, voice, speed, pitch, style, projectName }) {
  return apiRequest('/api/tts', {
    method: 'POST',
    body: JSON.stringify({ input, voice, speed, pitch, style, projectName }),
    responseType: 'blob'
  });
}
