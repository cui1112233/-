# Script Empty State Fix Report

## 状态
已修复剧本页面空状态契约失败；修改范围仅限 `frontend/src/user/pages/ScriptPage.jsx` 与 `frontend/src/shared/styles/global.css`。

## RED
执行 `node --test tests/script-empty-state-card-contract.test.js`：失败。失败原因是空状态仍为旧图标和文本，缺少卡片结构、响应式尺寸、动画、浅色主题与减少动态效果样式。

## 实现
- 空状态替换为 `script-empty-card`、dot、ray、top/bottom line、title 与 copy 结构。
- 保留文案“先提取人物与场景，确认后再生成剧本”。
- 增加 `width: min(100%, 420px)`、`min-height: 220px`、`script-empty-move-dot` 动画、浅色主题和 `prefers-reduced-motion` 样式。
- 未修改 CM 协作功能。

## GREEN 与构建
- `node --test tests/script-empty-state-card-contract.test.js`：2 通过，0 失败。
- `npm run frontend:build`：成功。Vite 仅报告现有的大 chunk 警告。
