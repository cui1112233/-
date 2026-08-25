# 05 · 账号中心视觉还原重构 / Account Center Visual Fidelity Rebuild

## 目标

冻结 01-04 已验收功能，不新增账号能力，只重构账号中心视觉层。解决“功能能用但更新后布局散乱、和设计图不一致”的问题。

## 原因确认

1. `global.css`、`member-center.css`、`team-governance.css`、`team-collaboration.css` 多层增量样式同时作用于同一 DOM。
2. 03 协作样式引用了账号中心不存在的 `--text-secondary` / `--border-subtle` 变量。
3. 04 `AdvancedTeamAdminPage` 使用 `.ac-delegated-team`，此前没有完整组件样式。
4. 联合治理成员表是 6 列 DOM，但复用了普通团队表的 7 列 grid template。
5. 旧响应式主要按浏览器 viewport 判断，没有扣除固定侧栏，导致常见桌面宽度下内容区提前被挤坏。

## 设计原则

- 所有账号中心路由统一使用一套最终视觉 Token。
- 最终视觉样式 `account-center-visual-rebuild.css` 必须最后加载，禁止旧工作区 CSS 覆盖它。
- 深色模式为主视觉：深黑蓝背景、低对比细边框、克制阴影、金色 DEV 身份重点、珊瑚色导航状态。
- `/member` 保持设计稿核心构图：大身份 Hero + 主数据区 + 紧凑右侧 Rail。
- Panel、Metric、Form、Table、Tag、Button、Progress 使用同一圆角、间距和层级。
- 账号中心响应式以 `.legacy-content` 实际内容宽度作为 container query 基准，而不是浏览器总宽度。
- 不修改 API、路由权限、角色、额度、MFA、Passkey、团队、邀请、用量等业务语义。

## 固定布局

- Account sidebar: 232px；折叠 68px。
- Topbar: 72px。
- Page max width: 1420px。
- Page padding: desktop 30/34/64；tablet 24；mobile 14。
- Member dashboard: main `1fr` + right rail `326px`。
- Identity hero: desktop 双区，内容宽度不足时自动转单列。
- 三张 dashboard card 在内容区不足时先变 2+1，再变单列。

## 回归约束

专项测试必须检查：
- 最终视觉 CSS 的 import 顺序。
- container query 存在且使用真实内容宽度。
- 03 缺失变量已桥接。
- `.ac-delegated-team` 不会回退为浏览器默认 button。
- `/member` 主区 + 326px 右 Rail 与 Hero 结构保持。
- 04 联合治理使用 6 列专用 grid。
- frontend production build 通过。
- 01-04 acceptance 回归通过。
- `server.js` 真实启动后所有账号中心路由可直接访问。
