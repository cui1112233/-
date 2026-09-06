# V88 一战晟铭豆包执行器 Phase 1 执行档

日期：2026-09-06  
项目：一战晟铭 V88  
正式基线：`v88`  
工作分支：`fix/v88-doubao-executor-phase1-20260906`  
原则：只收口到 V88，不合 master；源码证据优先；关键行为采用 TDD；没有真实测试证据不宣称 GREEN。

## 1. 本阶段目标

把“设置 → 豆包执行器”和 `/script` VIDEO 任务链路收口为可诊断、可升级、可精确确认接单、可精确匹配成片的正式 V88 实现：

```text
公网 /script
→ 创建本地 VIDEO 任务
→ Go localexecutor
→ Windows 一战晟铭豆包执行器
→ 领取任务
→ 绑定正确豆包账号/页面
→ 设置模型/时长/比例/参考图/提示词
→ 点击生成
→ 确认豆包真正接单
→ generating
→ 精确匹配本次成片
→ 下载 MP4
→ 上传公网
→ succeeded
→ /script 可播放
```

## 2. 状态机硬规则

```text
queued              等待执行器领取
leased              已领取
preparing           准备豆包页面
submitting          正在提交
acceptance_unknown  正在确认是否接单
accepted            豆包已接单
generating          豆包正在生成
downloading         正在下载
uploading           正在回传
succeeded           完成
failed              失败
cancelled           取消
```

只有服务端已记录 `accepted` 才允许进入 `generating`。网页不得把 queued/preparing/submitting/acceptance_unknown 统一误显示成“视频生成中”。

## 3. 已完成且有历史 GREEN 的部分

### Step 1：Node → Go VIDEO bridge + stable 下载源

关键提交：

```text
af69bbf90d7416069c7f8d62dd1c9c34f763505e
```

历史 GREEN：`34017379066`

### Step 2–3：设置页动态版本

关键提交：

```text
0847510b7f552087223412b3efbd0b5a72816e8a
```

历史 GREEN：`34018080537`

### Step 4–5：yizhan-executor:// + Electron 单实例

关键提交：

```text
9f9fd1fbc948d2fd3cf1dac8c057cddae9e1cc57
```

历史 GREEN：`34018270271`

### Step 6：设置页“打开执行器”

关键提交：

```text
8b2b6751e31c6ac53c02f840b375a825dff72c64
```

历史 GREEN：`34018460735`

## 4. Step 7：/script 真实 VIDEO stage

关键提交：

```text
52ff1d55b7ea20a1f4df6a03b183e93485e3cb36  stage helper
bd2b3f30c8bfb51678ef6d97ddb1a6b80d916bf7  ShotOutputCards 显示真实 stage
e1a030cf03749ed37f9d4c07fde2f6f4692a95dc  ScriptPage 轮询持续写回真实 stage
c66cb8e0222a2d52d7d657e6d9c393ed341252de  页面集成契约
```

确定修复：

- Go 正式列表返回 `{"executors": [...]}`，原 ScriptPage 误读 `result.items`，已改 `result.executors`。
- 创建任务保存服务端 status/stage。
- 每轮 poll 都合并服务端阶段。
- 历史/草稿恢复继续轮询全部非终态。
- 只有 `stage=generating` 才显示“豆包正在生成视频”。
- failed/cancelled 可以重新生成。

## 5. Step 8：接单 / 网络证据 / 精确成片

已确认：

- unknown 只恢复取证，不重复点击提交。
- recoverAcceptance 最多 3 次。
- 只有明确 not_accepted 才允许重新 submit。
- accepted 后的完成/下载/上传重试不会重新生成。
- Go/MySQL 强制 accepted → generating。
- human_verification / quota_exhausted / auth_required 会 hold 账号。
- bindExactMedia 无唯一匹配就失败。

发现并修复：旧 `conversationId` 不得单独证明本次接单，也不得单独把同会话旧视频绑定为当前成片。

关键提交：

```text
257a5dbab6bc9c91eb814b9d7426da39d4c02148  conversation-only acceptance 测试
813d7761cc83c95c4b1e98ba38704964d727e9c5  require submission identity
d3753e84a6110fb004e3ea232cb6534e06c3fe34  reject same-conversation old media
```

新规则：只有 `messageId / taskId / generationId` 能推进网络 accepted；conversation/media/video id 只能作为上下文辅助身份。

## 6. Step 9：结构化日志

新增本机日志：

```text
userData/logs/executor-events.jsonl
```

关键提交：

```text
43e70cf9dbdd770dfa5972af2d15419ad2911408  structured logger
6bb91ec15fefb6902cce894cd0885b9bfa5c40e1  JobRunner 边界日志
8b9d9603913a13f44546e9ea49d4f641dde0b2e2  DoubaoAdapter 页面边界日志
065e06a64510e4069ac8c54bdc5969bd20b9adb8  Electron wiring
33f8c0164244450ca971f1a349a069a03fd22020  修正 CommonJS wiring test
8297bae21b703758715178e28b970adfba8bcdb7  SUBMIT_CLICKED 仅在真实点击成功后记录
```

日志事件：

```text
JOB_CLAIMED
ACCOUNT_ACQUIRED
DOUBAO_PAGE_READY
VIDEO_OPTIONS_SELECTED
PROMPT_FILLED
SUBMIT_CLICKED
ACCEPTANCE_UNKNOWN
ACCEPTANCE_DETECTED
GENERATION_STARTED
MEDIA_DETECTED
VIDEO_DOWNLOADED
ARTIFACT_UPLOADED
JOB_COMPLETED
JOB_FAILED
```

日志禁止保存：完整 prompt、executor token、lease token、Cookie、Authorization、签名下载 URL query、账号密码。

