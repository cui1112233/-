# 登录系统 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为小说转剧本工具添加多用户登录系统，6个预设账号各自独立工作区

**Architecture:** 后端新增 /api/login 端点 + Token 鉴权中间件替代当前 X-Auth-Token 方式，用户数据按 username 隔离在内存 Map 中；前端新增登录弹窗 + localStorage Token 持久化 + authFetch 改造

**Tech Stack:** Node.js Express (server.js), 原生 HTML/CSS/JS (index.html)

## 全局约束

- 6个账号：choushiyiguai ~ choushiyiguai5，密码均为 123456
- Token 方式：crypto.randomBytes(16) 生成，Bearer 头传递
- 内容隔离：提取数据、生成内容按用户内存隔离
- 服务重启后所有 token 失效，需重新登录
- API 共用 api-config.json，用户配置目前不隔离（后续可扩展）

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `server.js` | 修改 | 账号表 + /api/login + 新鉴权中间件 + 用户会话 Map |
| `index.html` | 修改 | 登录弹窗 HTML/CSS + 登录 JS + authFetch 改造 + 退出按钮 |
| `.auth-token` | 删除 | 不再需要（被 Token 机制替代） |

---

### Task 1: 后端 — 账号表与登录端点

**文件：**
- 修改: `server.js`

**接口：**
- 产出: `POST /api/login` — body `{username, password}` → `{token, username}` 或 401

- [ ] **Step 1: 在 server.js 顶部添加账号表和 token 存储**

在 `const AUTH_TOKEN = loadOrCreateAuthToken();` 之后添加：

```js
// 用户账号表
const USERS = {
  'choushiyiguai':  '123456',
  'choushiyiguai1': '123456',
  'choushiyiguai2': '123456',
  'choushiyiguai3': '123456',
  'choushiyiguai4': '123456',
  'choushiyiguai5': '123456',
};

// Token → username 映射（服务重启清空）
const tokenMap = new Map();

// 用户会话数据：username → { extraction: null, outputs: {} }
const userSessions = new Map();
```

- [ ] **Step 2: 添加 /api/login 路由**

在 API 路由区域（`apiAuth` 中间件定义之前）添加：

```js
// POST /api/login — 登录（无需鉴权）
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (!USERS[username] || USERS[username] !== password) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = crypto.randomBytes(16).toString('hex');
  tokenMap.set(token, username);
  // 初始化用户会话
  if (!userSessions.has(username)) {
    userSessions.set(username, { extraction: null, outputs: {} });
  }
  res.json({ token, username });
});
```

- [ ] **Step 3: 验证 — 重启服务测试登录**

```bash
node server.js
```

测试命令：
```powershell
$body = '{"username":"choushiyiguai","password":"123456"}'
Invoke-RestMethod -Uri http://127.0.0.1:3000/api/login -Method Post -Body $body -ContentType "application/json"
```

预期返回：`{ token: "...", username: "choushiyiguai" }`

---

### Task 2: 后端 — 替换鉴权中间件

**文件：**
- 修改: `server.js`

**接口：**
- 消耗: Task 1 的 `tokenMap`
- 产出: 新 `apiAuth` 中间件，注入 `req.username`

- [ ] **Step 1: 替换 apiAuth 中间件**

将现有的：

```js
function apiAuth(req, res, next) {
  if (req.headers['x-auth-token'] !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
```

替换为：

```js
function apiAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Unauthorized — missing Bearer token' });
  }
  const token = match[1];
  const username = tokenMap.get(token);
  if (!username) {
    return res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
  }
  req.username = username;
  next();
}
```

- [ ] **Step 2: 删除旧的 AUTH_TOKEN 相关代码**

删除以下几行（不再需要）：
```js
const TOKEN_PATH = path.join(ROOT_DIR, '.auth-token');

function loadOrCreateAuthToken() { ... }  // 整个函数

const AUTH_TOKEN = loadOrCreateAuthToken();
console.log('  Auth Token: ' + AUTH_TOKEN);
```

同时删除 `servePage` 中注入 `window.__AUTH_TOKEN__` 的那一行：
```js
// 删除这行
'<script>window.__AUTH_TOKEN__ = "' + AUTH_TOKEN + '";</script>\n</head>'
```

改为仅注入 CSP：
```js
content = content.replace('</head>',
  '<meta http-equiv="Content-Security-Policy" content="...">\n</head>');
```

- [ ] **Step 3: 删除 .auth-token 文件**

```bash
del f:\脚本测试\qiantie\.auth-token
```

- [ ] **Step 4: 验证中间件生效**

重启服务，不带 token 访问 `/api/config`：
```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3000/api/config -Method Get
```
预期：401 Unauthorized

带 token 访问：
```powershell
$token = (Invoke-RestMethod -Uri http://127.0.0.1:3000/api/login -Method Post -Body '{"username":"choushiyiguai","password":"123456"}' -ContentType "application/json").token
Invoke-RestMethod -Uri http://127.0.0.1:3000/api/config -Method Get -Headers @{"Authorization"="Bearer $token"}
```
预期：正常返回配置 JSON

---

### Task 3: 前端 — 登录弹窗 HTML + CSS

**文件：**
- 修改: `index.html`

**接口：**
- 产出: `#login-overlay` 弹窗 DOM + CSS 样式

- [ ] **Step 1: 在 body 底部（toast-container 之后）添加登录弹窗 HTML**

