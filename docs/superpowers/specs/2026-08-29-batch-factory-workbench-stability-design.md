# 批量工厂工作台稳定性与可用性改造设计

**日期：** 2026-08-29  
**分支：** `10-batch-factory-inline-constraints-version-config`  
**PR：** #8  
**范围：** 批量工厂工作台主题系统、四模块可拖动布局、滚动边界、占位/未接线能力、VIDEO 时长策略、合并设置、视频管理系统账号状态以及回归测试。

## 1. 目标

把当前“能展示但存在半接线、固定布局、主题不一致”的批量工厂，改成一个可以长期维护的生产工作台。

完成后需要满足：

1. 深色/浅色主题切换后，批量工厂所有 Ant Design 组件和自定义区域都能正确跟随，文字与背景保持可读对比度。
2. 工作区保留四个业务模块，但视觉结构为“三列 + 右列上下分区”，支持 2 根纵向分割线和 1 根横向分割线拖动。
3. 每个模块有独立滚动区；拖动、窗口缩放、侧栏收起/展开均不会把关键内容裁掉。
4. 分割尺寸按用户本地持久化；双击分割线恢复默认；最小尺寸约束避免 Pane 被拖到不可用。
5. 未接通的能力明确显示“暂不可用/尚未接通”，不出现看似可点击但永远失败的假操作。
6. VIDEO 数量策略与 VIDEO 时长策略解耦：固定单 VIDEO 只控制数量，不决定时长。
7. 当前阶段移除“跟随原音频时长”与 TTS 测时入口，不把未来能力提前暴露给用户。
8. 视频管理系统账号状态区分 `online / login_required / unavailable`，不会把“适配器未接通”伪装成“账号掉线”。
9. 新增/调整测试后，`npm test` 与 `npm run frontend:build` 在 PR CI 中全部通过。

## 2. 非目标

本轮不实现以下能力：

- 不实现视频管理系统真实发布 API；如果真实接口尚未存在，只把 UI 状态改成明确的不可用说明。
- 不重新设计整个前贴导航、个人中心或其它工作台。
- 不引入新的第三方 Split Pane / layout 依赖。
- 不实现 TTS 音轨合入最终成片。
- 不改变已经确认的发布统一设置版本配置语义。
- 不把批量工厂改成四列横向布局。

## 3. 已确认根因

### 3.1 主题系统冲突

当前存在两套同时生效的主题来源：

- `ConfigProvider` 调用 `createAntTheme(theme)`，但 `createAntTheme()` 只切换 token，没有切换 Ant Design `defaultAlgorithm / darkAlgorithm`。
- `global.css` 中 `.user-theme-active` 又直接覆盖 Ant Design 的 `.ant-tag`、表格、按钮等组件样式。

这会造成组件背景由 AntD 计算、文字色却被全局 CSS 强制覆盖。例如浅色 Tag 背景可能配上浅色文字，产生低对比度。

### 3.2 工作区不是可拖动四模块

当前 `BatchFactoryPageV9.jsx` 使用固定三列 Grid：

- 左：小说列表
- 中：当前小说 / 导演 Prompt
- 右上：VIDEO
- 右下：合并 / 发布

代码没有 resize state、pointer drag、最小尺寸保护或本地持久化，因此“4 模块拉动”实际上没有实现。

### 3.3 内容裁切

外层 `.legacy-content` 为 `overflow: hidden`。批量工厂内部没有完整的“固定工作台高度 + Pane 自身滚动”结构，因此窗口变小或模块被压缩时会出现内容不可达。

### 3.4 视频管理系统账号适配器未在真实启动链路注入

`createApp()` 已经可以接收 `videoManagementAccountAdapter`，但 `server.js` 当前仍然直接 `createApp()`。因此真实服务启动时适配器为空，账号状态只能返回 `unavailable`。

### 3.5 发布按钮当前是占位能力

“发布到视频管理系统”按钮当前硬编码 disabled，并明确写着真实发布接口正在接入。因此它不是可用功能，应改为不可用状态展示，而不是继续表现成主要操作按钮。

### 3.6 VIDEO 数量与时长逻辑混在一起

当前“固定单 VIDEO”的说明写成“时长跟随当前模型单次最大时长”，把“只生成一个 VIDEO”和“这个 VIDEO 多长”绑在一起，违反已确认产品规则。

