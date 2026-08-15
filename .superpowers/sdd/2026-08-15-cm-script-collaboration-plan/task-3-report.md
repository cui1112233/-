# Task 3 报告

## 实施内容

- `ScriptPage` 监听 `PET_PREVIEW_EVENT`，仅将候选稿保存到预览状态，不写入当前剧本或草稿。
- 新增“CM 修改预览”弹窗，左右展示当前剧本和候选剧本；取消/放弃不产生写入。
- 仅在确认应用时调用 `updateOutputDraft` 覆盖剧本；若预览期间当前剧本变化，拒绝应用并提示重新生成修改稿。
- 每次应用将原剧本保留为一次内存撤销快照；撤销会恢复该快照并清空快照。
- 剧本生成失败不再清空已有 `output`。
- 新增预览双栏的响应式样式与相关契约覆盖。

## TDD 与验证

- 先扩展 Task 3 契约断言并运行，预期因预览状态、撤销和防覆盖逻辑缺失而失败。
- 实现后运行：
  - `node --test tests/cm-agent-ui-contract.test.js tests/script-draft-persistence-contract.test.js`
  - 结果：10 项通过，0 项失败。
  - `npm --prefix frontend run build`
  - 结果：构建成功；Vite 输出既有的大体积 chunk 警告，无构建错误。

未执行 Task 4 的完整回归或手动验收。
