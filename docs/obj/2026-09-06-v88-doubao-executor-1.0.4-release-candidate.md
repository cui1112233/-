# V88 豆包执行器 1.0.4 发布候选记录

日期：2026-09-06  
分支：`fix/v88-doubao-executor-phase1-20260906`  
正式 V88 当前维护版本：`1.0.3`  
本次候选版本：`1.0.4`

## 为什么必须升到 1.0.4

本次 Phase 1 对执行器本身加入了新的接单确认、结构化日志、网页 update 协议、stable 更新语义和安装/更新验证。若 package 仍保持 1.0.3，则已经安装 1.0.3 的用户会把未来 1.0.3 manifest 判定为“没有新版本”，无法收到本次更新。

测试：

```text
0f91891be3dbac494a439f056c41168bf50cd55c
```

版本实现：

```text
4189582a1b58a0d5154c626ad5c5f938ec5801f0
```

Windows workflow 已从 package.json 动态读取版本，因此后续安装包正式命名将自动成为：

```text
yizhan-local-executor-v88-1.0.4-win-x64.exe
```

实际 EXE 尚未因 GitHub hosted runner 阻塞而构建，不能虚报当前字节数、MiB 或 SHA-256。

## 更新通道规则

发现原执行器没有偏好文件时默认 `beta`，与网页“最新稳定版/立即更新”语义不一致。

新规则：

```text
普通新用户：stable
网页【立即更新】：强制 stable
用户在执行器内主动选择 beta：允许 beta
```

测试：

```text
5e5947907f490d8d57083342be6f766e68cdca4d  新安装 stable 默认
b7d13fca22011a84e69cee341d0c40d339edaada  网页 update 必须切 stable
b240061b6c20c94d9d89bc02251970a330f218ad  preferences 异常 fallback stable
```

实现：

```text
924d8906e7f2dbe71b1ef40ccdbd6adba4ef4c49  UpdatePreferencesStore 默认 stable
a5339aaa53c3570df264212eed006ebe1d1c5947  UpdateManager fallback stable
0a17935b88a97cef8ca2b5ef038ed6738219bd52  yizhan-executor://update 强制 stable
```

## 最低支持 / 自更新引导版本

`yizhan-executor://update` 的自更新引导能力以 `1.0.3` 为最低基线。

规则：

```text
< 1.0.3  → 不显示协议“立即更新”，提示一次“下载新版安装器”完成迁移
>= 1.0.3 → 允许 yizhan-executor://update
```

前端 helper 测试/实现：

```text
e6026bd5723d7d708faf4a3e304d8127b7127a7f
3363483e17c8d327c070020f317167f361f149ca
```

Settings 迁移测试/实现：

```text
a5b2a4e3f2ecf1502a99ef479bb9647a68073b6c
0106f719e7ace2a9e709a73c15289eeb0dc44552
```

旧 OS 标签兼容：

```text
5968be6bcc597a16fda5c48269e9cfa360944969  测试
feabe74cebbcab680f0684cb578c9dd59fef9f05  Settings 同时识别 windows / win32
```

## 发布 manifest 最低版本

Windows 发布 workflow 现在写入：

```json
{
  "version": "1.0.4",
  "minimumVersion": "1.0.3"
}
```

测试：

```text
7eccba4cbc77f60e7e079110f63b6c6fb9e261b0
```

实现：

```text
d0e179b8b11f2cae22c1c11e5176aa729792e48d
```

这让 Settings 能把低于 1.0.3 的客户端明确标为“必须更新”。

## 当前未通过项

### GitHub Actions

Windows run：

```text
34022409272
```

结果仍为：

```text
build-windows
steps=null
logs_url=null
```

说明 Checkout 都没有开始，不是 1.0.4 代码/构建命令失败。

### HTTPS

1.0.4 自更新仍必须使用 HTTPS 更新源。当前已知 HTTP 公网不能被用来自动下载并执行 EXE；这项安全规则不允许降级。

## 1.0.4 发布前硬门槛

- [ ] Go / Node / local-executor / frontend 真实测试全 GREEN
- [ ] frontend build GREEN
- [ ] Windows NSIS 成功
- [ ] installer <= 90 MiB
- [ ] build-report / manifest / SHA-256 一致
- [ ] minimumVersion=1.0.3
- [ ] HTTPS stable feed 可访问
- [ ] 1.0.3 → 1.0.4 自更新实机成功
- [ ] <1.0.3 → 1.0.4 一次安装器迁移成功
- [ ] 覆盖更新不产生多个正式安装目录
- [ ] 配对/账号配置保留
- [ ] yizhan-executor://open / update 单实例正确
- [ ] 真实 `/script → executor → doubao → mp4 → upload → succeeded`
- [ ] 全部通过后才合入 `v88`，不合 master
