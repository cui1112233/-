# UI 流程修复设计文档

## 背景

当前两步生成流程存在两个问题：

1. **冗余选择**：用户已通过 format-tabs 选了输出格式、通过 mode-switch 选了模式（连续/爆款），但提取人物场景后，工具栏又弹出三个重复按钮（画布/剧本/剧情），需要再次选择
2. **Tab 切换内容丢失**：在多个格式间切换时，已生成的内容消失，复制按钮也失效

## 设计目标

- 提取完成后，在原按钮位置出现 `[格式下拉] + [生成按钮]`，默认画布模式
- 删除冗余的 `gen-mode-toolbar`（画布/剧本/剧情三个按钮）
- 修复 format-tabs 切换时缓存内容丢失的 bug
- 复制按钮（canvas-btn-copy）在切换到空 tab 时仍可用（复制当前显示内容，而非缓存）

## 改造后流程

```
[提取前]
[📝 输入框]
[🔍 提取人物与场景]

[提取后]
[👤 人物卡片] [🎬 场景卡片]
[🔍 重新提取]
[画布模式 ▼] [▶ 一键生成]     ← 新 UI
```

点击 `▶ 一键生成`：
- 用下拉选择的格式 + mode-switch 的状态 + 时长设置 → 调用 generate

## UI 变更

### 移除

- HTML: `#gen-mode-toolbar` 及其三个按钮
- JS: gen-mode-toolbar 的 click 事件处理函数（约 2703-2765 行）
- CSS: `.gen-mode-toolbar`、`.gen-toolbar-btn` 样式

### 新增

在 `left-panel-scroll` 中，`btn-generate` 之后插入：

```html
<!-- 生成控制器：提取完成后显示 -->
<div id="gen-controls" style="display:none;">
  <select id="gen-format-select" class="gen-format-select">
    <option value="storyboard" selected>画布模式</option>
    <option value="shortdrama">剧本模式</option>
    <option value="screenplay">剧情模式</option>
  </select>
  <button id="btn-exec-generate" class="btn-exec-generate" type="button">▶ 一键生成</button>
</div>
```

样式：
```css
#gen-controls {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.gen-format-select {
  flex: 1;
  padding: 10px 14px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  outline: none;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238b8ba0' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
}
.btn-exec-generate {
  padding: 10px 24px;
  background: var(--gradient-accent);
  color: #fff;
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}
.btn-exec-generate:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 20px var(--accent-glow);
}
.btn-exec-generate:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}
```

### JS 逻辑变更

#### 1. btn-exec-generate 点击处理