### 3.7 未来 TTS 能力提前出现在合并区

当前 `MergePanel` 包含“跟随音频时长”、TTS 调用、音频测时和压缩倍率计算。这一能力尚未属于当前产品目标，应先从批量工厂 UI 和运行路径中移除。

## 4. 方案选择

### 方案 A：内部重构为可拖动工作台（采用）

用现有 React + Ant Design 自建一个轻量 `ResizableWorkspace`，不增加第三方依赖。布局采用三列，右列内部上下分割。

优点：

- 与现有页面结构一致，改动可控。
- 能精确处理右列上下分区。
- 可以把滚动、最小尺寸、持久化和主题一次解决。
- 不引入新的包维护成本。

### 方案 B：保留固定 Grid，只补 CSS/局部拖动

改动少，但不能解决结构性问题。以后还会继续出现裁切、尺寸冲突和状态难维护。

### 方案 C：引入第三方 Split Pane 库

代码量可能少，但会引入新依赖、样式/主题兼容成本，也不符合本轮 YAGNI 原则。

**决策：采用方案 A。**

## 5. 工作区架构

目标结构：

```text
┌──────────────────────────────────────────────────────────────┐
│ 批量工厂顶部操作                                             │
├──────────────┬──────────────────────┬────────────────────────┤
│              │                      │ ③ VIDEO               │
│ ① 小说队列  │ ② 当前小说 / 导演    │                        │
│              │                      ├────────────────────────┤
│              │                      │ ④ 合并 / 发布          │
│              │                      │                        │
└──────────────┴──────────────────────┴────────────────────────┘
       ↔                 ↔                       ↕
```

### 5.1 模块定义

- `pane-queue`：小说队列与批次切换。
- `pane-director`：当前小说正文、Prompt 版本、约束、导演结果和生成入口。
- `pane-video`：当前 VIDEO 切换、状态、预览、VIDEO 编辑信息。
- `pane-publish`：合并状态、倍率、成片状态、视频管理系统发布能力状态。

### 5.2 分割线

- `split-left`：小说队列 / 当前小说。
- `split-right`：当前小说 / 右侧工作区。
- `split-publish`：右侧 VIDEO / 合并发布。

使用 Pointer Events 实现拖动，拖动期间：

- `setPointerCapture()` 保证鼠标移出分割线仍能持续拖动。
- `requestAnimationFrame` 或直接更新 CSS custom properties，避免无意义的高频布局状态抖动。
- 页面添加 `is-resizing` 状态，临时禁用文字选择。

### 5.3 默认比例和最小尺寸

桌面默认值：

- 左列：260px。
- 中列：min 420px，默认承担主要编辑空间。
- 右列：min 340px，默认约 420px。
- 右上 VIDEO：右列高度约 58%。
- 右下合并/发布：右列高度约 42%。

硬约束：

- 左列 min 220px / max 420px。
- 中列 min 420px。
- 右列 min 340px。
- VIDEO 区 min 280px。
- 发布区 min 220px。

当容器尺寸不足以同时满足全部最小值时，不继续把 Pane 压缩到不可用，而是进入响应式模式。

### 5.4 响应式模式

- 宽度 >= 1180px：完整三列 + 右侧上下分区，可拖动。
- 900px–1179px：两列。左侧小说队列保留独立列；右侧主工作区把“当前小说 / 导演、VIDEO、合并 / 发布”纵向堆叠，桌面三列分割线关闭。
- < 900px：单列堆叠四个模块，每个模块正常滚动，不提供拖动分割线。

阈值最终由工作区容器宽度判断，而不是只看 `window.innerWidth`，这样侧栏收起/展开也能正确触发布局变化。

### 5.5 持久化

使用 `localStorage` 保存当前用户工作区比例，例如：

```json
{
  "leftWidth": 260,
  "rightWidth": 420,
  "rightTopRatio": 0.58
}
```

key 使用版本化名称：

`qiantie:batch-factory:workspace:v1`

要求：

- 读取失败或值越界时回退默认。
- 每次应用尺寸前 clamp 到当前容器 min/max。
- 双击任一分割线恢复默认布局，并同步更新存储。
- 响应式单列/两列模式不覆盖用户的桌面尺寸配置。

