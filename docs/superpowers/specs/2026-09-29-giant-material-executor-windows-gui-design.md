# 巨量素材 Windows GUI 执行器设计

## 目标

把当前“控制台 EXE + `.cmd` 输入配对码”的验证包改成真正的 Windows GUI 执行器：用户双击 `GiantMaterialExecutor.exe` 后看到配对窗口，输入网页生成的配对码并完成绑定；绑定后窗口可最小化，常驻 agent 在后台心跳、领取和执行 OCR 任务。

## 约束与不变项

- 保留现有 Go agent、DPAPI 凭证、心跳、任务领取和 OCR worker，不改变任务协议。
- 设置页继续生成一次性配对码并列出设备在线状态。
- 不把执行器端口暴露到公网；GUI 与网页的本机通道仍绑定 `127.0.0.1:17861`。
- Windows 执行器通过 `GIANT_MATERIAL_PUBLIC_API_URL` 访问控制 API；跨电脑时该地址必须是 Windows 可访问的公网或局域网地址。
- 安装包不包含 OCR 模型和 Python 依赖。
- `.cmd` 只作为故障排查备用入口，不是用户主入口。

## 方案

新增 `giant-material-executor/internal/ui` 跨平台边界。Windows 实现使用 user32 原生窗口和标准 Edit/Button/Static 控件，避免 Electron、WebView2 和额外运行时；非 Windows 实现为空实现，保证 macOS 单元测试和本地 smoke 不受影响。

主程序向 UI 提供三个回调：

- `Pair(context.Context, string) error`：复用现有服务端配对和凭证保存逻辑。
- `Snapshot() agent.Snapshot`：读取绑定、连接、模型和任务状态。
- `Shutdown()`：用户明确退出 GUI 时停止主进程；最小化不停止 agent。

GUI 启动时显示状态；没有保存凭证时显示配对码输入框和“绑定”按钮；绑定成功后清空输入、显示“已绑定/连接中”，状态轮询到在线后显示“在线”。窗口最小化只隐藏界面，不关闭 agent；窗口关闭执行明确退出。

## 错误处理

- 配对码过期、错误或服务不可达时在窗口状态区显示可读错误，不让程序静默退出。
- 已保存凭证收到 401 时沿用现有逻辑清除凭证并显示“需要重新绑定”。
- GUI 初始化失败时记录日志并保持 agent/loopback 的诊断能力；Windows 包仍保留 `.cmd` 备用入口。

## 验证边界

- Go 单元测试验证 UI 状态文本、配对回调和跨平台编译边界。
- `GOOS=windows GOARCH=amd64` 验证 GUI EXE 可交叉编译。
- ZIP 内容验证只有 GUI EXE、worker、依赖清单、说明和备用脚本，无模型文件。
- macOS 无法替代 Windows 桌面交互；最终窗口显示、输入和最小化需要用户在 Win 上实测。
