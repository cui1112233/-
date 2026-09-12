const express = require('express');
const http = require('http');
const { apiAuth } = require('../middleware/auth');
const { resolveTeamAuthorization } = require('../lib/api-access');

const router = express.Router();
router.use(apiAuth);

router.post('/', async (req, res) => {
  try {
    const { input, voice, speed, pitch, style } = req.body;
    if (!input || !input.trim()) {
      return res.status(400).json({ error: '输入文本不能为空' });
    }

    const memberStore = req.app.locals.memberStore;
    const usageStore = req.app.locals.usageStore;
    let authorization;
    try {
      authorization = resolveTeamAuthorization({
        memberStore,
        usageStore,
        username: req.username,
        scope: 'tts'
      });
    } catch (error) {
      return res.status(error?.status || 403).json({
        error: error?.message || '当前账号没有 TTS 使用权限',
        ...(error?.code ? { code: error.code } : {})
      });
    }

    const payload = JSON.stringify({
      input: input.trim(),
      voice: voice || 'zh-CN-XiaoxiaoNeural',
      speed: Number.isFinite(parseFloat(speed)) ? parseFloat(speed) : 1.8,
      pitch: pitch !== undefined ? String(pitch) : '10',
      style: style || 'general'
    });
    const startedAt = Date.now();

    function record(status, metadata = {}) {
      usageStore?.record({
        username: authorization.member.username,
        billedTo: authorization.billedTo,
        teamOwner: authorization.teamOwner,
        feature: 'tts',
        provider: 'tts2.121w.com',
        model: voice || 'zh-CN-XiaoxiaoNeural',
        status,
        usage: null,
        metadata: {
          ...metadata,
          characters: input.trim().length,
          elapsedMs: Math.max(0, Date.now() - startedAt),
          nonTokenModelCall: true
        }
      });
    }

    const ttsReq = http.request('http://tts2.121w.com/v1/audio/speech', {
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
      ttsRes.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (res.headersSent) return;
        if (ttsRes.statusCode >= 400) {
          record('upstream_error', { statusCode: ttsRes.statusCode });
          const text = buffer.toString('utf8').slice(0, 500);
          res.status(502).json({ error: 'TTS 服务错误 (' + ttsRes.statusCode + '): ' + text });
          return;
        }
        if (buffer.length === 0) {
          record('upstream_error', { statusCode: ttsRes.statusCode, emptyAudio: true });
          res.status(502).json({ error: 'TTS 服务返回空音频，请稍后重试' });
          return;
        }
        const contentType = ttsRes.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          record('upstream_error', { statusCode: ttsRes.statusCode, jsonInsteadOfAudio: true });
          const text = buffer.toString('utf8').slice(0, 500);
          res.status(502).json({ error: 'TTS 服务返回错误: ' + text });
          return;
        }
        record('success', { statusCode: ttsRes.statusCode, audioBytes: buffer.length });
        res.status(200);
        if (contentType) res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', buffer.length);
        res.end(buffer);
      });
      ttsRes.on('error', error => {
        console.error('TTS upstream response error:', error);
        record('error', { errorCode: error.code || null });
        if (!res.headersSent) {
          res.status(502).json({ error: 'TTS 服务响应异常: ' + error.message });
        }
      });
    });

    ttsReq.on('error', error => {
      console.error('TTS upstream error:', error);
      record('error', { errorCode: error.code || null });
      if (!res.headersSent) {
        res.status(502).json({ error: 'TTS 服务请求失败: ' + error.message });
      }
    });

    ttsReq.write(payload);
    ttsReq.end();
  } catch (error) {
    console.error('TTS proxy error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

module.exports = router;
