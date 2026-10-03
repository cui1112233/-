# ECS 资源收敛盘点（2026-10-03）

## 采集范围

目标主机：`115.190.156.223`。本记录来自只读 `docker ps -a`、`docker system df -v`、`docker volume inspect`、磁盘/内存和容器网络检查。

## 容器分类

| 对象 | 当前状态 | 结论 |
|---|---|---|
| `v88-public-v88-node-1` | 运行，镜像 SHA `b9a1b6d3...` | 保留 |
| `v88-public-go-api-1` | 运行且 healthy，镜像 SHA `b9a1b6d3...` | 保留 |
| `v88-public-browser-worker-1` | 运行，`f437cd88-v88` | 保留 |
| `v88-public-novel-fetch-121-worker-1` | 运行且 healthy，`v88-latest` | 保留 |
| `v88-public-nginx-1` | 运行，`nginx:1.27-alpine` | 保留 |
| `v88-public-shuihuo-compat-1` | Compose 管理，挂载 `v88-public_shuihuo_objects` | 保留 |
| `v88-public-shuihuo-compat-legacy-1` | 无 Compose 标签，连接旧 default 与当前 internal 网络 | **待路由验证后处理** |
| `qiantie-unified-mysql` | 运行，挂载统一 MySQL 数据卷 | 保留 |

旧兼容容器共享 `shuihuo-compat` DNS 别名和对象卷。当前证据不足以直接删除，因此本轮仅标记为待处理。

## 镜像

当前 8 个镜像均被运行中容器引用；`docker system df` 显示无可直接回收的未引用镜像。Node/Go 为统一 SHA `b9a1b6d3df7682f29b0fe9047cc6d53bbd702c61`。

## 卷

| 卷 | 大小 | 链接 | 结论 |
|---|---:|---:|---|
| `qiantie_unified_mysql_data_20260911_r3` | 2.823GB | 1 | 保留，数据库 |
| `v88-public_go_api_artifacts` | 1.892GB | 1 | 保留，业务产物 |
| `v88-public_v88_data` | 234.5MB | 1 | 保留，任务/配置数据 |
| `v88-public_v88_outputs` | 13.69MB | 1 | 保留，业务输出 |
| `v88-public_mysql_data` | 76.14MB | 0 | 待确认后清理 |
| `v78-public_mysql_data` | 50.54MB | 0 | 可清理候选，需保留本记录 |
| `958973b470c987fc45546fad4166fadda2f35944a994046dd320cff9f2972cf7` | 0B | 0 | 可清理候选 |
| `v88-public_browser_sessions` | 7.6kB | 2 | 保留 |
| `v88-public_novel-fetch-121-data` | 1kB | 2 | 保留 |
| `v88-public_shuihuo_objects` | 0B | 2 | 保留，共享对象卷 |

## 系统资源

- 根盘：20GB，总可用约 3.2GB（83%）。
- 内存：3.8GiB，总可用约 1.2GiB；无 Swap。
- `/var/lib/docker`：约 4.8GB，其中卷约 4.8GB。
- `/var/log`：约 91MB；`/tmp`：约 195MB，包含发布临时目录。

## 可逆行动顺序

1. 核验旧兼容容器路由与依赖。
2. 记录无链接卷的完整 inspect 和大小后再删除。
3. 清理确认过期的发布临时目录与日志。
4. 重跑容器、路由、健康检查和卷链接核验。
