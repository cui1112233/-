# Task 3b — API 配置页统一模型管理

## 完成内容

- 将旧的单文本／图片／视频 Key 表单替换为管理者专用的统一模型管理界面。
- 按文本、视频、图片分组展示自定义模型，并提供新增、编辑、启用／停用和删除。
- 直接展示 YD2.0 Mini、MiniMax H3 与本地豆包执行器三个视频预设；预设未完成 Key 或执行器配对前不可启用。
- 自定义模型弹窗支持模型类型、API 格式、Base URL、模型 ID、显示名称、API Key、适用能力和启用状态。
- 成员仅看到托管说明，不会获得凭据输入或模型 CRUD 控件。
- 旧的视频 UI 契约已改为验证预设目录，不再要求废弃的 `video.ydApiKey`／`video.h3ApiKey` 表单字段；后端迁移兼容断言保持不变。

## 验证

- RED：新增“适用能力”和预设未配置不可启用的 UI 契约后，测试因页面缺少对应实现而失败。
- GREEN：`node --test tests/model-catalog-api-config-ui.test.js tests/video-api-config.test.js` — 5 passed。
- 构建：`npm --prefix frontend run build` — 通过；仅有既有静态品牌资源与大 chunk 警告。
- `git diff --check` — 通过。

## 范围

本任务未修改后端、业务路由、部署配置或构建产物。前端构建产生的 `frontend/dist` 工作区变更未纳入本任务。
