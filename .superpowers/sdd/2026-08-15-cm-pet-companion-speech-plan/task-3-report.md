# Task 3 Report

## 状态

完成。CM 气泡已接入主动台词调度、优先级与生命周期管理，且未修改聊天、拖拽、任务或剧本协作协议。

## 文件

- 修改：`frontend/src/shared/pet/StackyPet.jsx`
- 新增：`tests/cm-pet-companion-ui-contract.test.js`

## RED

执行：

```powershell
node --test tests/cm-pet-companion-ui-contract.test.js
```

结果：失败，断言未在 `StackyPet.jsx` 中找到 `getCompanionCandidate`，符合未接入调度器的预期。

## GREEN

执行：

```powershell
node --test tests/cm-pet-companion-ui-contract.test.js frontend/src/shared/pet/stacky.test.js
```

结果：通过，17 个测试通过、0 个失败。

另已完成组件语法诊断与 `git diff --check`，均无问题。

## 提交

`ee27baf feat: schedule CM companion bubbles`

## 风险

- UI 契约测试为静态源码契约，覆盖导入、条件、计时器、优先级、点击与 JSX 顺序；尚未执行浏览器运行时交互验收。
- 工作树原有未跟踪目录 `data/` 未被暂存或提交。

## 审查修复

### RED

执行：

```powershell
node --test tests/cm-pet-companion-ui-contract.test.js
```

结果：失败。新增契约要求页面隐藏时 `handleVisibilityChange` 调用 `clearCompanionSpeech()`；原实现只取消计时器，普通气泡状态会在恢复可见且无候选时遗留。

### GREEN

`handleVisibilityChange` 在页面隐藏时改为调用 `clearCompanionSpeech()`，可见时仍重新调度。`reply` 与 `petSpeech` 不受影响。

执行：

```powershell
node --test tests/cm-pet-companion-ui-contract.test.js frontend/src/shared/pet/stacky.test.js
```

结果：通过，17 个测试通过、0 个失败。

提交：`fix: clear CM bubbles when hidden`
