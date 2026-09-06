# V88 视频画面提示词流水线复刻实施记录（Live OBJ）

> 日期：2026-09-06  
> 分支：`v88`  
> 依据：`docs/obj/2026-09-06-v783031-prompt-generation-logic-analysis.md`  
> 状态：执行中  
> 原则：实时同步；每完成一个阶段立即更新本文；源码事实与新增设计分开记录。

---

## 1. 最终目标

把 V78.3.0.31 已验证的提示词制作逻辑，按 V88 公网现有架构增量落地，并保留 V88 已确定的 `matchAudio=true` 音频总时长硬约束。

目标链：

```text
剧本
→ 智能统一规则（统一风格附加视觉信息）
→ 导演要求语义合同
→ Global Director Plan
→ Scene/Event 语义分批
→ 每条原文完整视频画面提示词（1~6 micro_shots）
→ 验收 / 定向修复
→ 第三步 + 第四步同源写入
→ 第五步确定性本地分段（0 AI）
→ Segment 级视频生成任务
→ 最终顺序合成
```

---

## 2. 执行计划

### Phase 0 — V88 基线定位与测试框架确认【已完成】
- [x] 定位公网剧本生成页面、约束设置、画面前缀词、`matchAudio` 的前端入口。
- [x] 定位后端剧本生成/提示词/约束接口与现有 prompt builder。
- [x] 定位视频段生成、合并、执行器相关逻辑。
- [x] 确认前端/后端现有测试框架和可执行测试命令。
- [x] 明确本轮最小修改边界，避免无关重构。

### Phase 1 — 智能统一规则【实现已写入；自动验证受 GitHub Runner 阻塞】
- [x] 先补合同测试：统一风格字段、职责边界、完整剧本输入、不能混入单镜头时间码/焦段/灯位。
- [x] 后端新增独立系统级元提示词与 11 字段结构化输出契约。
- [x] 接入公网“约束设置 → 画面前缀词 → 智能统一”：仅明确选中时额外运行一次完整原文分析。
- [x] 系统元提示词保留在后端；前端只接收结构化结果与服务端确定性拼出的统一视觉前缀。
- [x] 本次实际统一风格写入 outputConstraints/history，并由第五步最终卡优先使用。
- [x] 最终视频 prompt 不再混入“智能统一系统元提示词”正文。
- [!] 自动测试/构建已配置，但当前 GitHub Actions job 在获取 runner 前即失败；见验证记录，不宣称通过。

### Phase 2 — 第三步：Global Director Plan【执行中】
- [ ] 读透并复用 `lib/novel-panel/v783031-outline-route.js` 的语义合同、审核、失败行修复事务。
- [ ] 确认现有 V78.3.0.31 请求字段、outline_shots/timeline_segments、返回字段与导出函数。
- [ ] 先补失败合同测试：逐条原文索引、事件语义、时长规划、上下文承接。
- [ ] 建立公网 `/script` 专用适配层，不复制一套近似算法。
- [ ] 实现/整理 Global Director Plan 元提示词与结构化输出。
- [ ] 对长剧本引入 Scene/Event 语义批次和 Story Map/上下文摘要机制（仅在现有 V78 核心没有覆盖时补）。
- [ ] `matchAudio=true` 时将总时长作为硬约束传到导演规划和最终校验。

### Phase 3 — 第四步：每条完整视频画面提示词【待执行】
- [ ] 先补失败测试：一条原文 = 一张权威外层画面卡；每卡 1~6 个 micro_shots。
- [ ] 第三步与第四步使用同一权威执行事务，禁止第四步独立重写第三步结论。
- [ ] 输出完整镜头字段：时间、景别、观察角度、运镜、动作、环境、光线、节奏等。
- [ ] 复用语义验收；只对失败原文行做定向修复一次。
- [ ] 原子写入第三/第四步结果。

### Phase 4 — 第五步：确定性最终分段【部分已提前完成】
- [x] 智能统一元提示词与最终视觉前缀已彻底分层；最终卡只使用 resolved style。
- [x] 已保留 0-AI 本地卡片组装，不新增最终润色模型调用。
- [ ] 补最终总时长硬校验：`matchAudio=true` 时最后一段结束时间必须严格等于 `audioDurationSec`。
- [ ] 进一步固定拼接顺序：统一风格 → 本段人物 → 镜头画面 → 负面提示词 → 声音/文字隔离 → 画质约束，并与现有 UI 卡顺序兼容。
- [ ] 保护 Master Visual Prompt；精品/参考图模式只注入 `(@图N)` 索引，不重写内容（若公网当前链存在该模式）。
- [x] Segment 级独立任务已是 V88 现有能力；单段任务独立 taskId/status，不合成 mega prompt。

### Phase 5 — 全链路验证与收口【待执行】
- [ ] 跑相关单元/集成测试。
- [ ] 跑前端构建。
- [ ] 跑后端构建/测试。
- [ ] 用代表性剧本验证普通模式与 `matchAudio=true`。
- [ ] 检查无独立重复 AI 改写、无时间空缺/重叠、无最终时长漂移。
- [ ] 把实际修改文件、提交 SHA、测试证据、剩余风险写回本文。

