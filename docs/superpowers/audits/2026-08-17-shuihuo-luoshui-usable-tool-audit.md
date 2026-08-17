# 水货生产洛水对齐可用工具审计

日期：2026-08-17
项目：/Users/ming/Downloads/qiantie
参考：/Users/ming/Documents/小说前贴/docs/reverse/luoshui2026-prompt-community/

## 1. 结论摘要

Task 2 静态源码分类显示，当前水货生产不是纯前端假页面：项目/源文本、分段候选与确认、当前挂载的 `CommentaryWorkbench` 分镜编辑、人工资产、媒体上传下载、任务提交/轮询/取消/重试、前端导出 ZIP、配置与健康检查均能在源码中追到前端入口、API 包装、Go handler 和 store/对象存储/队列副作用。

但本轮未调用需登录 API，也未验证数据库、Redis、对象存储、模型 provider、worker 的当前运行健康。因此所有“已落地”仅表示源码链路有持久化或任务副作用，不写成已端到端可用。智能分段、AI 资产分析、图片/视频/配音任务均依赖文本或生成模型配置；生成任务还依赖 Redis 队列、对象存储和 worker。导出在当前 `CommentaryWorkbench` 已有可见入口并调用后端 ZIP API，但仍依赖已确认分镜和对象存储素材读取。

洛水2026字段缺口和最小补齐路线由 Task 3 完成；本轮只给当前水货功能真实性分类。

## 2. 证据边界

- 本轮证据来源限定为已批准计划中的静态源码、洛水本地 evidence index、以及安全运行态 HTTP/端口检查。
- 已读取 React 用户页与水货组件目录：`frontend/src/user/pages/ShuihuoProductionPage.jsx`、`frontend/src/user/pages/shuihuo/*.jsx`。
- 已读取前端 API 契约：`frontend/src/shared/api/shuihuoProduction.js`。
- 已读取 Node 网关：`routes/shuihuo-production.js`。
- 已读取 Go 路由与水货后端目录：`backend/internal/httpapi/router.go`、`backend/internal/httpapi/shuihuo_*.go`、`backend/internal/shuihuo/**/*.go`。
- 已读取洛水2026本地证据索引：`/Users/ming/Documents/小说前贴/docs/reverse/luoshui2026-prompt-community/evidence_index.md`。
- 未读取浏览器 cookie、localStorage、保存凭据、浏览器 profile、第三方受保护数据。
- 未调用需要登录态或用户 token 的水货生产 API；运行态证据只包含公开页面响应和本地端口监听。
- 本文档没有输出 bridge secret、cookie、token、provider 配置值、模型密钥或对象存储凭据。
- 当前文件中的“存在”只代表源码或运行态入口被采集到；Task 2 的真实性分类已基于静态源码完成，洛水缺口和补齐路线由 Task 3 补充，见第 10、11 章。

## 3. 功能真实性矩阵

