# 2026-10-16 首轮空正文失败重试恢复

## 根因及范围

线上 Go automation Retry 调用 control，但 control 仅查找 running/paused/needs_attention，
整批 failed 返回 404 not found。当前线上 Go 二进制对应源码尚未找到，不能用旧版后端覆盖。
此发布不宣称修复通用的后期阶段重试。

原生 retry 返回精确 404 not found 后，前端仅允许整批首轮 audio_planning、
错误为“正文没有可测量的生产行”、正文已补齐且无任何资产、视频、上传记录、
阶段执行或独立 production/merge job 的任务沿原配置调用原生 automation/start。
两轮完整快照检查及末次 automation 检查；会话变化中止；同页面重复点击复用请求。
不伪改账本、不增加浏览器生产循环。前端检查不提供跨浏览器原子互斥。

Go books 来源 map，实际返回顺序不固定。首版 bf48d7b1 被快照保护拒绝启动，
随后 21222691 规范对象键和 books 顺序；所有字段和值仍参与比较。

## 验证与发布

52 项 API、恢复保护、书目状态和手动获取测试通过；前端构建成功。
独立代码复审通过，覆盖会话切换、阶段变化、独立合并记录、接口不可用和书目乱序。
Git origin/v88 发布 SHA：2122269119db935300f5369cf05eec587b957c13。
IP 与 yzcm.site 外部 X-Qiantie-Frontend-SHA 均核验一致。
静态资源增量复制、index 原子替换，未重建容器或替换 Go/数据库。
压缩包 SHA256：771d942fd80fb2744dcf77c3979cdb253f88f94b595bb55b9d05524b82df3bae。
候选 /opt/qiantie/v88/direct/staging/retry-21222691。
回滚 /opt/qiantie/v88/direct/staging/rollback-retry-bf48d7b1，保存修复前 index 和 Nginx 配置。

## 公网实际操作

张莹当前登录页面进入 10.16，点击“自动生产 → 重试失败小说（8）”。
batch_fc3d375cd6cf3e4996281e30952e7edb 原失败任务 go-auto-1792140447310081149，
09:33:12 UTC 新增原生服务任务 go-auto-1792143192843196053。
回读 state=running、failed=0，沿用 2开头批量 preset、full_submit、concurrency=2。
页面显示 1 本执行中、7 本待开始；首本 audio_planning 正在逐行生成配音并测量时长。
这证明恢复请求成功且原生执行器已接管，尚非视频生成或上传完成证明。
