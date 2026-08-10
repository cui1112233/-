# React + Antd 前后台统一前端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同一个 `frontend/` 文件夹内建立 React + Antd 用户端和管理端前端骨架，并接入现有 Express API，同时保证真实 prompt 只留在后端。

**Architecture:** 使用 Vite 多入口构建 `index.html` 和 `admin.html`，分别承载用户端与管理端。前后台共用 `frontend/src/shared/` 中的 API、鉴权、布局与基础组件。Express 继续负责 `/api/*`、鉴权、用户数据隔离和后端内部 prompt 拼接。

**Tech Stack:** Node.js、Express、React、Vite、Ant Design、JavaScript ES Modules、CSS。

---

## File Structure

- Create: `frontend/package.json`
  - React 前端工程依赖与脚本。
- Create: `frontend/index.html`
  - 用户端入口 HTML。
- Create: `frontend/admin.html`
  - 管理端入口 HTML。
- Create: `frontend/vite.config.js`
  - Vite 多入口构建配置。
- Create: `frontend/src/shared/api/client.js`
  - Bearer token 注入、JSON 请求、401 处理。
- Create: `frontend/src/shared/api/auth.js`
  - 登录、登出、当前用户状态。
- Create: `frontend/src/shared/api/config.js`
  - API 配置读写。
- Create: `frontend/src/shared/api/generation.js`
  - 人物提取和剧本生成请求，只传策略参数，不传真实 prompt。
- Create: `frontend/src/shared/api/history.js`
  - 历史记录 CRUD。
- Create: `frontend/src/shared/layouts/UserLayout.jsx`
  - 用户端基础布局。
- Create: `frontend/src/shared/layouts/AdminLayout.jsx`
  - 管理端基础布局。
- Create: `frontend/src/shared/styles/theme.js`
  - Antd theme token。
- Create: `frontend/src/shared/styles/global.css`
  - 全局样式。
- Create: `frontend/src/user/main.jsx`
  - 用户端 React 入口。
- Create: `frontend/src/user/App.jsx`
  - 用户端路由分发。
- Create: `frontend/src/user/pages/HomePage.jsx`
  - 用户端首页壳。
- Create: `frontend/src/user/pages/ScriptPage.jsx`
  - 用户端剧本生成页壳。
- Create: `frontend/src/user/pages/TtsPage.jsx`
  - 用户端配音页壳。
- Create: `frontend/src/admin/main.jsx`
  - 管理端 React 入口。
- Create: `frontend/src/admin/App.jsx`
  - 管理端路由分发。
- Create: `frontend/src/admin/pages/DashboardPage.jsx`
  - 后台仪表盘壳。
- Create: `frontend/src/admin/pages/PromptStrategyPage.jsx`
  - 后台 prompt 策略元信息页，不展示真实 prompt。
- Modify: `package.json`
  - 增加前端安装、构建、开发脚本。
- Modify: `.gitignore`
  - 忽略 `frontend/node_modules/` 与 `frontend/dist/`。
- Modify: `server.js`
  - 生产环境服务 `frontend/dist` 静态文件。
- Modify: `routes/pages.js`
  - React 构建产物存在时，`/`、`/script`、`/tts`、`/admin` 返回 React 入口；不存在时保留旧 HTML 回退。
- Modify: `docs/技术文档.md`
  - 记录 React + Antd 前后台统一前端架构。
- Create: `scripts/validate-react-frontend-architecture.js`
  - 验证前后台同文件夹、共享目录、prompt 不进入前端源代码。

---

### Task 1: Create Vite React Frontend Skeleton

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/index.html`
- Create: `frontend/admin.html`
- Create: `frontend/vite.config.js`
- Create: `frontend/src/shared/styles/global.css`
- Create: `frontend/src/shared/styles/theme.js`
- Modify: `.gitignore`

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vite build",
    "preview": "vite preview --host 0.0.0.0"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^5.0.0",
    "antd": "^5.21.6",
    "vite": "^5.4.8",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {}
}
```

- [ ] **Step 2: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>一战晟铭</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/user/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `frontend/admin.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>一战晟铭管理端</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/admin/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `frontend/vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        user: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html')
      }
    }
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000'
    }
  }
});
```

- [ ] **Step 5: Create shared style files**

`frontend/src/shared/styles/theme.js`:

```js
export const theme = {
  token: {
    colorPrimary: '#1677ff',
    borderRadius: 6,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  }
};
```

`frontend/src/shared/styles/global.css`:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #f5f7fb;
  color: #1f2937;
}

.page-shell {
  min-height: 100vh;
}
```

