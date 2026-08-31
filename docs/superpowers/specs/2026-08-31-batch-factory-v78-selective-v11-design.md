# V78 选择性迁入 Batch Factory V11 设计

## 文档状态

`review pending`

本文是已确认的设计草案，供实现前复核。当前只完成设计，不包含业务代码、数据库迁移、容器发布或生产数据操作。

## 1. 目标与边界

目标是在 V78.3.0.3 可重建源码基线之上，选择性迁入已经完成的 V11 工作台 UI，并把第一阶段真实的数据读写接到 Go/MySQL。第一阶段应让用户看到并操作：

- Batch 列表、创建和读取；
- 配置版本读取和同步；
- 生产统一设置 Drawer；
- 当前小说设置；
- 单 VIDEO 设置；
- sparse override 与恢复继承；
- Inline Constraints 的编辑状态。

以下能力在 Go 契约、持久化和测试完成前只展示 UI 位置，不允许执行：

- Hook 生成、审核；
- Director 生成或重新生成；
- 最终 Prompt 编译和提交预览；
- 单本生产、整批生产、状态轮询；
- Merge；
- 121/Yadi 真实提交。

本设计明确不做以下事情：

- 不合并 `master`；
- 不整分支合并 08/09/10 历史线；
- 不把旧 Node Batch Store、effective-settings、Prompt Compiler、production bridge 搬入 V11；
- 不新增 Node Batch Factory 业务规则；
- 不修改现有 `:3000`、正式 MySQL、正式 volume 或生产镜像；
- 不把 UI 中存在的按钮误报为已接通能力。

## 2. 固定基线与来源

### 2.1 V78 发布基线

```text
recovery/production-v78.3.0.3-source
483faed8d654e452f6079fc1ef40b74db3a13d1c
```

这是源码可重建基线。所有候选实现均从该 SHA 建立独立分支/worktree。

### 2.2 V11 UI 来源

```text
origin/feat/batch-factory-v11-layout-showcase
59afd75da3d9b96b908b849931c5f28289a674d9
```

该分支与 V78 基线没有可直接依赖的共同合并基线，采用逐文件、逐提交选择性迁移。

主要 UI 资产：

- `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`
- `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11SettingsDrawers.jsx`
- `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11ScopedSettings.jsx`
- `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11ConstraintEditor.jsx`
- `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11BatchManager.jsx`
- `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11PublishSettings.jsx`
- `frontend/src/user/pages/batch-factory-v11/workspace-layout.js`
- `frontend/src/shared/api/batchFactoryV11.js`
- `frontend/src/user/pages/batch-factory-v11/bf11Runtime.js`
- `frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.js`

### 2.3 Go Slice 1 来源

```text
origin/release/production-v78.3.0.3-batch-factory-go-first
8aca2668b332d37f1c7c64030b17220621d74799
```

已存在 HMAC bridge、owner 隔离、Batch/Book/VIDEO 基础 Store、Settings、Snapshot、Config Version、Prompt/Draft 初步存储和 MySQL schema。它仍需通过 Node 认证代理接入 V78，并补齐 UI 所需的领域字段。

当前运行中的 Go 服务对 `/api/batch-factory/v11/capabilities` 实测返回 `404`；因此本设计把“Node 代理注册、Go 路由暴露、端到端 readback”列为前置门禁，不把已有源码误判为线上已接通。

### 2.4 历史参考来源

历史分支只用于提取 UI、契约或测试意图：

| 来源 | SHA | 允许提取 |
|---|---|---|
| `10-batch-factory-inline-constraints-version-config` | `4be9b359d2878562634aace57e566690a0fda34f` | Drawer、Inline Constraints、workspace 交互 |
| `09-batch-factory-video-model-selector` | `61d600004af1ea990ad9d605c97a4b163ba74445` | 模型选择/冻结语义 |
| `08-batch-factory-unified-settings-version-sync` | `b57f626c81d3ed9f16cf1edf3965326d14b82386` | 版本同步和单书约束交互 |
| `10-batch-factory-go-api-migration` | `b02632d77d299f3106483b6b37621019cd9ca1dc` | Go Settings/Snapshot 架构参考 |

禁止整分支 merge，禁止复制其旧 Node 业务链。

## 3. 运行架构

```text
浏览器
  ↓ 同源请求
Node/Express :3000
  ├─ React 静态资源
  ├─ 登录/session
  └─ V11 认证代理（只签名和转发）
        ↓ HMAC bridge
Go Batch Factory API :4000
        ↓
MySQL 8.4
```

现有 V78 的其他页面、认证、媒体和旧接口保持原有运行方式。Node 代理必须：

