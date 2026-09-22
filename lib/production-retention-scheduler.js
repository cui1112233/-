const fs = require('node:fs');
const path = require('node:path');
const { readConfig } = require('./shared');
const { planLocalProductionCleanup, executeLocalProductionCleanup, normalizeProductionRetentionDays } = require('./production-retention');

const DAY_MS = 24 * 60 * 60 * 1000;

function listUsernames(usersDir) {
  if (!usersDir || !fs.existsSync(usersDir)) return [];
  return fs.readdirSync(usersDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
}

function createProductionRetentionScheduler({
  usersDir,
  configReader = readConfig,
  usernamesReader = () => listUsernames(usersDir),
  cleanupLocal = executeLocalProductionCleanup,
  tosCleaner = null,
  logger = console,
  intervalMs = DAY_MS,
  now = () => new Date(),
  startupScan = true
} = {}) {
  let timer = null;
  let running = false;

  async function runOnce({ dryRun = false } = {}) {
    if (running) return { skipped: true, reason: '已有清理任务运行中' };
    running = true;
    const summary = { users: 0, deleted: 0, skipped: 0, failed: 0, dryRun };
    try {
      for (const username of usernamesReader()) {
        const config = configReader(username) || {};
        const retentionDays = normalizeProductionRetentionDays(config.productionRetentionDays);
        const plan = planLocalProductionCleanup({ root: config.storageRoot, retentionDays, now: now() });
        const result = cleanupLocal(plan, { dryRun });
        summary.users += 1;
        summary.deleted += result.deleted || 0;
        summary.skipped += result.skipped || 0;
        summary.failed += result.failed || 0;
        if (result.failed) logger.warn(`[制作文件清理] 用户 ${username} 有 ${result.failed} 个文件清理失败`);
        if (tosCleaner) {
          const tosResult = await tosCleaner({ username, retentionDays, dryRun });
          summary.deleted += tosResult?.deleted || 0;
          summary.skipped += tosResult?.skipped || 0;
          summary.failed += tosResult?.failed || 0;
        }
      }
      logger.info(`[制作文件清理] 完成：用户 ${summary.users} 个，删除 ${summary.deleted} 个，跳过 ${summary.skipped} 个，失败 ${summary.failed} 个${dryRun ? '（只读扫描）' : ''}`);
      return summary;
    } catch (error) {
      logger.error(`[制作文件清理] 执行失败：${error.message}`);
      return { ...summary, failed: summary.failed + 1, error: error.message };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    void runOnce({ dryRun: startupScan });
    timer = setInterval(() => { void runOnce(); }, Math.max(60 * 1000, Number(intervalMs) || DAY_MS));
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, runOnce, listUsernames: () => listUsernames(usersDir) };
}

module.exports = { DAY_MS, listUsernames, createProductionRetentionScheduler };
