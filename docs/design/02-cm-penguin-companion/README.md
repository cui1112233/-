# 02 · CM Penguin Companion

**中文设计名：CM 企鹅搭档**  
**分支：`design/02-cm-penguin-companion`**  
**定位：常驻 qiantie 全功能区的 QQ 企鹅式 AI 桌宠。**

> CM 不是一个缩小版 Agent 工作区，也不是单纯的装饰宠物。它是跟着用户走遍 qiantie 的 AI 搭档：有自己的性格和台词，知道用户当前在哪、正在操作什么，能回答、分析、提出修改，并在用户确认后把修改真正应用回当前功能区。

---

## 1. 这版解决什么

当前 CM 已经具备动画、主动台词、聊天任务、页面上下文和 Agent 跳转，但这些能力集中在一个浮层组件里，用户感知上更像“右下角的另一个聊天窗口”。

02 方案把体验重新拆成两层：

1. **宠物层**：陪伴、表情、主动说话、点击互动、工作/成功/失败动作。
2. **工作层**：理解当前页面和当前选中对象，回答问题，给出结构化修改提案，用户点“应用”后由当前页面真正更新数据。

复杂任务仍然可以进入 Agent，但必须携带当前 CM 对话、页面上下文、选择上下文，不再让用户复制问题。

---

## 2. 核心体验

### 普通状态

只显示宠物本体和偶发气泡，不显示拖拽柄、关闭叉、后台式工具条。

示例台词：

- “又在改人物啊？”
- “今天准备折磨哪个角色？”
- “这个镜头看着有点闷，要我看看吗？”
- “好烦呀～又是上班的一天。”

### 点击 CM

打开一个从宠物旁边长出来的轻量对话气泡，不是 360×420 的 Cyber 后台窗口。

顶部明确告诉用户 CM 当前知道：

- 当前页面：剧本生成
- 当前区域：人物
- 当前选择：林晚

所以用户可以直接说：

> 她太强势了，再脆弱一点。

不需要重新解释“她”是谁。

### 修改不是直接写入

CM 先展示修改预览：

- 修改对象
- 改了哪些字段
- 修改前 / 修改后
- 会影响哪些功能

然后由用户点：

**应用修改**

高风险动作（删除、批量覆盖、清空、涉及历史数据）必须额外确认。

### 进入 Agent

当问题变复杂，CM 提供：

**Agent 工作区 ↗**

进入时携带：

- 当前 task / conversation
- Project Context
- Page Context
- Selection Context
- 当前未应用的 proposal（如有）

---

## 3. 四层上下文模型

每个页面统一给 CM 四层信息。

### Project Context

当前项目级数据，例如作品名、项目 ID、当前脚本草稿。

### Page Context

当前功能区，例如：

- 剧本生成
- 小说面板
- 水货生产
- 配音

### Selection Context

用户当前明确选中的对象，例如：

- character / 林晚
- scene / 旧城区雨巷
- shot / 第 7 镜
- segment / 第 8 段
- tts-card / 卡片 3

这是 CM 和普通聊天 Agent 最大的体验差异。

### Capability Context

当前页面允许 CM 做什么，例如：

```text
character.update
character.create
character.setProtagonist
scene.update
script.replace
constraint.bind
constraint.update
```

CM 只能提出页面声明过的 capability。

---

## 4. CM Page Bridge

原则：**CM 修改数据，不修改 DOM。**

禁止：

```js
document.querySelector('input').value = '...'
```

正确：

```text
CM
↓
结构化 Action Proposal
↓
当前 Page Bridge
↓
业务 state / store / API
↓
页面重新渲染
↓
Undo
```

参考契约见：

`cm-bridge-contract.js`

---

## 5. Action Proposal

Agent 返回两部分：

```js
{
  message: '我会把林晚改成外强内脆弱，同时保持泪痣特征。',
  proposals: [ ... ]
}
```

不要再从普通文字中寻找 `【修改稿】` 来判断能否应用。

第一批标准动作：

```text
character.update
character.create
character.setProtagonist
scene.update
script.replace
script.patch
shot.update
constraint.bind
constraint.update
asset.update
segment.update
segment.bindAsset
tts.update
```

---

## 6. `/script` 第一阶段设计

当前剧本页最适合作为 CM Bridge 的第一个落地点，因为人物/场景已经使用稳定实体 ID。

### CM 能看到

- 小说原文
- 当前生成阶段
- 人物和场景实体
- 主角 IDs
- 当前剧本结果
- 当前格式、时长
- 当前约束
- 当前选中人物/场景

### CM 能执行

人物：

```text
character.update
character.create
character.setProtagonist
```

场景：

```text
scene.update
scene.create（后续）
```

剧本：

```text
script.replace
script.patch
```

约束：

```text
constraint.bind
constraint.update
```

### 典型场景

用户选中“林晚”：

> 她太强势了。我想让她外表强势，其实很没安全感；跟周泽不要那么咄咄逼人。右眼下加一颗泪痣，以后生成都保持。

