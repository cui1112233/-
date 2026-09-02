# Batch Factory V11 双视频通道接入实施计划

- 设计文档：`docs/superpowers/specs/2026-09-02-bf11-dual-video-provider-design.md`
- 实施分支：`feat/bf11-dual-video-provider-integration-20260902`
- 当前设计提交：`06d03223262fe647224c2187152c6e59aca2fe5f`

## 阶段 1：盘点与契约测试

- 对比 V11 当前 Production、Merge、Capabilities、Personal Prompt Bridge。
- 为视频 Provider 选择、个人中心配置解析、任务状态映射写失败测试。
- 为豆包执行器 API 适配、租约、验收、artifact 上传写失败测试。
- 明确不得调用旧 Node Batch Factory mutation。

## 阶段 2：个人中心 API 通道

- 在 V11 服务端增加用户视频配置的安全读取/内部同步边界。
- 实现 `yd_video` / `yd2.0-mini` 提交、轮询、媒体 URL 校验和错误归一化。
- 将 `compiledPrompt`、duration、aspect ratio 和生成参数映射到真实请求。
- 配置缺失或远程错误时 fail closed。
- 加入 API Key 不进响应和日志的测试。

## 阶段 3：豆包本地执行器通道

- 只移植执行器控制面需要的类型、客户端和服务端路由。
- 增加配对状态和在线能力查询。
- 将 V11 ProductionTask 映射到 claim/lease/progress/acceptance/result/fail/release。
- 精确绑定 job、book、VIDEO 和媒体 artifact。
- 实现上传重试不重生成以及接受后禁止再次提交。

## 阶段 4：V11 UI 接线

- 在生产统一设置加入 Provider 选择，默认个人中心 API。
- 显示个人中心配置状态和豆包执行器在线状态。
- 接通生成、重试、取消、合并、发布按钮及真实错误提示。
- 所有按钮遵守服务端 capabilities，不用前端假成功。
- 保持统一播放器和 Director 顺序合并。

## 阶段 5：全链路验证

- 后端 Go 测试。
- 前端构建和 UI/adapter 测试。
- Node 代理和执行器测试。
- 临时 Compose/网络 smoke：
  - 个人中心 API 通道配置缺失/成功/失败
  - 豆包执行器在线/离线/租约过期/上传重试
  - 提示词快照、VIDEO 状态、合并和发布
  - 密钥、Cookie、token、storage_state 日志脱敏
- 真实豆包账号登录和真实视频生成只能使用专用测试账号，不在聊天中传递密码。

## 发布闸门

只有在上述测试和隔离 smoke 全部通过后，才生成候选镜像和发布报告。未经用户明确授权，不切生产 `:3000`。
