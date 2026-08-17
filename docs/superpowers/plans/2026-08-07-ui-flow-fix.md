# UI 流程修复 + Toast 趣味化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** 修复冗余 UI 选择 + tab 切换内容丢失 + Toast 趣味化

**Architecture:** 单文件 (index.html) 的 HTML/CSS/JS 改动，删除 gen-mode-toolbar，新增 gen-controls 下拉+生成按钮，统一 switchToFormat，趣味化所有提示文案。

**Tech Stack:** HTML/CSS/JS，无后端变更。

## Global Constraints

- 只改 index.html
- 不改变 Server.js 或 prompt 文件
- 遵循现有 CSS 变量体系 (--var-name)
- Toast 文案统一活泼风格

---

### Task 1: HTML 结构变更 + CSS 样式

**Files:** Modify `index.html`

- [ ] **Step 1: 删除 gen-mode-toolbar HTML**

删除 `#format-tabs` 内的：
```html
<div class="gen-mode-toolbar" id="gen-mode-toolbar" style="display:none;">
  <button class="gen-toolbar-btn" data-format="storyboard" type="button">画布</button>
  <button class="gen-toolbar-btn" data-format="shortdrama" type="button">剧本</button>
  <button class="gen-toolbar-btn" data-format="screenplay" type="button">剧情</button>
</div>
```

- [ ] **Step 2: 新增 gen-controls HTML**

在 `btn-generate` 之后插入：
```html
<div id="gen-controls" style="display:none;">
  <select id="gen-format-select" class="gen-format-select">
    <option value="storyboard" selected>画布模式</option>
    <option value="shortdrama">剧本模式</option>
    <option value="screenplay">剧情模式</option>
  </select>
  <button id="btn-exec-generate" class="btn-exec-generate" type="button">▶ 一键生成</button>
</div>
```

- [ ] **Step 3: 删除旧 CSS**

删除 CSS 中的 `.gen-mode-toolbar` 和 `.gen-toolbar-btn` 样式块。

- [ ] **Step 4: 新增 gen-controls CSS**

在样式区添加：
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
  transition: border-color var(--transition), box-shadow var(--transition);
}
.gen-format-select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
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
  transition: transform var(--transition-fast), box-shadow var(--transition-fast), opacity var(--transition);
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

- [ ] **Step 5: 新增加载动画 CSS**

添加点点动画和呼吸动画：
```css
.loading-status.visible {
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
```

- [ ] **Step 6: Commit**

---

### Task 2: JS 逻辑变更

**Files:** Modify `index.html`

- [ ] **Step 1: 删除 gen-mode-toolbar 的 JS 事件处理**

删除整个 "生成模式按钮（工具栏中的画布/剧本/剧情按钮）" 模块（约 2703-2765 行）。

- [ ] **Step 2: 重写 format-tab 点击处理**

替换为统一调用 `switchToFormat`：
```javascript
(function() {
    var formatNames = { screenplay: '剧情模式', storyboard: '画布模式', shortdrama: '剧本模式' };
    document.querySelectorAll('#format-tabs .format-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
            var newFormat = tab.dataset.format;
            if (newFormat === ScriptGenerator.getCurrentFormat()) return;
            ScriptGenerator.switchToFormat(newFormat);
        });
    });
})();
```

- [ ] **Step 3: 增强 switchToFormat**

将 `switchToFormat` 改为包含 tab 同步 + 双路径显示（有缓存/无缓存）：
```javascript
function switchToFormat(format) {
    currentFormat = format;
    var outputArea = document.getElementById('output-area');
    outputArea.innerHTML = '';

    var fNames = { screenplay: '剧情模式', storyboard: '画布模式', shortdrama: '剧本模式' };

    // 同步 tab
    document.querySelectorAll('#format-tabs .format-tab').forEach(function(t) {
        t.classList.toggle('active', t.dataset.format === format);
    });

    // 同步工具栏名
    var modeName = document.getElementById('canvas-mode-name');
    if (modeName) modeName.textContent = fNames[format] || '剧本模式';

    if (outputs[format]) {
        var div = document.createElement('div');
        div.style.whiteSpace = 'pre-wrap';
        div.style.lineHeight = '1.8';
        div.textContent = outputs[format];
        outputArea.appendChild(div);
    } else {
        outputArea.innerHTML = '<div class="empty-state"><div class="empty-icon">📄</div><div class="empty-text">' + fNames[format] + '尚未生成</div><div class="empty-sub">在左侧选择格式后点击"一键生成"</div></div>';
    }
    showActionButtons();
    StoryDuration.updateUI();
}
```

