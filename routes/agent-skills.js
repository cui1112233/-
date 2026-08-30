const express = require('express');
const { apiAuth } = require('../middleware/auth');

function sendError(res, error) {
  if (error?.code === 'NOT_FOUND') return res.status(404).json({ error: 'Not found' });
  if (error?.code === 'FORBIDDEN') return res.status(403).json({ error: 'Forbidden' });
  return res.status(400).json({ error: error?.message || 'Invalid request' });
}

function createAgentSkillsRouter(skillStore) {
  const router = express.Router();
  router.use(apiAuth);

  router.get('/', (req, res) => res.json({ skills: skillStore.listVisible(req.username) }));
  router.get('/mine/:id', (req, res) => {
    const skill = skillStore.getPrivate(req.username, req.params.id);
    if (!skill) return res.status(404).json({ error: 'Not found' });
    return res.json({ skill });
  });
  router.post('/mine', (req, res) => {
    try {
      return res.status(201).json({ skill: skillStore.createPrivate(req.username, req.body) });
    } catch (error) {
      return sendError(res, error);
    }
  });
  router.put('/mine/:id', (req, res) => {
    try {
      return res.json({ skill: skillStore.updatePrivate(req.username, req.params.id, req.body) });
    } catch (error) {
      return sendError(res, error);
    }
  });
  router.delete('/mine/:id', (req, res) => {
    try {
      skillStore.deletePrivate(req.username, req.params.id);
      return res.status(204).end();
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}

module.exports = { createAgentSkillsRouter };
