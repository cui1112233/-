# OBJ｜V88 小说面板 V78.3.0.31 执行计划与实际记录

> 日期：2026-09-06  
> 仓库：`cui1112233/-`  
> 正式分支：`v88`  
> 模块：公网 `/novel-panel`  
> 当前状态：`SOURCE VERIFIED / V31 REGRESSION 7/7 PASS / PUBLIC DEPLOYMENT PENDING`

---

## 0. 固定开发约束

- 所有正式功能写入 `v88`，不修改旧版页面。
- 不整体覆盖 standalone Python 桌面包；迁移的是 V78.3.0.31 最终业务语义。
- 不机械按 `.20 → .21 → ... → .31` 搬运中间机制，只保留 V31 最终仍存在的逻辑。
- `.24～.26` 已经删除的 freshness / stale recovery / semantic baseline 机制不得重新引入。
- 保留 v88 现有登录、项目、历史、AI 设置、参考图、TTS、timeline 等能力。
- 版本号只能在核心逻辑和回归测试通过之后升级，禁止“只改版本号”。
- 必须区分以下状态：
  1. 代码已写
  2. 测试已过
  3. CI 已过
  4. 镜像已构建
  5. ECS 已部署
  6. 公网已验证

---

# 1. 总体执行计划

按以下顺序收口：

1. V78.3.0.22 原文事务保护（Source Transaction）
2. V78.3.0.23 生成条件事务保护（Generation Input Transaction）
3. V78.3.0.27 单条重生成：内容修改、总时长硬锁
4. V78.3.0.28 Patch Regenerate：Current Truth 单条修改
5. V78.3.0.30 专业摄影参数兼容 + 导演语法
6. V78.3.0.31 统一风格字段边界修复
7. V78.3.0.20 / .21 导演要求语义合同与唯一审计链
8. V78.3.0.24～.26 Current Truth 收口，确认退休机制没有重新出现
9. 写完整回归测试
10. 将 V31 回归接入 GitHub Actions
11. 全部测试通过后升级正式版本身份到 V78.3.0.31
12. 构建 Linux AMD64 Docker 发布包
13. 部署火山 ECS
14. 公网 `/novel-panel` 冒烟验证
15. 公网通过后标记 `PUBLIC DEPLOYED`

---

# 2. V78.3.0.22｜原文事务保护

## 目标

防止 AI 请求期间原文已经变化，但旧请求返回后又覆盖新状态。

## 权威字段

- `source_hash`
- `source_revision`
- `canonical_text`

## 规则

- 原文每次有效变化都增加 revision。
- 支持 Anti-ABA：即使文本 A → B → A，revision 已变化，A 的旧请求仍视为 stale。
- 原文变化时取消旧 outline / regenerate 请求。
- AI 请求返回、解析、写回之前都校验 source transaction。
- 旧请求失败也不能恢复旧原文快照。

## 最终原则

> AI 结果不是由“当前原文事务”生成的，就必须丢弃，不能写回。

---

# 3. V78.3.0.23｜生成条件事务保护

## 目标

不仅原文变化会使旧任务失效，所有影响生成结果的权威输入变化也必须让旧任务失效。

## fingerprint 覆盖输入

包括但不限于：

- 原文
- 导演要求
- 内容类型
- 统一风格
- 人物
- 场景
- trailer style
- camera / camera style
- AI instructions
- duration / audio duration
- scene guidance
- 人物外形相关生产输入

## 权威字段

- `input_fingerprint`
- `input_revision`

## 规则

- 任意生成条件变化，旧 outline / regenerate 事务作废。
- fetch 返回、JSON/text 读取、写回之前必须重新校验。
- 旧 AI 返回不能覆盖当前工作区。

---

# 4. V78.3.0.27｜单条重新生成：时长硬锁

## 目标

“重新生成这一条”只改内容，不允许 AI 擅自改变总秒数。

## 契约

- `locked_duration`
- `preserve_total_duration`
- `locked_micro_slots`
- `duration_authority: existing_card_locked`

## 规则

- 当前卡片总时长为硬约束。
- 已存在 micro_shots 时，默认保留原时间槽结构。
- AI 如果返回其他 duration，拒绝写回。
- 用户没有明确要求改结构时，不允许任意重拆时间槽。
- 成功 Patch 后直接从当前卡重建最终本地 segments。

---

# 5. V78.3.0.28｜Patch Regenerate Current Truth

## 唯一底稿

`current card + current scene + 最新 guidance`

## 规则

