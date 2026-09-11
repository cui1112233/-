# V88 公网统一运行时设计

## 目标

把公网 `:3000` 收敛为唯一 V88 Docker 拓扑：

```text
公网 :3000
  -> v88-public-nginx-1
  -> v88-public-v88-node-1
  -> v88-public-go-api-1 / Worker / qiantie-unified-mysql
```

Node 与 Go 必须由同一 Git 提交构建。公网请求不得再经过宿主机 `qiantie-v88-node-stage.service:18081`，也不得依赖 Docker 容器 IP。

## 已确认的问题

- 当前 Nginx 将页面、静态资源及部分业务 API 转发至 `172.19.0.1:18081` 的宿主机 stage 服务。
- 通用 `/api/` 又转发至 Docker 内 `go-api:4000`。
- stage Node 是提交 `7f0f4cee`，Go 镜像是 `3dd484c8`，两者不是同一提交链。
- V78 的可用模型是 Nginx 统一转发至同一 Node，再由 Compose 服务名访问 Go 与 Worker；当前混搭破坏此契约。

## 运行时边界

- 公网部署目录固定为 `/opt/qiantie/v88/deploy/v88-public`。
- 公网入口固定为 `v88-public-nginx-1`，宿主机端口固定为 `3000`。
- 业务数据只使用 `qiantie-unified-mysql` 的 `qiantie_v88`；不复制、重建或清空正式卷。
- V78 容器、镜像和旧库只保留回滚，不启动、不写入新业务数据。
- 宿主机 stage 服务可以保留作回滚依据，但其端口不能继续接收公网 Nginx 流量。

## 发布设计

1. 从本机 Git 选定一个准确 V88 提交，并在该提交上完成 Node、Go 定向测试和前端构建。
2. 仅生成一对带同一提交标识的 V88 Node/Go 发布镜像；不删除已有镜像，不创建并行公网项目。
3. 更新 `v88-public` Compose，使 Node 和 Go 都引用该提交的镜像标签。
4. 将 Nginx 的页面、静态资源和 API 上游统一改为 Compose 服务名：Node 为 `v88-node:3000`，API 为 `go-api:4000`；移除所有 `172.19.0.1:18081` 上游。
5. 先执行 Compose 配置校验，再仅重建 V88 Node、Go 与 Nginx；保留 MySQL、Worker、卷和 V78。
6. 回滚方式为恢复上一对 V88 镜像标签与 Nginx 配置，再仅重建上述三个容器。

## 验收

- `v88-public-nginx-1` 唯一占用宿主机 `3000`。
- Nginx 配置中不存在 `18081` 或 Docker IP 上游。
- 入口页面、静态资源、`/api/build-info` 与受保护 API 都来自同一 V88 发布提交。
- Node、Go 镜像标签携带同一提交标识。
- 匿名访问仅得到预期的登录/401；登录态下水货生产的模型读取、项目读取和一次只读状态回读成功。
- 不以 HTTP 200、容器存活或构建成功代替登录态业务验收。
