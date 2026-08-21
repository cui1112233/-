# 一战晟铭工程协作说明

## 范围与原则

- 项目根目录：`/Users/ming/Downloads/qiantie`。
- 以当前代码、运行中的容器和实际 HTTP 验证为准；不要根据旧文档假设运行状态。
- 保留用户已有的未提交改动，不执行 `git reset --hard`、`git checkout --` 等破坏性操作。
- 前端 API 必须使用同源相对路径（例如 `/api/login`），不得硬编码局域网 IP 或容器 IP。

## 端口约定

| 环境 | 平台页面 | 水货 Go 后端 | Vite |
| --- | --- | --- | --- |
| Docker 正式运行 | `3000` | `14000` | 不单独暴露 |
| 本地开发 | `18081` | `4000` | `5173` |

- Node 平台由 `QIANTIE_NODE_PORT` 控制，未设置时默认 `18081`。
- Docker Compose 必须为平台容器设置 `QIANTIE_NODE_PORT=3000`。
- Vite 开发服务器的 `/api` 代理目标为 `http://127.0.0.1:18081`。

## Docker 正式运行

- 编排文件：`deploy/docker-compose.test.yml`；本地私密配置：`deploy/.env.test-docker`。
- 启动或更新：`scripts/deploy-test-docker.sh up`。
- 查看状态：`scripts/deploy-test-docker.sh ps`；查看日志：`scripts/deploy-test-docker.sh logs`。
- 健康检查：`scripts/deploy-test-docker.sh health`。
- `down` 仅停止容器并保留数据卷；`clean` 会删除 Docker 的 MySQL、Redis、平台数据和对象存储卷，执行前必须获得明确确认。
- 不得把密钥、密码、令牌或供应商凭据写入源码、镜像、Compose 文件或提交到 Git。

## 本地开发

- Node 平台：`npm start`，访问 `http://127.0.0.1:18081`。
- React/Vite：`npm run frontend:dev`，访问 `http://127.0.0.1:5173`。
- Go 水货后端默认监听 `127.0.0.1:4000`。
- Docker 正式环境运行时，本地开发服务不得占用 `3000` 或 `14000`。

## 数据与验证

- 水货业务数据及媒体引用写入 MySQL；图片和视频二进制通过对象存储卷保存。不要为新业务状态增加 JSON 或文件持久化。
- 修改前端后至少运行 `npm --prefix frontend run build`；修改 Go 后端后运行相关包的定向测试和构建。
- 修改 Docker 配置后运行 `docker compose --env-file deploy/.env.test-docker -f deploy/docker-compose.test.yml config --quiet`，再执行部署脚本的 `up` 或 `health`。
- 不把构建成功或 HTTP 健康检查描述为真实供应商生成成功；涉及付费模型时单独验证请求结果。