```javascript
btnExecGenerate.addEventListener('click', async () => {
  const format = genFormatSelect.value;
  const novelText = ScriptGenerator.getCurrentNovelText();
  if (!novelText) return;

  // 同步 format-tabs 选中状态
  ScriptGenerator.setCurrentFormat(format);
  document.querySelectorAll('#format-tabs .format-tab').forEach(t => t.classList.remove('active'));
  const targetTab = document.querySelector(`#format-tabs .format-tab[data-format="${format}"]`);
  if (targetTab) targetTab.classList.add('active');

  // 更新画布工具栏名称
  const modeName = document.getElementById('canvas-mode-name');
  if (modeName) modeName.textContent = formatNames[format];

  // 显示加载状态 + 生成
  setLoading(formatNames[format] + '生成中...');
  try {
    await ScriptGenerator.generate(novelText, format, StoryDuration.get());
    showToast(formatNames[format] + '生成完成！', 'success');
  } catch (e) {
    showToast('生成失败：' + e.message, 'error');
  } finally {
    clearLoading();
  }
});
```

#### 2. format-tab 切换修复

统一所有 tab 切换逻辑，不绕过 `switchToFormat`：

```javascript
document.querySelectorAll('#format-tabs .format-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const newFormat = tab.dataset.format;
    if (newFormat === ScriptGenerator.getCurrentFormat()) return;
    ScriptGenerator.switchToFormat(newFormat);
  });
});
```

`switchToFormat` 做增强：

```javascript
function switchToFormat(format) {
  currentFormat = format;
  const outputArea = document.getElementById('output-area');
  outputArea.innerHTML = '';

  // 同步 tab 激活状态
  document.querySelectorAll('#format-tabs .format-tab').forEach(t => t.classList.remove('active'));
  const targetTab = document.querySelector(`#format-tabs .format-tab[data-format="${format}"]`);
  if (targetTab) targetTab.classList.add('active');

  // 同步画布工具栏名
  const modeName = document.getElementById('canvas-mode-name');
  if (modeName) {
    const names = { screenplay: '剧情模式', storyboard: '画布模式', shortdrama: '剧本模式' };
    modeName.textContent = names[format] || '剧本模式';
  }

  if (outputs[format]) {
    const div = document.createElement('div');
    div.style.whiteSpace = 'pre-wrap';
    div.style.lineHeight = '1.8';
    div.textContent = outputs[format];
    outputArea.appendChild(div);
    showActionButtons();
  } else {
    outputArea.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📄</div>
      <div class="empty-text">${formatNames[format]}尚未生成</div>
      <div class="empty-sub">请在左侧选择生成模式后点击"一键生成"</div></div>`;
    // 复制按钮仍然可见（虽然暂无内容可复制）
    showActionButtons();
  }

  StoryDuration.updateUI();
}
```

#### 3. 复制按钮始终可用

`showActionButtons()` 在无缓存 tab 时也调用，`canvas-btn-copy` 点击时检查 `getCurrentOutput()` 是否为空：

```javascript
// canvas-btn-copy handler 增加判空逻辑
btnCopy.addEventListener('click', () => {
  const text = ScriptGenerator.getCurrentOutput();
  if (!text) { showToast('当前格式暂无生成内容', 'warning'); return; }
  navigator.clipboard.writeText(text).then(...)
});
```

#### 4. 清除提取后显示的按钮

提取完成后显示 `gen-controls` 而非 `gen-mode-toolbar`：

```javascript
// 在 btn-generate 点击处理中
document.getElementById('gen-controls').style.display = 'flex';
// 删除: document.getElementById('gen-mode-toolbar').style.display = 'flex';
```

## Toast 文案趣味化

所有提示信息统一改为轻松活泼风格：

| 场景 | 原文案 | 新文案 |
|------|--------|--------|
| 网络/API 错误 | `API 请求失败` `生成失败：xxx` | `啊哦，网络悄悄跑到外星球去了~` |
| 提取失败 | `提取失败：xxx` | `哎呀，人物提取出了点小状况，再试试？` |
| 无内容复制 | `暂无生成内容，请先生成` | `还没生成内容呢，先去点"一键生成"吧~` |
| 输入太短 | `内容太短，请至少输入100字` | `再写多一点吧，至少100个字才能施展魔法~` |
| 未见小说内容 | `请先粘贴小说内容` | `先粘贴小说内容再点我哦~` |
| 提取成功 | `提取完成！请选择生成模式` | `人物和场景提取好啦，选个模式一键生成吧！` |
| 生成成功 | `xxx生成完成！` | `xxx出炉啦，趁热看看！` |
| 复制成功 | `已复制到剪贴板`  `已复制` | `复制成功，快去粘贴吧~` |
| 提取中 | `提取人物和场景中...` | `正在挖掘小说里的人物和场景...` + 点点动画 |
| 剧本生成中 | `剧本模式生成中...` 等 | `正在施展魔法，剧本即将出现...` + 点点动画 |
| 生成按钮 | `处理中...` | `魔法吟唱中...` |

### 加载动画

加载文案后的三个点 `...` 实现动态跳动（每个点依次缩放/闪烁）：

```css
.loading-dots::after {
  content: '';
  animation: dots 1.2s steps(1, end) infinite;
}
@keyframes dots {
  0%   { content: ''; }
  25%  { content: '.'; }
  50%  { content: '..'; }
  75%  { content: '...'; }
  100% { content: ''; }
}
```

加载状态区域 `#loading-status` 增加微呼吸动画（透明度脉冲），让用户感知系统在工作：

```css
.loading-status.visible {
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
```

## Toast 文案趣味化验收标准

- [ ] 提取完成后，`[格式下拉▼] + [▶ 一键生成]` 出现在原按钮下方
- [ ] 下拉默认选中"画布模式"，可切换到剧本/剧情
- [ ] 点击"一键生成"按选中格式生成，按钮变为"处理中..."
- [ ] 不再出现 `gen-mode-toolbar` 的三个重复按钮
- [ ] 切换到有缓存的 tab 时内容正确恢复
- [ ] 切换到无缓存的 tab 时显示空状态，复制按钮可见但提示"当前格式暂无生成内容"
- [ ] 生成后 format-tabs 选中状态同步
