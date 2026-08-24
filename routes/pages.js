const express = require('express');
const fs = require('fs');
const path = require('path');
const { ROOT_DIR, servePage } = require('../lib/shared');

const router = express.Router();
const frontendDist = path.join(ROOT_DIR, 'frontend', 'dist');

function serveReactEntry(entryFile, fallbackFile) {
  return (req, res) => {
    const reactEntry = path.join(frontendDist, entryFile);
    if (fs.existsSync(reactEntry)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.send(fs.readFileSync(reactEntry, 'utf8'));
      return;
    }
    servePage(fallbackFile, req, res);
  };
}

router.get('/', serveReactEntry('index.html', 'index.html'));
router.get('/script', serveReactEntry('index.html', 'views/script.html'));
router.get('/history', serveReactEntry('index.html', 'index.html'));
router.get('/novel-panel', serveReactEntry('index.html', 'index.html'));
router.get('/shuihuo-production', serveReactEntry('index.html', 'index.html'));
router.get('/agent', serveReactEntry('index.html', 'views/agent.html'));
router.get('/tts', serveReactEntry('index.html', 'views/tts.html'));
router.get('/settings', serveReactEntry('index.html', 'index.html'));
router.get('/member', serveReactEntry('index.html', 'index.html'));
router.get('/issues', serveReactEntry('index.html', 'index.html'));
router.get(/^\/admin(?:\/.*)?$/, serveReactEntry('admin.html', 'index.html'));

module.exports = router;
