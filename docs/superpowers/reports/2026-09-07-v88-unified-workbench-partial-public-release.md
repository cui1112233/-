# v88 统一工作台部分公网发布验收

日期：2026-09-07
公网：`http://115.190.156.223:3000/batch-factory`
代码提交：`3e356edf`

## 发布范围

- 已发布：直接导入、V11 批次读取/创建、内容幅度、后台提示词目录、编剧入口和中文工作台界面。
- 未发布：视频生产、合并和 121 发布。
- 公网配置：`QIANTIE_BATCH_FACTORY_V11_SLICE=3`、`QIANTIE_BATCH_FACTORY_V11_PRODUCTION_ENABLED=0`。

## 镜像证据

- Node：`qiantie-v88-node-public-v88:3e356edf-amd64`
  - digest：`sha256:400e5f6d03a6257047697d23020165ba08c7951a7f5132a9eda2e1d4af14088b`
  - 架构：`linux/amd64`
- Go：`qiantie-go-api:public-v88-3e356edf-amd64`
  - digest：`sha256:5754d6202d0e20d672b887130365058996951e142e4609bafab92968847ef46e`
  - 架构：`linux/amd64`

## 公网验收

- 公网 `/batch-factory` 返回 200。
- 实际 HTML 加载新 bundle：`assets/user-2hQ3o03o.js`。
- 批量工厂 bundle 实际包含“内容幅度”“开启编剧”“开启导演”“开启发布”。
- Go `/health`、Node 内部 `/api/build-info`、121 Worker 内部 `/healthz` 均通过。
- 登录用户 `choushiyiguai` 的能力检查：编剧和提示词可用；视频生产显示“Production slice not released”；121 显示“121 视频上传接口尚未验证”。

## 数据与回滚

- MySQL 容器 ID 未变：`313e89a94137`。
- 121 Worker 容器 ID 未变：`6ad0c5a8fd1e`。
- 正式卷 `v88-public_mysql_data`、`v88-public_browser_sessions`、`v88-public_v88_data`、`v88-public_v88_outputs` 未删除。
- 发布前备份：`.env.pre-v88-unified-partial-20260907021003`、`docker-compose.yml.pre-v88-unified-partial-20260907021003`。

## 说明

本次发布是用户选择的“方案 1”：先上线已验证的基础工作台，视频和 121 发布保持关闭。视频链路和 121 视频上传契约完成真实验证后，再单独提升生产能力开关。
