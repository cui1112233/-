const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { createBatchFactoryStore } = require('../lib/batch-factory/store');

function createBatchFactoryIntakeRouter({ store = createBatchFactoryStore() } = {}) {
  const router = express.Router();
  router.use(apiAuth);
  const forRequest = req => store.forAccount ? store.forAccount(req.auth?.account) : store;

  // 小说获取页面把用户选中的任务一次性交给这里。这里不开始 AI，
  // 只创建一个交接单并返回跳转地址；生产设置仍由批量工厂统一选择。
  router.post('/intakes/novel-fetch', async (req, res) => {
    try {
      const intake = await forRequest(req).createNovelFetchIntake(req.username, req.body || {});
      return res.status(201).json({
        intake,
        redirectTo: `/batch-factory?intake=${encodeURIComponent(intake.id)}`
      });
    } catch (error) {
      return res.status(400).json({ error: error?.message || '转入批量工厂失败' });
    }
  });

  router.get('/intakes/:intakeId', async (req, res) => {
    try {
      const intake = await forRequest(req).getIntake(req.username, req.params.intakeId);
      if (!intake) return res.status(404).json({ error: '小说获取交接单不存在' });
      return res.json({ intake });
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.message || '读取小说获取交接单失败' });
    }
  });

  return router;
}

module.exports = { createBatchFactoryIntakeRouter };
