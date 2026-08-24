# 01｜星云玻璃登录卡（Nebula Glass Login）

- 分支：`design/01-nebula-glass-login`
- 产品名称：一战晟铭
- Logo：复用仓库现有 `BrandLogo`，对应 `/assets/brand-logo-black.png` 与 `/assets/brand-logo-white.png`

## 设计定位

深色星云背景 + 半透明玻璃卡 + 红/粉/蓝动态流光。强调沉浸感，但不牺牲账号密码表单的可读性。

## 核心视觉

1. 顶部直接展示一战晟铭真实 Logo 与品牌名，不使用临时或生成 Logo。
2. 卡片采用 30px 大圆角、半透明深色玻璃和细流光边框。
3. 左侧珊瑚红、右侧冷蓝，两侧星云与卡片边缘保持同一色彩语言。
4. 标题层级：品牌 → 欢迎回来 → 继续你的一战晟铭创作工作流。
5. 输入框聚焦时只做轻量蓝光与粉色侧光，不使用高亮霓虹描边。
6. 登录按钮使用红 → 粉 → 蓝渐变，保留扫光和箭头位移反馈。
7. 保留鼠标 3D 视差、跟随光晕、登录成功 ✓ 扩散环和退场动画。
8. 移动端降低尺寸与留白，`prefers-reduced-motion` 下关闭非必要动画。

## 文件

- `frontend/src/shared/styles/login-design-01-nebula-glass.css`：01 号方案视觉覆盖层
- `frontend/src/shared/styles/login-card.css`：基础登录卡样式
- `frontend/src/shared/styles/login-card-motion.css`：3D 视差与成功态动画
- `frontend/src/user/main.jsx`：加载 01 号方案

## 后续可对比方向

- 02｜黑曜石极简登录卡
- 03｜液态极光登录卡

01 号方案作为偏沉浸、品牌感最强的版本保留，后续方案都应单独分支，避免互相覆盖。
