# 02 · 一战晟铭「星云流光登录舱」

## 分支

`design/02-yizhan-nebula-glass-login`

## 品牌规范

- 产品名称：**一战晟铭**
- Logo：只使用项目现有 `BrandLogo` 组件，对应 `/assets/brand-logo-black.png` 与 `/assets/brand-logo-white.png`
- 不使用示意图中的 `qiantie` 文案或虚构 Logo
- 登录主标题：`一战晟铭登录`
- 辅助文案：`继续你的创作工作流`

## 视觉方向

- 深色星空 + 红蓝星云环境光
- 半透明毛玻璃登录卡
- 红 → 粉 → 蓝动态流光边框
- 项目真实 Logo 呼吸光效
- 输入框聚焦时蓝紫柔光
- 主按钮渐变与扫光反馈
- 卡片随鼠标位置产生轻量 3D 视差

## 登录状态动效

1. 登录卡从轻微缩小、下移和模糊状态进入
2. 鼠标移动时卡片按指针位置计算 `rotateX / rotateY`
3. 登录按钮 loading 时保持渐变反馈
4. 登录成功后展示绿色 ✓ 与扩散光环
5. 成功态停留约 760ms 后卡片缩小、虚化退场并进入工作台

## 功能边界

本设计只修改登录入口的视觉和交互动效，不改变：

- 账号密码登录 API
- 30 天保持登录逻辑
- Token / 登录失效处理
- 权限判断
- 登录后页面与工作区业务逻辑

## 主要文件

- `frontend/src/shared/layouts/UserLayout.jsx`
- `frontend/src/shared/styles/login-card.css`
- `frontend/src/shared/styles/login-card-motion.css`
- `frontend/src/shared/components/BrandLogo.jsx`
