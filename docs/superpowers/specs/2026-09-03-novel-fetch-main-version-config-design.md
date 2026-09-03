# Novel Fetch Mainline Version Configuration Backport Design

## Goal

把小说获取页面当前集成分支中已经验证过的版本配置能力回迁到主线公网入口，使 `/novel-fetch` 同时支持原文、AI1～AI5 精确选择、每个 AI 版本独立处理方案、版本对应 121 配置档、同步批量后台配置和同步批量风格类型。

## Scope

本次只回迁小说获取相关功能，不整体合并 `integrate/v88-novel-fetch-version-config-20260903` 的 31 个提交，也不带入无关的 V88/Go 批量工厂改动。

保留现有书籍清单输入；处理页去掉旧的解析格式和列顺序配置。AI 生成数量由 `selected_versions` 中的 AI 版本决定，不再使用独立的默认 AI 文案数量作为处理依据。

## Architecture

`/novel-fetch` 继续使用主线 React 外壳，但其工作区由 `/batch-rewrite/index.html` 提供。处理页的版本选择、AI 槽位处理方案和 121 配置档绑定统一保存到任务元数据，并通过任务请求传递到后端。网站提交直接复用同一份选中版本，避免处理和提交各自维护一套选择。

版本顺序固定为：

```text
original, ai1, ai2, ai3, ai4, ai5
```

AI 槽位处理方案允许：

```text
high_imitation, opening_instruction, instruction, 空值（自动轮换）
```

121 配置档绑定允许为每个版本单独指定；空值表示跟随默认配置档或按书籍平台、男女频、风格自动匹配。

## Required Behavior

1. 处理页显示原文、AI1～AI5 六个版本选择框。
2. AI1～AI5 每个版本拥有独立的处理方案选择框。
3. 任务创建时保存 `selected_versions`、`target_versions` 和 `ai_slot_methods_snapshot`。
4. 重新打开任务时恢复原先的版本选择和 AI 槽位方案，不被当前配置覆盖。
5. AI 生成只生成已选择的 AI 版本；未选择的版本不生成。
6. 网站提交使用处理页确认的版本集合，并支持 original、ai1～ai5 的独立配置档绑定。
7. “同步批量后台配置”更新可用 121 配置档。
8. “同步批量风格类型”更新可用风格目录。
9. 失败响应必须说明是版本选择、配置同步、登录会话还是上传接口错误。
10. 兼容没有显式版本选择的历史任务，按旧 `aiCount` 推导目标版本。

## Files

- Modify: `frontend/public/batch-rewrite/index.html`
- Modify: `frontend/public/batch-rewrite/app.js`
- Modify: `frontend/dist/batch-rewrite/index.html`
- Modify: `frontend/dist/batch-rewrite/app.js`
- Create: `lib/novel-fetch-workshop/version-selection.js`
- Modify: `lib/novel-fetch-workshop/task-ops.js`
- Modify: `lib/novel-fetch-workshop/rewrite.js`
- Modify: `routes/batch-rewrite.js`
- Modify: `routes/novel-fetch-upload.js`
- Add focused tests under `tests/` for version selection, task persistence, AI generation selection and UI source contracts.
- Update the production version record after the final mainline commit is known.

## Testing

先写并运行失败测试，覆盖：

- 版本集合规范化及固定顺序；
- 历史 `aiCount` 的兼容推导；
- 选择 AI2、AI5 时只生成对应槽位；
- 任务重新读取时恢复版本和槽位方案；
- original、ai1～ai5 的配置档绑定；
- 前端主线入口包含六版本选择和两个同步按钮，且不包含旧解析格式控件和独立默认 AI 数量控件。

之后运行小说获取聚焦测试、前端构建和完整 Node 回归测试。

## Deployment

仓库当前没有 master 自动部署工作流。最终发布必须使用同一个 Git SHA 构建前端和后端镜像，并在公网机器上核对实际运行版本；不能只替换静态文件。发布前必须确认公网 `/novel-fetch`、`/batch-rewrite/index.html`、`/api/batch-rewrite/config` 和版本配置保存/读取接口都来自该 SHA。

## Non-goals

- 不整体合并 31 个提交的 V88/Go 批量工厂分支。
- 不在旧的 `frontend/public/batch-rewrite` 外重新创建第二套小说获取页面。
- 不保留“解析输入”和“默认 AI 文案数量”作为本次版本选择的主控制入口。
