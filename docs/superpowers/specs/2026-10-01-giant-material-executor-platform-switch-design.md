# 巨量素材执行器：Mac/Win 双平台切换 + 同机身份合并

- 日期：2026-10-01
- 状态：已与用户分节确认
- 范围：巨量素材（giant_material）读取通道的执行器侧；Go 控制面 + 用户前端
- 不在范围：执行器程序自身新版本（不重新打包 Mac 包、不发 0.4.10）；普通书城流程仅做回归

## 1. 背景与现状

每台巨量素材执行器配对时如实上报系统类型（Windows 上报 `windows`，macOS 上报 `darwin`），设备表 `giant_executors` 已保存 `os`、`app_version`、`last_seen_at` 等字段。

现有问题：

1. **派活不分平台**：任务进入队列后由执行器主动 claim（`Service.Claim` → `Store.ClaimJob`），SQL 只按 owner/platform/排队顺序选任务，谁先领归谁。用户无法指定优先使用 Mac 还是 Win。
2. **同机重复身份**：`Service.Pair` 每次配对都无条件生成新执行器 ID 和新 token（service.go:57-62），不检查"同账号 + 同系统 + 同设备名"是否已存在。历次版本升级解压到新文件夹、重新配对后，同一台电脑产生 4 条记录（设备名均为 `PC-202512101831\Administrator`，版本 0.4.9/0.4.3/0.4.2/0.3.0）。
3. 顶部状态条（`BatchFactoryGiantMaterialExecutorStatus` dot 变体）只显示"第一台在线设备"，看不到两个平台各自的状态。

关键时间常量：执行器心跳间隔 15 秒；`OnlineThreshold` = 45 秒；`JobLeaseTTL` = 60 秒。

## 2. 用户需求（确认结论）

1. 状态区分 **Mac 版在线 / Win 版在线**，两台都登录时都能看到。
2. 设置页可手动切换优先平台；开关为**全局一个**（账号级），管之后所有新建的巨量任务。
3. 偏好平台"用不了"= **离线** 或 **干砸了**（主动报告失败）；任务自动交给另一平台。
4. 偏好平台恢复后**新任务自动切回**；已在另一平台手上做到一半的任务不抢回。
5. 同一台电脑的多条记录合并为一条；以后配对自动认老设备。
6. 设置页提供"删除设备"入口。
7. 设备名格式统一为"电脑名 + 用户名"：Windows 现状已满足（`PC-...\Administrator`），仅改 macOS 侧代码；**本次不重新生成 Mac 压缩包**，新逻辑随以后打包生效。

## 3. 方案选型

采用**做法一：claim 时现做现判定**。

- 每个执行器 claim 时，控制面根据账号偏好、各平台在线状态、近 5 分钟失败记录当场判定它能不能领。
- 不在 job 上贴目标平台标签、不保存"当前生效平台"等中间状态。
- 偏好平台恢复后自动恢复优先是判定逻辑的天然结果，不存在开关卡住。
- 放弃做法二（job 贴标签 + 撕换标签，环节多且需改任务表）和做法三（只看离线不看失败，不符合需求）。

## 4. 数据模型变更

### 4.1 新表 `giant_executor_preferences`

账号级偏好，一人一行：

| 字段 | 类型 | 说明 |
|---|---|---|
| owner_username | VARCHAR(191)，主键 | 账号 |
| preferred_os | VARCHAR(32)，非空 | `windows` 或 `darwin` |
| updated_at | DATETIME(6) | 最后改动时间 |

无行时默认 **Windows 优先**（与既有使用习惯一致）。通过 Go 迁移脚本建表（迁移版本号在实现时取下一个可用号）。

### 4.2 既有表不变

`giant_executor_jobs` 不增加目标平台字段；平台归属在 claim 时实时计算。

## 5. 核心逻辑：claim 判定

执行器（os = callerOS）发起 claim 时：

1. 取账号偏好 `preferred`（无记录 = `windows`）。
2. **偏好平台在线**（该账号 `giant_executors` 中 os=preferred 且 `last_seen_at >= now-45s` 的设备存在）：
   - callerOS = preferred：正常在队列中选任务。
   - callerOS ≠ preferred：
     - 偏好平台近 5 分钟（`FailureCooldown = 5min`）内没有失败记录 → 返回 `ErrNoClaimableJob`（"暂时没你的单"）。
     - 偏好平台有近 5 分钟失败记录 → 允许非偏好平台 claim（兜底）。
