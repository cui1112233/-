# CM Script Collaboration 最终审查修复报告

- 后端 `routes/agent.js` 的最终上下文净化规则现额外覆盖 `authorization`、`authorizationHeader`、`credential` 与 `accessToken`（大小写不敏感），并保留既有 `token`、`key`、`secret`、`password` 过滤。直接请求 `/api/agent/chat` 的敏感 `entities`、`extracted` 字段不会传入 responder 或任务持久化内容。
- `/api/agent/chat` 对 Base URL、模型名或 API Key 缺失产生的 `ensureReadyConfig` 错误返回 HTTP 422，其他上游/模型错误仍保持原有 502 映射。
- 前端 CM 错误分类将 422 及缺失配置文本归类为设置操作，显示“模型配置无法使用，请检查接口、模型名或密钥。”并提供“打开模型设置”。既有 API error metadata 与 `suppressGlobalError` 未变更。
- 新增真实路由回归测试覆盖直接 POST 上下文凭据净化和缺失配置 422；新增前端单元断言覆盖 422 与模型名缺失文本分类。

验证：
- `node --test tests/agent-routes.test.js`：19 通过，0 失败。
- `node --test frontend/src/shared/pet/scriptCollaboration.test.js`：2 通过，0 失败。
- `npm run frontend:build`：成功（Vite 既有大 chunk 提示，未影响构建结果）。
- 已检查修改文件诊断：无诊断。
