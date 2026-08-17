# 一战晟铭 UI 视觉重设计 规范

## 概况
- 纯 CSS 驱动升级，零 JS 结构改动
- 暗色/亮色双模，玻璃态风格
- 覆盖全页面组件 + 动画微交互 + 响应式适配

## 色彩体系

### 暗色模式
- bg-primary: #0a0a14
- bg-secondary: #12121f
- bg-panel: rgba(22,22,46,0.7)
- bg-card: rgba(30,30,54,0.6)
- bg-card-hover: rgba(40,40,70,0.7)
- bg-input: rgba(10,10,24,0.6)
- text-primary: #e8e8f0
- text-secondary: #8b8ba0
- text-muted: #555570
- accent: #f07167
- accent-hover: #f08a7d
- border: rgba(255,255,255,0.06)
- border-light: rgba(255,255,255,0.1)

### 亮色模式
- bg-primary: #f5f5f7
- bg-secondary: #eeeef2
- bg-panel: rgba(255,255,255,0.75)
- bg-card: rgba(255,255,255,0.6)
- bg-card-hover: rgba(255,255,255,0.85)
- bg-input: rgba(240,240,244,0.7)
- text-primary: #1a1a2e
- text-secondary: #6b6b80
- text-muted: #9999aa
- 强调色同暗色模式
- border: rgba(0,0,0,0.06)
- border-light: rgba(0,0,0,0.1)

## 玻璃态效果
- backdrop-filter: blur(20px) saturate(180%)
- 面板级半透明背景
- 边框使用极淡的白色/黑色

## 组件设计

### 侧边栏
- 玻璃态面板，激活项左侧 3px 指示条
- 底部主题切换按钮
- 收起动画 cubic-bezier(0.4,0,0.2,1)

### 输入区
- 圆角 12px，聚焦外发光
- 生成按钮渐变背景 + hover 上浮

### 卡片
- 玻璃态，hover 缩放 1.01 + 阴影提升
- 展开/收起动画

### 格式标签
- Pill 风格，激活态填充背景

### 模态框
- 入场 scale(0.95)→scale(1) + 淡入
- 玻璃态背景 + 强模糊

### Toast
- 弹性滑入，左侧彩色边框

## 响应式
- ≥1024px: 完整布局
- 768-1023px: 侧边栏图标模式
- <768px: 面板堆叠，汉堡菜单