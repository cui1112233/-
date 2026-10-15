# 公网失败任务重试返回 404

## 复现与范围

用户点击“重试失败小说（1）”，请求 qiuwanjing 批量
batch_ee6a6a4fdb2ebf90269689204b08153f 的 POST automation/retry。
公网 Nginx 日志确认 404。相同账号的批量 GET 与 automation GET 都为 200。
持久化账本存在三条该批量记录，owner 正确，state 都为 failed。

## 精确运行实现证据

当前 Go 文件 SHA256：86d4093040e78340e3dddb85b1e5471c17e4d1d2353b0fef482b54d64a66feaa。
二进制 Go 函数表包含 BatchAutomationCoordinator.Retry、control 和重试路由，
所以不能将本故障解释为完全缺少重试接口。

control 对应 batch_factory_automation.go:772，入口 0x901a80。
任务选择循环在匹配身份、批量后，仅接纳 running、paused、needs_attention；
未接纳 failed，遍历结束后进入未找到任务分支。
Retry 对应同文件第 744 行，并调用同一 control。因此已失败任务读得到，却无法重试。

## 修复要求与阻塞

应在准确源码中为重试选择最新的匹配失败任务，保持暂停等控制动作的状态约束。
验证失败批量能重试、越权仍拒绝、已确认上传书被排除、仅续跑缺失阶段、请求幂等。
不得将账本伪改为运行中，也不得用 start 重放已完成书。

当前公网源码标识 7df6290b0c8294f89f7e226fdeecf3024cedbdcf 不在本地 Git 对象，
远端 fetch 明确返回 not our ref。服务器发布包仅含 go/qiantie。
本机项目目录、临时目录、服务器归档未找到 batch_factory_automation.go。
V88 旧源码不能重建出当前完整运行能力；在准确源码恢复前未替换后端、未篡改账本、未重放任务。

下一步需要当前运行后端的仓库/工作目录或完整源码包，先回收进 V88，再测试和增量部署。