| 功能 | 前端入口 | API/网关 | Go 后端 | 持久化/产物 | 判定 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| 项目列表/打开 | 项目页读取项目列表、点击卡片打开工作台 | 前端 `listProjects/getProject` 包装；Node 网关需登录后转发 | list 在 DB 缺失时返回空数组，get 读取 read model | DB 读项目、segments/sourceUnits/assets/media | 源码链路已落地；DB 缺失时列表退化为空 | `/Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx:47`、`:58`；`/Users/ming/Downloads/qiantie/frontend/src/shared/api/shuihuoProduction.js:11`、`:14`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_handlers.go:54`、`:110`、`:122` |
| 项目创建/粘贴原文 | 新建弹窗粘贴文本后创建项目、替换 source | `createProject`、`replaceProjectSource` | create 写项目；replace 写 source 并拒绝 active tasks | DB 项目和原文；替换旧导入文件时尝试清理对象 | 源码链路已落地；依赖数据库 | `/Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx:87`、`:91`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/ProjectsView.jsx:54`、`:65`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_handlers.go:68`、`:82`、`:254`、`:269` |
| 文件导入 TXT/SRT/DOCX | Upload 读取 data URL，支持指定扩展 | `importProject` | 解析上传、创建 importing 项目、写对象存储、保存 source object key | DB 项目/sourceText + object storage 原文件；失败有补偿清理 | 源码链路已落地；依赖数据库和对象存储 | `/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/ProjectsView.jsx:60`、`:122`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_handlers.go:198`、`:222`、`:230`、`:241`、`:246` |
| 项目删除 | 卡片删除按钮 | `deleteProject` | 删除 DB 项目，清理 source/media 对象或记录待清理 | DB 删除；对象存储清理可延迟 | 源码链路已落地；对象清理依赖存储 | `/Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx:116`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/ProjectsView.jsx:111`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_handlers.go:152`、`:176`、`:181`、`:184` |
| 分段：创建后段落识别/工作台手动分段候选 | 创建流程用段落识别；当前工作台 `CommentaryWorkbench` 的“分镜调整”用固定行数生成候选并人工确认 | `paragraphSegmentation/fixedSegmentation/confirmSegmentation` | paragraph/fixed 返回候选；confirm 替换 confirmed segments | 生成候选不写入；confirm 写 DB segments | 候选/人工确认机制；确认写入链路已落地 | `/Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx:75`、`:80`、`:136`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:98`、`:102`、`:108`、`:111`、`:203`、`:206`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_segmentation_handlers.go:34`、`:55`、`:257`、`:281` |
| 分段：AI 推理/智能识别 | 当前 `CommentaryWorkbench` 工具栏和分镜调整弹窗在 textReady 时开放 AI 推理 | Node 网关代码会尝试读取并注入系统预设；API 需要文本模型 | 校验模型、账号 AI 配置、调用 TextCompletion、保存 prompt snapshot | 候选和分析快照；确认前不改分镜 | 依赖存在但当前环境可能阻塞；候选/人工确认机制 | `/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:63`、`:66`、`:101`、`:103`、`:203`、`:206`；`/Users/ming/Downloads/qiantie/routes/shuihuo-production.js:18`、`:47`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_segmentation_handlers.go:103`、`:117`、`:136`、`:212`、`:224` |
| 分镜编辑：字幕/图片提示词/视频提示词/锁定 | 当前 `CommentaryWorkbench` 编辑弹窗与放大编辑字段，`StoryboardRow` 行内删除/绑定入口；当前可见排序控件未在该路径中确认 | `updateSegment/deleteSegment/reorderSegments/replaceSegmentAssets` 已有后端路由/API 包装 | update 只改任务面向字段；delete/reorder/assets 写 DB | DB segments 和分镜资产绑定 | update/delete/assets 在当前路径有入口且后端落地；reorder 后端/API 已落地但当前可见入口未确认；旧 `StudioView` 的 createSegment 断链不列为当前核心断点 | `/Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx:136`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:113`、`:117`、`:121`、`:126`、`:143`、`:147`、`:168`、`:205`、`:207`、`:208`；`/Users/ming/Downloads/qiantie/frontend/src/shared/api/shuihuoProduction.js:44`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/router.go:112`、`:113`、`:114`、`:115`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_storyboard_handlers.go:81`、`:99`、`:105`、`:111`、`:128`、`:154` |
| 分镜合并/拆分/后方新增 | 当前工作台渲染 `StoryboardRow`；“后方新增”打开 modal 后保存 | `mergeStoryboard/splitStoryboard/insertStoryboard` | SourceUnits Merge/Split/InsertAfter 后返回 read model | DB source units + segments | 当前可见后方新增走 `insert-after`，后端路由已注册并实现 | `/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:149`、`:152`、`:205`、`:211`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/StoryboardRow.jsx:4`、`:80`、`:86`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/router.go:109`、`:110`、`:111`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_storyboard_handlers.go:33`、`:46`、`:59` |
| 资产：人工人物/场景/道具/音色 | 资产页添加、编辑、删除；分镜可绑定资产 | `createAsset/updateAsset/deleteAsset/replaceSegmentAssets` | assets CRUD；segment-assets replace | DB assets 与绑定关系 | 源码链路已落地；依赖数据库 | `/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/AssetsView.jsx:25`、`:30`、`:35`、`:70`、`:74`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_handlers.go:411`、`:428`、`:454`、`:487`; `/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_storyboard_handlers.go:128`、`:148` |
| 资产：AI 分析候选 | 资产页“分析候选”，选择文本模型后生成，用户采纳 | `analyzeAssets/applyAssetCandidates` | analysis 调 TextCompletion 只返回候选；apply 创建 `ai_candidate` assets | 候选不写入；采纳后 DB assets | 候选/人工审核机制；依赖文本模型和提示词仓库 | `/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/AssetsView.jsx:37`、`:51`、`:58`、`:63`、`:75`、`:76`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_analysis_handlers.go:63`、`:86`、`:88`、`:94`、`:104`、`:113`、`:26`、`:53` |
| 提示词候选：图片/视频 | 当前挂载的 `CommentaryWorkbench` 未导入/渲染 `PromptCandidatesModal`；当前提示词主要是手动编辑和放大编辑字段 | 前端 API 包装和 Go handler 存在 | 按 segment 调 TextCompletion 生成候选并保存快照；apply 更新未锁定提示词 | 候选不写入；应用后 DB prompt 字段 | 后端/API 存在但当前 UI 未开放或未挂载；不列为当前可见入口 | `/Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx:136`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:8`、`:207`、`:208`；`/Users/ming/Downloads/qiantie/frontend/src/shared/api/shuihuoProduction.js:35`、`:36`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_prompt_generation_handlers.go:39`、`:98`、`:144`、`:187` |
| 媒体上传/绑定/主图/下载预览 | 当前 `CommentaryWorkbench` 打开 `MediaModal`，`StoryboardRow` 预览/主图/上传入口 | `uploadMedia/attachMedia/setPrimaryMedia/downloadMedia` | 上传校验类型并写对象存储和 media 记录；下载从对象存储读 | object storage 文件 + DB media；图片绑定分镜时自动设主图 | 当前可见链路已落地；依赖对象存储和数据库 | `/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:154`、`:157`、`:158`、`:205`、`:213`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/StoryboardRow.jsx:17`、`:69`、`:85`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/MediaModal.jsx:21`、`:25`、`:29`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_media_handlers.go:41`、`:46`、`:82`、`:88`、`:94`、`:116`、`:138`、`:178` |
| 任务中心：单任务、轮询、取消、重试 | 当前 `CommentaryWorkbench` 的任务/日志、取消操作打开 `TaskDrawer`；行级任务也进入批量弹窗单项提交 | `listModels/listTasks/createTask/cancelTask/retryTask` | 创建任务写 DB draft->queued 并入 Queue；cancel/retry 写状态/重新入队 | DB tasks + Redis queue；完成产物由 worker 写 media | 依赖存在但当前环境可能阻塞；需 DB、Redis、模型配置、worker、对象存储 | `/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:192`、`:196`、`:203`、`:205`、`:215`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/TaskDrawer.jsx:32`、`:51`、`:59`、`:64`、`:69`、`:78`、`:85`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_task_handlers.go:80`、`:98`、`:116`、`:212`、`:216`、`:242`、`:267`、`:275`、`:282`、`:319`、`:332` |
| 批量任务 | 当前 `CommentaryWorkbench` 批量操作下拉和行级生成入口打开 `BatchTaskModal` | `createBatchTasks` | 循环调用 createShuihuoTask，允许部分失败返回 207 | DB tasks + Redis queue | 依赖存在但当前环境可能阻塞；不是本地假提交 | `/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:200`、`:203`、`:205`、`:214`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/BatchTaskModal.jsx:58`、`:65`、`:91`、`:98`、`:101`、`:117`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_task_handlers.go:135`、`:158`、`:169`、`:173` |
| Worker 生成产物 | 前端不直接控制，任务中心轮询结果 | 队列消费不经用户 API | worker 从 Redis dequeue，校验任务/模型/分段，调用 adapter，下载结果，写对象存储和 generated media | object storage generated 文件 + DB media/task output | 依赖存在但当前环境可能阻塞；需 worker 进程和 adapter/下载链路健康 | `/Users/ming/Downloads/qiantie/backend/internal/shuihuo/tasks/worker.go:63`、`:82`、`:83`、`:93`、`:151`、`:172`、`:181`、`:184`、`:188`、`:192` |
| 导出 ZIP | 当前 `CommentaryWorkbench` 有“导出剪映”按钮，未 confirmed 或 exporting 时禁用 | 前端 `exportProject` 包装存在并被调用；Go route/handler 存在 | handler 读取 read model 并 BuildZIP；缺分镜/存储返回错误 | ZIP response，包含持久化工作台状态和可读素材 | 前端已有可见导出入口 + 后端 ZIP API，源码链路已落地；本轮未做登录态/真实项目导出验证；依赖 confirmed 分镜和对象存储素材读取 | `/Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx:136`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:8`、`:169`、`:172`、`:181`、`:203`；`/Users/ming/Downloads/qiantie/frontend/src/shared/api/shuihuoProduction.js:55`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/router.go:83`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_export_handlers.go:18`、`:22`、`:41`、`:54` |
| 配置/健康 | 当前页面读取 health；当前工作台“引擎配置”只展示启用模型名称和类型 | `getProductionHealth/listModels` 当前可见；`getProductionConfig/saveProductionConfig` API 和旧 modal 存在 | health 返回 DB/Redis/storage/models 安全快照；config handler 可读写用户生产默认配置 | DB production config；health 不暴露凭据 | health 和模型展示当前可见；默认配置 API/旧组件存在但当前 `CommentaryWorkbench` 未开放配置 modal | `/Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx:52`、`:133`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:188`、`:190`、`:212`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/ProductionConfigModal.jsx:18`、`:30`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_health_handlers.go:16`、`:30`、`:36`、`:39`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_config_handlers.go:10`、`:23` |

## 4. 已真实落地

以下只表示源码静态证据显示有前端入口、API 包装、Go handler 和持久化/副作用链路；本轮未做登录态真实 API 调用。

- 项目基础管理：项目列表、打开、创建、粘贴原文、替换原文、删除均接入 API 与 DB store；导入文件删除/替换还包含对象清理或延迟清理记录。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx:47`、`:87`、`:116`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_handlers.go:54`、`:68`、`:152`、`:254`、`:298`。
- 文件导入：前端支持 TXT/SRT/DOCX，后端解析上传、保存 sourceText、写 source object key。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/ProjectsView.jsx:60`、`:122`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_handlers.go:198`、`:222`、`:241`、`:246`。
- 创建后段落识别、当前工作台固定行数分镜候选与确认：候选阶段不写入，确认后 `ReplaceConfirmed` 写入分镜。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx:75`、`:80`、`:136`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:98`、`:102`、`:108`、`:111`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_segmentation_handlers.go:34`、`:55`、`:257`、`:281`。
- 当前工作台分镜编辑的 update/delete/assets 链路已落地：字幕、图片提示词、视频提示词、锁定字段、删除、资产绑定在当前 `CommentaryWorkbench`/`StoryboardRow` 有入口，在 Go handler 中有 store 更新；reorder 的 API 包装和 Go handler 也已落地，但当前可见排序控件未在 `CommentaryWorkbench` 路径中确认。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx:136`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:113`、`:117`、`:121`、`:126`、`:143`、`:147`、`:168`、`:205`；`/Users/ming/Downloads/qiantie/frontend/src/shared/api/shuihuoProduction.js:44`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_storyboard_handlers.go:81`、`:99`、`:105`、`:111`、`:128`、`:148`、`:154`、`:169`。
- 当前工作台分镜结构操作中的 merge/split/insert-after 已落地：`StoryboardRow` 提供合并、拆分、后方新增入口，后方新增保存调用 `insertStoryboard`，Go 后端注册并实现对应路由。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:149`、`:152`、`:205`、`:211`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/StoryboardRow.jsx:80`、`:86`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/router.go:109`、`:110`、`:111`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_storyboard_handlers.go:33`、`:46`、`:59`。
- 人工资产：人物/场景/道具/音色资产的新增、编辑、删除和分镜绑定都有 DB 写入路径。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/AssetsView.jsx:25`、`:30`、`:35`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_handlers.go:428`、`:454`、`:487`。
- 人工媒体：当前工作台的图片/视频/音频上传、分镜绑定、主图设置、下载预览都有对象存储和 DB media 路径；`deleteMedia` API 和旧组件入口存在，但当前 `CommentaryWorkbench` 主路径未看到删除素材入口。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:154`、`:157`、`:158`、`:213`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/StoryboardRow.jsx:17`、`:69`、`:85`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/MediaModal.jsx:21`、`:25`、`:29`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_media_handlers.go:41`、`:82`、`:88`、`:138`、`:178`。
- 导出 ZIP：当前 `CommentaryWorkbench` 有“导出剪映”按钮，调用 `exportProject` 获取 blob 并触发下载；Go handler 读取项目 read model 并 `BuildZIP`。本轮未做登录态/真实项目导出验证。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:169`、`:172`、`:181`、`:203`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_export_handlers.go:18`、`:41`、`:54`。
- 配置/健康：前端读取 health 并展示依赖状态；当前 `CommentaryWorkbench` 的“引擎配置”只列出管理员启用的引擎名称和类型。默认配置 API 和 `ProductionConfigModal` 旧组件存在，但当前主工作台未开放该配置 modal；health 明确只返回安全依赖快照。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx:52`、`:133`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:188`、`:190`、`:212`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/ProductionConfigModal.jsx:18`、`:30`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_health_handlers.go:16`、`:30`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_config_handlers.go:10`、`:23`。

