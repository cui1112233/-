一战晟铭 · 巨量素材 Windows 本地执行器
========================================

这是一个轻量的 Windows x64 常驻执行器。它只包含执行器和 OCR worker 脚本，
不包含 OCR 模型或 Python 依赖，因此安装包保持较小；模型/运行包在首次任务需要时
由服务端下发清单后单独下载并缓存。

安装与启动
----------
1. 把整个 ZIP 解压到一个固定目录，例如：
   C:\Users\<你的用户名>\AppData\Local\YizhanShengming\GiantMaterialExecutor
2. 在网页「设置 → 巨量素材执行器」点击「生成配对码」，记下 10 分钟内有效的代码。
3. 双击 GiantMaterialExecutor.exe，会出现“巨量素材执行器”窗口；把网页上生成的配对码粘贴进去并点击“绑定”。
   绑定成功后，设备凭证会保存在当前 Windows 用户配置目录，之后重启执行器会自动连接，不需要重复配对。
4. 保持执行器在后台运行。窗口可以点击“最小化到后台”；它只监听本机 127.0.0.1:17861，不会暴露公网端口。
   运行日志保存在 `%APPDATA%\YizhanShengming\GiantMaterialExecutor\executor.log`。
   如果需要诊断启动问题，可运行同目录的 start-giant-material-executor.cmd；它会检查本机端口并在失败时停住显示日志。
5. 回到网页设置点击「刷新状态」，应显示已绑定/在线；然后在批量工厂输入巨量素材 ID 开始任务。

本地联调要求
------------
- 本地网页默认地址：http://127.0.0.1:5173
- 本地控制服务默认地址：http://127.0.0.1:4000
- 执行器回环地址：http://127.0.0.1:17861
- Windows 需要可用的 Python 命令（默认调用 python）。OCR 依赖按项目提供的
  worker/requirements-lock.txt 准备；这些依赖和模型没有放进本 ZIP。

跨电脑测试说明
--------------
- 这里的 127.0.0.1 永远指安装执行器的这台 Windows 电脑。Mac 上的
  http://127.0.0.1:5173 或 http://127.0.0.1:4000 不会自动被 Windows 访问到。
- 最简单的首次测试：网页和 Go 控制服务也运行在 Windows 本机。
- 如果网页运行在公网或另一台电脑，请把 GIANT_MATERIAL_PUBLIC_API_URL 设置成
  Windows 能访问的控制 API 地址，并让浏览器在同一台 Windows 电脑打开网页完成首次绑定。
  不要把 17861 端口映射到公网。

如果你的本地服务端口不同，可在启动前设置环境变量：
- GIANT_MATERIAL_PUBLIC_API_URL：控制服务地址
- GIANT_MATERIAL_EXECUTOR_ORIGIN：允许访问执行器的网页 Origin
- GIANT_MATERIAL_PYTHON：Python 可执行文件路径
- GIANT_MATERIAL_MODEL_MANIFEST：首次运行时使用的模型清单路径（可选）

安全提示
--------
- 不要把 credential.bin、模型缓存或执行器日志上传给别人。
- 不要把执行器端口映射到 0.0.0.0；执行器只应接受本机网页调用。
- 关闭窗口会停止执行器；需要继续后台常驻时请最小化窗口。start-giant-material-executor.cmd 仅用于诊断启动。

版本：0.2.0
