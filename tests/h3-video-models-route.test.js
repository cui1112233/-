const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const test = require('node:test');

const { createShuihuoProductionRouter } = require('../routes/shuihuo-production');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/shuihuo-production', createShuihuoProductionRouter({
    authenticate: (req, _res, next) => {
      req.auth = { account: { username: 'h3-model-route-test', isOwner: true } };
      req.username = 'h3-model-route-test';
      next();
    }
  }));
  return app;
}

function requestModels(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const request = http.get({ hostname: '127.0.0.1', port, path: '/api/shuihuo-production/models' }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          server.close();
          resolve({ statusCode: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        });
      });
      request.on('error', error => { server.close(); reject(error); });
    });
    server.on('error', reject);
  });
}

test('video model endpoint exposes H3 without exposing credentials', async () => {
  const previousToken = process.env.QIANTIE_AUTODL_H3_API_KEY;
  process.env.QIANTIE_AUTODL_H3_API_KEY = 'test-token-that-must-not-leak';
  try {
    const response = await requestModels(makeApp());
    assert.equal(response.statusCode, 200);
    const h3 = response.body.models.find(model => model.key === 'minimax-h3-video');
    assert.ok(h3);
    assert.equal(h3.configured, true);
    assert.equal(JSON.stringify(response.body).includes('test-token-that-must-not-leak'), false);
  } finally {
    if (previousToken === undefined) delete process.env.QIANTIE_AUTODL_H3_API_KEY;
    else process.env.QIANTIE_AUTODL_H3_API_KEY = previousToken;
  }
});