## 5. 依赖存在但当前环境可能阻塞

- 智能分段/AI 推理：当前 `CommentaryWorkbench` 在 `textReady` 时开放 AI 推理，Node 网关会尝试读取并注入 `shuihuo-smart-segmentation` 预设；如果该预设未发布，网关代码会返回 409。Go 端还要求启用文本模型、provider 配置和账号 AI 配置，并保存 prompt snapshot。缺任一环节会返回 409/503/502。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:56`、`:63`、`:66`、`:101`、`:103`、`:203`；`/Users/ming/Downloads/qiantie/routes/shuihuo-production.js:18`、`:47`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_segmentation_handlers.go:117`、`:136`、`:150`、`:187`、`:216`、`:224`。
- AI 资产分析：handler 明确只返回候选，但生成候选依赖 prompt repository、TextCompletion、模型返回格式和快照保存。证据：`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_analysis_handlers.go:81`、`:86`、`:99`、`:104`、`:108`、`:113`。
- 图片/视频提示词候选 API：后端可逐分镜调用 TextCompletion，依赖启用文本模型、预设仓库和模型返回 JSON；应用时才写入 segments。但当前挂载工作台未开放该 modal。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:8`、`:207`、`:208`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_prompt_generation_handlers.go:57`、`:72`、`:80`、`:85`、`:98`、`:187`。
- 单任务和批量任务：前端会按 readiness 禁用提交，后端要求 Queue 非空、分镜已确认、模型可用且 provider configured、对应提示词非空；任务从 draft 转 queued 后入 Redis。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/TaskDrawer.jsx:26`、`:27`、`:78`、`:85`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/BatchTaskModal.jsx:98`、`:101`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_task_handlers.go:216`、`:226`、`:242`、`:252`、`:267`、`:275`、`:282`。
- Worker 产物保存：worker 消费队列、调用 adapter、下载模型结果、写对象存储和 generated media；缺 worker 配置、adapter、对象存储、可下载 HTTPS 结果都会失败。证据：`/Users/ming/Downloads/qiantie/backend/internal/shuihuo/tasks/worker.go:63`、`:83`、`:151`、`:172`、`:181`、`:184`、`:192`、`:264`。
- 导入文件、媒体上传、导出均依赖对象存储；数据库缺失时多数写接口由 `requireShuihuoDatabase` 阻断。证据：`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_handlers.go:202`、`:504`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_media_handlers.go:46`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_export_handlers.go:22`。

## 6. 前端禁用或阶段性关闭

- AI 推理：当前工作台工具栏和分镜调整弹窗在 `!textReady` 时禁用 AI 推理。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:56`、`:203`、`:206`。
- 批量生成：当前工作台批量操作下拉中的图片/视频/配音项分别受 `imageReady/videoReady/audioReady` 控制；批量操作按钮本身还要求已确认分镜。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:53`、`:54`、`:55`、`:57`、`:200`、`:203`。
- 行级图生视频：StoryboardRow 要求视频模型 ready 且已有主图；文生视频文案明确“暂未接入后端，不能提交任务”。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/StoryboardRow.jsx:46`、`:47`、`:51`、`:86`。

