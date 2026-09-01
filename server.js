const os = require('os');
const express = require('express');

const { HOST, PORT } = require('./lib/shared');
const { createApp } = require('./app');
const { createLocalExecutorDeviceRouter } = require('./routes/local-executor-device');

// The desktop executor must reach the public V78 origin without a website login cookie.
// Mount its narrow bearer-token device channel before the main app's terminal 404 handler.
const serverApp = express();
serverApp.use(express.json({ limit: '50mb' }));
serverApp.use('/api/local-executor/v1', createLocalExecutorDeviceRouter());
serverApp.use(createApp());

// ============================================================
// 启动服务器
// ============================================================
serverApp.listen(PORT, HOST, () => {
  const interfaces = os.networkInterfaces();
  console.log('========================================');
  console.log('  Server running on (Express):');
  console.log('  本机访问: http://127.0.0.1:' + PORT);
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        console.log('  局域网访问: http://' + addr.address + ':' + PORT);
      }
    }
  }
  console.log('========================================');
});