- existing/current card 是“待修改底稿”。
- 单条重生成只发一次 Patch AI 请求。
- 单条 Patch 不叠加整段 semantic audit 第二链路。
- 只修改用户最新补充意见明确指出的问题，以及必要的联动内容。
- 未明确要求结构变化时，不因旧模板/topic/density 擅自重拆镜头。
- 必须真正产生修改；最新 guidance 明确要求修改时，不接受原样返回旧 visual。
- Patch 成功后直接更新 Current Truth 与最终 segments。

---

# 6. V78.3.0.30｜专业摄影参数与导演语法

## 允许专业摄影表达

包括：

- ARRI ALEXA 35
- Sony VENICE 2
- RED V-RAPTOR
- Leica
- Apple iPhone Pro Cinematic
- Super35
- Large Format
- Full Frame
- LogC4
- AWG4
- S-Log3
- Log3G10
- Apple Log
- L-Log
- T1.4 / T2.8
- 180° shutter
- Black Pro-Mist 1/8
- Vision3 250D / 500T
- Kodak 2383
- Skin +0.3EV
- Key:Fill
- Bloom
- Halation
- Grain

## 规则

- 专业品牌、型号、缩写、单位可以保留国际写法。
- AI 可根据剧情自由选择，不做固定设备模板。
- 全片级相机/Log/胶片模拟参数不机械复制到每个微镜头。
- 每镜只写该镜真正需要的摄影信息。

## 导演语法

支持：

- Narrative Beat → Visual Beat
- Reaction Shot
- Coverage 三角
- POV 链
- Rack Focus
- 180°轴线
- L-cut / J-cut
- Insert Shot
- Cut on Action
- Eye-line Match
- Object-motivated Cut
- Spatial Reset
- Reveal
- 防审美疲劳

## 关键原则

> 说话者/旁白者不等于镜头必须一直拍说话者本人。

可以根据叙事需要切到：

- 听者反应
- 关系
- 物件
- 行为结果
- 空间信息

但禁止为了镜头变化新增原文不存在的剧情。

---

# 7. V78.3.0.31｜统一风格字段边界修复

## 摄影字段内合法表达

以下不能被当成污染：

- 无明显暗角
- 避免高光死白
- 不压黑暗部
- 低数字锐化
- 控制粗颗粒

## 修复原则

不能因为出现单独的：

- 不
- 避免
- 禁止

就判定统一风格字段污染。

## 仍然必须阻止真正跨字段污染

包括：

- 水印
- 字幕
- Logo
- 最终导出负面提示
- 人物外形要求
- 角色外形要求

## 错误语义

使用：

`未通过字段边界协议`

不再使用错误的：

`未通过中文纯净协议`

---

# 8. V78.3.0.20 / .21｜导演要求语义合同

## 合同分组

- `must_cover`
- `rhythm`
- `row_guidance`
- `scene_progression`

## 整段生成链

1. 编译用户导演要求为通用语义合同。
2. 执行正常整段生成。
3. 对最终生成结果进行 semantic audit。
4. 找出未通过要求对应的 source rows。
5. 只对失败 source rows 做一次定向修复。
6. 修复时保留原 duration。
7. 再进行一次最终验收。
8. 仍失败则不能把半成品当成功结果。

## 单条 Patch

- 不执行整段完整二次 semantic audit。
- 保持一次 Patch 请求模型。

## 最终原则

> 全局生成只有一条权威审计链，不维护多个相互冲突的 provenance / audit 状态。

---

# 9. V78.3.0.24～.26｜Current Truth 最终收口

这些版本的最终意义是“删除旧机制”，不是新增更多 freshness 系统。

## V31 不允许重新出现

- artifact freshness dependency
- stale artifact recovery queue
- stale recovery UI 按钮
- adopt baseline
- semantic freshness baseline
- baseline migration
- runtime-only instruction revision side-effect guard
- runtime-only character revision side-effect guard
- merge semantic freshness diff

## 最终权威模型

`Source Transaction`
+
`Generation Input Transaction`
+
`Current Truth`

## 输出原则

合并、复制、导出等最终操作直接读取当前状态。

---

# 10. 实际落地文件/模块

本轮 V31 收口涉及/新增的主要位置：

- `public/novel-panel/workbench/v783031-runtime.js`
- `public/novel-panel/workbench/clean-core/release.js`
- `lib/novel-panel/v783031-regeneration-middleware.js`
- `lib/novel-panel/v783031-outline-route.js`
- `lib/novel-panel/v783031-build-info.js`
- `server.js`
- `tests/novel-panel-v783031-*.test.js`
- `.github/workflows/novel-panel-v783031-regression.yml`

