# 左上角品牌流光设计

## 目标

为用户端左上角品牌提供两种独立、低频的动态视觉效果：Logo 图片表面扫光，以及“一战晟铭”文字在金色、暖白和强调色之间持续渐变。

## 范围

- 仅作用于 `.legacy-brand` 内的 `.legacy-brand-logo` 与 `.legacy-brand-title`。
- 不修改 `BrandLogo` 组件、原始图片资源、`UserLayout.jsx` 结构或品牌链接行为。
- 不改变侧边栏折叠规则；折叠时现有隐藏逻辑继续生效。
- 深色和浅色主题均复用同一动画，保留主题现有的黑白 Logo 图片切换。

## 实现

- 为 `.legacy-brand-logo` 建立裁切边界，并使用 `::after` 添加斜向半透明暖白高光层。
- 通过 `brand-logo-sheen` 关键帧让高光从左向右穿过 Logo 表面；伪元素不接收鼠标事件。
- 将 `.legacy-brand-title` 的文字颜色替换为背景裁切渐变，以 `brand-title-shift` 关键帧循环改变背景位置，实现持续金色、暖白与 `--legacy-accent` 的变色。
- 在 `prefers-reduced-motion: reduce` 下关闭 Logo 和标题动画。

## 验收

1. `.legacy-brand-logo::after` 使用 `brand-logo-sheen` 动画，且不会遮挡链接点击。
2. `.legacy-brand-title` 使用 `brand-title-shift` 动画和文字背景裁切。
3. 两个关键帧均存在。
4. 降低动态效果设置时两个动画均停止。
5. 现有会员页面滚动与会员身份流光契约测试继续通过。