## 6. 滚动与高度模型

批量工厂页面根节点必须占满 `legacy-content` 可用高度：

```text
legacy-content
└─ batch-factory-page (height: 100%; min-height: 0)
   ├─ toolbar (固定高度/自然高度)
   └─ workspace (flex: 1; min-height: 0)
      ├─ pane queue (overflow: hidden)
      │  └─ pane-body (overflow: auto)
      ├─ pane director
      │  └─ pane-body (overflow: auto)
      └─ right-stack
         ├─ pane video
         │  └─ pane-body (overflow: auto)
         └─ pane publish
            └─ pane-body (overflow: auto)
```

禁止依赖 `72vh` 这类固定视口高度作为核心滚动模型。

模块标题栏可以保持可见，真正滚动的是 pane body。

## 7. 主题系统设计

### 7.1 单一主题入口

`createAntTheme(mode)` 改为：

- 深色：`algorithm: theme.darkAlgorithm`
- 浅色：`algorithm: theme.defaultAlgorithm`
- 品牌色、圆角、字体等继续通过 token 覆盖。

Ant Design 组件视觉由算法 + token 负责。

### 7.2 CSS 职责边界

`global.css` 保留：

- 页面背景。
- Sidebar / topbar / shell。
- 品牌动画与非 AntD 自定义元素。
- 布局尺寸变量。

删除或缩小这些高风险覆盖：

- `.user-theme-active .ant-tag { color: ... }`
- 对 AntD table/card/input/button 的大面积背景/文字强制覆盖。
- 任何会破坏 Ant Design color semantic token 的规则。

如果批量工厂需要额外背景或边框，使用 AntD `theme.useToken()` 或 CSS 变量映射后的语义变量，而不是硬编码颜色。

### 7.3 批量工厂硬编码颜色

当前选中小说 `outline: 2px solid #1677ff` 改为主题 token（如 `colorPrimary` 或适合的 active border token）。

VIDEO 播放器允许保持黑色媒体背景，因为这是媒体容器的功能色，不需要跟主题切成白色。

### 7.4 可读性验收

至少检查：

- Typography primary/secondary。
- Tag 默认/blue/green/gold/red。
- Alert info/warning/error。
- Segmented selected/unselected。
- Select placeholder/value/dropdown。
- Switch on/off。
- Drawer/Modal/Collapse/Card。
- disabled Button。
- 小说列表 selected/hover。

深色和浅色都必须可读。

## 8. VIDEO 时长与固定单 VIDEO

### 8.1 数据语义

生产设置新增/统一：

```text
videoDurationMode: 'auto' | 'fixed'
fixedVideoDuration: number | null
fixedSingleVideo: boolean
```

### 8.2 UI

```text
VIDEO 时长策略
[ AI自动 ] [ 固定时长 ]

固定时长开启时：
[ 选择固定时长 ▼ ]
```

10s、15s 可以是模型常见候选示例，但不是所有模型的硬编码规则。固定时长候选应优先来自视频模型 capability；如果现有模型元数据只有 `maxVideoDuration`，则 UI 只允许选择/输入不超过该上限的有效时长，并由后端再次验证。

要求：

- 任何固定时长都不得超过 `maxVideoDuration`。
- 如果切换模型后当前固定时长超出新模型能力，先提示用户并要求重新选择，不静默截断。
- 模型最大时长是上限，不代表每个 VIDEO 必须生成到最大时长。

### 8.3 固定单 VIDEO

`fixedSingleVideo` 只做：

- 每本小说最终最多生成一个 VIDEO。
- 导演只输出该单 VIDEO 覆盖的内容。
- 后续小说内容不继续输出 VIDEO。

它不改变 `videoDurationMode / fixedVideoDuration`。

## 9. 合并区域

本轮只保留当前确认的固定倍率：

`1.0 / 1.1 / 1.2 / 1.3 / 1.5 / 1.7 / 2.0`

删除当前批量工厂中的：

- `跟随音频时长`
- `textToSpeech()` 测时
- `audioDuration()`
- “仅测时，不合入音轨”相关 Tag
- 根据音频自动计算 ratio 的代码路径

合并能力本身仍然通过现有 merge capability 检查。

