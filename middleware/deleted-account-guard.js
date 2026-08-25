function createDeletedAccountGuard(recoveryStore) {
  if (!recoveryStore) throw new Error('recoveryStore is required');
  return (req, res, next) => {
    const username = req.params?.username;
    if (!username || req.method === 'GET' || req.method === 'HEAD') return next();
    try {
      if (!recoveryStore.isDeleted(username)) return next();
      return res.status(409).json({
        error: '该账号已永久删除，不能恢复、重置凭据或重新授权',
        code: 'ACCOUNT_PERMANENTLY_DELETED'
      });
    } catch (error) {
      return res.status(400).json({ error: error?.message || '无法检查账号删除状态' });
    }
  };
}

module.exports = { createDeletedAccountGuard };
