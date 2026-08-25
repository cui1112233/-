const os = require('os');

const { HOST, PORT } = require('./lib/shared');
const { ensureFrontendBuild } = require('./lib/frontend-runtime-build');
const { createApp } = require('./app');

// ============================================================
// 启动服务器
// ============================================================
try {
  ensureFrontendBuild();
} catch (error) {
  console.error('========================================');
  console.error('  前端准备失败，服务器未启动');
  console.error('  ' + (error?.message || error));
  console.error('========================================');
  process.exitCode = 1;
  return;
}

createApp().listen(PORT, HOST, () => {
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