## 7. 后端已实现但前端未完全开放

- 图片/视频提示词候选：前端 API 包装、`PromptCandidatesModal` 和 Go handler 存在，但当前 `ShuihuoProductionPage` 挂载的是 `CommentaryWorkbench`，该组件未导入/渲染 `PromptCandidatesModal`，当前可见提示词入口主要是手动编辑和放大编辑字段。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx:136`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:8`、`:207`、`:208`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/PromptCandidatesModal.jsx:19`、`:28`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_prompt_generation_handlers.go:39`、`:144`。
- 素材删除：`deleteMedia` 前端 API 包装和 Go handler 存在，旧组件路径也有删除入口；当前 `CommentaryWorkbench`/`StoryboardRow` 主路径未看到删除素材按钮。证据：`/Users/ming/Downloads/qiantie/frontend/src/shared/api/shuihuoProduction.js:51`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/router.go:97`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_media_handlers.go:155`。
- 默认生产配置：`getProductionConfig/saveProductionConfig` API、Go handler 和 `ProductionConfigModal` 存在，但当前 `CommentaryWorkbench` 主路径使用的是只读模型列表式“引擎配置”，未开放默认配置保存入口。证据：`/Users/ming/Downloads/qiantie/frontend/src/shared/api/shuihuoProduction.js:17`、`:18`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:188`、`:190`、`:212`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/ProductionConfigModal.jsx:18`、`:30`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_config_handlers.go:10`、`:23`。
- Admin 模型列表/创建 route 注册在 owner 下，但 `handleListAdminModels` 当前只返回空列表；这不应被当作已完成管理后台。证据：`/Users/ming/Downloads/qiantie/backend/internal/httpapi/router.go:118`、`:119`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_handlers.go:522`。