3. **偏好平台不在线**：允许另一平台 claim；两台都不在线时都领不到，任务保持排队。
4. **冷却恢复（试岗）**：冷却到期后偏好平台的 claim 恢复正常。其再次失败则重新冷却 5 分钟；成功则完全恢复优先。不设"一次失败永久停用"。
5. **进行中任务不抢**：claim SQL 只选 `queued`（及租约已过期）的任务，leased/uploading 状态由行锁与租约保护，另一平台恢复不影响在做的任务。
6. **服务器侧假死保护（不改执行器）**：claim 选任务范围额外纳入"租约未过期但超过 10 分钟（`StuckProgressLimit`）进度完全未更新"的任务——视为执行器假死，任务按上述平台判定重新派发，并记录事件。这是对执行器 0.4.10（10 分钟无进度自保）的服务端兜底；0.4.10 发布后形成双保险。

失败判定依据：事件/任务状态中该平台设备在近 5 分钟内有 `failed` 终态记录（job 的 `lease_executor_id` 可确定平台；事件表记录失败时间）。判定所需数据在实现时用一条只读查询取得并在 claim 事务内校验。

## 6. 配对：一台电脑 = 一条身份

### 6.1 Pair 改为认老设备

`Service.Pair` 在生成新 token 前，按 `owner_username + os + device_name` 查既有记录：

- **命中**：沿用该执行器 ID，更新 `token_hash`（旧 token 立即失效）、`app_version`、`updated_at`；配对码照常核销。
- **未命中**：新建执行器记录（现有逻辑）。
- 设备字段校验（device_name/os/version 非空、os 白名单）保持不变。

### 6.2 现存重复记录一次性合并

控制面启动时执行幂等的合并过程（只对仍存在重复的组生效，中断重启后自动继续）：

1. 按 `owner_username + os + device_name` 分组，找出记录数 > 1 的组。
2. 组内保留"版本最新（其次 last_seen 最新）"的一条；当前 4 条全离线无 running 任务，安全。
3. `giant_executor_jobs.lease_executor_id`、`giant_executor_job_events.executor_id` 中的旧 ID 改写为保留 ID（历史可追溯）。
4. 删除旧记录。

### 6.3 删除设备

DELETE 设备时：其名下未完成任务（leased/uploading、租约未到期）取消租约、状态重置为 queued，自动重新排队，不丢单；已完成任务与历史事件保留。

### 6.4 设备名规则

`localDeviceName()` 按平台区分，格式统一为"电脑名 + 用户名"：

- Windows：保持系统返回值（形如 `PC-202512101831\Administrator`），不改——保证 0.4.9 现有记录名不变。
- macOS：改为 `电脑名/用户名`（如 `MacBook-Pro/cuijiaming`），用 hostname + 当前用户名拼接。
- 仅源码改动，**本次不重新打包、不发布 Mac 执行器**。

## 7. 接口变更（Go 控制面）

| 方法/路径 | 作用 |
|---|---|
| GET `/api/giant-material-executor/v1/preference` | 读取当前偏好（无记录返回默认 windows） |
| PUT `/api/giant-material-executor/v1/preference` | 保存 `{ preferredOs: 'windows' \| 'darwin' }`，校验白名单 |
| DELETE `/api/giant-material-executor/v1/executors/{id}` | 删除设备（§6.3） |

claim 接口路径不变，行为按 §5 改变；"列出全部执行器"接口仍返回每台设备 online/os/version，并在响应中增加按平台汇总的近 5 分钟失败标记（§8.2）。

## 8. 前端变更

### 8.1 设置页（SettingsPage.jsx 巨量素材执行器区块）

1. 设备清单上方加"优先读取平台"：Windows / macOS 两个并排可点选项，点击即调 PUT 偏好并立即生效。
2. 选项**永不禁用**：选了 macOS 但无在线 Mac 设备时，选项下方提示"当前没有在线的 macOS 设备，任务仍会交给 Windows"；保存失败提示重试，不假报成功。
3. 设备列表每条右侧加"删除"（Popconfirm 二次确认），删除后刷新列表。
4. 合并生效后列表由 4 条变 1 条。