- [ ] **Step 4: 新增 btn-exec-generate 点击处理函数**

```javascript
(function() {
    var btnExec = document.getElementById('btn-exec-generate');
    var genFormatSelect = document.getElementById('gen-format-select');
    var loadingStatus = document.getElementById('loading-status');
    var fNames = { screenplay: '剧情模式', storyboard: '画布模式', shortdrama: '剧本模式' };

    function setLoading(msg) {
        loadingStatus.style.display = 'flex';
        loadingStatus.innerHTML = '<div class="spinner"></div><span>' + msg + '</span>';
    }
    function clearLoading() {
        loadingStatus.style.display = 'none';
        loadingStatus.innerHTML = '';
    }

    btnExec.addEventListener('click', async function() {
        var format = genFormatSelect.value;
        var novelText = ScriptGenerator.getCurrentNovelText();
        if (!novelText) { showToast('先粘贴小说内容再点我哦~', 'warning'); return; }

        btnExec.disabled = true;
        btnExec.textContent = '魔法吟唱中...';

        // 同步 tab
        ScriptGenerator.setCurrentFormat(format);
        document.querySelectorAll('#format-tabs .format-tab').forEach(function(t) {
            t.classList.toggle('active', t.dataset.format === format);
        });
        var modeName = document.getElementById('canvas-mode-name');
        if (modeName) modeName.textContent = fNames[format];
        StoryDuration.updateUI();

        setLoading('正在施展魔法，' + fNames[format] + '即将出现...');
        try {
            await ScriptGenerator.generate(novelText, format, StoryDuration.get());
            showToast(fNames[format] + '出炉啦，趁热看看！', 'success');
        } catch (e) {
            showToast('啊哦，网络悄悄跑到外星球去了~', 'error');
        } finally {
            clearLoading();
            btnExec.disabled = false;
            btnExec.textContent = '▶ 一键生成';
        }
    });
})();
```

- [ ] **Step 5: 更新 btn-generate 点击处理中的提取完成后逻辑**

在提取成功回调中，改：
```javascript
document.getElementById('gen-controls').style.display = 'flex';
```
删掉：
```javascript
document.getElementById('gen-mode-toolbar').style.display = 'flex';
```

并更换 Toast 文案。

- [ ] **Step 6: 更换所有 Toast/提示文案**

全局搜索替换：
| 原文 | 新文 |
|------|------|
| `提取失败：` | `哎呀，人物提取出了点小状况，再试试？` |
| `提取完成！请选择生成模式` | `人物和场景提取好啦，选个模式一键生成吧！` |
| `请先粘贴小说内容` | `先粘贴小说内容再点我哦~` |
| `内容太短，请至少输入100字` | `再写多一点吧，至少100个字才能施展魔法~` |
| `暂无生成内容，请先生成` | `还没生成内容呢，先去点"一键生成"吧~` |
| `已复制到剪贴板` 和 `已复制` | `复制成功，快去粘贴吧~` |
| `剧本生成中...` | `正在施展魔法，剧本即将出现...` |
| `人物和场景提取中...` / `提取人物和场景中...` | `正在挖掘小说里的人物和场景...` |
| `生成失败：` | `啊哦，网络悄悄跑到外星球去了~` |
| `API 请求失败` | `啊哦，网络悄悄跑到外星球去了~` |
| `重新生成` 等 toast 中的 `生成完成` | `出炉啦，趁热看看！` |

- [ ] **Step 7: canvas-btn-copy 增加判空提示**

在复制按钮 handler 中，将 `showToast('暂无生成内容，请先生成', 'warning')` 替换为 `showToast('还没生成内容呢，先去点"一键生成"吧~', 'warning')`

- [ ] **Step 8: Commit**

---

## 验收

- [ ] gen-controls（下拉+生成按钮）在提取后出现
- [ ] gen-mode-toolbar 不再出现
- [ ] Tab 切换始终正确恢复缓存内容
- [ ] 复制按钮始终可见，空 tab 提示趣味文案
- [ ] 所有 Toast 文案趣味化
- [ ] 加载动画（点点跳动 + 呼吸脉冲）正常