---

## 3. Phase 0 基线调查结果

### 3.1 公网真实入口

- 主页面：`frontend/src/user/pages/ScriptPage.jsx`。
- 约束状态：`frontend/src/user/pages/scriptConstraints.js`。
- 智能统一选择判定与音频时长读取：`frontend/src/user/pages/scriptGenerationRules.js`。
- 模型输出解析/按时长拆卡：`frontend/src/user/pages/scriptShotOutput.js`。
- 最终卡片确定性组装：`frontend/src/user/pages/scriptFinalSegment.js`。
- 文本 AI 客户端：`frontend/src/shared/api/generation.js`，普通文本生成请求 `/api/chat`。
- 文本 AI 服务端：`routes/chat.js`。
- 系统预设目录：`prompts/`，注册表在 `lib/system-preset-catalog.js`。
- 视频段任务：`routes/script-video.js`；当前已经按单卡独立提交并单独轮询状态。

### 3.2 当前已有能力

1. **原智能统一入口存在，但旧实现没有独立分析层。**
   - 预设 ID：`script-constraint-prefix-smart-unified`。
   - 旧逻辑只是把人物/场景提取阶段得到的 `visualStyle` 再注入画面前缀。

2. **V88 原有十一项统一风格雏形。**
   - `prompts/小说面板人物场景提取.md` 已要求统一风格按十一项生成一行中文，但它与人物/场景提取混在一次 AI 调用中。

3. **已有导演母版，但 `/script` 原路径仍是一轮直接出成品。**
   - `prompts/导演级分镜母版.md` 已包含完整读原文、场景边界、blocking、连续性、动作链和静默质检等规则。
   - `routes/chat.js` 的 `script` / `quick_director` 仍是单次 upstream AI 调用。

4. **`matchAudio=true` 总时长硬约束已经存在。**
   - `lib/script-generation-rules.js::buildAudioMatchRules()` 明确要求所有独立分镜单元时长之和精确等于真实音频总秒数。

5. **第五步已有 0-AI 雏形。**
   - `scriptShotOutput.js` 与 `scriptFinalSegment.js` 会本地解析、切段、重置相对时间、剥离模型乱输出的共享设定，再按实际开关注入约束。
   - 不为形式一致强迁到 Go；先强化现有确定性 JS 层。

6. **Segment 级失败隔离已有基础。**
   - 每张最终分镜卡独立调用 `/api/script-video`，拥有独立 taskId/status。

7. **发现可直接复用的 V78.3.0.31 核心。**
   - `server.js` 已注册 `/api/novel-panel/outline-scenes`。
   - 实际核心位于 `lib/novel-panel/v783031-outline-route.js`。
   - 它已经实现“导演要求语义合同 → 生成 → 逐项语义验收 → 只修失败 source row 一次并保持时长 → 再验收”的权威事务。
   - Phase 2/3 不重新发明近似逻辑，而是为公网 `/script` 写适配层复用它。

### 3.3 测试/验证条件

- 前端有 `npm --prefix frontend run test`，原脚本主要覆盖 `src/shared/api/*.test.js`。
- 根 Node 代码采用 `node:test`，本轮已新增独立合同测试文件。
- 本轮新增 `.github/workflows/v88-script-prompt-pipeline.yml`，用于专门跑提示词流水线 Node 合同、前端合同与构建。
- **当前 GitHub Actions runner 基础设施异常**：workflow 能创建 run，但 job 未获得 runner 即终止；不能把这类 failure 当成代码断言失败，也不能把未执行的测试宣称为通过。

---

## 4. Phase 1：智能统一规则实际实现

### 4.1 新的真实运行链

```text
用户选择：约束设置 → 画面前缀词 → 智能统一
  ↓
前端生成 API 检测 smart preset
  ↓
POST /api/script/smart-unified-style
  ↓
后端读取 prompts/智能统一视觉分析.md
  ↓
完整原文 + 已确认人物/场景事实
  ↓
AI 只返回 11 字段 JSON
  ↓
服务端校验字段完整性和边界
  ↓
拒绝具体 mm 焦段 / 时间码 / 分镜编号等单镜泄漏
  ↓
服务端按固定字段顺序确定性重建最终统一视觉 prefix
  ↓
写入本次 requestConstraints.prefix.smartUnifiedStyle
  ↓
再进入原剧本/分镜生成
  ↓
第五步最终卡优先使用 smartUnifiedStyle
```

没有选择智能统一时，不增加这次 AI 调用。

### 4.2 十一项权威字段

固定顺序：

1. `imageMedium` — 影像媒介
2. `captureProcess` — 成像介质
3. `grainTexture` — 颗粒与材质纹理
4. `filterColorSystem` — 滤镜与色彩体系
5. `lensLanguage` — 镜头语言基线
6. `opticalCharacter` — 光学特性
7. `contrast` — 对比度
8. `saturation` — 饱和度
9. `lightingHierarchy` — 光线与明暗层次
10. `narrativeComposition` — 叙事构图原则
11. `atmosphere` — 整体氛围