- [ ] **Step 6: Update `.gitignore`**

Add:

```gitignore
# React 前端构建产物
frontend/node_modules/
frontend/dist/
```

- [ ] **Step 7: Install and build**

Run:

```bash
npm --prefix frontend install
npm --prefix frontend run build
```

Expected:

```text
frontend/dist/index.html exists
frontend/dist/admin.html exists
```

- [ ] **Step 8: Commit**

```bash
git add .gitignore frontend/package.json frontend/package-lock.json frontend/index.html frontend/admin.html frontend/vite.config.js frontend/src/shared/styles
git commit -m "feat: add react antd frontend skeleton"
```

---

### Task 2: Add Shared API And Layout Foundation

**Files:**
- Create: `frontend/src/shared/api/client.js`
- Create: `frontend/src/shared/api/auth.js`
- Create: `frontend/src/shared/api/config.js`
- Create: `frontend/src/shared/api/generation.js`
- Create: `frontend/src/shared/api/history.js`
- Create: `frontend/src/shared/layouts/UserLayout.jsx`
- Create: `frontend/src/shared/layouts/AdminLayout.jsx`

- [ ] **Step 1: Create API client**

`frontend/src/shared/api/client.js`:

```js
export function getToken() {
  return localStorage.getItem('auth_token') || '';
}

export function setToken(token) {
  if (token) localStorage.setItem('auth_token', token);
  else localStorage.removeItem('auth_token');
}

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, { ...options, headers });
  if (response.status === 401) {
    setToken('');
    throw new Error('登录已失效，请重新登录');
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `请求失败：${response.status}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return response.text();
}
```

- [ ] **Step 2: Create auth API**

`frontend/src/shared/api/auth.js`:

```js
import { apiRequest, setToken } from './client';

export async function login(username, password) {
  const data = await apiRequest('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  setToken(data.token);
  localStorage.setItem('auth_username', data.username);
  return data;
}

export function logout() {
  setToken('');
  localStorage.removeItem('auth_username');
}

export function getCurrentUsername() {
  return localStorage.getItem('auth_username') || '';
}
```

- [ ] **Step 3: Create config API**

`frontend/src/shared/api/config.js`:

```js
import { apiRequest } from './client';

export function getConfig() {
  return apiRequest('/api/config');
}

export function saveConfig(config) {
  return apiRequest('/api/config', {
    method: 'POST',
    body: JSON.stringify(config)
  });
}
```

- [ ] **Step 4: Create generation API without prompt exposure**

`frontend/src/shared/api/generation.js`:

```js
import { apiRequest } from './client';

export function extractCharactersAndScenes(novelText) {
  return apiRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      promptType: 'extract',
      novelText,
      max_tokens: 4096,
      temperature: 0.3,
      stream: false
    })
  });
}

export function generateScript({ mode, format, duration, novelText, characters, scenes }) {
  return apiRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      promptType: 'script',
      mode,
      format,
      duration,
      novelText,
      characters,
      scenes,
      max_tokens: 8192,
      temperature: 0.7,
      stream: false
    })
  });
}
```

- [ ] **Step 5: Create history API**

`frontend/src/shared/api/history.js`:

```js
import { apiRequest } from './client';

export function listHistory() {
  return apiRequest('/api/history');
}

export function saveHistory(entry) {
  return apiRequest('/api/history', {
    method: 'POST',
    body: JSON.stringify(entry)
  });
}