## 10. 视频管理系统账号状态

统一状态：

### online

```text
视频管理系统
● 账号名称
账号在线
```

### login_required

```text
视频管理系统
登录异常
账号登录状态已失效
[重新登录]
```

只有存在真实 relogin adapter 且能返回有效登录 URL 时，才允许出现可用的重新登录动作。

### unavailable

```text
视频管理系统
暂不可用
视频管理系统账号验证能力尚未接通
```

不显示“重新登录”按钮，避免用户点击一个注定失败的操作。

### 真实启动注入

实现阶段需要找到“小说获取”当前用于视频管理系统的真实账号/session 能力，并把它作为 adapter 注入 `createApp()` 的真实启动路径。

如果仓库里不存在可复用的真实 adapter，本轮必须保持 `unavailable`，并在代码和 UI 中明确说明；不能伪造 online。

## 11. 发布能力状态

在真实发布 API 未接通前，删除主要 CTA 风格的 disabled “发布到视频管理系统”按钮，改为状态卡：

```text
发布
当前成片：{bookId}.mp4
TXT：{bookId}.txt

发布能力尚未接通
```

如果现有页面有下载成片能力，可保留下载；不能新增一个假的发布成功路径。

未来真实接口接入后，再根据 capability 显示真正的一键发布按钮。

## 12. 约束设置与错误反馈

### 12.1 旧批次兼容

`constraintQualityEnabled / constraintRestrictionEnabled / constraintNegativeEnabled`：

- 如果字段本身是 boolean，使用明确值。
- 如果旧数据里字段不存在，则根据对应 body 是否非空推导 enabled。

这样避免旧批次已有约束正文但 UI 显示关闭，用户保存后反而把它禁用。

### 12.2 API 错误

当前 `getBatchFactoryPromptCatalog()`、`listModels()`、发布版本配置读取等地方存在 `.catch(() => {})`。

重要数据加载失败时必须出现局部错误或 `message.error`；不能把错误吞掉后展示空 Select，让用户误以为功能是摆设。

### 12.3 系统预设编辑

系统预设正文编辑不应该因为用户开始输入就自动切换到“我的提示词”来源。来源切换和正文编辑是两个独立动作。

## 13. 组件边界

建议新增：

- `BatchFactoryWorkspace.jsx`
  - 负责桌面/响应式布局、分割线、尺寸状态、持久化。
- `ResizableDivider.jsx`
  - 可复用 pointer drag + double click reset。
- `useBatchFactoryWorkspaceLayout.js`
  - localStorage、clamp、容器尺寸响应。

保留：

- `BatchFactoryPageV9.jsx` 负责业务状态和 API 操作。
- `BatchFactorySettingsDrawers.jsx` 负责生产/发布 Drawer。
- `BatchConstraintSettings.jsx` 负责约束编辑。

目标是把“布局行为”从已经很大的 `BatchFactoryPageV9.jsx` 中抽出来，避免继续加耦合。

## 14. 数据流

### 工作区尺寸

```text
pointer drag
→ workspace local state
→ clamp
→ CSS layout
→ debounce/localStorage save
```

### 主题

```text
UserLayout theme state
→ document[data-theme]
→ ConfigProvider createAntTheme(mode)
→ AntD algorithm + token
→ Batch Factory consumes semantic tokens
```

### VIDEO 时长

```text
生产统一设置 draft
→ validate against selected model capability
→ save batch.settings
→ director uses duration strategy
→ generation uses director output + model cap
```

### 视频管理账号

```text
打开发布 Drawer
→ GET status
→ adapter reads real session
→ online / login_required / unavailable
→ UI renders corresponding state
```

## 15. 测试策略

实施使用 TDD。先写/调整失败测试，再写生产代码。

### 15.1 主题测试

至少锁定：

- `createAntTheme('dark')` 使用 dark algorithm。
- `createAntTheme('light')` 使用 default algorithm。
- 不再存在破坏 Tag semantic color 的全局强制文字色覆盖。

### 15.2 工作区测试

测试纯函数/Hook：

- 默认尺寸。
- clamp。
- localStorage 无效值回退。
- 双击 reset。
- 小容器进入响应式模式。

UI contract 测试：

