const express = require('express');

function sendStoreError(res, error) {
  if (error?.code === 'NOT_FOUND') return res.status(404).json({ error: 'Not found' });
  if (error?.code === 'FORBIDDEN') return res.status(403).json({ error: 'Forbidden' });
  return res.status(400).json({ error: error?.message || 'Invalid request' });
}

function createApplicationsRouter(accountStore) {
  if (!accountStore) throw new Error('accountStore is required');
  const router = express.Router();

  router.post('/', (req, res) => {
    try {
      const application = accountStore.submitApplication({
        username: req.body?.username,
        password: req.body?.password,
        reason: req.body?.reason
      });
      res.status(201).json(application);
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/:id/status', (req, res) => {
    try {
      const application = accountStore.getApplicationStatus(req.body?.username, req.params.id, req.body?.password);
      if (!application) return res.status(404).json({ error: 'Not found' });
      res.json(application);
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/:id/withdraw', (req, res) => {
    try {
      res.json(accountStore.withdrawApplication(req.body?.username, req.params.id, req.body?.password));
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  return router;
}

module.exports = { createApplicationsRouter };