CM 返回两个 proposal：

1. `character.update`
2. `constraint.bind`

点应用后：

- 人物表更新
- 剧本旧输出标记为需要重新生成/检查
- 人物一致性约束继续引用同一 `entityId`
- 后续提示词读取最新人物特征
- 产生一次可撤销记录

---

## 7. 约束引用设计

当前约束是 prefix / quality / restriction / negative 的文本层。

02 方案新增实体引用层，不把人物描述复制进约束文本：

```js
entityReferences: [
  {
    entityType: 'character',
    entityId: 'stable-character-id',
    fields: ['外形'],
    mode: 'identity-lock'
  }
]
```

生成时：

```text
entityId
↓
读取最新人物数据
↓
抽取被引用字段
↓
组装最终约束 / prompt
```

因此人物改名、改发型、增加泪痣时不需要同步复制另一份人物描述。

---

## 8. 全站能力矩阵

| 功能区 | Selection | 第一批 CM 能力 |
| --- | --- | --- |
| 剧本原文 | 文本/段落 | 解释、精简、改写、提取问题 |
| 人物 | character | 修改、创建、主角、人物一致性约束 |
| 场景 | scene | 修改、补充、视觉/氛围约束 |
| 剧本结果 | 段落/全文 | 局部重写、替换、分析 |
| 分镜结果 | shot | 改机位、节奏、提示词、内容 |
| 小说面板 | 章节/选区 | 分析、改写、整理（需 iframe bridge） |
| 水货资产 | asset | 修改人物/场景/道具 prompt |
| 水货分段 | segment | 修改分段、提示词、绑定资产 |
| TTS | tts-card | 改文本、voice/style/speed/pitch |
| 历史 | entry | 查找、比较、打开；删除必须确认 |
| 设置 | setting | 诊断和解释；不暴露 API Key/凭据 |

---

## 9. 宠物人格与工作脑分离

### Companion Brain

不调用复杂 Agent，负责低成本宠物感：

- welcome
- morning / midday / afternoon / evening
- idle
- click
- working
- success
- error

### Work Brain

只在用户主动提问、明确触发分析或发现重要冲突时调用。

宠物台词不要伪装成工作结论；工作回答也不要每句都强行卖萌。

---

## 10. 视觉方向

关键词：

**桌宠 / 轻量 / 亲近 / 不挡内容 / 不像后台 / 有一点游戏感但不幼稚。**

保留：

- 现有 CM 精灵图
- 像素动画
- 跟随视线
- 拖动
- 工作/成功/失败动作

删除或弱化：

- 永久显示的拖拽把手
- 永久显示的关闭叉
- Cyber conic-gradient 大聊天框
- 网格纹理和强 glow

新增：

- 宠物旁自然生长的圆角气泡
- Page / Selection context chips
- Proposal 修改预览卡
- “应用修改 / 继续调整”
- Agent 深度入口

---

## 11. 原型

打开：

`prototype.html`

原型模拟完整场景：

1. 当前页面是剧本生成。
2. 当前选中人物“林晚”。
3. 点击右下 CM。
4. 查看人物修改 proposal。
5. 点击“应用修改”。
6. 左侧人物描述更新。
7. 右侧约束引用显示同步到最新人物特征。
8. Agent 按钮演示“携带上下文进入深度模式”。

原型只做设计验证，不连接真实 Agent API，也不会修改生产数据。

---

## 12. 推荐开发顺序

### Phase 1 — `/script` Bridge

- 扩展 CM Context：selection + capabilities
- ScriptPage 注册 selection
- Agent 响应支持 structured proposals
- character.update / scene.update
- script.replace
- apply + one-step undo

### Phase 2 — Entity Constraints

- entityReferences
- constraint.bind
- 生成阶段动态读取最新实体数据

### Phase 3 — 水货生产

- asset.update
- segment.update
- segment.bindAsset
- prompt 修改

### Phase 4 — TTS

- selection: tts-card
- tts.update
- 修改后可试听

### Phase 5 — Novel Panel

在现有 MessageChannel 上增加：

```text
novel-panel-cm-context
novel-panel-cm-action
```

### Phase 6 — 宠物表现力

- 隐藏拖拽/关闭控件
- hover 动作
- 被拖动台词
- 打瞌睡
- 工作小动画
- 更丰富的性格台词

---

## 13. 验收标准

第一版接入生产前至少满足：

- 用户在 `/script` 选中人物后可直接用“她/他”提问。
- CM 清楚显示当前 Selection。
- AI 普通回答和可执行 Action 分离。
- 所有写入必须预览并确认。
- `character.update` 按实体 ID 更新，不按名字查找。
- 约束引用按实体 ID 读取最新数据。
- 修改可以撤销一次。
- 进入 Agent 时不需要复制问题。
- CM 不读取、不回显 API Key、token、authorization、credential 等敏感数据。
- 复杂功能没有塞进宠物组件本身，而由 Page Bridge 提供。
