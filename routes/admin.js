const express = require('express');
const { apiAuth, requireCapability, requireOwner } = require('../middleware/auth');

function sendStoreError(res, error) {
  if (error?.code === 'NOT_FOUND') return res.status(404).json({ error: 'Not found' });
  if (error?.code === 'FORBIDDEN') return res.status(403).json({ error: 'Forbidden' });
  if (error?.code === 'CONFLICT') return res.status(409).json({ error: error.message });
  return res.status(400).json({ error: error?.message || 'Invalid request' });
}

function createAdminRouter(accountStore) {
  if (!accountStore) throw new Error('accountStore is required');
  const router = express.Router();
  router.use(apiAuth);

  router.get('/accounts', requireCapability('account:review'), (req, res) => {
    try {
      res.json({ accounts: accountStore.listAccounts() });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.get('/applications', requireCapability('account:review'), (req, res) => {
    try {
      res.json({ applications: accountStore.listApplications() });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/applications/:id/approve', requireCapability('account:review'), (req, res) => {
    try {
      res.json(accountStore.approveApplication(req.username, req.params.id));
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/applications/:id/reject', requireCapability('account:review'), (req, res) => {
    try {
      res.json({ application: accountStore.rejectApplication(req.username, req.params.id) });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/accounts/:username/status', requireCapability('account:review'), (req, res) => {
    try {
      res.json({ account: accountStore.setActive(req.username, req.params.username, req.body?.active) });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/accounts/:username/reset-password', requireCapability('account:review'), (req, res) => {
    try {
      res.json({ account: accountStore.resetPassword(req.username, req.params.username, req.body?.password) });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/grants', requireOwner, (req, res) => {
    try {
      res.status(201).json({ grant: accountStore.grant(req.username, req.body?.subject, req.body) });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.delete('/grants/:id', requireOwner, (req, res) => {
    try {
      res.json({ grant: accountStore.revokeGrant(req.username, req.params.id) });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.get('/audit', requireOwner, (req, res) => {
    try {
      res.json({ audit: accountStore.listAudit() });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  return router;
}

module.exports = { createAdminRouter };