说明：

- 没有整体覆盖 1.5MB 的旧 `app.js`。
- 使用较小、可验证、可回归的兼容/前置模块把 V31 最终语义接入现有正式链路。
- 认证、AI 设置、用量统计等仍走现有 coreApp 正式能力。

---

# 11. TDD / CI 实际过程

## RED → GREEN 过程

### V31 Runtime

- 先写回归测试。
- 测试因 V31 模块不存在而 RED。
- 实现 V31 runtime 后 GREEN。

### V27/V28 后端 Patch

- 先写 duration / micro-slot / guidance / current truth 契约测试。
- 测试 RED。
- 新增 regeneration middleware 与契约后 GREEN。

### V20/V21 导演语义合同

- 先写“只修失败 source rows、保留其他行与时长、修完复验”测试。
- 测试 RED。
- 接入整段 `/outline-scenes` 正式入口后 GREEN。

### 版本身份

- 先写 V31 public identity 测试。
- 原 release 仍为 `v78.3.0.2`，测试按预期 RED。
- 核心语义全通过后再升级正式 public identity。
- 最终 GREEN。

---

# 12. CI 排错记录

V31 GitHub Actions 建立过程中出现过以下测试基础设施问题：

## 问题 1：目录递归 / symlink

`.24～.26` 退休机制测试遍历目录时遇到递归路径问题。

修复：

- 跳过符号链接。
- 使用 realpath 防循环。

## 问题 2：ENAMETOOLONG

测试遍历器错误地把“已经读取的文件内容”再次当成文件路径读取。

修复：

- 正确区分 path 与 content。

## 问题 3：错误 schema 假设

测试错误假定 `app.js` 内必须出现字面量：

`SCHEMA_VERSION=40`

实际 workspace schema 权威在后端 build-info。

修复：

- 改为验证 `workspace_schema_version: 40`。
- 不再依赖错误的代码书写形式。

---

# 13. V31 GitHub Actions 最终结果

专用 workflow：

`.github/workflows/novel-panel-v783031-regression.yml`

执行：

```bash
node --test tests/novel-panel-v783031-*.test.js
```

最终结果：

**7 / 7 PASS**

通过项：

1. V78.3.0.31 CI contract regression：PASS
2. V78.3.0.20/21 director semantic outline regression：PASS
3. V78.3.0.27/28 regeneration middleware regression：PASS
4. V78.3.0.24-26 retired freshness semantics regression：PASS
5. V78.3.0.31 runtime regression：PASS
6. V78.3.0.31 server mounts regression：PASS
7. V78.3.0.31 public version identity regression：PASS

已确认 GitHub Actions job：

- job `101443350939`
- conclusion：`success`

---

# 14. 正式版本身份

核心语义与回归全部通过后，正式公开身份才从：

`V78.3.0.2`

升级为：

`V78.3.0.31`

正式 Build：

`v78.3.0.31-final-semantics-20260906-r1`

Workspace Schema：

`40`

## 对外身份层

包括：

- 前端 release authority
- `__VIDEO_PROMPT_TOOL_BUILD__`
- `__V78_CURRENT_RUNTIME__`
- `/api/novel-panel/build-info`
- V31 capability flags

采用“小型权威覆盖层”，不批量替换旧 bundle 中仅用于历史/兼容的版本字符串。

---

# 15. 关键提交记录（本轮已知）

以下为本轮可确认的关键提交节点：

- `4726cca…`：加入 V31 专用 GitHub Actions
- `67502f21462c35adeb0574da706b1cb9c886c2da`：V31 CI 第一次完整成功
- `741017c6a8729972cde3de54413a80de7630a84e`：加入 public identity RED 测试
- `b4a90857653796de7423235c4f1765126b766083`：新增 V31 build-info authority
- `94601ca951853fd739caff181f9b721cbec35ee9`：挂载 V31 build-info overlay
- `21eefd231526292e10ce225222c0d606859804c4`：正式提升 V78.3.0.31 public release identity
- `2b86b9c667cf5575fbc10baa5ed8707bbf6c1423`：最终 public identity 测试修正并 7/7 PASS

---

# 16. 当前发布状态

## 源码层

✅ V78.3.0.31 最终语义已收口到 `v88`

## 回归测试

✅ 7 / 7 PASS

## V88 CM Public Release Guard

✅ 已有运行成功记录

## BF11 Integrated Runtime Verify

✅ 已有运行成功记录

## Linux AMD64 公网镜像发布

❌ 当前仍存在发布失败记录。

已确认失败 workflow：