## 8. 候选/人工审核机制

- 分段候选：当前创建流程的段落识别、工作台固定分段和 AI 推理都先返回 `status: candidate` 或本地 candidates；只有用户点击“确认分镜/确认分段”后才写 confirmed segments。证据：`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_segmentation_handlers.go:52`、`:69`、`:130`、`:257`、`:281`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:98`、`:105`、`:108`、`:111`、`:206`。
- AI 资产分析：Go handler 注释明确本请求 always returns candidates and never mutates assets；采纳接口才创建 `Source: "ai_candidate"` 的资产。证据：`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_analysis_handlers.go:86`、`:88`、`:26`、`:53`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/AssetsView.jsx:58`、`:63`、`:76`。
- 图片/视频提示词候选：后端/API 与 `PromptCandidatesModal` 仍是候选/人工应用设计，apply 会跳过锁定分镜；但该 modal 不在当前挂载的 `CommentaryWorkbench` 路径中作为可见入口。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/PromptCandidatesModal.jsx:28`、`:33`、`:43`、`:44`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:8`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/shuihuo_prompt_generation_handlers.go:144`、`:177`、`:187`、`:193`。

## 9. 虚拟或空转功能

- 当前指定文件内未发现“只弹提示且完全无 API”的核心生产功能；主要问题是依赖未就绪或前端禁用，而不是无后端空转。
- 旧 `StudioView` 的“新增分段”属于未挂载旧组件/遗留 API 包装断链：`ShuihuoProductionPage` 当前实际挂载 `CommentaryWorkbench`；旧 `StudioView` 保存新增时调用 `createSegment(project.id, editing)`，前端 API 包装为 `POST /projects/{id}/segments`，但当前 Go router 未注册该路由。当前可见“后方新增”走 `insertStoryboard` / `insert-after`，不受这个旧断链影响。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx:136`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/StudioView.jsx:62`、`:66`、`:135`；`/Users/ming/Downloads/qiantie/frontend/src/shared/api/shuihuoProduction.js:38`；`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx:149`、`:152`、`:211`；`/Users/ming/Downloads/qiantie/backend/internal/httpapi/router.go:109`、`:110`、`:111`、`:112`、`:113`、`:114`、`:115`。
- `ProjectsView` 的“创建合集”开关只影响本地 UI 状态，本轮在提交 payload 中未看到合集字段传入 `onCreate/importProject`，因此该开关目前不形成可追踪的后端副作用。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/ProjectsView.jsx:26`、`:41`、`:54`、`:62`、`:65`、`:116`。
- `ProjectsView` 的“全部合集”筛选按钮点击后仍设为 `all`，且过滤逻辑只允许 `collection === 'all'`，本轮未见真实合集查询/切换。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/ProjectsView.jsx:24`、`:76`、`:80`、`:101`。
- 行级“播放已生成配音”按钮在有音频时只解除 disabled，本身未绑定播放逻辑；真实播放由下方 audio media preview 承担。证据：`/Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo/StoryboardRow.jsx:82`、`:33`。

## 10. 洛水2026对照缺口

| 洛水能力 | 洛水证据字段 | 水货当前对应 | 缺口 | 优先级 |
| --- | --- | --- | --- | --- |
| 负面词 / negative_prompt | `screenplay_shots.negative_prompt`；`storyboards.negative_prompt` | `Segment` 只有 `ImagePrompt`、`VideoPrompt` 与锁定字段，未见 `NegativePrompt` | 当前不能按分镜保存负面词，也无法进入图片/视频任务输入和剪映导出；需要先补 domain/store/API/UI/export 字段，再接入生成任务 payload | P0 |
| 配音行字段 | `dubbing_shots.character_name`、`script_text`、`emotion`、`emotion_intensity`、`speed`、`volume`、`pitch`、`voice_id`、`audio_path`、`audio_duration`、`status`；`storyboard_voices.text`、`emotion`、`emotion_weight`、`speed`、`audio_path`、`audio_duration`、`status`、`volume` | 水货 `Segment` 只有 `SubtitleText`；`Media` 可记录 audio kind 与 `DurationMS`；`Task` 可提交 audio kind/status，但没有分镜内多配音行模型 | 配音仍是“按分镜生成/上传一个音频”的媒体绑定，缺可编辑配音台词行、说话人、情绪、语速、音量、音高、生成状态和音频时长的独立结构 | P0 |
| 音色 / voice 表 | `screenplay_voices.character_id`、`voice_name`、`voice_id`、`voice_settings`；`project_speakers.name`、`voice_id`、`voice_settings`、`is_narrator`、`sort_order` | 水货把音色作为 `Asset.Category` 的一种人工资产；`AssetGenerationConfig` 有 `AudioModelID`，但无 voice 表 | 音色缺少角色绑定、旁白标记、排序、provider voice_id 与 voice_settings；批量配音无法稳定从角色/旁白映射到音色 | P0 |
| 多候选图片集合 | `screenplay_shots.image_collection`；`storyboards.image_collection` | 水货 `Media` 支持同一 `SegmentID` 多张 image，`IsPrimary` 标记主图；没有显式 image_collection 字段 | 已有多媒体记录可承载候选集合，但缺“候选组/批次/来源/选择状态”的语义；导出和图生视频只可稳定依赖主图，无法保留候选集决策过程 | P1 |
| 视频/音频/图片路径与状态 | `screenplay_shots.image_path`、`video_path`、`voice_path`、`status`；`storyboards.image_path`、`cover_path`、`keyframe_path`、`video_path`、`audio_path`、`status` | 水货 `Media.ObjectKey` 保存对象路径，`Kind` 区分图片/视频/音频，`Task.Status` 保存生成状态；`Segment` 本身无媒体路径和综合状态字段 | 文件路径被拆到 `Media`，生成状态被拆到 `Task`，这是可接受的工程拆分；缺口是 read model/export 层需要聚合出每条分镜的 image/video/audio/cover/keyframe 路径与最终可用状态 | P0 |
| 导出入口和 ZIP | 洛水 `projects.output_path`、`audio_path` 与分镜媒体路径字段支撑产物组织 | 水货当前 `CommentaryWorkbench` 有“导出剪映”按钮，后端 `BuildZIP` 读取 read model 与对象存储 | 源码链路已落地，但未验证登录态真实项目导出；P0 需要定义 ZIP 必含清单、缺素材降级策略、字幕/配音/图片/视频路径映射和导出前完整性检查 | P0 |
| 提示词社区元数据 | `prompts.name`、`description`、`prompt_type`、`content`、`creator`、`likes`、`stars`、`dislikes`、`is_saved`、`is_shared` | 水货有提示词仓库/预设依赖和 `PromptVersionID` 快照引用；Task 2 显示智能分段、资产分析、提示词候选均依赖预设仓库 | 当前生产工具不应复制洛水社区账号/远端数据；但需要本地可管理的 prompt template 元数据、版本、类型、启用状态与收藏/复用入口，否则“当前未发布预设”会阻塞生产 | P1 |
| 角色/场景/道具参考图 | `screenplay_characters.reference_image`、`screenplay_scenes.reference_image`、`screenplay_props.reference_image`，并有 `image_prompt` | 水货 `Asset` 有 `Category`、`Prompt`、`ReferenceObjectKey`；`AssetTemplate` 也有 `ReferenceObjectKey` | 字段能力基本对齐，但 Task 2 只证明人工资产 CRUD 和 AI 候选采纳；还缺从资产参考图进入图片/视频任务 payload、导出清单、以及角色/场景/道具与分镜的可视绑定校验 | P0 |
| 字幕时间码 / 持续时长 | `storyboards.start_time`、`end_time`、`duration_sec`、`duration_calc`、`timecode_global`；`subtitles.start_time`、`end_time` | 水货 `Segment` 没有 start/end/duration/timecode；`Media.DurationMS` 只描述媒体时长 | 导入 SRT 后没有在 domain 层保留分镜时间码；剪映导出和配音对齐缺稳定时间轴来源。P0 至少要保存字幕 start/end 与导出 duration，P1 再补自动计算/重算策略 | P0 |
| 当前未挂载的提示词候选 | 洛水 `prompts.prompt_type` + 分镜 `positive_prompt`/`video_prompt`/`negative_prompt` 支撑候选应用 | 水货后端/API/`PromptCandidatesModal` 存在，Task 2 判定当前 `CommentaryWorkbench` 未导入/渲染该 modal | 不是后端空转，而是当前主路径不可见；需要把图片/视频/负面词候选入口挂到 `CommentaryWorkbench`，保留候选预览、锁定跳过、人工应用和 prompt snapshot | P0 |

## 11. 最小可用工具补齐路线

### P0：形成可用生产闭环

目标是让一个已登录用户能从原文/SRT 进入工作台，完成分镜、提示词、参考图、配音、生成/上传素材、完整性检查和 ZIP 导出。P0 不承诺复制洛水私有源码、账号社区、密钥或远端数据，只补齐水货自有工具的最小字段、入口和导出闭环。

- 分镜字段补齐：在 `Segment`/store/API/UI 中加入 `negativePrompt`、字幕 `startTime/endTime/duration`、分镜综合状态或 read model 聚合状态；兼容旧数据为空值。
- 配音最小结构：新增或等价实现分镜配音行，字段至少包括 `segmentId`、`speaker/character`、`text`、`emotion`、`speed`、`volume`、`pitch`、`voiceId`、`audioMediaId/audioObjectKey`、`durationMs`、`status`；先支持每分镜一行，结构预留多行。
- 音色最小表：把“音色资产”提升为可被配音行引用的 voice/speaker 配置，支持角色、旁白、voice_id、voice_settings 和排序；不保存 provider 密钥。
- 当前工作台入口补齐：把已存在但未挂载的 `PromptCandidatesModal` 接回 `CommentaryWorkbench`，覆盖图片、视频、负面词候选；生成候选不直接覆盖已锁定字段，必须人工应用。
- 参考图进入任务：让角色/场景/道具 `ReferenceObjectKey` 和分镜绑定关系进入图片/视频任务输入快照；失败时在任务事件中明确提示缺参考图、缺主图或缺模型配置。
- 媒体状态聚合：read model 为每条分镜返回主图、视频、音频、封面/关键帧、生成任务状态和缺失项；前端在批量生成、图生视频、导出前使用同一套 readiness。
- ZIP 导出契约：固定导出清单，至少包含 `storyboard.json`、字幕/时间轴文件、配音映射、图片/视频/音频素材目录、缺失素材报告；缺非关键素材时可导出并写 warnings，缺分镜或关键对象读取失败时阻断。
- 验证闭环：补静态/单元测试覆盖字段序列化、候选应用、read model 聚合、ZIP manifest；再用一个无真实模型费用的本地项目验证“粘贴/导入 -> 确认分镜 -> 手工上传素材/绑定音色 -> 导出 ZIP”。

### P1：提高生产效率与可追溯性

- 多候选图片集合：在 `Media` 或独立集合表上增加 batch/source/selected/rejected 元数据，保留每次生成候选组，并明确主图选择历史。
- 提示词模板管理：建设本地 prompt template 元数据，包含 name、description、type、content、version、creator/local owner、enabled、saved/shared-like 标记；只迁移字段范式，不拉取洛水社区账号或远端内容。
- 字幕时间轴增强：SRT 导入保留原始字幕行，分镜合并/拆分/重排时重算 `duration_calc` 和全局 timecode，并在 UI 中显示冲突/空洞。
- 导出预检面板：在导出按钮前增加完整性报告，列出每条分镜的字幕、负面词、图片、视频、配音、参考图、音色和任务状态，支持跳转修复。
- 默认生产配置入口：把已有 `ProductionConfigModal` 或等价设置接回主工作台，保存默认文本/图片/视频/音频模型、剪映目录、提示词前后缀等非凭据配置。

### P2：规模化与协作增强

- 批量生产策略：支持按缺失项批量生成、按失败原因重试、按候选质量筛选主图，避免整项目重复跑。
- 素材复用库：把角色/场景/道具模板与参考图沉淀为项目内/账号内可复用库，并保留来源项目和版本。
- 导出格式扩展：在剪映 ZIP 之外增加纯素材包、CSV/JSON 台账、配音审听包、模型任务审计包。
- 生产质量看板：按项目统计缺字幕、缺负面词、缺主图、缺配音、任务失败、导出 warnings，帮助用户先补最影响成片的断点。
- 社区能力边界：若后续需要类似洛水的提示词社区，只做自有账号体系内的收藏、评分和共享；不得依赖或复制洛水私有账号数据、密钥、远端社区内容。

## 12. 验证记录

### 静态源码证据

- 前端关键词扫描命中按钮、弹窗、抽屉、禁用状态、任务提交、批量任务、导出、上传/下载素材、提示词候选、资产分析、分段、预设等入口相关文件与代码片段。重点文件包括 `StudioView.jsx`、`CommentaryWorkbench.jsx`、`TaskDrawer.jsx`、`BatchTaskModal.jsx`、`AssetsView.jsx`、`PromptCandidatesModal.jsx`、`MediaModal.jsx`、`ProductionConfigModal.jsx`、`ProjectFilesModal.jsx`、`SegmentProductionCard.jsx`、`StoryboardRow.jsx`、`ProjectsView.jsx`、`SegmentationModeModal.jsx`。
- 静态读取显示，前端 API 契约在 `/api/shuihuo-production` 下定义了项目、导入、配置、资产类型/模板、分段、资产分析、提示词候选、分镜编辑、媒体上传/下载、导出、模型、任务、批量任务、取消与重试等包装函数。
- 静态读取显示，Node 网关代码路径会让水货 API 经过 `apiAuth`，再转发到默认 `http://127.0.0.1:4000`；桥接请求包含用户、owner、签名和时间戳。智能分段路径包含读取并注入 `shuihuo-smart-segmentation` 系统预设的逻辑，但本轮没有验证该预设在当前数据库中已发布。
- 静态读取显示，Go 路由中 `/shuihuo-production` 组注册了 health/config/projects/export/files/source/assets/media/models/tasks/segmentation/analysis/storyboard/admin 等路由，且受 `requirePlatformAuth` 保护，admin 模型与对象清理路由额外要求 owner。
- 静态读取显示，Go 后端目录包含 domain、documents、segmentation、assets、prompts、models、providers、storage、store、tasks、export 等包；其中可见 Redis queue、worker、poller、local/minio/tos storage、export service、model adapter 与 store 代码。该证据只证明代码结构存在，不证明依赖已配置、worker 已启动或任务能完成。