1. 从当前 session 取得 username/owner 信息；
2. 对 Go 请求生成现有 bridge 所需的签名头；
3. 原样转发允许的 HTTP method、path、body 和状态码；
4. 不解析、不合并、不重新计算 Batch Factory 业务规则；
5. 不把密钥或原始用户凭据写入前端或 Node Batch Store。

React 不直接访问宿主机 `:4000`，避免绕过 V78 session 和 owner 隔离。

## 4. 页面与回退策略

### 4.1 正式入口

`/batch-factory` 逐步切换为 `BatchFactoryV11UiPage`。V11 页面只能通过 `batchFactoryV11.js` 访问 `/api/batch-factory/v11/*`。

### 4.2 明确回退

`/batch-factory-preview` 保留 V78 旧 Preview 页面，继续使用旧 API，仅作为人工回退入口。V11 API 失败时不得静默切回旧 Node 业务链；页面应显示可重试的 V11 错误状态。

### 4.3 第一阶段 capability

Go 返回的 capability 是唯一解锁依据：

```text
batch.read       enabled after API and readback tests
batch.create     enabled after create/intake tests
settings.edit    enabled after revision/conflict tests
snapshot.read    enabled after snapshot tests
override.edit    enabled after sparse override tests

director.run     disabled
hook.review      disabled
production.submit disabled
merge.run        disabled
publish.121      disabled
publish.yadi     disabled
```

前端不得根据按钮是否存在、环境变量或本地状态自行解锁能力。

## 5. UI 迁移合同

### 5.1 工作台主体

从 V11 UI 选择性迁入四个工作区卡片：

1. `book-list`：小说列表、搜索、切换；
2. `book-workbench`：当前小说、原文、Hook/Director/资产/VIDEO 区域；
3. `preview`：最终合并和单 VIDEO 标签切换，共用一个播放器容器；
4. `batch-tools`：进度、批量动作和错误提示区域。

布局编辑、保存、恢复默认布局属于纯前端能力，可以直接迁入，不读写旧 Batch Store。

### 5.2 设置层

生产统一设置必须是宽 Drawer，内容顺序固定：

1. 配置版本；
2. 基础生产设置；
3. 约束设置。

Book 设置使用轻量 Modal/卡片，VIDEO 设置使用 Drawer。所有保存均通过 V11 client 发送 sparse patch 和 expected revision。

### 5.3 Prompt 和约束

第一阶段允许编辑当前层 draft/override，但不允许把 React 内置选项当作最终权威目录。系统预设、我的提示词和草稿的正式 authoritative store 由后续 Go Prompt slice 定义；在该 slice 完成前，保存为公共 Prompt 的按钮保持禁用。

约束开关打开后直接展开编辑区；关闭只停止编译注入，不删除当前草稿。恢复继承必须删除对应 override key，而不是复制父级当前值。

### 5.4 不能伪装成已接通的 UI

- `BatchFactoryV11BatchManager` 和 `BatchFactoryV11PublishSettings` 文件存在，但必须先完成页面挂载和 capability/API 接线；
- 发布 Drawer 可以展示，但没有 Go 发布 API 时保存/提交按钮必须禁用；
- Hook、Director、Production、Merge 面板可以展示状态和说明，执行动作必须禁用；
- 画面 Prompt 保存、最终 Prompt 预览在 Go Compiler 完成前保持禁用；
- 播放器没有真实 media URL 时只能显示占位，不得显示“已完成播放”。

## 6. Go 数据与 API 契约

### 6.1 最小详情响应

为了让截图中的 UI 使用真实数据，`GET /api/batch-factory/v11/batches/{batchId}` 至少需要返回：

```json
{
  "batch": {
    "id": "...",
    "title": "...",
    "status": "...",
    "mode": "original|viral",
    "videoModel": {
      "id": "...",
      "versionId": "...",
      "name": "...",
      "maxDurationSeconds": 15
    },
    "configVersion": {"id": "...", "name": "..."},
    "books": [
      {
        "id": "...",
        "bookId": "...",
        "title": "...",
        "platform": "...",
        "status": "...",
        "overrideCount": 0,
        "sourceText": "...",
        "assets": {"characters": [], "scenes": [], "props": []},
        "hook": null,
        "directorRevision": null,
        "videos": [
          {
            "id": "...",
            "label": "VIDEO 01",
            "status": "draft",
            "durationSeconds": 0,
            "visualPrompt": "",
            "compatibilityState": "active",
            "mediaUrl": ""
          }
        ],
        "mergedUrl": ""
      }
    ]
  }
}
```

缺失字段必须在 Go 类型、Store、SQL readback 和 HTTP contract test 中补齐；React 不得通过猜测旧 Node 字段来填充。

### 6.2 请求流

