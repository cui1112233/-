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

## 已完成的公网验收

- 2026-10-15 05:16 UTC 激活，配置来源提交 d4ba5024；页面前端标识精确为 563920d2c126f492797ad2f6e4e99bcd84aae3cd。
- 回退目录：上述 staging 目录下的 rollback-20261015T051600Z。
- 新建隔离浏览器会话，无预览拦截，账号重新登录成功；会话接口返回 200。
- 公网显示 10 张作品卡片；9 个有成片批次的封面视频均 readyState=4、尺寸 496x864，已定位到 0.001 秒首帧。
- 空的新建批次显示“暂无可用封面”，本次浏览器验收未发现失败的 API 响应。
- Nginx 已通过配置验证；Go/MySQL 容器标识与发布前一致，Go 健康、二进制哈希未变化。
- 注意：本次仅恢复作品库封面与去重，不代表之前等待供应商回执的视频生产任务均已完成。

## 域名 HTTPS 入口恢复

随后检查发现：yzcm.site 解析正确、证书有效至 2027-01-08，Nginx 容器内部 HTTPS 返回 200，
但宿主机只映射了 80/3000，443 未映射。HTTP 自动跳 HTTPS，因此域名入口不可用。
初次封面发布仅验收 IP 入口，遗漏了域名入口的验收。

用户明确要求“解决”后，在本实例已有 TLS 配置对应的 cover-recovery overlay 增加 443:443，
而非覆盖服务器基础配置或后端。后续重建该实例 Nginx 必须继续加载该 overlay；
未配置证书的通用 HTTP 基础模板不默认开放 HTTPS。
切换前保存 overlay 原文件；若失败，恢复 overlay 并用相同的三个 Compose 文件仅重建 nginx。
最终必须验证真实公网证书、HTTPS 首页、HTTPS 作品页和登录会话，而非仅验收 IP 入口。

HTTPS 恢复结果（2026-10-15 05:26 UTC）：
- 修复提交 17842c97 已进入 v88，实例 Nginx 已发布 443 端口。
- 外网 TLS 1.3 握手及域名证书验证通过；HTTPS 首页、作品页均返回 200。
- 新隔离浏览器在 https://yzcm.site/shuihuo-production 重新登录成功，会话接口返回 200。
- HTTPS 下仍显示 10 张作品卡片，9 个视频封面均已成功解码。
- Go 后端版本仍为 7df6290b0c8294f89f7e226fdeecf3024cedbdcf。
- 首次切换检查遇到容器启动瞬间连接重置并按预案回退；随后使用允许短暂启动重试的检查完成切换。

## 首页视频资源补齐

首页 DOM 引用 /assets/home-hero.mp4，但域名及 IP 实际请求均返回 404。
原文件在 Git public/assets/home-hero.mp4，前端 Vite 默认仅复制 frontend/public，
此前的前端发布包未包含仓库根 public 中的视频。

修复为在 Vite build 阶段显式发出 assets/home-hero.mp4，保持仓库根原视频为唯一维护源。
构建通过，生成文件与原文件逐字节一致，SHA256 为
d6777a5260a36f29ffc4764df832f517557f8440b3dbaabb1ebe778bdac6549b，大小 1285735 字节。
仅向现有只读前端挂载目录补齐该资源并同步校验清单，UI 编译文件、首页路由和后端均保持原版本。
若需回退，将该补充文件移入回退目录；本次上线前该路径不存在，无需覆盖旧媒体。
验收必须在 HTTPS 域名和 IP 首页观察视频实际解码及播放时间递增，并验证 Range 读取。

首页视频恢复验收（2026-10-15 05:41 UTC）：
- 修复提交 cfaa25fb 已进入 v88；仅补传原始视频及校验清单，未重启服务。
- HTTPS 和 IP 首页均解码为 1920x1080、readyState=4，视频未暂停且播放时间持续递增。
- HTTPS 资源 Content-Type 为 video/mp4，大小 1285735 字节，实际文件校验及整套前端文件清单均通过。
