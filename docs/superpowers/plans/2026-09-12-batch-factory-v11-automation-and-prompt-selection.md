# Batch Factory V11 自动化定时与后台提示词选择实施计划

> REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Batch Factory V11 增加与小说获取一致的单次定时生产、任务管理和后台预设提示词下拉选择。

**Architecture:** 前端读取后台返回的提示词目录和定时任务状态。Go API 负责 V11 接口，MySQL 持久化任务与提示词版本快照，Redis 负责生产队列，TOS 保存图片、Shot 视频、VIDEO 和最终成片。定时任务保存时冻结模型、提示词 ID/版本及实际内容。

**Tech Stack:** Go API、React + Ant Design、MySQL + Goose、Redis、TOS、现有 V11 Prompt Compiler 与 Merge Worker。

**Spec:** 批量工厂新版布局与生产逻辑设计总结.md；小说获取现有定时任务行为。

## Global Constraints

- 定时任务采用一次性日期时间，不增加每日/每周循环。
- VIDEO01 包含一个或多个 Shot；每个 Shot 独立生成。
- 目标时长 6 秒；模型只支持或实际返回 10 秒时保留原始 10 秒，不裁剪。
- 画面 Prompt 只进入图片模型；视频 Prompt 只进入视频模型。
- 文本、图片、视频模型只能使用 API 配置目录中的已启用模型。
- 元提示词维护在管理后台的系统预设词中，生产页只显示下拉选择。
- 不修改 v78 运行逻辑，不把 v78 当成 v88 实现分支。

### Task 1: 后台预设提示词目录

**Files:** backend/internal/batchfactoryv11/types.go；backend/internal/httpapi/batch_factory_v11_compiler.go；frontend/src/shared/api/batchFactoryV11.js；frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.js；新增 Go/前端提示词目录测试。

- [ ] RED：增加测试，要求按类型返回启用提示词，并包含 id、name、version、content 和 enabled。
- [ ] 验证 RED：接口不存在时测试失败。
- [ ] GREEN：新增 GET /api/batch-factory/v11/prompts?type=director，从后台预设词存储读取，停用项不返回。
- [ ] 验证 GREEN：Go、Node、前端测试通过。

### Task 2: 提示词下拉选择与版本快照

**Files:** frontend/src/user/pages/batch-factory-v11/BatchFactoryV11SettingsDrawers.jsx；BatchFactoryV11UiPage.jsx；backend/internal/batchfactoryv11/director_service.go；相关测试。

- [ ] RED：测试 Hook、Director、画面、视频、音频匹配、Shot 合成和成片合成均有下拉框。
- [ ] GREEN：下拉框动态读取后台目录，保存 promptSelections。
- [ ] GREEN：执行前生成 promptSnapshot，记录提示词 ID、版本和实际内容。
- [ ] GREEN：后台更新提示词后，旧任务仍使用旧快照。

### Task 3: 定时任务持久化

**Files:** 新增 backend/internal/storage/batch_factory_v11_schedule_schema.go；新增 backend/internal/batchfactoryv11/schedule_store_mysql.go；修改 migrations 和 types；相关测试。

- [ ] RED：测试创建、读取、取消、删除和 running 恢复。
- [ ] GREEN：新增 Goose 迁移表，保存 owner、batch、book IDs、run_at、状态、模型快照和 promptSnapshot。
- [ ] GREEN：实现按用户隔离的 CRUD 和状态更新。

### Task 4: 定时任务 API

**Files:** 新增 backend/internal/httpapi/batch_factory_v11_schedule.go；修改 router.go、前端 API 和 UI adapter；相关测试。

- [ ] RED：测试 GET/POST/PATCH/DELETE /api/batch-factory/v11/schedules 及 retry。
- [ ] GREEN：校验 runAt 晚于当前时间；创建时冻结批次、小说、模型和提示词。
- [ ] GREEN：取消只允许 scheduled，删除只允许当前用户任务。

### Task 5: Redis 调度与生产编排

**Files:** 新增 backend/internal/batchfactoryv11/scheduler.go；修改 production.go、merge.go、merge_book.go；相关测试。

- [ ] RED：测试到点只入队一次、重启恢复、失败变 failed、retry 保留历史。
- [ ] GREEN：Go scheduler 扫描 MySQL，使用 Redis 锁防重复，把任务加入 V11 production/merge 队列。
- [ ] GREEN：严格按 Shot → VIDEO → Book 执行，缺 Shot 不允许跳级。

### Task 6: 定时任务管理 UI

**Files:** 修改 BatchFactoryV11SettingsDrawers.jsx、BatchFactoryV11UiPage.jsx、BatchFactoryV11Workbench.jsx 和 CSS；相关测试。

- [ ] RED：测试“定时生产”和“定时任务”入口、日期时间选择、快照预览、取消、删除、失败重试。
- [ ] GREEN：实现一次性日期时间选择，不显示循环频率。
- [ ] GREEN：列表显示等待执行、处理中、完成、失败、已取消，并支持刷新回读。

### Task 7: TOS 与状态验收

**Files:** 修改 production.go、merge_store_mysql.go、mergeworker/worker.go、HTTP routes；相关测试。

- [ ] RED：测试图片、Shot 视频、VIDEO 和最终成片都有 TOS URL，状态中心可回读。
- [ ] GREEN：完成时写入 TOS，失败保留错误，外部资源继续走授权访问。

### Task 8: HTML 预览同步

**Files:** docs/batch-factory-v11-preview.html。

- [ ] 改为一次性日期时间选择。
- [ ] 增加提示词下拉框、提示词版本、任务快照预览。
- [ ] 增加定时任务列表、取消、删除、失败重试展示。
- [ ] 明确标注仅为交互预览，不冒充真实执行。

### Task 9: 验证、合并和公网发布

- [ ] 运行 Go、Node、前端测试和前端构建。
- [ ] 合入 v88 并记录最终 SHA。
- [ ] 构建 Node/Go 同 SHA 统一 Docker 镜像。
- [ ] 公网验证 build-info、提示词下拉、定时任务创建、队列、Shot 生产、TOS 回读和合成。
- [ ] 公网失败时回滚发布前 SHA。
