# V88 本地执行器 readiness 回迁记录

- 来源：`fix/v88-local-executor-readiness-contract-20260909`
- 目标：仅回迁共享前端 readiness 解析，不整支合并旧分支。
- 根因：Go `Service.List()` 已按 45 秒心跳阈值计算 online，Node 水货生产路由已统一签名透传；前端设置页只读取 `executors`，剧本页自行兼容 `executors/items`，共享 API 层缺少统一响应归一化。
- TDD：先新增 `frontend/src/shared/api/localExecutors.test.js`，当前 v88 因模块不存在应 RED；随后仅新增共享解析模块并在 `apiRequest()` 的 local-executors 响应路径归一化。
- 边界：不改本地执行器配对协议、Go 在线阈值、Node bridge 签名、视频任务提交、下载或公网部署。
