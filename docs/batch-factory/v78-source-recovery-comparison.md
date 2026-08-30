# V78.3.0.3 Source Recovery Comparison

更新时间：2026-08-31

## 结论边界

本报告比较的是 V78.3.0.3 production content snapshot 与 Phase 0 恢复分支的可构建静态产物。结论只能称为 `reconstructed reproducible source baseline`，不能称为“100% 原始源码恢复”：生产产物没有 source map、Vite manifest 或 CI build metadata。

本阶段没有修改 `master`、`:3000`、生产容器、生产后端、正式卷或生产数据；没有迁入 V10、Go Settings、Config Snapshot、Inline Constraints、121、Yadi、Drawer 或 Pixiu。

## 基线与镜像

| 项目 | 值 |
| --- | --- |
| production content snapshot | `e4a8ebc4c50c40c383a6a39e69730b22e59c258e` |
| snapshot branch | `snapshot/production-v78.3.0.3` |
| recovered source commit | `17125d67f0919d714ae9ae9f4edc80b9d1a04788` |
| recovery branch | `recovery/production-v78.3.0.3-source` |
| isolated image tag | `qiantie-platform:v78-source-recovery-17125d6` |
| isolated image digest | `sha256:0311279cfabb5e3fcfe14e0cbeec26ba0c9643bda8f317b43c962adbd276f97c` |
| isolated candidate | host port `13100` only; temporary data directory; no production volume mount |

## 静态产物对比

从恢复源码执行 `npm ci`、`npm --prefix frontend ci`、`npm --prefix frontend run build` 后，构建出的 `frontend/dist` 与 `e4a8ebc` 中的 production `frontend/dist` 对比结果为：

```text
expected files: 88
rebuilt files:  88
SHA-256 mismatches: 0
```

该比较在 2026-08-31 从全新 detached worktree 的 clean checkout 重新执行；三个命令 exit code 均为 `0`。

关键文件的 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `frontend/dist/index.html` | `8a8efad54260552cbce1588c97fca0fae61828df8fee55753bb1c1f1899818f3` |
| `frontend/dist/assets/BatchFactoryPreviewPage-C0Ax5a8v.js` | `f9a6418a8bada7423308619d4d0ff846851598dc4c1c40eda46426d0674bd00a` |
| `frontend/dist/assets/BatchFactoryPreviewPage-BNgMoFX3.css` | `8221df7559cc709b87a51a2b45639946a1871a0530d13e9ff866bdd78bdea1c1` |
| `frontend/dist/assets/user-BIFT7AmZ.js` | `461b50381428b43cf9c07c6016a75a6ddfdab3f7f2c474c049b7e1949c67e695` |
| `frontend/dist/batch-rewrite/app.js` | `1b81392f0f1f86e876bc8127e5f22ee477bd0bb0d508c8bc5b1139b7c9b7be21` |
| `frontend/dist/batch-rewrite/index.html` | `64bb852e2c7abac64165fbee12b079f937a140a571fc74f57a076352fa3e485b` |
| `frontend/dist/batch-rewrite/styles.css` | `93372eb590cb11464810843feb7f5d8c9d17e23da1f2da3885c705ea0cc1aa2e` |

生产 snapshot 与构建产物均未发现 `*.map`、`manifest.json`、`vite-manifest.json` 或 `metadata.json`。

## 源码恢复清单与证明级别

完整清单在 `v78-source-recovery-manifest.tsv`（150 条恢复输入）：

- 147 条来自只读暂存索引树 `integration/master-production-20260828:index@4d2925e5d0029924c3e6cafa4b11278d6f407f42`，字节未修改；其中 146 条可在可达 Git 历史中定位同 blob。
- `frontend/src/user/pages/BatchFactoryPage.jsx` 的 blob `d69ce914614d6560a92f28ae6c083e80d883d07e` 仅能在该只读索引树证明，未找到可达 commit 中的相同 blob。
- 3 条 `frontend/public/batch-rewrite/` 输入从 `e4a8ebc` 的已发布 dist 逐字节回置；内容可证明，原始 source 目录组织不可证明。

没有剩余的 missing import、missing module、missing CSS、missing asset、missing API module 或 missing component 构建错误。该清单是 production snapshot 原先缺失、为可重建而恢复的所有构建输入，而不是对后续历史分支的功能迁入。

## 隔离运行时对比

| 检查 | 结果 | 含义 |
| --- | --- | --- |
| `GET /api/build-info` | `200`，返回 `v78.3.0.3-remote-workbench-20260819-r1` | 与 production build ID 一致 |
| `/`, `/settings`, `/novel-fetch`, `/batch-factory`, `/batch-factory-preview`, `/shuihuo-production`, `/script`, `/admin`, `/profile` | 全部 `200` | React 入口和 route matrix 可加载 |
| 未带会话的 Batch GET/intake/batch read/compile/merge API | 全部 `401` | 正确保留 V78 鉴权边界，没有借用生产会话 |
| 已登录 Batch Factory 空工作台 | 已人工截屏核验 | V78 空工作台、工具区、生产/发布设置、单书与 VIDEO 区域均加载；截图路径：`/private/tmp/v78-batch-factory-recovery.png` |

候选容器故意没有连接生产 Go backend；因此已登录画面中的 merge capability 会显示 Go bridge `503`。这证明隔离边界生效，不是前端静态产物差异。

## 动态 Batch API 的未证明项

为避免把候选接到生产 Go 或生产 MySQL，额外尝试以同一 `qiantie-backend:production` 镜像、同一 `mysql:8.4` image digest、全新网络和临时卷启动一个 Go/MySQL 测试栈。两次都没有连接或读取生产数据：

1. 首次失败是 Go 在 MySQL 初始化完成前连接，报 `connect: connection refused`。
2. 等 MySQL 变为可用后重试，生产 Go 镜像在空 MySQL 8.4 卷启动 migration 27 时失败：`BLOB, TEXT, GEOMETRY or JSON column 'admin_note' can't have a default value`。

因此当前不能诚实宣称以下动态链路已在全新临时数据栈完成等价验证：当前 Batch GET、intake、batch read、prompt compile、带数据的空/有数据状态 UI。此问题属于现有 production Go image 的空库迁移可演练性，不是 Phase 0 恢复 Node/React 源码的改动；按本阶段边界没有修改 Go migration。两套失败的临时 MySQL/Go 容器和网络已删除，原 `:13100` 隔离候选保留。

## UI 结论

静态 route matrix 与已登录空工作台已验证，且 88 个发布静态文件逐字节一致。需要 Go 数据或真实批次的 UI 状态不能在不违反隔离要求的前提下证明。故本报告不把“页面可打开”误写为“所有有数据工作流与 production 行为完全等价”。

后续要完成动态等价验收，应先单独修复或提供与 production schema 完全匹配、可从空临时卷启动的 Go backend migration 路径；这属于 Phase 0 之后的独立 Go/数据演练工作，不能和源码恢复混在同一次迁移中。
