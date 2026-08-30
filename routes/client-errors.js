const express = require('express');
const { apiAuth, optionalApiAuth } = require('../middleware/auth');

function createClientErrorsRouter(errorLogStore) {
  const router = express.Router();
  router.use(optionalApiAuth);

  router.post('/', (req, res) => {
    const body = req.body || {};
    errorLogStore.record({
      kind: `client.${String(body.kind || 'error').slice(0, 80)}`,
      message: body.message,
      stack: body.stack,
      path: body.path,
      source: body.source || 'browser',
      method: body.method,
      status: body.status,
      username: req.username,
      context: body.context
    });
    res.status(202).json({ accepted: true });
  });

  router.get('/mine', apiAuth, (req, res) => {
    const entries = errorLogStore.listForUser(req.username, req.query.limit).map(entry => ({
      id: entry.id,
      at: entry.at,
      kind: entry.kind,
      message: entry.message,
      path: entry.path,
      method: entry.method,
      status: entry.status,
      source: entry.source,
      context: entry.context
    }));
    res.json({ entries });
  });

  return router;
}

module.exports = { createClientErrorsRouter };
