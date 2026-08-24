# 01 · 曜金会员中枢 / Aurum Member Hub

- **设计序号**：01
- **设计名称**：曜金会员中枢（Aurum Member Hub）
- **分支**：`01-aurum-member-hub`
- **状态**：V1 验证中

## 设计定位

把 qiantie 原来的“登录账号 + 设置页”升级为“会员身份中心 + 团队资源管理中心”。账号 `username` 继续作为稳定登录 ID；用户可修改 `displayName` 和头像，产品界面优先展示显示名称与身份徽章。

## 身份体系

### DEV · 金色

- Owner 永久拥有 DEV 有效身份，且不可被降级或替代。
- DEV 可创建 DEV / MANAGER / MEMBER。
- DEV 可调整角色、转移成员、管理团队 API 授权与额度。
- DEV 兼容旧后台 `account:review`、`preset:draft`、`preset:publish` 能力。

### MANAGER · 蓝色

- 可创建 MEMBER；新成员自动绑定到当前 MANAGER。
- 仅可管理自己旗下 MEMBER。
- 可开启/关闭旗下 MEMBER 的团队 API 使用权限。
- 可调整旗下 MEMBER 的月度 Token 额度。
- 可查看自己团队的成员用量。

### MEMBER · 灰绿

- 默认身份。
- 必须绑定有效 MANAGER 且拥有 `api:use` 才能调用团队模型。
- 不显示、不读取、不写入 MANAGER 的 API Key。
- 无独立模型连接设置权限；宠物等个人偏好仍可修改。

## API 共享

每次模型调用区分：

- `username`：实际使用者。
- `billedTo`：API 配置实际归属账号。
- `teamOwner`：调用发生时的团队归属快照。
- `feature`：`chat` / `agent` / `novel-panel` 等功能来源。

MEMBER 请求模型时：

1. 校验账号状态。
2. 校验 `api:use`。
3. 校验 `boundTo`。
4. 校验 MANAGER 有效状态。
5. 校验 MEMBER 月度额度。
6. 服务端读取 MANAGER 的模型配置。
7. 调用上游并写入 Usage Ledger。

## 用量口径

- 非流式响应优先读取上游真实 `usage`。
- 流式响应请求 `stream_options.include_usage`；如上游返回 usage，记录真实 Token。
- 上游不返回 usage 时，以输入消息和响应文本做 Token 估算，并在元数据标记 `usageEstimated: true`。
- 小说面板当前以请求/响应文本估算 Token，并标记 `estimateBasis: request-response-text`；不会伪装成供应商真实账单值。
- 历史记录保存调用当时的 `teamOwner`，成员转组后不会改写旧团队消耗。

## 异常规则

- 有直属 MEMBER 的 MANAGER 不能直接降级，必须先转移成员。
- MANAGER 不能管理其他 MANAGER 旗下 MEMBER。
- 未绑定 MANAGER 的 MEMBER 不能启用团队 API。
- MEMBER 达到月度 Token 额度后，服务端在下一次调用前拒绝请求。
- MEMBER 不能通过模型连接测试接口提交临时 Key 绕过团队托管。

## 会员中心 V1

会员中心包含：

- 头像 / 显示名称 / 登录账号。
- DEV / MANAGER / MEMBER 身份徽章。
- 所属管理与 API 状态。
- 今日 / 本月调用与 Token 消耗。
- 月度额度进度。
- 最近模型调用与功能消耗构成。
- DEV / MANAGER 的团队成员列表、成员额度与 API 开关。

## 验证

分支包含专用 GitHub Actions：`.github/workflows/01-aurum-member-hub-check.yml`。

验证目标：

- `node --test tests/*.test.js`
- `npm --prefix frontend run build`
