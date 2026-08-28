# Task 2 报告

状态：DONE

## 修复

- `UserLayout` 导航加入 `/batch-factory`，保持账号中心路由集合独立。
- 发布设置归一化保留已有组织/121 配置值（空值不污染既有契约），并限制解压倍速为 `0.5–2`、音调为 `-50–50`；默认值保持 `1.7` 与 `0`。
- V6 生产抽屉标题统一为“高级生成设置”，解压倍速/音调控件显式暴露数值范围。

## 验证

- `node --test tests/batch-factory-current-mainline-contract.test.js tests/batch-factory-settings-contract.test.js tests/batch-factory-v6-completeness.test.js`：8/8 PASS。
- 额外 `tests/batch-factory-121-publish.test.js` 合并运行：12/12 PASS。
- `npm --prefix frontend run build`：成功；仅有既有资源解析与大 chunk 警告。

## 提交

`28cd3b5 fix: align batch factory contracts with v6 flow`

## Concerns

工作树中其他任务的改动仍未提交；本提交仅包含 Task 2 的 3 个目标文件。前端构建未将 `dist` 产物纳入版本控制。