```text
GET capabilities
  → GET config-versions + GET batches
  → GET selected batch
  → POST intakes/novel-fetch（小说获取转入）
  → POST intakes/{intakeId}/batches（用户明确创建批次）
  → PUT batch settings / book override / VIDEO override
  → POST change-impact（只读预览）
```

保存必须携带 `expectedRevision`。Go 返回 `409` 时前端保持 Drawer 打开，提示刷新后重试，不覆盖用户未确认的编辑。

### 6.3 权威性和安全规则

- 模型 ID、版本、名称、最大时长和可用性由 Go catalog canonicalize；
- React 的模型选项仅用于初始渲染，不能作为可信值；
- Batch/Book/VIDEO 设置采用 `system < batch < book < video`；
- 显式 `false`、空字符串和零值必须保留；
- 模型/模式/配置变化只使 Director 失效，不删除 Book/VIDEO override；
- VIDEO identity 变化时保留旧 override，并返回 `orphaned/incompatible` 状态；
- Node 不保存新的 V11 业务状态，不与 Go 双写。

当前 Go `ChangeImpact` 固定返回 `InvalidatesDirector=false`，在第一阶段正式解锁前必须修正为服务端计算结果。

前后端 capability 名称统一使用 `production.submit`。现有 V11 UI 中仍出现 `production.run` 的旧键名，迁移时必须改为服务端契约，禁止通过添加别名掩盖未接入的 Production 能力。

## 7. 分阶段实施边界

每个阶段独立测试、独立提交；任一门禁失败即停止，不继续下一阶段。

### Slice A：V11 bridge 和基础数据 readback

- Node 只读 session 并转发签名请求；
- Go 补 Batch/Book/VIDEO 详情字段；
- 打通 Novel Fetch intake 到明确创建 Batch 的请求链；
- capability、列表、详情、owner 隔离和错误状态测试；
- 不解锁生产动作。

### Slice B：Settings/Snapshot/Override

- 生产设置 Drawer 接 batch settings；
- 配置版本读取/同步；
- Book/VIDEO sparse override；
- 恢复继承、显式 false/空字符串、revision conflict；
- 修正 ChangeImpact 契约。

### Slice C：UI 挂载与候选展示

- 挂载 V11 工作台、Batch Manager 和 Drawer；
- 迁入四区布局、状态筛选、单播放器和主题样式；
- 未接 API 的入口保持 capability disabled；
- 在临时候选端口运行，不替换 `:3000`。

### 后续阶段（本设计不实现）

- Director/Hook contract 与持久化；
- Effective Settings 和唯一 Final Prompt Compiler；
- Production/Status/Merge；
- 121/Yadi 独立安全接入。

## 8. 测试和发布门禁

每个 Slice 至少包含：

- Go unit/store/HTTP contract tests；
- Node bridge/auth/错误透传 tests；
- 前端 source guard、状态和保存流程 tests；
- clean worktree 的 `npm ci`、frontend tests、frontend build；
- 不使用生产卷的临时 MySQL/对象存储验收。

候选切换前必须记录：

- 基线 SHA 和候选 SHA；
- image tag/digest；
- Node/Go container name；
- 启动参数和 volume mount；
- 可回滚 image 和数据库备份路径。

没有完成候选端口的页面、API、刷新恢复和容器重启验证时，不得替换 `10.0.101.122:3000`。

## 9. 回滚原则

1. UI-only 问题：回滚 platform image 到上一 digest；
2. Go/API 问题：关闭 V11 capability 或回退 Go image，Node 仍保持 V78 认证和旧 Preview；
3. 数据问题：只回滚临时 V11 schema/volume，不操作正式 MySQL；
4. 任意回滚都不得删除旧 volume、旧 Node Store 或正式媒体对象。

## 10. 验收标准

第一阶段只有满足以下条件才可称为“V11 Settings/UI Alpha”：

- `/batch-factory` 展示 V11 四区工作台；
- 小说列表、搜索和切换读取 Go 数据；
- 生产统一设置 Drawer 保存后刷新仍保持；
- Book/VIDEO override 保存、恢复继承和冲突提示正确；
- 配置版本由 Go 返回，不能被 React 静态选项覆盖；
- 约束开关打开即编辑，未接 Prompt 库动作保持禁用；
- Director、Production、Merge、121/Yadi 没有误解为可执行；
- `/batch-factory-preview` 仍可作为明确回退入口；
- 现有 V78 登录、首页、设置、小说获取和其他主要页面无回归；
- 候选端口和 clean build 证据完整。

完成这些条件不等于完整 Batch Factory；完整产品仍需后续 Go Director、Compiler、Production、Status、Merge 和 Publish 阶段。
