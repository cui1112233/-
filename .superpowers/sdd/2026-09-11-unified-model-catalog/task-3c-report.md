# Task 3c — 模型能力安全持久化

## 完成内容

- 在模型目录领域中持久化自定义模型的 `capabilities`。
- 白名单仅允许 `supportsReferenceImages`、`requiresImageInput` 与 `maxVideoDuration`；后者仅接受 1–60 的整数。
- 丢弃未知字段、数组输入和任何能力字段中的敏感数据，目录公开摘要仍不会返回 `credential`。
- 为 YD、H3、本地豆包执行器定义不可变的系统能力；客户端提交的预设能力不会覆盖系统定义。
- 目录 CRUD 通过现有归一化链路保存并安全返回能力字段，无需修改路由或前端。

## 验证

- RED：新增自定义能力持久化、公开摘要脱敏、预设能力不可覆盖与 CRUD 保存测试后，`node --test tests/model-catalog.test.js tests/model-catalog-routes.test.js` 出现 3 个预期失败。
- GREEN：`node --test tests/model-catalog.test.js tests/model-catalog-capabilities.test.js tests/model-catalog-routes.test.js tests/model-catalog-member-visibility.test.js tests/model-catalog-legacy-migration.test.js` — 21 passed。
- `git diff --check` — 通过。

## 范围

仅修改 `lib/model-catalog.js` 和目录领域测试；未修改前端、业务路由、部署、数据或构建产物。
