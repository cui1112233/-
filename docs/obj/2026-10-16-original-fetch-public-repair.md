# 2026-10-16 原文自动获取修复与公网验收

## 原因

张莹的 10.16 批量（batch_fc3d375cd6cf3e4996281e30952e7edb）创建时，
前端发送字符串 platform，线上 Go fetch-originals 要求数字，返回 HTTP 400
及 invalid JSON body。对同一本点众书使用数字 4，实际返回 4000 字正文。
创建流程仍保留空正文书目并启动自动化，导致八本在 audio_planning 报正文为空。

## 修改和验证

发布源码 e1ef253460bae9d078c5daca205f4670104c0ae5，已进入 origin/v88。
客户端发送数字书城编号；新建分组批量有正文缺失时保留全部书目，
取消本次自动启动与定时启动，明确提示补齐正文。正文齐全时维持原自动启动设置。
原文仍在创建流程自动获取，未改为要求用户逐本点击。

32 项 API/手动导入行为测试通过；先观察两个回归失败，再修复通过。前端构建成功。
IP 和 HTTPS 的 X-Qiantie-Frontend-SHA 均为上述发布 SHA。
线上现有 Go 二进制和数据库未替换。

通过当前登录页面实际获取前三本正文，其余五本通过相同账号的原生单书获取接口补取。
最终批量 GET 回读八本 sourceText 长度为
3998、3998、3997、3998、3998、3998、3998、3994，页面刷新后获取正文按钮为 0。
没有重放配音、视频、合并或上传任务；既有 failed 自动化账本未伪改为成功。
本次未创建额外测试批量；新建流程的格式转换与启动门由行为测试覆盖。

## 发布和回滚

前端继续使用现有 cover-563920d2c126f492797ad2f6e4e99bcd84aae3cd/frontend 挂载。
资源增量保留，index 原子替换。
服务器备份：/opt/qiantie/v88/direct/staging/rollback-original-fetch-20261016。
候选静态文件：/opt/qiantie/v88/direct/staging/original-fetch-e1ef2534。
发布压缩包 SHA256：08da1f8c9b610ca0b2dcb6703c8800b18b3e3d2e8791a80acc161fbe7d721e1f。

Nginx 原配置为只读单文件绑定。宿主配置原子修改后容器仍引用旧 inode，
因此当前容器 /etc/nginx/nginx.conf 的 include 改为 /etc/nginx/qiantie-current.conf，
该文件内容为更新后的宿主 nginx.conf；nginx -t 和 reload 均成功。
容器原主配置备份为 /etc/nginx/nginx.conf.pre-original-fetch。
重建容器时原绑定会直接读取更新后的宿主配置；现有 overlay 挂载必须保留。
回滚时先恢复备份 index 与配置，再验证 nginx 配置与外部资源，勿删除旧 assets。