### 8.2 顶部状态条（dot 变体）

改为双平台渲染，各一个圆点：

- `● Windows 在线　● macOS 离线`（在线亮色、离线灰色）。
- 后缀小字标偏好与生效状态：
  - 两台在线、偏好生效：`优先：macOS`
  - 偏好平台冷却中：`优先：macOS（冷却中，暂用 Windows）`
  - 偏好平台离线：`优先：macOS（离线，暂用 Windows）`
- 数据来源：执行器列表接口（按 os 分组、online 判定）+ GET 偏好。在"列出执行器"响应中为每个平台补充一个近 5 分钟失败标记（如 `recentFailureAt`），前端据此明确显示"冷却中"，不靠前端猜。

### 8.3 样式

沿用现有暗色主题 CSS（`shuihuo-production.css` 中 gme-executor-dot 系列及设置页样式），新增双平台行与偏好选项样式。

## 9. 出错处理

| 情况 | 处理 |
|---|---|
| 两台都离线 | 任务保持排队，不判失败；设备回来自动领 |
| 偏好平台失败、另一平台也失败 | 任务回队，等先冷却到点的平台领，不丢单 |
| 偏好平台失败后立即恢复在线 | 仍需冷却满 5 分钟，到点给试岗单，防反复崩溃空转 |
| 任务进行中切换偏好 | 在做的不抢，下一单走新偏好 |
| 删除正在跑活的设备 | 租约 60 秒失效/删除时立即释放，任务回队 |
| 保存偏好网络失败 | 明确提示失败、保持可点，不写本地假状态 |
| 合并过程中重启 | 合并幂等，只处理仍重复的组，重启自动续跑 |

边界：执行器 worker 崩溃且不上报的假死，在执行器 0.4.10 发布前由 §5.6 服务端 10 分钟保护兜底；0.4.10 本身不在本次范围。

## 10. 验收

### 10.1 自动化测试（Go 侧先写测试）

1. 偏好 darwin、两台在线：只有 darwin 能 claim，windows 领不到。
2. 偏好 darwin、darwin 离线：windows 能 claim。
3. 偏好 darwin、darwin 近 5 分钟失败（冷却）：windows 能 claim；时钟推进 5 分钟后 darwin 恢复可 claim。
4. darwin 失败后 windows 也失败：任务不丢，冷却后可重领。
5. 同账号 + 同 os + 同设备名重复 Pair：不新增记录，token/version 被更新，旧 token 失效。
6. 一次性合并：4 条重复 → 保留 1 条（版本最新），jobs/events 均挂保留 ID，旧记录删除；重复运行无副作用。
7. 删除设备：在跑任务释放回队、历史保留。
8. 假死保护：租约内 10 分钟进度不动的任务可被重新派发。
9. 前端源码级测试：设置页存在 Windows/macOS 偏好选项与删除入口；dot 状态条按两个平台渲染。

### 10.2 构建

Go 编译、全部 Go 测试通过；前端 `npm run build` 成功；既有前端相关测试回归通过。

### 10.3 公网实测（发布后）

1. Ctrl+Shift+R 强制刷新；设置页：4 条 → 1 条，出现平台切换与删除按钮，当前默认 Windows。
2. Win 执行器在线：新建巨量批量，顶部显示"Windows 在线、macOS 离线"，任务正常派给 Win 并跑通后续流水线。
3. 有 Mac 时：两台在线、切到 macOS → 新任务给 Mac；Mac 关闭 → 顶部变"离线，暂用 Windows"，任务不断；Mac 干砸一次 → 5 分钟内走 Win。
4. 回归：新建普通书城批量（非巨量），全流程无异常。

## 11. 发布方式

Go（迁移 + 接口 + claim 判定）与 Node（前端页面）均有改动：按 v88 惯例做 Go + Node 精确 SHA 增量部署；部署前查询 `giant_executor_jobs` 确认无 running/cleaning 任务；记录发布 SHA 与回滚点。不重新生成执行器安装包。
