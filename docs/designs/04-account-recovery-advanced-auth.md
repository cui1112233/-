# 04 · 账号恢复与高级认证 / Account Recovery & Advanced Auth

## 目标

在 03 的 Team / MFA / 邀请 / 通知基础上，补齐正式账号体系需要的恢复、无密码登录、联合治理与不可逆删除能力，同时保持 01-03 的角色、团队 API、额度、Usage 与审计语义不变。

## 功能范围

### 1. 邮箱验证
- 个人资料中的邮箱必须先保存，再单独发起验证。
- 验证链接使用一次性随机 token，仅保存摘要，30 分钟过期。
- 邮箱变更后原验证状态自动失效。
- 未配置邮件发送通道时明确返回 `MAIL_UNAVAILABLE`，不得显示“发送成功”。

### 2. 邮件找回密码
- 仅已验证邮箱可用于找回密码。
- 申请接口对存在/不存在邮箱返回相同文案，避免账号枚举。
- 重置 token 一次性、30 分钟有效。
- 重置成功后撤销该账号全部运行时与持久登录会话。

### 3. Passkey / WebAuthn
- Passkey 与密码登录并列，不替代现有密码登录能力。
- 绑定新 Passkey 前必须再次校验当前密码。
- 注册和登录 challenge 5 分钟有效且单次消费。
- 服务端校验 Origin、RP ID、RP ID hash、credential ID、签名与签名计数器。
- Passkey 登录要求 User Presence + User Verification；浏览器应触发 Windows Hello、Touch ID、Face ID、PIN 或硬件安全密钥验证。
- 私钥始终保留在用户设备，服务端只保存公钥与凭据元数据。
- Passkey 登录成功后生成与密码登录一致的 session / remember session。

### 4. Team 联合管理员
- Team 保留唯一 Primary Manager。
- `coManagers[]` 仅允许引用可用的 MANAGER 账号，最多 20 人。
- Primary Manager / DEV 可设置联合管理员；Co-Manager 无权继续委派其他 Co-Manager。
- Co-Manager 可治理被委派 Team 的成员账号状态、密码重置、API scopes、成员额度与团队总额度。
- Co-Manager 不可替换 Primary Manager，也不能越权管理未委派 Team。

### 5. 永久账号清除
- 仅 DEV 可执行，Owner 不可删除。
- 仅允许对已经归档并停用的 MEMBER 执行；MANAGER / DEV 必须先完成角色和团队关系调整。
- 需要 DEV 当前密码 + 完整目标账号名二次确认。
- 清除：运行时/持久会话、MFA、Passkey、API scopes、个人资料、头像、恢复 token，并将密码替换为不可知随机值。
- 保留：账号最小审计墓碑、历史 usage、团队/系统审计记录。
- tombstone 创建后，旧的恢复、重置密码、重新授权、再次 purge 等写操作必须拒绝，不能复活账号。

## UI

### 登录
- 保留原密码 + MFA 登录。
- 增加“使用 Passkey”入口；用户先填写账号，再由系统认证器完成强认证。
- 增加“忘记密码”进入 `/recover`。

### 个人资料
- 邮箱旁显示：未验证 / 已验证 / 邮件通道未配置。
- 邮箱变更后立即刷新验证状态。

### 账号安全
- Password / MFA / Passkey / Active Sessions 同屏。
- Passkey 列表显示创建时间、最近使用时间和删除入口。
- 添加 Passkey 前弹出当前密码确认，然后调用系统 WebAuthn UI。

### 联合治理
- `/advanced-team-admin` 作为账号中心独立治理页。
- Primary Manager 管理本 Team Co-Manager。
- DEV 可查看所有 Team，并对已归档 MEMBER 执行永久清除。

## 不伪造的能力

- SMS 手机验证码：未配置真实短信通道前不显示“已发送”。
- Enterprise SSO / SAML / OIDC：没有真实企业 IdP 前不模拟成功登录。
- 邮件供应商：代码只定义可注入 Mailer；生产环境未配置 SMTP/API 时功能明确不可用。

## 验收标准

04 专项 CI 必须同时通过：
1. Email verification / password recovery acceptance。
2. Passkey current-password enrollment guard。
3. P-256 Passkey signature + RP hash + UV + counter replay validation。
4. Co-Manager delegation / forbidden boundary。
5. Permanent purge + tombstone no-resurrection + usage retained。
6. 01 / 02 / 03 核心 acceptance 回归。
7. Agent injected-responder regression tests。
8. Frontend production build。

04 未通过上述最终 head CI 前，不标记为完成，也不合并 03 / 02 / 01 / master。
