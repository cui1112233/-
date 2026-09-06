# V88 豆包执行器 Phase 1 — 更新协议执行附录

主计划：`docs/plans/V88_DOUBAO_EXECUTOR_PHASE1_20260906.md`

## 本附录新增范围

在原 Phase 1 计划基础上补齐用户要求：已安装执行器升级时不再走浏览器重复下载，而是由网页安全唤起本机执行器完成更新下载与覆盖安装。

## 已落地

- [x] `yizhan-executor://update` 加入严格 action 白名单。
- [x] 网页不能传命令、安装 URL 或脚本参数。
- [x] Electron 收到 update action 后只调用内置 UpdateManager。
- [x] Settings 对有新版本/必须更新的 Windows 执行器显示【立即更新】。
- [x] Windows 浏览器下载入口改名【首次安装 Windows 版】。
- [x] UpdateManager 继续强制 HTTPS + size + SHA-256。
- [x] 更新包保存在 `userData/updates` 并自动清理旧候选。
- [x] VIDEO 执行中延迟安装。
- [x] Windows workflow 已加入双安装覆盖烟测。
- [x] Windows installer 已加入 90 MiB CI 硬门槛。
- [x] structured logger 已纳入 npm syntax gate。

关键提交：

```text
9e6497f4d0b39b2b2694b314d591a60f69072d45  protocol RED
8b8be9b5d7ab9c624a94b279ebfa4b650d60a028  protocol integration RED
2cd3b678c3094a0114f6263f6baa005c481436e2  Settings update RED
735c3a7cabd59e4f1039e3deee19da48a248ffab  allow update action
169d8dc7619718bed9f91f74ca17fa0e3723a678  route update to UpdateManager
5763874f1e10b514b0af691b13e0333b9c0e1bc6  Settings one-click update
25e57641a0a2202276ecb7063d675f9149f36e05  syntax coverage RED
20e5b3a8a72b0a43f06205ae215bc48ee0636c81  syntax gate implementation
```

## 当前硬阻塞

### 1. GitHub hosted runner 未分配

最新相关 run `34021872826` 仍为 `steps=null / logs_url=null`。因此代码尚不能标为完整 GREEN。

### 2. 正式 HTTPS 更新源尚未确认

当前已知公网是 `http://115.190.156.223:3000`，但 UpdateManager 正确地禁止从 HTTP 下载并执行 EXE。仓库中没有发现已配置的正式 HTTPS 更新基址。

不能通过关闭 HTTPS 校验解决。

正式可发布条件：

```text
稳定 HTTPS 更新基址
→ /updates/stable/manifest.json 可访问
→ manifest 中 installer size/SHA 与构建报告一致
→ Windows 执行器可以下载并校验
→ 双安装覆盖烟测通过
→ 配对/账号数据保留
→ yizhan-executor://update 实机通过
```

## 下一顺序

1. 解决/确认 GitHub Actions hosted runner 使用限制，重新执行完整回归与 Windows NSIS。
2. 给更新下载链路配置正式 HTTPS 域名或独立 HTTPS 对象存储/CDN。
3. 取得真实 Windows installer 的版本、字节数、MiB、SHA-256。
4. Windows 首装 + 覆盖更新 + 协议 + 单实例实机验收。
5. 执行一条真实 `/script → executor → doubao → mp4 → upload → succeeded`。
6. 所有真实证据通过后，才允许合入 `v88`；不合 master。
