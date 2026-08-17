# 水货生产洛水对齐可用工具审计设计

日期：2026-08-17  
项目：`/Users/ming/Downloads/qiantie`  
状态：用户已确认，待审计执行

## 1. 目标

本轮目标不是单纯指出“假功能”，而是把现有水货生产模块审计成一份可执行的融合改造依据：哪些功能已经真实写入，哪些只是前端入口或阶段性禁用，哪些依赖后端但当前环境未配置，哪些需要参考洛水2026的漫剧解说数据结构补齐，最终形成能导入、分镜、生成提示词、管理素材、提交任务、保存结果和导出的可用工具。

审计对象限定为 `/Users/ming/Downloads/qiantie` 的水货生产链路：

- React 用户页：`frontend/src/user/pages/ShuihuoProductionPage.jsx` 与 `frontend/src/user/pages/shuihuo/`
- 前端 API 契约：`frontend/src/shared/api/shuihuoProduction.js`
- Node 网关：`routes/shuihuo-production.js`
- Go 后端路由与服务：`backend/internal/httpapi/shuihuo_*.go` 与 `backend/internal/shuihuo/`
- 参考资料：`/Users/ming/Documents/小说前贴/docs/reverse/luoshui2026-prompt-community/`

前面误看的 `/Users/ming/Documents/小说前贴/web` 和 React+Go 原型不作为本轮水货生产主体，只在需要时作为历史思路参考。

## 2. 判定口径

每个功能按证据归为以下类别：

1. `已真实落地`：前端有入口，API 已接通，后端有存储或任务副作用，刷新后可恢复，错误状态真实返回。
2. `依赖可用但环境缺项`：代码链路存在，但当前需要数据库、Redis、对象存储、模型目录、凭据或 worker 健康后才可生产。
3. `前端禁用或阶段性关闭`：页面显示入口，但按钮 disabled、文案说明后续开放，或没有调用对应 API。
4. `后端契约存在但前端未暴露`：Go API 或服务已实现，用户页未接入或被 UI 禁用。
5. `候选/人工审核机制`：AI 只生成候选，必须人工采纳才写入；这不算虚拟功能，但要标注为“非自动写入”。
6. `虚拟或空转功能`：只弹提示、只改本地状态、没有 API、没有持久化、没有任务、没有真实结果保存。

所有结论必须标注证据类型：静态源码、后端路由、测试合同、真实 HTTP、浏览器 DOM、运行依赖状态。没有做过的验证不能写成已验证。

## 3. 洛水2026对齐基准

洛水2026静态提取只证明本地包和业务数据库中存在相关结构，不证明远端社区或运行态功能。可用作对齐的本地证据包括：

- `screenplay_shots`：`script_text`、`image_prompt`、`video_prompt`、`negative_prompt`、`image_path`、`image_collection`、`video_path`、`video_cover`、`duration`、`voice_text`、`voice_path`、`status`、`metadata`
- `storyboards`：`subtitle_text`、`positive_prompt`、`negative_prompt`、`video_prompt`、`image_path`、`image_collection`、`keyframe_path`、`video_path`、`audio_path`、`character_tags`、`status`、`duration_sec`
- `screenplay_characters`、`screenplay_scenes`、`screenplay_props`：名称、描述、图片提示词和参考图
- `dubbing_shots`、`storyboard_voices`、`screenplay_voices`：配音文本、音色、情绪、语速、音频路径与状态
- `prompts`：提示词类型、内容、分享/收藏元数据

水货生产不复制洛水源码、品牌、账号、密钥、授权逻辑或私有资源，只抽象其可见生产表能力和数据字段。

## 4. 审计输出

审计执行后产出一份 Markdown 报告，建议路径：

`docs/superpowers/audits/2026-08-17-shuihuo-luoshui-usable-tool-audit.md`

报告结构固定为：

1. `结论摘要`：当前水货生产离可用工具差几步，最大阻塞是什么。
2. `功能真实性矩阵`：按页面功能列出 UI、API、后端、存储、任务、产物、结论、证据文件。
3. `洛水对照缺口表`：洛水有而水货缺的字段、状态、工作流入口和导出项。
4. `互补保留清单`：现有水货生产已做得比原型更真实的部分，直接保留。
5. `必须补齐清单`：为形成可用工具必须做的最小闭环。
6. `应删除或改文案清单`：避免用户以为已生成或已导出的误导入口。
7. `验证记录`：静态、HTTP、浏览器、测试分别做了什么；没做什么也明确写出。

## 5. 最小可用工具闭环

最终工具第一阶段只承诺以下闭环：

1. 创建项目，粘贴或上传 `TXT`、`SRT`、`DOCX`。
2. 生成分段候选，人工确认后写入分镜。
3. 维护分镜字幕、配音文本、图片提示词、视频提示词和锁定状态。
4. 管理角色、场景、道具、音色资产，并绑定到分镜。
5. 上传图片、视频、音频素材并保存为项目媒体。
6. 在 Redis、对象存储、模型目录和 worker 均健康时提交图片、视频、配音任务。
7. worker 调用后端配置的模型 adapter，保存生成素材，不伪造成功。
8. 导出 ZIP，包含分镜表、提示词、资产、媒体清单和可下载素材。

剪映草稿、完整合成成片、社区提示词市场、远端洛水账号社区同步不纳入第一阶段。

## 6. 重点风险

- 当前运行态可能显示服务可访问，但数据库、Redis、存储或模型不健康时，功能只能停在候选、人工编辑和上传素材阶段。
- 前端可能已经有导出 API 包装，但按钮仍禁用；这类要区分“后端有能力”和“用户不可用”。
- 模型目录可以存在但未配置 provider 参数或凭据引用；此时提交任务应被阻止，不应算生成失败。
- AI 资产分析和提示词生成采用候选机制，必须人工采纳才写入，不应误判为自动生产。
- 洛水字段比水货当前字段更细，补齐时应优先补生产闭环字段，不一次性追求社区、收藏、点赞等非核心功能。

## 7. 执行方法

1. 静态扫描 React 页面与 API 包装，列出每个按钮和弹窗的真实调用。
2. 静态扫描 Node 网关，确认鉴权、签名、预设词注入和超时行为。
3. 静态扫描 Go 路由、store、tasks、models、storage、export，确认副作用和缺失链路。
4. 读取当前健康接口和关键 HTTP 响应，只记录不涉及凭据、cookie 或浏览器 profile 的安全信息。
5. 必要时使用已登录浏览器做页面 DOM 检查，但不读取登录数据、不绕过鉴权。
6. 将洛水证据字段映射到水货生产实体，形成缺口表。

## 8. 验收标准

- 每个“虚拟/未接入/已落地”判断都有文件路径或运行证据。
- 不把环境缺项误写成代码没做，也不把代码存在误写成当前可用。
- 报告能直接转成后续实施计划，按优先级补齐可用工具闭环。
- 不包含第三方源码、账号数据、密钥、cookie、浏览器 profile 或受保护资源内容。
