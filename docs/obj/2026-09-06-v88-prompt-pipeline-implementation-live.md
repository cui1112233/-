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

### Phase 1 — 智能统一规则【执行中】
- [ ] 先补失败测试：统一风格字段、职责边界、完整剧本输入、不能混入单镜头动作/焦段/灯位。
- [ ] 后端新增/整理系统级元提示词与结构化输出契约。
- [ ] 接入公网“约束设置 → 画面前缀词 → 智能统一”。
- [ ] 保证系统预设词由后端托管，前端只选择/展示结果。
- [ ] 跑针对性测试并记录结果。

### Phase 2 — 第三步：Global Director Plan【待执行】
- [ ] 先补失败测试：逐条原文索引、事件语义、时长规划、上下文承接。
- [ ] 建立导演要求语义合同。
- [ ] 实现/整理 Global Director Plan 元提示词。
- [ ] 对长剧本引入 Scene/Event 语义批次和 Story Map/上下文摘要机制（仅在当前架构需要时）。
- [ ] `matchAudio=true` 时将总时长作为硬约束传递到导演规划。

### Phase 3 — 第四步：每条完整视频画面提示词【待执行】
- [ ] 先补失败测试：一条原文 = 一张外层画面卡；每卡 1~6 个 micro_shots。
- [ ] 第三步与第四步使用同一权威执行结果，禁止第四步独立重写第三步结论。
- [ ] 输出完整镜头字段：时间、景别、观察角度、运镜、动作、环境、光线、节奏等。
- [ ] 增加语义验收；只对失败原文行做定向修复一次。
- [ ] 原子写入第三/第四步结果。

### Phase 4 — 第五步：确定性最终分段【待执行】
- [ ] 先补失败测试：0 次 AI；只做分组、时间换算、字段拼接。
- [ ] `matchAudio=true` 时最后一段结束时间必须严格等于 `audioDurationSec`。
- [ ] 每段拼接顺序固定：统一风格 → 本段人物 → 镜头画面 → 负面提示词 → 声音/文字隔离 → 画质约束。
- [ ] 保护 Master Visual Prompt；精品/参考图模式只注入 `(@图N)` 索引，不重写内容。
- [ ] Segment 级独立任务；单段失败只重试该段。

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
- 文本 AI 客户端：`frontend/src/shared/api/generation.js`，统一请求 `/api/chat`。
- 文本 AI 服务端：`routes/chat.js`。
- 系统预设目录：`prompts/`，注册表在 `lib/system-preset-catalog.js`。
- 视频段任务：`routes/script-video.js`；当前已经按单卡独立提交并单独轮询状态。

### 3.2 当前已有能力

1. **智能统一入口已存在，但分析层不独立。**
   - 预设 ID：`script-constraint-prefix-smart-unified`。
   - 当前只是把人物/场景提取阶段得到的 `visualStyle` 再注入画面前缀。
   - 没有在用户明确选择“智能统一”时，针对完整剧本单独运行一次专业统一视觉分析。

2. **V88 已经有十一项统一风格雏形。**
   - `prompts/小说面板人物场景提取.md` 要求统一风格按十一项生成一行中文。
   - 但它仍与人物/场景提取混在一次 AI 调用中，职责边界没有 V78 独立分析层清楚。

3. **已有导演母版，但仍是一轮直接出成品。**
   - `prompts/导演级分镜母版.md` 已包含完整读原文、场景边界、blocking、连续性、动作链和静默质检等优秀规则。
   - `prompts/快速导演分镜.md` 仍要求“请直接交付完整导演分镜成品”。
   - `routes/chat.js` 的 `script` / `quick_director` 都是单次 upstream AI 调用；还没有 Global Director Plan → 执行 → 验收 → 定向修复事务。

4. **`matchAudio=true` 的总时长硬约束已经存在。**
   - `lib/script-generation-rules.js::buildAudioMatchRules()` 明确要求所有独立分镜单元时长之和精确等于真实音频总秒数。
   - 后续必须保留并进一步把该总时长传到 Global Director Plan 与最终确定性校验层。

