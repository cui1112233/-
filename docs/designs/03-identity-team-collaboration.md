# 03 · 身份与团队协作 / Identity & Team Collaboration

基于 `02 · 团队治理控制台 / Team Governance Control` 的身份、安全与协作增强版本。

## 本版目标

把 `Manager → Member` 的隐式关系升级成可识别、可邀请、可归档、可通知的团队协作系统，同时把 MFA 真正接入登录链路。

## 1. 独立 Team 实体

- 每个 MANAGER 对应一个独立 Team。
- Team 拥有独立 UUID、团队名称、Manager、创建时间和更新时间。
- 现有 `boundTo` 继续作为兼容关系，但 UI、邀请和通知优先展示 Team ID / Team Name。
- MANAGER 可修改自己团队名称；DEV 可管理所有 Team。

## 2. 一次性邀请链接

- MANAGER 可为自己的 Team 生成邀请。
- DEV 可选择 MANAGER 后为对应 Team 生成邀请。
- 邀请包含：有效期、成员默认月额度、默认 `text/image/tts` scopes。
- 邀请链接只能成功使用一次。
- 接受邀请的人自己设置登录账号、显示名称和密码。
- 服务端先原子 claim 邀请，再创建 MEMBER；创建失败会释放 claim，避免邀请被无效消耗。
- 邀请成功后成员自动 `boundTo` 对应 Manager，但永远看不到 Manager API Key。

## 3. MFA / TOTP

- 使用标准 30 秒 TOTP，6 位数字，HMAC-SHA1。
- 安全页需要当前密码才能开始 MFA 设置。
- 启用前必须用验证器生成的动态码完成校验。
- 启用后，密码正确但缺少 MFA 码的登录请求返回 `MFA_REQUIRED`，不会创建 session。
- 登录支持动态验证码或一次性恢复码。
- 默认生成 8 个恢复码；恢复码服务端只保存 SHA-256 摘要，使用一次后立即失效。
- 支持重新生成恢复码和关闭 MFA。

## 4. 站内通知

通知用于记录对账号真正有影响的事件，包括：
- 通过邀请加入团队
- 团队改名 / 转组
- API scopes 变化
- 密码被管理员重置
- 账号停用 / 恢复 / 归档
- MFA 开启 / 关闭
- 使用 MFA 恢复码登录

会员中心显示最近通知和未读状态，可一键全部标记已读。

## 5. 成员软删除 / 归档

- 归档不是物理删除。
- 归档会：停用账号、撤销登录会话、清空团队 AI scopes。
- 历史 usage、审计、账号资料继续保留。
- 恢复归档后账号重新可登录，但 AI scopes 不自动恢复，需要管理员重新授权。
- 普通“停用账号”仍作为临时冻结能力存在，与归档语义分离。

## 6. 邀请公开页

- `/invite/:token` 可在未登录状态打开。
- 页面展示 Team 名称、Manager、邀请有效期、默认额度和默认 AI scopes。
- 邀请注册页不进入登录后的 UserLayout，避免未登录用户被重定向回首页。

## 当前仍未实现

- 邮箱验证码发送与验证
- 手机短信验证码发送与验证
- 邮箱找回密码
- 企业 SSO / Passkey / WebAuthn
- 多 Manager Team
- 供应商正式账单对账
- 物理删除账号（默认不建议）

## 分支

`03-identity-team-collaboration`