- `V88 Linux AMD64 Public Image Release`
- run：`34017327266`
- conclusion：`failure`

注意：

> 目前只确认“镜像发布 workflow 失败”；尚未把正确的失败 job 日志完整定位到根因，因此不能在 OBJ 中编造失败原因。

## 火山 ECS

⏳ 尚未确认部署 V31 新镜像。

## 公网 `115.190.156.223:3000/novel-panel`

⏳ 尚不能声明已经运行 V78.3.0.31。

---

# 17. 下一步执行计划｜从当前节点继续

## Step 1｜定位 Linux AMD64 workflow 真正失败步骤

目标 workflow：

`V88 Linux AMD64 Public Image Release`

run：

`34017327266`

必须读取它自己的 jobs 列表和失败 job 日志，不能再误用 Novel Panel Regression 的 job 日志。

要判断失败发生在：

- Checkout
- runner architecture assertion
- frontend build
- CM release contract
- Docker build
- Docker image inspection
- Docker runtime verification
- docker save
- artifact upload

中的哪一步。

---

## Step 2｜只修发布链，不回退 V31 业务逻辑

原则：

- 不回退 V31 runtime。
- 不删除 V20/21、V22/23、V27/28、V30/31 能力。
- 不破坏 7/7 regression。
- 不重新引入 `.24～.26` 已退休机制。
- 如果是 workflow 配置问题，只修改 release pipeline。
- 如果是 Dockerfile / 镜像内容问题，写失败测试或镜像校验后再修。

---

## Step 3｜重新触发 Linux AMD64 Public Image Release

验收条件：

`conclusion = success`

并生成 artifact：

`qiantie-v88-linux-amd64-<SHORT_SHA>`

artifact 内必须包含：

- Docker image archive (`.tar.gz`)
- `SHA256SUMS`
- `RELEASE-METADATA.txt`
- `ECS-STORAGE.txt`

---

## Step 4｜ECS 部署

目标环境：火山 ECS。

标准动作：

1. 下载 GitHub Actions 生成的 Linux AMD64 release artifact。
2. 上传 ECS 建议目录：
   `/opt/qiantie/releases/v88/<SHORT_SHA>/`
3. 执行 SHA256 校验。
4. `docker load` 导入新镜像。
5. 检查镜像架构必须为 `linux/amd64`。
6. 记录当前线上容器配置与旧镜像，用于回滚。
7. 替换 v88 公网容器。
8. 保留原环境变量、MySQL、Redis、volume、端口、network 等配置。
9. 启动新容器。
10. 检查容器日志与健康状态。

---

## Step 5｜公网冒烟测试

必须验证：

- `/novel-panel`
- `/novel-panel/workbench`
- `/api/novel-panel/build-info`
- 登录/session
- 项目读取
- 历史记录
- AI 设置
- 参考图
- TTS
- 整段 outline generation
- 单条 regenerate
- duration 锁定
- guidance 修改是否真正生效
- V31 style boundary
- 专业摄影参数是否能正常通过

`build-info` 最终应包含：

```text
app_version = v78.3.0.31
release_version = v78.3.0.31
build_id = v78.3.0.31-final-semantics-20260906-r1
workspace_schema_version = 40
```

---

# 18. 完成定义

只有以下全部成立才允许把本任务标记为完成：

- [x] V31 最终业务语义已落到 v88
- [x] V31 回归 7/7 PASS
- [x] Public identity 已升级到 V78.3.0.31
- [ ] Linux AMD64 image workflow success
- [ ] 发布 artifact 成功生成
- [ ] 新镜像成功加载到 ECS
- [ ] 公网容器完成切换
- [ ] `/api/novel-panel/build-info` 公网返回 V31
- [ ] 整段生成公网冒烟通过
- [ ] 单条 Patch regenerate 公网冒烟通过
- [ ] 登录/项目/历史/AI 设置/参考图/TTS 无回归

全部通过后状态改为：

`V78.3.0.31 PUBLIC DEPLOYED / VERIFIED`

---

# 19. 后续 OBJ 更新规则

以后继续这个任务，不另开一套相互冲突的记录；直接更新本文件。

每次开发至少追加：

- 日期/时间
- 当前问题
- 设计决定
- 执行计划
- 实际执行步骤
- 修改文件
- commit SHA
- 测试结果
- CI run / job
- Docker artifact
- ECS 部署状态
- 公网验证结果
- 未完成事项
- 下一步

任何时候都必须明确区分：

`代码已写 ≠ CI 已过 ≠ 镜像已构建 ≠ ECS 已部署 ≠ 公网已验证`
