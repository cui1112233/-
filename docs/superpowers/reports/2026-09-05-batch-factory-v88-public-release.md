# Batch Factory V11 `v88` 公网发布验收

日期：2026-09-05  
公网：`http://115.190.156.223:3000/batch-factory`  
运行账号：`choushiyiguai`  
部署代码：`20698f227ca59592ade481678eaffe2b53251572`

## 实际链路

- 公网页面提供“直接导入内容”，支持粘贴正文和 TXT / MD 文件。
- 通过公网现有 Agent Skill“前贴片广告脚本 v1”处理正文，真实返回分镜表预览。
- 点击确认后创建真实 V11 Intake；再次明确点击后创建正式 V11 Batch。
- Director 没有自动启动，批次保持“待开始”。
- 最终版本再次打开直接导入并执行技能预览，未再次确认，避免制造额外验收数据。

公网数据库复核：

- `batch_factory_v11_intakes`：1 条
- Intake：`intake_8b58c64873929b4946d38d39ef4c4e5a`
- `batch_factory_v11_batch_records`：1 条
- Batch：`batch_4e99a92e5fbf15c636cf5cf10362d73a`
- `batch_factory_v11_book_records`：1 条
- `sourceType=manual`，原文长度 21，处理后正文长度 588，`skillRuns=1`

## 公网运行时证据

- Node 镜像：`qiantie-v88-node-public-v88:v88-20698f22-amd64`
- Node digest：`sha256:8f7fb69ceb32679955fde568517d35994ffa0a32b73cf5c7d76f5e4dca908aa4`
- Go 镜像：`qiantie-go-api:public-v88-local-20698f22-direct-skill-amd64`
- Go digest：`sha256:a98899ded16fbefe7a8b2599a8930001d4400042226982cca299613c96db8bd2`
- 两个镜像架构均为 `linux/amd64`，OCI revision 均为部署代码 SHA。
- Go healthcheck 通过，公网 `/batch-factory` 返回 200。
- 公网 `QIANTIE_BATCH_FACTORY_V11_SLICE=1`、`QIANTIE_BATCH_FACTORY_V11_PRODUCTION_ENABLED=0`；视频生产未被越权开启。
- MySQL、浏览器 Worker、Nginx 和正式数据卷未删除或重建。
- 旧 Node/Go 镜像保留 rollback tag；最终切换前的环境备份为 `.env.backup.20260905222750`。

## 验证结果

- Node 全量回归：186/186 通过
- Go：`go test ./...` 全部通过
- V11 前端测试：127/127 通过
- Vite production build：通过
- `/api/build-info` 仍是历史硬编码 v78 元数据，因此没有作为版本身份依据；版本身份以 OCI revision、镜像 digest 和实际功能验收为准。

## 过程中的发布问题

第一次切换误用了开发机默认的 `linux/arm64` 镜像，公网 ECS 为 `linux/amd64`，容器出现 `exec format error`。已立即恢复旧镜像，随后按 `--platform linux/amd64` 重建并完成最终切换；正式数据库和数据卷未受影响。