### 运行态 HTTP/端口证据

- `curl -I http://127.0.0.1:3000/shuihuo-production` 返回 HTTP 200，证明 Express 当前能返回页面入口 HTML。
- `curl http://127.0.0.1:3000/shuihuo-production` 返回 React HTML 入口，证明前端资源入口可被服务端返回。
- `lsof` 显示本机 `3000` 有 `node` 进程监听，`4000` 有 `.qiantie-` 进程监听。
- 以上运行态检查不证明登录后页面渲染成功、不证明水货 API 鉴权通过、不证明数据库/Redis/对象存储健康、不证明模型任务生产链可跑通。

### 洛水本地 evidence index

- 洛水 evidence index 显示本地包中有 `screenplay_shots`、`storyboards`、`dubbing_shots`、`storyboard_voices`、`screenplay_voices`、`screenplay_characters`、`screenplay_scenes`、`screenplay_props`、`prompts` 等表结构字段。
- 该证据只用于字段/流程对照，不证明远端社区或运行态能力。

### 已运行命令

```bash
rg -n "Button|Modal|Drawer|message\.|disabled|title=|onClick|createTask|createBatchTasks|exportProject|uploadMedia|generatePromptCandidates|analyzeAssets|listTasks|cancelTask|retryTask|downloadMedia|导出|配音|视频|图片|素材|分段|预设" \
  /Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx \
  /Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo \
  /Users/ming/Downloads/qiantie/frontend/src/shared/api/shuihuoProduction.js
```

