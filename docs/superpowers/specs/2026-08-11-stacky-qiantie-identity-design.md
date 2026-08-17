# Stacky 前贴形象设计

## 目标

将 Codex 原版 Stacky 精灵图作为前贴的官方宠物形象。登录后的工作页面固定展示 Stacky，并用有限的状态动画反馈当前生成任务的结果。

## 范围

- React 工作区的 `/script`、`/history`、`/tts`、`/settings` 页面在右下角显示 Stacky。
- 旧版 `/agent` 页面通过已有的 `public/js/common.js` 注入同样的 Stacky 容器。
- 首页和登录遮罩期间不显示宠物，避免遮挡首次进入与登录操作。
- 资源继续使用 `/pets/stacky/spritesheet.webp`，不生成替代形象，也不依赖 Codex 应用运行。

## 状态与动作

组件只接受四种视觉状态：`idle`、`working`、`success`、`error`。默认显示 `idle`。

- 剧本生成和配音请求开始时进入 `working`。
- 请求成功后短暂显示 `success`，再自动回到 `idle`。
- 请求失败后短暂显示 `error`，再自动回到 `idle`。
- 没有可执行任务的页面始终保持 `idle`。

状态从页面经浏览器自定义事件传递给宠物组件。这样生成页面不需要依赖布局组件的内部状态，旧版 Agent 页面也可复用同一事件协议。

## 组件边界

- `frontend/src/shared/pet/stacky.js` 定义状态名、精灵帧位置和安全的事件分发函数。
- `frontend/src/shared/pet/StackyPet.jsx` 负责读取状态事件、显示正确精灵帧、自动复位和无障碍文字。
- `UserLayout` 在已登录的非首页 React 页面挂载该组件。
- `ScriptPage` 与 `TtsPage` 在网络请求开始、成功、失败时发出状态事件。
- `public/js/common.js` 为旧版页面注入等价的 Stacky DOM 与事件监听器。
- 两套 CSS 仅控制定位、精灵裁切、非阻塞指针行为和状态过渡；宠物不会遮挡按钮或接收鼠标事件。

## 失败与兼容性

- 宠物配置未读取到或不是 `stacky` 时，仍使用 Stacky 默认资源，避免设置损坏使布局报错。
- 精灵图加载失败时保留固定占位尺寸并隐藏破损图标。
- 用户关闭或未登录时不挂载宠物，不额外发起配置请求。
- 窄屏时宠物缩小并避开移动端安全边距。

## 验证

- 单元测试覆盖状态事件的名称、默认状态和自动复位时间。
- 前端构建必须通过。
- 本地服务验证 `/settings` 和精灵资源均返回 `200`。
- 浏览器检查登录后的剧本页是否显示 Stacky，并确认触发生成后的状态 class 变化。
