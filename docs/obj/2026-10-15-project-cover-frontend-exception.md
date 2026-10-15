# 2026-10-15 封面恢复：已批准的单次前端发布例外

用户在本会话回复“可以”，明确同意仅更新前端、保留现有登录后端的例外。
此例外不修改 AGENTS.md 第 13 条，不设立常规发布入口。

- 前端修复源码：Git v88 的 563920d2c126f492797ad2f6e4e99bcd84aae3cd。
- 后端保持：7df6290b0c8294f89f7e226fdeecf3024cedbdcf（当前不在 V88 仓库；不得据此重建后端）。
- 后端文件 SHA256：86d4093040e78340e3dddb85b1e5471c17e4d1d2353b0fef482b54d64a66feaa。
- 单次配置、文件清单及带版本复核/失败回退的激活脚本见 deploy/v88-direct/cover-recovery-20261015。
- 仅覆盖 /shuihuo-production 页面及版本化静态文件；已有静态文件未命中时继续转发 Go。
- 新页面返回 X-Qiantie-Frontend-SHA。后端版本接口仍代表后端，不得将前端 SHA 冒充后端 SHA。
- 只增加 Nginx 的只读挂载并重建 Nginx，保留 Go、MySQL 和业务数据。
- 前端目录位于 /opt/qiantie/v88/direct/staging/cover-563920d2c126f492797ad2f6e4e99bcd84aae3cd/frontend。
  激活后该目录是运行依赖，清理 staging 时必须保留。
- 激活脚本会在同目录下建立 rollback-时间戳，保存原 Nginx 配置及切换前服务状态。

验证要求：真实公网、无本地请求拦截、重新登录、10 张去重作品卡片、9 个有成片作品首帧可读；
空批次应明确暂无封面。切换前 19 项针对性测试和构建均通过，并用真实接口预览确认首帧。
服务端切换成功不等于浏览器最终验收完成。

回退：恢复 rollback-时间戳/nginx.conf 到原 nginx.conf，
使用既有 docker-compose.yml 和 docker-compose.direct.yml 仅重建 nginx，
不再传入本次 docker-compose.cover-recovery.yml。无需修改后端或数据。