结果：命令成功；输出包含计划预期的主要 UI 组件和前端 API 包装。输出量较大，终端显示被截断，因此后续补充了窄范围 `nl`/`rg` 抽样定位。

```bash
rg -n "shuihuo-production|handle.*Shuihuo|createShuihuoTask|BuildZIP|Worker|ProviderConfigured|Queue|Object|Export|Media|PromptCandidates|AssetAnalysis" \
  /Users/ming/Downloads/qiantie/routes/shuihuo-production.js \
  /Users/ming/Downloads/qiantie/backend/internal/httpapi \
  /Users/ming/Downloads/qiantie/backend/internal/shuihuo
```

结果：命令成功；输出包含 Node bridge signing、Go route registration、handlers、worker、queue、storage/object、export、model provider configuration 等证据。输出量较大，终端显示被截断，因此后续补充了窄范围 `nl`/`rg` 抽样定位。

```bash
curl -sS -I http://127.0.0.1:3000/shuihuo-production
```

结果：HTTP 200；`X-Powered-By: Express`；`Content-Type: text/html; charset=utf-8`；`Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`；`Content-Length: 570`。

```bash
curl -sS http://127.0.0.1:3000/shuihuo-production | head -n 30
```

结果：返回 React HTML 入口，标题为“一战晟铭”，加载 `/assets/user-CxWywCIx.js`、`/assets/createLucideIcon-BJGIhDZx.js`、`/assets/createLucideIcon-Dc8JUspE.css`、`/assets/user-TPPdIvpX.css`。

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

