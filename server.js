const os = require('os');
const path = require('path');
const express = require('express');

const { HOST, PORT } = require('./lib/shared');
const { createApp } = require('./app');
const { createLocalExecutorDeviceRouter } = require('./routes/local-executor-device');
const { createLocalExecutorShuihuoRouter } = require('./routes/local-executor-shuihuo');
const { createLocalExecutorTaskStore } = require('./lib/local-executor-shuihuo');

// Build the normal V78 app first so the local-executor overlay shares the same
// auth/member/usage runtime and only intercepts its own VIDEO routes.
const coreApp = createApp();
const systemDir = path.dirname(coreApp.locals.authRuntime.accountStore.files.audit);
const localExecutorTaskStore = createLocalExecutorTaskStore({
  filePath: path.join(systemDir, 'local-executor-video-tasks.json')
});

// The desktop executor must reach the public V78 origin without a website login cookie.
// Keep this parser/proxy scoped to the executor prefix so existing V78 routes are untouched.
const serverApp = express();
serverApp.locals.authRuntime = coreApp.locals.authRuntime;
serverApp.locals.memberStore = coreApp.locals.memberStore;
serverApp.locals.usageStore = coreApp.locals.usageStore;
serverApp.use('/api/local-executor/v1', express.json({ limit: '50mb' }), createLocalExecutorDeviceRouter());
serverApp.use('/api/shuihuo-production', express.json({ limit: '50mb' }), createLocalExecutorShuihuoRouter({
  taskStore: localExecutorTaskStore,
  memberStore: coreApp.locals.memberStore,
  usageStore: coreApp.locals.usageStore
}));
serverApp.use(coreApp);

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
