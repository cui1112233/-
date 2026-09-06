# 剧本统一外层分镜卡片协议（Live）

- 状态：最终统一协议已落地（本地验证通过，未部署）
- 分支：`v88`
- 日期：2026-09-06
- 发布边界：本次不部署公网，不修改公网 `:3000`、旧容器或正式数据卷。

## 最终协议

剧本生成的所有输出模式（剧情、画布、剧本、分镜、Q版及后续模式）共用同一个系统级外层协议：

```text
### 分镜一（总时长：10s 或 15s）
{当前输出模式的卡内内容}

### 分镜二（总时长：10s 或 15s）
{当前输出模式的卡内内容}
```

- 一个 `### 分镜N` 外层区块对应前端一张卡片。
- 前端只识别三级标题 `### 分镜N` 作为外层边界；阿拉伯数字和连续中文编号均可识别。
- 时间轴、`---`、`镜头一`、`分镜1：`、场次标题、JSON 数组和普通 Markdown 标题只能留在卡片内部，不能制造外层卡片。
- 开头预设负责依据剧情连续性、空间变化、动作完整性和信息揭示决定内容如何分段；输出模式只负责卡内表达格式。
- `10s` / `15s` 是单张外层卡片的最大时长规则。AI 生成完成后，程序不得按 10s / 15s 对已有卡片机械二次拆分、合并或重排。
- 剧本模式不再作为非卡片例外。

## 实现位置

- 系统级可编辑预设：`prompts/统一外层分镜卡片协议.md`
- 后端统一注入：`routes/chat.js`、`lib/system-preset-catalog.js`
- 前端统一拆卡：`frontend/src/user/pages/scriptShotOutput.js`
- 最终卡片组装：`frontend/src/user/pages/scriptFinalSegment.js`、`frontend/src/user/pages/ScriptPage.jsx`
- 管理后台分区：`frontend/src/admin/pages/PresetLibraryPage.jsx`

## 验证记录

已实际运行并通过：

- `node --test frontend/src/user/pages/scriptShotOutput.test.js frontend/src/user/pages/scriptFinalSegment.test.js`：7 项通过。
- `node --test tests/*.test.js tests/*.test.mjs`：206 项通过。
- `npm test`（`frontend`）：5 项通过。
- `npm run build`（`frontend`）：Vite 生产构建通过；仅有资源路径提示和大 chunk 警告。
- `git diff --check`：通过。

以上结果覆盖统一标题拆卡、全部剧本模式、快速导演入口、旧格式不自动成卡和 10s/15s 不二次拆卡回归测试。公网发布仍需后续明确授权，并不属于本次改造。