```html
<!-- Login Overlay -->
<div id="login-overlay" class="modal-overlay visible">
  <div class="modal" style="width:360px;">
    <div class="modal-title">🔐 登录</div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">账号</label>
        <input id="login-username" class="form-input" type="text" placeholder="请输入账号" autocomplete="username">
      </div>
      <div class="form-group">
        <label class="form-label">密码</label>
        <input id="login-password" class="form-input" type="password" placeholder="请输入密码" autocomplete="current-password">
      </div>
      <div id="login-error" style="display:none;color:var(--error);font-size:12px;margin-top:4px;"></div>
    </div>
    <div class="modal-footer">
      <button id="btn-login" class="btn btn-primary" type="button" style="width:100%;">登 录</button>
    </div>
    <p style="text-align:center;font-size:11px;color:var(--text-muted);margin-top:12px;">提示：请联系管理员获取账号</p>
  </div>
</div>
```

- [ ] **Step 2: CSS — 登录弹窗默认显示**

在 CSS 中，`#login-overlay` 使用现有的 `.modal-overlay.visible` 样式，无需新增 CSS。确保 `.modal-overlay` 的 `z-index` 足够高（当前已设 `z-index: 1000`）。

- [ ] **Step 3: Topbar 添加用户名和退出按钮**

在 `#topbar` 的 `#page-title` 后面、设置按钮前面添加：

```html
<span id="login-user-display" style="font-size:12px;color:var(--text-secondary);margin-right:12px;display:none;"></span>
<button id="btn-logout" class="btn-action" style="display:none;padding:4px 10px;font-size:12px;margin-right:8px;" type="button">退出</button>
```

---

### Task 4: 前端 — 登录 JS 逻辑

**文件：**
- 修改: `index.html`

**接口：**
- 消耗: Task 3 的 DOM 元素
- 产出: 登录/验证/退出完整流程

- [ ] **Step 1: 修改 authFetch 函数**

找到 `authFetch()`（约在 1690 行），替换为：

```js
function authFetch(url, options = {}) {
    const token = localStorage.getItem('auth_token');
    const headers = { ...(options.headers || {}) };
    if (token) {
        headers['Authorization'] = 'Bearer ' + token;
    }
    return fetch(url, { ...options, headers });
}
```

- [ ] **Step 2: 添加登录逻辑模块**

在 JS 区域末尾（`</script>` 之前）添加：

```js
// ============================================================
// 模块：登录系统
// ============================================================
(function() {
    var loginOverlay = document.getElementById('login-overlay');
    var btnLogin = document.getElementById('btn-login');
    var inputUser = document.getElementById('login-username');
    var inputPass = document.getElementById('login-password');
    var loginError = document.getElementById('login-error');
    var userDisplay = document.getElementById('login-user-display');
    var btnLogout = document.getElementById('btn-logout');

    function showLogin() {
        loginOverlay.classList.add('visible');
        inputUser.focus();
    }

    function hideLogin() {
        loginOverlay.classList.remove('visible');
        userDisplay.style.display = '';
        userDisplay.textContent = '👤 ' + (localStorage.getItem('auth_username') || '');
        btnLogout.style.display = '';
    }

    function showError(msg) {
        loginError.style.display = '';
        loginError.textContent = msg;
    }

    function hideError() {
        loginError.style.display = 'none';
    }

    // 登录按钮
    btnLogin.addEventListener('click', async function() {
        var username = inputUser.value.trim();
        var password = inputPass.value;
        if (!username || !password) {
            showError('请输入账号和密码');
            return;
        }
        hideError();
        btnLogin.disabled = true;
        btnLogin.textContent = '登录中...';
        try {
            var resp = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username, password: password })
            });
            var data = await resp.json();
            if (!resp.ok) {
                showError(data.error || '登录失败');
                btnLogin.disabled = false;
                btnLogin.textContent = '登 录';
                return;
            }
            localStorage.setItem('auth_token', data.token);
            localStorage.setItem('auth_username', data.username);
            hideLogin();
        } catch (e) {
            showError('网络错误，请检查服务器连接');
            btnLogin.disabled = false;
            btnLogin.textContent = '登 录';
        }
    });

    // 回车键登录
    inputPass.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') btnLogin.click();
    });

    // 退出按钮
    btnLogout.addEventListener('click', function() {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_username');
        location.reload();
    });

    // 页面加载：验证已有 token
    (async function init() {
        var token = localStorage.getItem('auth_token');
        if (!token) {
            showLogin();
            return;
        }
        // 调 /api/config 验证 token 是否有效
        try {
            var resp = await authFetch('/api/config');
            if (!resp.ok) throw new Error('invalid');
            hideLogin();
        } catch (e) {
            localStorage.removeItem('auth_token');
            showLogin();
        }
    })();
})();
```

- [ ] **Step 3: 处理弹窗关闭逻辑 — 防止未登录跳过**

登录弹窗不可关闭（没有关闭按钮、点击遮罩不关闭）。CSS 已经满足（`.modal-overlay` 没有自动关闭逻辑，需要 JS 控制）。


- [ ] **Step 4: 验证**

1. 打开 http://127.0.0.1:3000 → 应看到登录弹窗
2. 输入错误密码 → 显示"用户名或密码错误"
3. 输入 `choushiyiguai` / `123456` → 登录成功，进入主界面
4. 右上角显示 `👤 choushiyiguai` 和退出按钮
5. 点击退出 → 回到登录页
6. 刷新页面 → 自动登录（不弹登录窗）
7. 清除 localStorage 后刷新 → 弹登录窗