服务端不信任模型自行输出的总 `prompt`；模型只负责 11 字段，最终 prefix 由程序重建。

### 4.3 边界修复

- 统一风格只控制全片成像基线。
- 不允许 `24mm/35mm/50mm/85mm` 等具体焦段进入统一字段。
- 不允许 `00:00-00:03` 等时间码、分镜编号进入统一字段。
- 不允许某一镜具体灯位/人物动作/走位写进统一风格。
- 用户选择智能统一后，最终视频卡**不会再把系统元提示词模板正文一起塞给视频模型**。
- 新生成结果优先使用本次独立分析的 `smartUnifiedStyle`；旧历史没有该字段时回退到原 `extractInfo.visualStyle`。

---

## 5. 实时执行日志

### 2026-09-06 — 启动
- 用户明确批准执行并要求实时同步 Git OBJ。
- 已调用 Superpowers：`using-superpowers`、`brainstorming`、`writing-plans`、`executing-plans`、`test-driven-development`。

### 2026-09-06 — Phase 0 完成
- 已核对公网 React、Node prompt builder、系统预设目录、约束拼接、matchAudio、最终分段和视频段任务。
- 结论：保留 V88 已有导演母版、音频硬约束、0-AI 最终卡片组装与 Segment 独立任务。

### 2026-09-06 — Phase 1 实现写入
- 增加独立智能统一后端端点，不修改巨大 `/api/chat` 主路由来硬塞新职责。
- 增加专用 11 字段系统元提示词。
- 增加服务端确定性规范化与单镜泄漏拦截。
- 前端 `generateScript` 和 `generateQuickDirectorStoryboard` 在明确选择智能统一时自动先运行独立分析。
- 本次 resolved style 写入 outputConstraints/history。
- 第五步最终卡改为优先使用 resolved style，并阻止系统元提示词正文进入最终视频 prompt。
- 新增 Node/前端合同测试和专用 GitHub Actions workflow。
- GitHub Actions run `34022552877` 两个 job 均在 runner 分配前终止：`runner_id=0`、`steps=[]`；因此当前没有可声称“测试已通过”的执行证据。
- Phase 2 开始：复用 V78.3.0.31 Outline 语义合同链。

---

## 6. 本轮已修改文件与提交

- `.github/workflows/v88-script-prompt-pipeline.yml`
  - `012287872c16f6e7d794b626816d7a15a1988890` 初建验证流水线
  - `7353852872e7aba1098dcae000003b6d85c73273` 扩充智能统一/最终分段合同覆盖
- `lib/script-generation-rules.test.js`
  - `919ed18ce21ed96c54648deaa70c5e801393d6a8`
- `lib/script-generation-rules.js`
  - `63a01da2bf7dc792a7f5828547a302cb3d334b9f`
- `prompts/智能统一视觉分析.md`
  - `83bbad7d389fa5c79de69c0002340003452bd153`
- `lib/script-smart-unified-route.test.js`
  - `e3fe288d5ed7696356d1563f52d2748c38e70cd0`
- `lib/script-smart-unified-route.js`
  - `1eb7d78ffe454e3da6e47e2b619a4f40e2c39ce2`
- `server.js`
  - `5e955a4272c792bac63955df1dbd00ae0b4e6f09`
- `frontend/src/shared/api/generation.js`
  - `380dc99fdbad48e6c64ac083575dddf158d07037`
- `frontend/src/user/pages/scriptConstraints.js`
  - `a7ad21afb31c7fc40de6d52bd52f5c71b9db3fbf`
- `frontend/src/user/pages/scriptConstraints.test.js`
  - `f3b39205c1ac01d828de7ed9fd9af3f013d957f2`
- `frontend/src/user/pages/scriptFinalSegment.test.js`
  - `97fe69068a341fdf6ca515b2f94f81fe555e694b`
- `frontend/src/user/pages/scriptFinalSegment.js`
  - `37c3128ed11a2c1e0782b84e9bd162ab5b4026d9`
- 临时 `routes/chat.prompt-pipeline.test.js` 已因改用独立路由设计删除；不作为最终实现文件。

---

## 7. 验证记录

### 已有静态证据
- 新智能统一端点已在 `server.js` 注册并带 `apiAuth`。
- 系统元提示词存放在后端 `prompts/智能统一视觉分析.md`，前端没有硬编码完整真实元提示词。
- 服务端统一字段解析会拒绝空字段、数值焦段、时间码与分镜编号泄漏。
- 最终视频卡的智能统一来源已改为 `prefix.smartUnifiedStyle` 优先，`extractInfo.visualStyle` 仅作旧历史回退。

### 自动执行验证当前阻塞
- Workflow run：`34022552877`。
- `node-contracts`：`runner_id=0`，`steps=[]`，未实际执行 npm/test 命令。
- `frontend-build`：`runner_id=0`，`steps=[]`，未实际执行 npm/test/build 命令。
- 所以当前准确状态是：**代码和测试均已写入，但 GitHub Runner 没有实际执行；没有“测试通过/构建通过”的证据。**

下一次 runner 恢复后，Phase 5 必须重新获得新鲜通过证据后才能宣称完成。
