const express = require('express');
const { apiAuth } = require('../middleware/auth');

function createBatchFactoryV11ScheduleRouter(scheduler) {
  if (!scheduler) throw new Error('scheduler is required');
  const router = express.Router();
  router.use(apiAuth);
  router.get('/schedules', (req, res) => res.json({ schedules: scheduler.list(req.username) }));
  router.post('/schedules', (req, res) => {
    try { return res.status(201).json({ schedule: scheduler.create(req.username, req.body || {}) }); }
    catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  });
  router.patch('/schedules/:id', (req, res) => {
    try { return res.json({ schedule: scheduler.update(req.username, req.params.id, req.body || {}) }); }
    catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  });
  router.delete('/schedules/:id', (req, res) => {
    try { return res.json(scheduler.remove(req.username, req.params.id)); }
    catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  });
  return router;
}
module.exports = { createBatchFactoryV11ScheduleRouter };
