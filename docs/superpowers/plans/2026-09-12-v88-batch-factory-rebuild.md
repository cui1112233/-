# V88 全新批量工厂执行计划

> 执行分支：`feature/v88-batch-factory-rebuild-20260912`。目标分支：`v88`。
> 本计划不授权 121 发布；公网只在候选端到端验证后另行切换。

## 1. 扩展既有 V11 MySQL 领域层

**Files:**
- Modify: `backend/internal/storage/batch_factory_v11_schema.go`
- Modify: `backend/internal/batchfactoryv11/types.go`
- Modify: `backend/internal/batchfactoryv11/mysql_store.go`
- Modify: `backend/internal/batchfactoryv11/mysql_readback_store.go`
- Create: `backend/internal/batchfactoryv11/novel_workbench_store_test.go`
- Modify: `backend/internal/storage/batch_factory_v11_schema_test.go`

1. 先写失败测试：owner 隔离、书内 revision 冲突、重复幂等键、服务重启读回。
2. 增加可重试 migration：书内原文 revision、资产、约束、画面提示词、视频卡片和活动关系；保留现有 batch/book/video identity 与生产/合并表。
3. 扩展 V11 Store，所有读取必须接受 owner ID，更新必须带 expected revision。
4. 运行 `go test ./backend/internal/storage ./backend/internal/shuihuo/store`。

## 2. 扩展 Go V11 工作台 API

**Files:**
- Modify: `backend/internal/httpapi/router.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_handlers.go` (or the current slice-one route files)
- Create: `backend/internal/httpapi/batch_factory_v11_workbench_handlers_test.go`

1. 先写 handler 测试：空状态、创建批次、单书修改、过期 revision、跨账号 404、真实项目状态映射。
2. 在 `/api/batch-factory/v11/*` 增加正文、资产、约束、画面提示词、分镜、活动和选择范围的写入；不新增平行 v2 路由。
3. Go 端将生产任务与媒体回执映射为书内状态；沿用已有 V11 production/status/merge，默认 merge `speed=1`。
4. 运行 `go test ./backend/internal/httpapi ./backend/internal/shuihuo/...`。

## 3. 收紧旧入口，避免数据骨架回退

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPage.jsx`
- Modify/Create: `tests/batch-factory-current-mainline-contract.test.js`, V11 source guards

1. 先写：`/batch-factory` 只能挂载 V11 UI；空批次不产生示例数据。
2. 禁止新 UI 调用 legacy Node/JSON API；历史文件不自动迁移。
3. 增加 source guard，避免未来将 preview/JSON 页重新接回 V88 路由。

## 4. 以新五模块重构 V11 工作台

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPage.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11UiPage.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`
- Create: `frontend/src/user/pages/batch-factory-v11/NovelSourceModule.jsx`
- Create: `frontend/src/user/pages/batch-factory-v11/NovelAssetsModule.jsx`
- Create: `frontend/src/user/pages/batch-factory-v11/NovelConstraintsModule.jsx`
- Create: `frontend/src/user/pages/batch-factory-v11/NovelVisualPromptsModule.jsx`
- Create: `frontend/src/user/pages/batch-factory-v11/NovelVideoCardsModule.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/batch-factory-v11-workbench.css`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`

1. 先写 UI contract tests：不出现 sample、五模块、首开原文、可同时展开、书列表仅颜色、卡片联动外部预览。
2. 从现有 V11 和隔离候选分支选择性迁移五模块和资产预设交互；不复制 showcase 数据、状态存储或 V78 CSS。
3. 每个编辑/生成/重试动作接 V11 API，并将 loading、revision conflict、权限/能力未配置显示为明确状态。
4. 顶栏和批量选择只分发独立书动作；发布按钮 disabled，明确显示“121 回执链路未验证”。
5. 运行 `npm test` 定向测试和 `npm run build`。

## 5. 合并与真实候选验证

**Files:**
- Modify as needed: `backend/internal/httpapi/shuihuo_batch_factory_merge_handlers.go`
- Create: `docs/superpowers/reports/2026-09-12-v88-batch-factory-candidate.md`

1. 测试书内分镜排序、`speed=1`、能力未就绪失败、源媒体归属和重复合并保留旧成品。
2. 在隔离候选环境完成：登录→导入两本→逐书编辑/导演→一书生成/重试→真实状态读回→合并→重启读回。
3. 记录实际 SHA、镜像、MySQL migration、浏览器证据和已关闭的 121 门禁。
4. 只在全部 GREEN 后合并到 `v88`；随后再决定公网发布，且必须验证 served SHA、登录页面和真实链路。