## 7. 更新 / 覆盖安装机制

当前 UpdateManager 已确认：

- 更新源必须 HTTPS。
- manifest 校验 schema/channel/platform/arch/version/file/SHA256/size/publishedAt。
- 更新下载目录：`userData/updates`，不是 Downloads。
- 下载前清理旧执行器更新安装包。
- 文件大小不符拒绝。
- SHA-256 不符删除候选并拒绝安装。
- 正在执行 VIDEO 时不重启，进入 install_deferred。
- 空闲后启动 NSIS：`--updated /S --force-run`，随后退出旧执行器。
- device/accounts/update preferences/logs 均位于 Electron userData。
- NSIS `deleteAppDataOnUninstall=false`，覆盖更新不会删除配对/账号持久数据。

## 8. Windows 构建 / 体积门槛

Windows workflow：

```text
.github/workflows/v88-local-executor-windows.yml
```

已完成：

- 当前 Phase 分支自动触发 Windows build。
- 版本只读取 `local-executor/package.json`，不再多处硬编码 `1.0.3`。
- 自动生成正式文件名。
- 自动计算 SHA-256。
- 自动记录 sizeBytes / sizeMiB。
- 自动生成 `build-report.json`。
- 自动生成 update feed manifest。
- 构建 artifact 包含安装包、SHA、build-report、update-feed。

关键提交：

```text
a4dce3712488fa40dd67c8753c61b8c55662b82c  动态版本 + build report
dae943a0a7f2473c197fecf5adbfe9bd0ece6727  size gate 测试
ac2a9777b4e29d9ddc9c96849ad9db600722d508  90 MiB 硬门槛
```

Phase 1 当前保留 Electron，因此早期约 79 MiB 是现实基线；本阶段设置最大 90 MiB 门槛，超过即 CI 失败。不新增 Chromium/Playwright/Python/Node 副本/完整 FFmpeg，不使用 UPX 强压缩。

## 9. V88 基线同步

执行过程中发现工作分支相对 `v88` 曾为：

```text
ahead 51 / behind 25
```

审计 V88 独有 25 个提交，主要涉及 V78.3.0.31 小说面板、Linux release workflow、server.js 等，与本次豆包执行器核心文件无重叠。

通过 PR #18 将最新 `v88` 安全合回工作分支：

```text
merge commit: 352bcef7af5439ec0ff94ff4726c8565e692e2e6
```

同步后：

```text
工作分支 ahead / behind = ahead 52 / behind 0
```

未把任何 Phase 代码合入正式 `v88`。

## 10. 当前 GitHub Actions 外部阻塞

历史 Step 1–6 曾正常获得 GitHub hosted runner 并 GREEN。

从 Step 7 后开始，多轮 Ubuntu 与 Windows workflow 均出现：

```text
steps=[] / steps=null
runner_id=0
runner_name=""
logs_url=null
```

直接下载 job log 还返回 BlobNotFound，说明 job 连第一步 Checkout 都未真正开始。

代表性 run：

```text
34020329804
34020375585
34020644614
34020695665
34020824393
34021048780
34021235359
34021505061
34021547184
```

其中 Windows `34021547184` 也是零 step，证明不是 Ubuntu runner 单点，也不是构建脚本失败。

2026-09-06 GitHub 官方状态页显示 Actions 正常，没有当前公开事故。因此更像当前私有仓库/账号的 Actions hosted runner 配额、计费或权限侧限制；现有 GitHub 连接无法读取账户 billing/Actions admin 页面，暂时不能进一步证明具体是哪一种。

为后续恢复增加：

```text
11a78cd49b2eb4d375bab8d29e614065f3d11efb
```

`V88 Doubao Executor Verify` 已支持 `workflow_dispatch`，恢复后可直接手动跑完整回归。

## 11. 当前完成状态

- [x] Step 1：VIDEO bridge + stable 下载源
- [x] Step 2：Settings 动态下载版本
- [x] Step 3：当前/最新/最低版本状态
- [x] Step 4：`yizhan-executor://`
- [x] Step 5：Electron 单实例
- [x] Step 6：设置页打开执行器
- [ ] Step 7：真实 VIDEO stage（代码完成，等待真实 CI）
- [ ] Step 8：接单/网络/成片绑定（代码完成，等待真实 CI）
- [ ] Step 9：结构化日志（代码完成，等待真实 CI）
- [ ] Step 10：Go / Node / Executor / Frontend 完整回归
- [ ] Step 11：Windows NSIS 实际构建
- [ ] Step 12：取得真实 installer 版本 / 字节数 / MiB / SHA-256
- [ ] Step 13：Windows 实机安装、覆盖更新、协议唤起、单实例
- [ ] Step 14：实机 `/script → executor → doubao → mp4 → upload → succeeded`
- [ ] Step 15：全部真实验证通过后合并到 `v88`，不合 master

## 12. 下一验收条件

只有以下全部满足，才允许 Step 15：

1. GitHub Actions 或等价本地环境真实执行所有测试，而不是 runner_id=0。
2. Go / Node / local-executor / frontend tests 全通过。
3. Frontend build 成功。
4. Windows NSIS 成功构建。
5. 安装包 <= 90 MiB。
6. SHA-256 与 build report/manifest 一致。
7. Windows 首次安装成功。
8. 同目录覆盖更新成功，不产生 `(1)/(2)/(3)` 正式副本。
9. 配对、账号配置升级后保留。
10. `yizhan-executor://open` 正确唤起且保持单实例。
11. 一条真实 `/script` VIDEO 任务完整走到 succeeded。
12. JSONL 能明确定位每个关键边界，且不泄露敏感信息。
