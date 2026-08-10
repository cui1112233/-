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

默认测试账号：

```text
choushiyiguai / 123456
choushiyiguai1 / 123456
```

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

生成链路烟测脚本：

```bash
node test-gen.js
```

也可以指定账号：

```bash
QIANTIE_USERNAME=choushiyiguai1 QIANTIE_PASSWORD=123456 node test-gen.js
```

## 注意

本项目当前账号密码写在服务端代码中，适合本地或局域网临时使用，不适合直接公开部署。