5. **第五步已经有“0 AI”雏形。**
   - `scriptShotOutput.js` 与 `scriptFinalSegment.js` 会在前端本地解析、切段、重置相对时间、剥离模型乱输出的共享设定，再按用户实际开关注入基础设定、画面前缀、画质/限制和负面词。
   - 因此本轮不为“形式一致”强迁到 Go；优先强化现有确定性 JS 层，避免无收益重构。
   - 只有后续发现必须由服务端/执行器跨端共享同一算法时，再提取为后端共享实现。

6. **Segment 级失败隔离已具备基础。**
   - 当前每张最终分镜卡独立调用 `/api/script-video`，单段任务拥有独立 taskId/status。
   - 后续只需要保证最终提示词卡稳定，不应重新合成一个 mega prompt。

### 3.3 当前测试/验证条件

- 前端有 `npm --prefix frontend run test`，但脚本目前只覆盖 `src/shared/api/*.test.js`。
- 根 Node 代码存在大量 `node:test` 风格 `*.test.js`，可为 `lib/script-generation-rules.js`、新流水线模块和路由私有 builder 新增针对性测试。
- Go 后端有 `*_test.go`，但公网文本生成主链目前在 Node，不应把本轮测试错误放进无关 Go 包。
- `.github/workflows/` 当前没有专门覆盖剧本提示词流水线的通用 CI；因此本轮会增加可独立执行的 Node 测试，并在最终验证时明确记录哪些验证有 CI 证据、哪些只能做代码级静态验证，绝不把未运行的测试宣称为通过。

### 3.4 最小修改边界

本轮按现有架构增量实现：

```text
prompts/                            系统元提示词（新增/完善）
lib/script-generation-rules.js     纯规则、时长与结构校验
lib/system-preset-catalog.js       注册新增系统预设
routes/chat.js                      新 promptType / message builder
frontend/src/shared/api/generation.js
                                    调用新增 AI 阶段
frontend/src/user/pages/ScriptPage.jsx
                                    串联阶段并持久化权威结果
frontend/src/user/pages/scriptFinalSegment.js
                                    强化第五步确定性校验与拼接
对应 *.test.js                    TDD 回归
```

不做：无关 UI 重构、无必要 Go 迁移、把所有逻辑重新塞回 `ScriptPage.jsx`、用前端硬编码真实系统提示词。

---

## 4. 实时执行日志

### 2026-09-06 — 启动
- 已获用户明确批准执行。
- 已调用 Superpowers：`using-superpowers`、`brainstorming`、`writing-plans`、`executing-plans`、`test-driven-development`。
- 已确定先定位真实 V88 入口和测试框架，再写失败测试，不直接拍脑袋改业务代码。

### 2026-09-06 — Phase 0 完成
- 已核对公网 React、Node prompt builder、系统预设目录、约束拼接、matchAudio、最终分段和视频段任务。
- 结论：保留 V88 已有的导演母版、音频硬约束、0-AI 最终卡片组装与 Segment 独立任务；只补 V78 中缺失的独立统一视觉分析、Global Plan、执行/验收/定向修复层。
- Phase 1 开始：先建立智能统一的测试合同和后端系统元提示词。

---

## 5. 已修改文件

- `docs/obj/2026-09-06-v88-prompt-pipeline-implementation-live.md` — 本实时实施记录。

---

## 6. 验证记录

- Phase 0 为源码基线调查，无业务代码变更。
- 已确认前端构建命令：`npm --prefix frontend run build`。
- 已确认前端现有测试命令：`npm --prefix frontend run test`（覆盖范围有限）。
- Node 根目录测试采用 `node:test` 文件，可按文件执行。
- 尚未声称任何新增业务实现通过测试；Phase 1 即将进入 RED → GREEN。
