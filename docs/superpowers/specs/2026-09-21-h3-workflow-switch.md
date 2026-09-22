# H3 工作流 ID 切换规格

## 目标

管理员可以在 API 配置页修改 MiniMax H3 的 AutoDL ComfyUI 工作流 ID；剧本分镜生成读取已保存的工作流 ID，并按该 ID 提交任务。切换 `minimax_h3_image_audio_to_video_v2` 到 `minimax_h3_lightx2v_no_pic` 时不需要改代码。

## 行为

- H3 平台预设继续使用原有 API Key 和服务端 Token 边界。
- H3 记录新增 `workflowId`，仅允许字母、数字、下划线和短横线，长度不超过 120。
- 空的 `workflowId` 使用兼容默认值 `minimax_h3_image_audio_to_video_v2`。
- `minimax_h3_lightx2v_no_pic` 不发送参考图；页面生成时仍可保留分镜参考图状态，但提交 payload 会清空参考图字段。
- 其他合法工作流 ID 继续使用通用 H3 参数：`prompt`、`duration`、`resolution`，以及传入的 `ref_image_N`。
- 服务端不能接受前端传入的 Base URL、Authorization 或脚本；请求仍固定到 AutoDL HTTPS 服务地址。
- 现有任务 ID 前缀、轮询、结果解析和非 H3 视频模型行为不变。
- 批量工厂 V11 的 H3 provider bridge 同样使用已保存的工作流 ID，避免剧本页和批量工厂使用不同工作流。

## UI

- API 配置页的 MiniMax H3 预设增加“AutoDL 工作流 ID”输入框，显示当前值并允许修改。
- 剧本页的视频模型下拉继续只显示已启用模型；生成按钮不增加额外步骤。

## 验收

- 保存 `minimax_h3_lightx2v_no_pic` 后，服务端提交路径包含该工作流 ID。
- no_pic payload 不包含 `ref_image_0`。
- 保存 `minimax_h3_image_audio_to_video_v2` 后，payload 可保留参考图字段。
- 非法工作流 ID 被拒绝，API Key 不出现在公开模型响应中。
- H3 现有提交、轮询和前端构建回归通过。