- 页面存在 4 个 Pane。
- 桌面存在 3 个 divider。
- 不再使用固定 `gridTemplateColumns` 作为工作台核心布局。

### 15.3 VIDEO 时长测试

- auto 模式保存正确。
- fixed 模式保存用户选择的合法时长。
- 超过模型最大时长被拒绝。
- fixedSingleVideo 不覆盖 fixedVideoDuration。

### 15.4 合并测试

- UI 不再出现“跟随音频时长”。
- 批量工厂页面不再调用 TTS 测时。
- 固定倍率仍保留完整集合。

### 15.5 视频管理账号测试

- online 显示账号名。
- login_required 才出现重新登录。
- unavailable 不出现重新登录 CTA。
- 无 adapter 时永不返回 online。

### 15.6 CI

PR workflow 顺序：

1. `npm install`
2. `npm --prefix frontend install`
3. `npm test`
4. `npm run frontend:build`

完成标准：全部绿色。

## 16. 实施顺序

1. 先修当前 CI 基线测试契约，使失败原因可解释、可稳定复现。
2. 主题系统单一化，先消除明暗模式冲突。
3. 抽出 `BatchFactoryWorkspace`，实现四模块、滚动和拖动持久化。
4. 修 VIDEO 时长策略和 fixedSingleVideo 解耦。
5. 移除 TTS 跟随音频合并路径。
6. 修约束设置旧数据兼容、错误吞掉和预设编辑问题。
7. 修视频管理账号三态和真实启动 adapter 注入。
8. 把未接通发布按钮改成明确 capability 状态。
9. 运行完整测试与 frontend build；对深/浅主题、三个 divider、四 Pane 做人工契约核对。

## 17. 验收清单

- [ ] 深色主题下所有批量工厂文字、Tag、Alert、Select、Drawer 可读。
- [ ] 浅色主题下同样可读。
- [ ] 切换主题无需刷新页面即可完整更新。
- [ ] 小说队列与导演区可以左右拉动。
- [ ] 导演区与右工作区可以左右拉动。
- [ ] VIDEO 与合并/发布可以上下拉动。
- [ ] 三条分割线都有 min/max 保护。
- [ ] 双击分割线恢复默认。
- [ ] 刷新页面后桌面布局尺寸保持。
- [ ] 小窗口不会出现内容被 `overflow:hidden` 永久裁掉。
- [ ] 四个 Pane 各自可滚动。
- [ ] 生产统一设置有 AI自动 / 固定时长。
- [ ] 固定时长必须受当前模型 capability / maxVideoDuration 限制。
- [ ] 固定单 VIDEO 不再等于“模型最大时长”。
- [ ] 合并区不再出现跟随音频时长/TTS 测时。
- [ ] `unavailable` 不显示重新登录按钮。
- [ ] `login_required` 才显示重新登录。
- [ ] 未接通发布能力不再显示伪主要按钮。
- [ ] 重要 API 加载失败不会静默变成空白 UI。
- [ ] 旧批次非空约束正文不会因为缺少 enabled 字段被误关。
- [ ] `npm test` 通过。
- [ ] `npm run frontend:build` 通过。

## 18. 风险与控制

### 风险：工作台拖动造成布局抖动

控制：尺寸状态独立于业务状态；避免拖动时触发批量数据重算；使用 CSS variables/轻量 state。

### 风险：主题重构影响其它页面

控制：优先去掉明显破坏 AntD semantic color 的全局规则；每次删除覆盖前搜索依赖；必要时把页面专用规则限制到明确 scope，而不是新增新的全局覆盖。

### 风险：旧批次数据字段不完整

控制：所有新增字段有 backward-compatible fallback；存储层和 UI 初始化都测试 legacy case。

### 风险：视频管理系统真实 adapter 在仓库里找不到

控制：不猜、不伪造。保持 `unavailable`，并把“真实接线”作为明确未完成 capability，不影响其它工作台改造合并。

## 19. 完成定义

本轮只有同时满足以下条件才算完成：

- 代码与 UI 行为符合本 spec。
- 现有 PR #8 中与本范围冲突的旧实现已修正。
- 新增测试覆盖主题、布局、时长策略和账号三态。
- PR CI 的 test 与 frontend build 全绿。
- 没有把未接通外部能力伪装为已可用。
