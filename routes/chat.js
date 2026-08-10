const express = require('express');
const { apiAuth, checkRateLimit } = require('../middleware/auth');
const { readConfig, ensureReadyConfig, requestUpstream, collectResponse } = require('../lib/shared');

const router = express.Router();
router.use(apiAuth);

// POST /api/test — 测试连接
router.post('/test', async (req, res) => {
  try {
    const config = readConfig(req.username);
    ensureReadyConfig(config);

    const payload = {
      model: config.model,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 5
    };

    const upstream = await requestUpstream(config, payload, collectResponse);
    let data;

    try {
      data = JSON.parse(upstream.text);
    } catch (error) {
      res.status(502).json({ ok: false, error: 'Upstream did not return JSON', status: upstream.statusCode });
      return;
    }

    if (upstream.statusCode >= 200 && upstream.statusCode < 300 && data && data.choices && data.choices[0] && data.choices[0].message) {
      res.json({ ok: true, message: data.choices[0].message });
      return;
    }

    res.status(502).json({ ok: false, error: 'Upstream response missing choices[0].message', status: upstream.statusCode, details: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/chat — 聊天
router.post('/chat', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: 'Too many requests. Please slow down.' });
    return;
  }

  try {
    const config = readConfig(req.username);
    ensureReadyConfig(config);

    const body = req.body;

    const maxTokens = Math.min(Math.max(1, parseInt(body.max_tokens) || 4096), 32768);
    const rawTemp = Number(body.temperature);
    const temperature = Number.isFinite(rawTemp) ? Math.min(Math.max(0, rawTemp), 2.0) : 0.7;

    const payload = {
      messages: body.messages || [],
      max_tokens: maxTokens,
      temperature: temperature,
      model: config.model,
      stream: body.stream === true
    };

    if (payload.stream === true) {
      await requestUpstream(config, payload, upstreamRes => new Promise((resolve, reject) => {
        res.writeHead(upstreamRes.statusCode || 500, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        upstreamRes.on('data', chunk => res.write(chunk));
        upstreamRes.on('end', () => {
          res.end();
          resolve();
        });
        upstreamRes.on('error', error => {
          res.end();
          reject(error);
        });
      }));
      return;
    }

    payload.stream = false;
    const upstream = await requestUpstream(config, payload, collectResponse);

    if (upstream.statusCode >= 400) {
      res.status(502).json({ error: 'Upstream API error (status ' + upstream.statusCode + ')', type: 'upstream_error' });
      return;
    }
    try {
      JSON.parse(upstream.text);
    } catch (e) {
      res.status(502).json({ error: 'Upstream returned non-JSON response' });
      return;
    }

    res.writeHead(upstream.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(upstream.text);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

module.exports = router;