export function deleteHistory(id) {
  return apiRequest(`/api/history/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}

export function clearHistory() {
  return apiRequest('/api/history', {
    method: 'DELETE'
  });
}
```

- [ ] **Step 6: Create layouts**

`frontend/src/shared/layouts/UserLayout.jsx`:

```jsx
import { Layout, Menu, Typography } from 'antd';
import { Link } from '../components/Link';

const { Header, Content } = Layout;

export function UserLayout({ children }) {
  return (
    <Layout className="page-shell">
      <Header>
        <Typography.Text style={{ color: '#fff', marginRight: 24 }}>一战晟铭</Typography.Text>
        <Menu
          theme="dark"
          mode="horizontal"
          items={[
            { key: '/', label: <Link href="/">首页</Link> },
            { key: '/script', label: <Link href="/script">剧本生成</Link> },
            { key: '/tts', label: <Link href="/tts">配音</Link> }
          ]}
        />
      </Header>
      <Content style={{ padding: 24 }}>{children}</Content>
    </Layout>
  );
}
```

`frontend/src/shared/layouts/AdminLayout.jsx`:

```jsx
import { Layout, Menu, Typography } from 'antd';
import { Link } from '../components/Link';

const { Sider, Content } = Layout;

export function AdminLayout({ children }) {
  return (
    <Layout className="page-shell">
      <Sider width={220}>
        <Typography.Title level={5} style={{ color: '#fff', padding: 16, margin: 0 }}>
          管理端
        </Typography.Title>
        <Menu
          theme="dark"
          mode="inline"
          items={[
            { key: '/admin', label: <Link href="/admin">仪表盘</Link> },
            { key: '/admin/prompts', label: <Link href="/admin/prompts">Prompt 策略</Link> }
          ]}
        />
      </Sider>
      <Content style={{ padding: 24 }}>{children}</Content>
    </Layout>
  );
}
```

`frontend/src/shared/components/Link.jsx`:

```jsx
export function Link({ href, children }) {
  return (
    <a href={href} onClick={(event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      window.history.pushState({}, '', href);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }}>
      {children}
    </a>
  );
}
```

- [ ] **Step 7: Build check**

Run:

```bash
npm --prefix frontend run build
```

Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/shared
git commit -m "feat: add shared frontend api and layouts"
```

---

### Task 3: Add User Frontend Shell

**Files:**
- Create: `frontend/src/user/main.jsx`
- Create: `frontend/src/user/App.jsx`
- Create: `frontend/src/user/pages/HomePage.jsx`
- Create: `frontend/src/user/pages/ScriptPage.jsx`
- Create: `frontend/src/user/pages/TtsPage.jsx`

- [ ] **Step 1: Create user entry**

`frontend/src/user/main.jsx`:

```jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import 'antd/dist/reset.css';
import '../shared/styles/global.css';
import { theme } from '../shared/styles/theme';
import { UserApp } from './App';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider theme={theme}>
      <UserApp />
    </ConfigProvider>
  </React.StrictMode>
);
```

- [ ] **Step 2: Create user app router**

`frontend/src/user/App.jsx`:

```jsx
import { UserLayout } from '../shared/layouts/UserLayout';
import { HomePage } from './pages/HomePage';
import { ScriptPage } from './pages/ScriptPage';
import { TtsPage } from './pages/TtsPage';

function getPage() {
  const path = window.location.pathname;
  if (path === '/script') return <ScriptPage />;
  if (path === '/tts') return <TtsPage />;
  return <HomePage />;
}

export function UserApp() {
  return <UserLayout>{getPage()}</UserLayout>;
}
```

- [ ] **Step 3: Create user pages**

`frontend/src/user/pages/HomePage.jsx`:

```jsx
import { Button, Space, Typography } from 'antd';

export function HomePage() {
  return (
    <Space direction="vertical" size={16}>
      <Typography.Title level={2}>一战晟铭</Typography.Title>
      <Typography.Text>小说转可视化剧本工作台</Typography.Text>
      <Space>
        <Button type="primary" href="/script">开始生成</Button>
        <Button href="/tts">文本配音</Button>
      </Space>
    </Space>
  );
}
```

`frontend/src/user/pages/ScriptPage.jsx`:

```jsx
import { Button, Form, Input, Select, Segmented, Space, Typography } from 'antd';

export function ScriptPage() {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3}>剧本生成</Typography.Title>
      <Form layout="vertical">
        <Form.Item label="小说原文">
          <Input.TextArea rows={10} placeholder="粘贴小说原文" />
        </Form.Item>
        <Space wrap>
          <Segmented options={[
            { label: '连续开头', value: 'continuous' },
            { label: '爆款开头', value: 'hook' }
          ]} defaultValue="continuous" />
          <Select
            defaultValue="storyboard"
            style={{ width: 140 }}
            options={[
              { label: '画布模式', value: 'storyboard' },
              { label: '剧本模式', value: 'shortdrama' },
              { label: '剧情模式', value: 'screenplay' }
            ]}
          />
          <Segmented options={['10s', '15s']} defaultValue="10s" />
          <Button type="primary">一键生成</Button>
        </Space>
      </Form>
    </Space>
  );
}
```

`frontend/src/user/pages/TtsPage.jsx`:

```jsx
import { Button, Form, Input, Select, Space, Typography } from 'antd';

