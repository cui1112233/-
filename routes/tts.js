const express = require('express');
const http = require('http');
const { apiAuth } = require('../middleware/auth');
const { getStorageRoot, saveDubbingAudio } = require('../lib/storage-root');

const UPSTREAM_URL = 'http://tts2.121w.com/v1/audio/speech';

// 向上游发起 TTS 请求，缓冲完整响应后 resolve { statusCode, headers, buffer }；
// 请求/响应流错误以带 kind 标记的 Error reject，便于区分错误文案。
function requestUpstream(payload) {
  return new Promise((resolve, reject) => {
    const ttsReq = http.request(UPSTREAM_URL, {
      method: 'POST',
      headers: {
        'Host': 'tts2.121w.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',
        'Referer': 'http://tts2.121w.com/',
        'Origin': 'http://tts2.121w.com',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 60000
    }, ttsRes => {
      const chunks = [];
      ttsRes.on('data', chunk => chunks.push(chunk));
      ttsRes.on('error', error => reject(Object.assign(error, { kind: 'response' })));
      ttsRes.on('end', () => resolve({ statusCode: ttsRes.statusCode, headers: ttsRes.headers, buffer: Buffer.concat(chunks) }));
    });
    ttsReq.on('error', error => reject(Object.assign(error, { kind: 'request' })));
    ttsReq.write(payload);
    ttsReq.end();
  });
}

// POST /api/tts — 文本转语音代理（转发到 tts2.121w.com），缓冲后回写并可选落盘
function createTtsRouter({ fetchUpstream = requestUpstream, getStorageRootFn = getStorageRoot, auth = apiAuth } = {}) {
  const router = express.Router();
  router.use(auth);

  router.post('/', async (req, res) => {
    try {
      const { input, voice, speed, pitch, style } = req.body;
      if (!input || !input.trim()) {
        return res.status(400).json({ error: '输入文本不能为空' });
      }

      const payload = JSON.stringify({
        input: input.trim(),
        voice: voice || 'zh-CN-XiaoxiaoNeural',
        speed: Number.isFinite(parseFloat(speed)) ? parseFloat(speed) : 1.8,
        pitch: pitch !== undefined ? String(pitch) : '10',
        style: style || 'general'
      });

      let upstream;
      try {
        upstream = await fetchUpstream(payload);
      } catch (error) {
        console.error('TTS upstream error:', error);
        if (res.headersSent) return;
        const prefix = error && error.kind === 'response' ? 'TTS 服务响应异常' : 'TTS 服务请求失败';
        return res.status(502).json({ error: prefix + ': ' + error.message });
      }

      if (upstream.statusCode >= 400) {
        const text = upstream.buffer.toString('utf8').slice(0, 500);
        return res.status(502).json({ error: 'TTS 服务错误 (' + upstream.statusCode + '): ' + text });
      }
      const buffer = upstream.buffer;
      if (buffer.length === 0) {
        return res.status(502).json({ error: 'TTS 服务返回空音频，请稍后重试' });
      }
      const contentType = upstream.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        const text = buffer.toString('utf8').slice(0, 500);
        return res.status(502).json({ error: 'TTS 服务返回错误: ' + text });
      }

      // 可选落盘：<root>/制作工程/<项目>/配音/<时间戳>.mp3
      const projectName = (req.body && req.body.projectName) ? String(req.body.projectName).trim() : '';
      const username = req.auth ? req.auth.account.username : (req.username || '');
      const root = getStorageRootFn(username);
      if (root && projectName) saveDubbingAudio(root, projectName, buffer);

      res.status(200);
      if (contentType) res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', buffer.length);
      res.end(buffer);
    } catch (error) {
      console.error('TTS proxy error:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  return router;
}

const ttsRouter = createTtsRouter();
ttsRouter.createTtsRouter = createTtsRouter;
module.exports = ttsRouter;
