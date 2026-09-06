# V88 豆包执行器 — 网页一键更新与覆盖安装进度

日期：2026-09-06  
所属主执行档：`docs/obj/2026-09-06-v88-doubao-executor-phase1-execution-record.md`  
工作分支：`fix/v88-doubao-executor-phase1-20260906`

## 用户目标

已安装一战晟铭豆包执行器后，后续升级不应要求用户反复通过浏览器下载新的 EXE，不应产生：

```text
豆包执行器.exe
豆包执行器 (1).exe
豆包执行器 (2).exe
```

期望流程：

```text
设置页发现新版本
→ 用户点击【立即更新】
→ yizhan-executor://update
→ 唤起已安装执行器
→ 执行器内置 UpdateManager 检查版本
→ 下载到 userData/updates
→ 校验 size + SHA-256
→ VIDEO 任务忙时延迟安装
→ 空闲后 NSIS 原目录覆盖安装
→ 重新启动执行器
```

首次安装仍允许浏览器下载安装包；Settings 中 Windows 下载按钮已明确改名为“首次安装 Windows 版”。

## TDD 与实现提交

### 协议白名单

测试：

```text
9e6497f4d0b39b2b2694b314d591a60f69072d45
```

要求只允许：

```text
yizhan-executor://open
yizhan-executor://update
```

并继续拒绝：

```text
yizhan-executor://run?cmd=powershell
yizhan-executor://install?url=...
http/https 任意 URL
未知 action
```

实现：

```text
735c3a7cabd59e4f1039e3deee19da48a248ffab
```

### Electron update action

测试：

```text
8b8be9b5d7ab9c624a94b279ebfa4b650d60a028
```

实现：

```text
169d8dc7619718bed9f91f74ca17fa0e3723a678
```

`update` 不调用 PowerShell/CMD/curl，也不接收网页传来的下载 URL；它只调用执行器内置：

```js
updateManager.checkForUpdates({ autoDownload: true })
```

因此仍受 UpdateManager 的 HTTPS、manifest、文件大小、SHA-256、路径白名单和任务延迟安装保护。

### Settings 一键更新

测试：

```text
2cd3b678c3094a0114f6263f6baa005c481436e2
```

实现：

```text
5763874f1e10b514b0af691b13e0333b9c0e1bc6
```

行为：

- 已配对 Windows 执行器版本为“有新版本/必须更新”时显示【立即更新】。
- 点击走 `yizhan-executor://update`。
- Windows 下载按钮改为【首次安装 Windows 版 vX.Y.Z】。
- `5763874...` 提交级差异只有 `SettingsPage.jsx +11/-3`，未影响宠物、存储等其他设置。

### 语法门槛补齐

测试：

```text
25e57641a0a2202276ecb7063d675f9149f36e05
```

实现：

```text
20e5b3a8a72b0a43f06205ae215bc48ee0636c81
```

`npm run check` 现在包含：

```text
node --check src/structured-logger.js
node --check src/electron/protocol-handler.js
node --check src/electron/main.js
```

## Windows 覆盖安装自动烟测

测试契约：

```text
a0e0ab865931822d9945a408b815804caf44dab8
```

PowerShell 烟测：

```text
db6c9fabc3bccee36c0ee68128b5e69e3a2e6f0a
```

接入 Windows workflow：

```text
22b574a5d99ed44df2dbbec9c2b26724d724fb9a
```

Runner 恢复后会在干净 Windows Runner：

1. 静默安装一次。
2. 确认正式 EXE 在固定 `%LOCALAPPDATA%\Programs\yizhan-doubao-local-executor`。
3. 确认 `yizhan-executor` 注册表协议存在并指向正式 EXE。
4. 再静默安装同一个包一次。
5. 确认仍为相同安装路径。
6. 确认没有第二个 `yizhan-doubao-local-executor*` 正式安装目录。
7. 确认协议注册在覆盖安装后仍有效。

## 安装包体积硬门槛

```text
MAX_INSTALLER_MIB=90
```

测试：`dae943a0a7f2473c197fecf5adbfe9bd0ece6727`  
实现：`ac2a9777b4e29d9ddc9c96849ad9db600722d508`

早期 Electron 安装包约 79 MiB；当前真实新包尚未构建，因此不能宣称当前实际大小。Windows CI 恢复后会输出 `build-report.json`，包含 sizeBytes、sizeMiB、SHA256、version、commit。

## 当前最关键发布阻塞：HTTPS 更新源

UpdateManager 明确拒绝 HTTP 更新源，这是正确安全策略：不能通过明文 HTTP 下载并直接执行 EXE。

当前已知一战晟铭公网为：

```text
http://115.190.156.223:3000
```

而 Electron 当前默认更新地址是从配对 baseUrl 推导：

```text
<paired-base-url>/downloads/local-executor/updates
```

因此如果用户仍配对 HTTP 公网，点击【立即更新】会被 `UPDATE_HTTPS_REQUIRED` 安全拒绝。

仓库当前没有找到正式 `YIZHAN_EXECUTOR_UPDATE_BASE_URL` HTTPS 默认配置，也没有找到已确认的 HTTPS 更新域名。

### 禁止的错误修复

不能为了“让更新能跑”而删除 HTTPS 校验，也不能允许网页传任意更新 URL，因为这会把 EXE 更新链路暴露给中间人攻击/命令注入风险。

### 正式发布前必须完成

二选一，优先 A：

A. 给一战晟铭公网/更新下载路由配置正式 HTTPS 域名和证书，并让执行器使用该 HTTPS 更新基址。  
B. 使用独立 HTTPS 更新源（例如正式对象存储/CDN），由受信配置固定给执行器，不允许网页动态传入。

只有 HTTPS 更新源落地并通过真实 Windows 测试后，网页【立即更新】才算正式可用。

## GitHub Actions 当前状态

最新 Settings 一键更新提交触发：

```text
run 34021872826
```

四个 job 仍全部：

```text
steps=null
logs_url=null
```

因此仍属于 hosted runner 未分配的外部阻塞，测试并未执行。不能把该 run 视为代码失败，也不能宣称本轮 GREEN。