结果：`node` 进程监听 `*:3000`。

```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN
```

结果：`.qiantie-` 进程监听 `127.0.0.1:4000`。

### 补充定位命令

补充使用 `find`、`sed`、`nl` 和窄范围 `rg` 对关键文件做行号定位，避免大范围 `rg` 输出截断导致证据不可追踪。详细命令如下：

```bash
find /Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo /Users/ming/Downloads/qiantie/backend/internal/shuihuo -type f \( -name '*.jsx' -o -name '*.go' \) | sort
sed -n '1,220p' /Users/ming/Documents/小说前贴/docs/reverse/luoshui2026-prompt-community/evidence_index.md
nl -ba /Users/ming/Downloads/qiantie/frontend/src/shared/api/shuihuoProduction.js | sed -n '1,90p'
nl -ba /Users/ming/Downloads/qiantie/backend/internal/httpapi/router.go | sed -n '60,125p'
nl -ba /Users/ming/Downloads/qiantie/routes/shuihuo-production.js | sed -n '1,115p'
rg -n "exportProject|导出|disabled|createTask|createBatchTasks|generatePromptCandidates|analyzeAssets|uploadMedia|downloadMedia|ProviderConfigured|Redis|存储|模型" /Users/ming/Downloads/qiantie/frontend/src/user/pages/shuihuo /Users/ming/Downloads/qiantie/frontend/src/user/pages/ShuihuoProductionPage.jsx
```

结果：用于收敛行号和证据范围；未访问凭据或受保护数据。