export function TtsPage() {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3}>文本配音</Typography.Title>
      <Form layout="vertical">
        <Form.Item label="配音文本">
          <Input.TextArea rows={8} placeholder="输入需要配音的文本" />
        </Form.Item>
        <Form.Item label="音色">
          <Select
            defaultValue="zh-CN-XiaoxiaoNeural"
            options={[{ label: '晓晓', value: 'zh-CN-XiaoxiaoNeural' }]}
          />
        </Form.Item>
        <Button type="primary">生成音频</Button>
      </Form>
    </Space>
  );
}
```

- [ ] **Step 4: Build check**

Run:

```bash
npm --prefix frontend run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/user
git commit -m "feat: add user react frontend shell"
```

---

### Task 4: Add Admin Frontend Shell

**Files:**
- Create: `frontend/src/admin/main.jsx`
- Create: `frontend/src/admin/App.jsx`
- Create: `frontend/src/admin/pages/DashboardPage.jsx`
- Create: `frontend/src/admin/pages/PromptStrategyPage.jsx`

- [ ] **Step 1: Create admin entry**

`frontend/src/admin/main.jsx`:

```jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import 'antd/dist/reset.css';
import '../shared/styles/global.css';
import { theme } from '../shared/styles/theme';
import { AdminApp } from './App';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider theme={theme}>
      <AdminApp />
    </ConfigProvider>
  </React.StrictMode>
);
```

- [ ] **Step 2: Create admin app router**

`frontend/src/admin/App.jsx`:

```jsx
import { AdminLayout } from '../shared/layouts/AdminLayout';
import { DashboardPage } from './pages/DashboardPage';
import { PromptStrategyPage } from './pages/PromptStrategyPage';

function getPage() {
  const path = window.location.pathname;
  if (path === '/admin/prompts') return <PromptStrategyPage />;
  return <DashboardPage />;
}

export function AdminApp() {
  return <AdminLayout>{getPage()}</AdminLayout>;
}
```

- [ ] **Step 3: Create admin pages**

`frontend/src/admin/pages/DashboardPage.jsx`:

```jsx
import { Card, Col, Row, Statistic, Typography } from 'antd';

export function DashboardPage() {
  return (
    <>
      <Typography.Title level={3}>系统概览</Typography.Title>
      <Row gutter={16}>
        <Col span={6}><Card><Statistic title="服务状态" value="运行中" /></Card></Col>
        <Col span={6}><Card><Statistic title="前端" value="React + Antd" /></Card></Col>
        <Col span={6}><Card><Statistic title="后端" value="Express" /></Card></Col>
        <Col span={6}><Card><Statistic title="Prompt" value="后端保护" /></Card></Col>
      </Row>
    </>
  );
}
```

`frontend/src/admin/pages/PromptStrategyPage.jsx`:

```jsx
import { Table, Tag, Typography } from 'antd';

const rows = [
  { key: 'continuous', name: '连续开头', type: '叙事策略', status: '启用' },
  { key: 'hook', name: '爆款开头', type: '叙事策略', status: '启用' },
  { key: 'screenplay', name: '剧情模式', type: '输出格式', status: '启用' },
  { key: 'storyboard', name: '画布模式', type: '输出格式', status: '启用' },
  { key: 'shortdrama', name: '剧本模式', type: '输出格式', status: '启用' }
];

export function PromptStrategyPage() {
  return (
    <>
      <Typography.Title level={3}>Prompt 策略</Typography.Title>
      <Typography.Paragraph>
        本页只展示策略元信息，不展示真实 prompt 原文。
      </Typography.Paragraph>
      <Table
        rowKey="key"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: '策略', dataIndex: 'name' },
          { title: '类型', dataIndex: 'type' },
          { title: '状态', dataIndex: 'status', render: value => <Tag color="green">{value}</Tag> }
        ]}
      />
    </>
  );
}
```

- [ ] **Step 4: Build check**

Run:

```bash
npm --prefix frontend run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/admin
git commit -m "feat: add admin react frontend shell"
```

---

### Task 5: Serve React Build From Express With HTML Fallback

**Files:**
- Modify: `server.js`
- Modify: `routes/pages.js`

- [ ] **Step 1: Update `server.js` static serving**

Add `path` and `fs` imports only if not already present. Add `FRONTEND_DIST` from `lib/shared.js` only after Task 5 Step 2 adds it, or locally compute:

```js
const path = require('path');
const fs = require('fs');
const frontendDist = path.join(__dirname, 'frontend', 'dist');
```

Before existing static file service, add:

```js
if (fs.existsSync(frontendDist)) {
  app.use('/assets', express.static(path.join(frontendDist, 'assets'), {
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    }
  }));
}
```

- [ ] **Step 2: Update `routes/pages.js`**

Use this logic:

```js
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
      res.send(fs.readFileSync(reactEntry, 'utf8'));
      return;
    }
    servePage(fallbackFile, req, res);
  };
}

