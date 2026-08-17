# 一战晟铭

小说转可视化剧本工具。项目使用 Node.js + Express 提供多页面站点和本地 API 代理，不使用前端单页面 SPA。

## 功能

- 剧本生成页：粘贴小说，提取人物与场景，再生成剧情模式、画布模式或剧本模式内容。
- 双开头策略：连续开头、爆款开头。
- 本地提示词：后端读取 `prompts/*.md`，前端按模式拼接最终 system prompt。
- 登录鉴权：通过 `/api/login` 获取 Bearer token。
- 用户隔离：API 配置和生成历史按账号写入 `data/users/<username>/`。
- 多页面路由：首页 `/`、剧本页 `/script`、Agent 页 `/agent`、配音页 `/tts`。

## 启动

```bash
npm install
npm start
```

启动后访问：

```text
http://127.0.0.1:3000
```

登录账号请联系管理员获取。

## 配置与数据

- API 配置保存在 `data/users/<username>/api-config.json`。
- 生成历史保存在 `data/users/<username>/outputs/`。
- 旧根目录 `api-config.json` 和 `outputs/` 只作为主账号 `choushiyiguai` 的首次迁移来源，保留不删除。

## 验证

```bash
node -c server.js
node -c lib/shared.js
node -c routes/config.js
node -c routes/chat.js
node -c routes/history.js
node scripts/validate-multipage-architecture.js
```

生成链路烟测脚本（需通过环境变量提供密码）：

```bash
QIANTIE_PASSWORD=<你的密码> node test-gen.js
```

也可以指定账号：

```bash
QIANTIE_USERNAME=choushiyiguai1 QIANTIE_PASSWORD=<你的密码> node test-gen.js
```

## Go + MySQL Backend Preview

The repository includes a staged Go backend under `backend/`. It is not yet a replacement for the Express server. It provides the MySQL-backed foundation for login, API config, history, and legacy import.

See `backend/README.md` for local commands.

## 注意

登录账号密码不写入源码，由环境变量 `QIANTIE_SEED_ACCOUNTS`（JSON，如 `{"choushiyiguai":"你的密码"}`）或 gitignored 的 `data/system/seed-accounts.json` 注入。未配置种子账号时服务不创建任何账号。部署到公网前请务必设置强随机密码，勿沿用示例账号密码。
