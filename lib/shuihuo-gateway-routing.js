function resolveShuihuoGateways({ goBaseUrl, productionBaseUrl, bridgeSecret } = {}) {
  const resolvedGoBaseUrl = goBaseUrl || process.env.QIANTIE_GO_BASE_URL || 'http://127.0.0.1:4000';
  const resolvedBridgeSecret = bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET;
  return {
    batchFactory: {
      targetBaseUrl: resolvedGoBaseUrl,
      bridgeSecret: resolvedBridgeSecret
    },
    production: {
      targetBaseUrl: productionBaseUrl || process.env.QIANTIE_SHUIHUO_COMPAT_BASE_URL || resolvedGoBaseUrl,
      bridgeSecret: resolvedBridgeSecret
    }
  };
}

module.exports = { resolveShuihuoGateways };