router.get('/', serveReactEntry('index.html', 'index.html'));
router.get('/script', serveReactEntry('index.html', 'script.html'));
router.get('/tts', serveReactEntry('index.html', 'tts.html'));
router.get('/admin', serveReactEntry('admin.html', 'index.html'));
router.get('/admin/*', serveReactEntry('admin.html', 'index.html'));
router.get('/agent', (req, res) => servePage('agent.html', req, res));

module.exports = router;
```

- [ ] **Step 3: Syntax and build checks**

Run:

```bash
node -c server.js
node -c routes/pages.js
npm --prefix frontend run build
```

Expected: all commands pass.

- [ ] **Step 4: Runtime check**

Start server:

```bash
npm start
```

Check:

```bash
curl -s -o /tmp/qiantie-user.html -w '%{http_code}\n' http://127.0.0.1:3000/
curl -s -o /tmp/qiantie-admin.html -w '%{http_code}\n' http://127.0.0.1:3000/admin
```

Expected:

```text
200
200
```

Stop server after the check.

- [ ] **Step 5: Commit**

```bash
git add server.js routes/pages.js
git commit -m "feat: serve react frontend entries"
```

---

### Task 6: Add Architecture Validation And Docs

**Files:**
- Create: `scripts/validate-react-frontend-architecture.js`
- Modify: `docs/技术文档.md`

- [ ] **Step 1: Create validation script**

`scripts/validate-react-frontend-architecture.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function exists(relPath) {
  assert(fs.existsSync(path.join(root, relPath)), `Missing required path: ${relPath}`);
}

function read(relPath) {
  exists(relPath);
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

exists('frontend/package.json');
exists('frontend/index.html');
exists('frontend/admin.html');
exists('frontend/src/user/main.jsx');
exists('frontend/src/admin/main.jsx');
exists('frontend/src/shared/api/client.js');
exists('frontend/src/shared/api/generation.js');
exists('frontend/src/shared/layouts/UserLayout.jsx');
exists('frontend/src/shared/layouts/AdminLayout.jsx');

const generationApi = read('frontend/src/shared/api/generation.js');
assert(generationApi.includes(\"promptType: 'extract'\"), 'generation API should use promptType extract');
assert(generationApi.includes(\"promptType: 'script'\"), 'generation API should use promptType script');
assert(!generationApi.includes('systemPrompt'), 'frontend generation API must not send systemPrompt');

const frontendFiles = [
  'frontend/src/user/main.jsx',
  'frontend/src/admin/main.jsx',
  'frontend/src/shared/api/generation.js'
].map(read).join('\\n');

assert(!frontendFiles.includes('/api/prompt?file'), 'frontend must not request prompt files');
assert(!frontendFiles.includes('prompts/'), 'frontend source must not reference backend prompt files');

console.log('React frontend architecture validation passed.');
```

- [ ] **Step 2: Update `docs/技术文档.md`**

Add a new subsection under frontend architecture:

```markdown
### 4.1 React + Antd 迁移目标

下一阶段前端迁移到同一个 `frontend/` 工程：

- `frontend/src/user/`：用户端 / 前台。
- `frontend/src/admin/`：管理端 / 后台。
- `frontend/src/shared/`：共用 API、鉴权、布局、样式和组件。

真实 prompt 仍只在后端 `prompts/` 中读取。React 前端只传 `promptType`、`mode`、`format`、`duration`、小说原文、人物信息和场景信息，不接收完整 system prompt。
```

- [ ] **Step 3: Run all validation**

Run:

```bash
node scripts/validate-multipage-architecture.js
node scripts/validate-react-frontend-architecture.js
npm --prefix frontend run build
```

Expected:

```text
Multipage architecture validation passed.
React frontend architecture validation passed.
frontend build succeeds
```

- [ ] **Step 4: Commit**

```bash
git add scripts/validate-react-frontend-architecture.js docs/技术文档.md
git commit -m "docs: document react frontend architecture"
```

---

## Self-Review

- Spec coverage: The plan creates one `frontend/` folder containing both `user` and `admin`, with `shared` for common logic. It preserves Express and keeps prompt files backend-only.
- Prompt safety: Frontend API sends strategy parameters and content only; validation rejects `/api/prompt?file`, `prompts/`, and `systemPrompt` in selected frontend files.
- Migration safety: Existing HTML pages remain as fallback until React build exists.
- Risk: The first shell does not fully reimplement current generation UI behavior. That is intentional; full migration should happen after this skeleton is verified.
