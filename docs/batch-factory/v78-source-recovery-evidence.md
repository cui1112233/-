# V78.3.0.3 Source Recovery Evidence

更新时间：2026-08-30

## 范围与结论

本阶段只恢复 V78.3.0.3 的源码可重建基线，不迁入 V10、Go Settings、Config Snapshot、Inline Constraints、121、Yadi、Pixiu 或新业务行为，不修改 `master`、`:3000`、生产容器、正式卷和生产数据。

当前结论是：`reconstructed reproducible source baseline`。没有生产 source map、Vite manifest 或构建元数据，因此不能宣称恢复源码与原始源码 100% 等价。

## 纯生产 snapshot

| 项目 | 证据 |
| --- | --- |
| 纯 V78 snapshot | `e4a8ebc4c50c40c383a6a39e69730b22e59c258e` |
| snapshot 分支 | `snapshot/production-v78.3.0.3` |
| 父提交 | 无父提交；`git rev-list --parents -n 1 e4a8ebc` 只返回自身 SHA |
| 生产版本 | `V78.3.0.3` |
| 生产 build ID | `v78.3.0.3-remote-workbench-20260819-r1` |
| 生产镜像 | `qiantie-platform:production`，本地 digest `sha256:91f9741a9291d9e0e1ba64cc8c317a99b078cd440d6c3fc94136a1f6bc7e55fd` |

`release/production-v78.3.0.3-preset-migration @ 9baa60a57bf6de2086d1d7e132894024d8877c2d` 的父提交是 `89e2271fac9aa28fd56a9d40762caf6244d663a7`，其祖先链在 snapshot 之后增加了 Preset Migration 与 Batch Factory 变更，不能作为纯 snapshot 源码基线。snapshot 之后可见的关键链为：`24b5509`（刷新 frontend bundle）、`8ce9a69`、`dcf47ff`、`334ad91`、`89e2271`、`9baa60a`；更早的 V78 Batch Factory 变更包括 `48e6f1c`、`6456cf8`、`0eff825`、`4e96edb`、`47214d0`。

## 源码恢复来源

最高置信来源是只读工作区 `/private/tmp/qiantie-master-integration-20260828` 的已暂存索引树：

- 工作区 ref：`integration/master-production-20260828`
- 工作区 HEAD：`71fe3d12e40bf7d687563ce4fc03f063ab07773a`
- 已暂存索引树：`4d2925e5d0029924c3e6cafa4b11278d6f407f42`
- 原工作区保持 dirty，未执行 reset、checkout、clean 或写入操作。

该索引树的 source 与 `frontend/dist` 共存，且构建出的生产关键资产与 `e4a8ebc` 完全相同。恢复分支恢复了 147 个 frontend 构建输入/源码文件：146 个文件可定位到 Git 历史中的相同 blob，1 个文件（`frontend/src/user/pages/BatchFactoryPage.jsx`）只可证明来自该索引树，无法定位到可达历史提交。完整路径、来源 commit、blob SHA 和证据级别见 `v78-source-recovery-manifest.tsv`。

三个旧 batch-rewrite 静态输入没有对应原始 frontend 源码；为保持生产行为，直接从 `e4a8ebc` 的生产 `frontend/dist/batch-rewrite/` 原样复制到 `frontend/public/batch-rewrite/`，字节未修改，来源类型标为 `snapshot-asset-rehomed`。

## Source map / manifest 检查

在生产 snapshot 镜像和导出的 `frontend/dist` 中检查了 `*.map`、`manifest.json`、`vite-manifest.json`、`metadata.json`：均不存在（计数均为 0）。生产 `frontend/dist` 共 88 个文件，是当前可验证的权威静态资源集合。

## 固定工具链

| 项目 | 值 |
| --- | --- |
| Docker base | `node:24.19.0-alpine` |
| 容器 Node | `v24.19.0` |
| 容器 npm | `11.17.0` |
| 本地验证 Node | `v24.18.0` |
| 本地验证 npm | `11.16.0` |
| Vite | `5.4.21`，来自 `frontend/node_modules/vite/package.json`，并由 frontend lockfile 锁定 |
| 根 package-lock SHA-256 | `e7db656cd8a74fc3645b4220531c0edd3808d6a27c6177c66db5c41085f02728` |
| frontend/package-lock Git blob | `8a55cd12b3314c49208272699557c2d747e63b37` |
| frontend/package-lock SHA-256 | `405844ca85d21fb808b967d7222c9b3f489d1907d54488270cab47e13b66741f` |
| build command | `npm ci`；`npm --prefix frontend ci`；`npm --prefix frontend run build` |

源码中没有 `VITE_*`、`import.meta.env` 或 `process.env` 构建分支。Dockerfile 只设置 `NODE_ENV=production`；Vite dev proxy 的 `/api` 目标不参与 production build。

## Clean build 结果

在恢复分支的工作树中执行了完整命令：

```text
npm ci                         exit 0
npm --prefix frontend ci       exit 0
npm --prefix frontend run build exit 0
```

构建只有 npm audit、allow-scripts 和运行时品牌图片路径提示，没有 missing import、missing module、missing CSS、missing asset 或 missing API/component 错误。

## 资产复现结果

恢复构建后的 `frontend/dist` 与 `e4a8ebc` 的 88 个文件逐一 SHA-256 比较：`DIST_COUNT=88 MISMATCH=0`。

关键值：

```text
frontend/dist/index.html                                      8a8efad54260552cbce1588c97fca0fae61828df8fee55753bb1c1f1899818f3
frontend/dist/assets/BatchFactoryPreviewPage-C0Ax5a8v.js      f9a6418a8bada7423308619d4d0ff846851598dc4c1c40eda46426d0674bd00a
frontend/dist/assets/BatchFactoryPreviewPage-BNgMoFX3.css     8221df7559cc709b87a51a2b45639946a1871a0530d13e9ff866bdd78bdea1c1
frontend/dist/assets/user-BIFT7AmZ.js                          461b50381428b43cf9c07c6016a75a6ddfdab3f7f2c474c049b7e1949c67e695
frontend/dist/batch-rewrite/app.js                             1b81392f0f1f86e876bc8127e5f22ee477bd0bb0d508c8bc5b1139b7c9b7be21
frontend/dist/batch-rewrite/index.html                         64bb852e2c7abac64165fbee12b079f937a140a571fc74f57a076352fa3e485b
frontend/dist/batch-rewrite/styles.css                          93372eb590cb11464810843feb7f5d8c9d17e23da1f2da3885c705ea0cc1aa2e
```

## 尚不能证明的部分

1. 生产镜像没有 source map、manifest 或 CI metadata，无法证明每个源文件就是当时编译器使用的原始路径版本。
2. `BatchFactoryPage.jsx` 的当前 blob 只存在于已暂存索引树，不能定位到可达 commit。
3. batch-rewrite 的三个源输入只能证明其内容与生产 dist 字节相同，不能证明原始 source 目录的组织方式。
4. 本阶段验证的是静态构建复现；未启动正式容器、未连接正式卷、未做真实外部提交。

因此本阶段名称固定为 `reconstructed reproducible source baseline`，不是“原始源码 100% 恢复”。
