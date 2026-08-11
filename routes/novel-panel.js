const express = require('express');
const { apiAuth } = require('../middleware/auth');

const router = express.Router();

router.use(apiAuth);
router.all(/.*/, (req, res) => {
  res.status(501).json({
    error: 'Novel panel API is not available yet',
    code: 'NOVEL_PANEL_API_PENDING'
  });
});

module.exports = router;
