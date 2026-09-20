const express = require('express');
const { createBatchFactoryV11Router } = require('./batch-factory-v11');

const V12_BASE = '/api/batch-factory/v12';
const V11_BASE = '/api/batch-factory/v11';

// V12 owns the public API namespace. During the one-time batch upgrade window
// it adapts durable V11 records through the existing, tested V11 service
// boundary. The browser never calls the V11 write API directly.
function rewriteV12PathForLegacyRead(value) {
  const pathname = String(value || '');
  if (!pathname.startsWith(V12_BASE + '/') && pathname !== V12_BASE) return '';
  return V11_BASE + pathname.slice(V12_BASE.length);
}

function isNativeV12H3Path(value) {
  const parsed = new URL(String(value || ''), 'http://qiantie.local');
  return /^\/api\/batch-factory\/v12\/batches\/[^/]+\/books\/[^/]+\/h3\/(?:director|audio-measurement|compile|trace)$/.test(parsed.pathname);
}

function routeV12UpstreamPath(value) {
  const original = String(value || '');
  if (isNativeV12H3Path(original)) return original;
  return rewriteV12PathForLegacyRead(original);
}

function rejectLegacyV11Mutations(req, res, next) {
	if (["GET", "HEAD", "OPTIONS"].includes(String(req.method || "").toUpperCase())) return next();
	return res.status(410).json({
		error: "批量工厂已升级到 V12，请从 V12 继续生产",
		code: "BATCH_FACTORY_V11_READ_ONLY",
		upgradePath: V12_BASE,
	});
}

function createBatchFactoryV12Router(options = {}) {
  const legacy = createBatchFactoryV11Router(options);
  const router = express.Router();
  router.use((req, res, next) => {
    const originalURL = req.originalUrl;
    const rewritten = routeV12UpstreamPath(originalURL);
    if (!rewritten) return next();
    req.originalUrl = rewritten;
    res.setHeader('X-Batch-Factory-Version', 'v12');
    return legacy(req, res, error => {
      req.originalUrl = originalURL;
      next(error);
    });
  });
  return router;
}

module.exports = {
  V12_BASE,
  isNativeV12H3Path,
  routeV12UpstreamPath,
  rewriteV12PathForLegacyRead,
  rejectLegacyV11Mutations,
  createBatchFactoryV12Router
};
