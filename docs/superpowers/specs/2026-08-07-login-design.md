# 登录系统设计

## 需求

6个局域网用户各自登录，完全独立工作区。

### 账号列表

| 账号 | 密码 |
|------|------|
| choushiyiguai | 123456 |
| choushiyiguai1 | 123456 |
| choushiyiguai2 | 123456 |
| choushiyiguai3 | 123456 |
| choushiyiguai4 | 123456 |
| choushiyiguai5 | 123456 |

### 行为

- 首次访问弹出登录页，登录后 token 存浏览器 localStorage
- 下次打开自动验证，无需重新登录
- 不同账号的提取结果、生成内容完全隔离
- 服务重启后所有人重新登录

## 后端 (server.js)

### 账号存储

硬编码在服务端内存：

```js
const USERS = {
  'choushiyiguai':  '123456',
  'choushiyiguai1': '123456',
  // ... 共6个
};
```

### 新增端点

**POST /api/login**（无需鉴权）
- 接收 `{ username, password }`
- 验证通过生成 `crypto.randomBytes(16).toString('hex')` token
- 存 `tokenMap: Map<token, username>`
- 返回 `{ token, username }`
- 验证失败返回 401

### 修改现有鉴权

- 替换当前 `apiAuth` 中间件
- 从 `Authorization: Bearer <token>` 头解析 token
- 查到 username 注入 `req.username`，未查到返回 401
- 不再使用 `X-Auth-Token` + `.auth-token` 文件

### 内容隔离

当前数据存全局变量。改为按用户隔离：

```js
const userSessions = new Map(); // username → { extraction, outputs }
```

每个 API 请求通过 `req.username` 找到对应用户数据。

### 现有端点修改

| 端点 | 修改 |
|------|------|
| `/api/config` | 获取/保存按用户隔离（各自用各自的 api-config） |
| `/api/chat` | 流式输出不变，数据隔离在 client 层 |
| `/api/prompt` | 无变化（公共资源） |
| `/api/test` | 无变化 |
| `/api/tts` | 无变化 |

## 前端 (index.html)

### 登录弹窗

- 页面加载时检查 localStorage 的 `auth_token`
- 有 token → 调 `/api/config` 验证（成功进主界面，失败弹登录窗）
- 无 token → 弹出登录弹窗

弹窗布局：
```
┌─────────────────────────┐
│       🔐 登录           │
│                         │
│  账号  [___________]    │
│  密码  [___________]    │
│                         │
│  [      登  录      ]   │
│                         │
│  提示：请联系管理员获取账号 │
└─────────────────────────┘
```

### 关键逻辑

- 登录成功：存 `auth_token` + `auth_username` 到 localStorage → 页面刷新
- `authFetch()` 改用 `Authorization: Bearer <token>` 替代 `X-Auth-Token`
- Topbar 右上角显示当前用户名 + 退出按钮
- 退出：清除 localStorage → 刷新

### CSS

复用现有 `.modal-overlay` / `.modal` 样式，登录弹窗结构一致。

## 实现清单

1. server.js：账号表 + `/api/login` 端点 + 新鉴权中间件 + 用户数据隔离
2. index.html：登录弹窗 HTML + CSS + JS 登录逻辑 + authFetch 改造 + 退出按钮
