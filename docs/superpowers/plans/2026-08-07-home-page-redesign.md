# 一战晟铭首页简约动态重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重塑“一战晟铭”首页，替换原本简陋的占位元素，打造一套不含积分额度概念、极致简约好看、且富有科技微动效的玻璃态工作台 Dashboard，并完美适配移动端。

**Architecture:** 
1. 采用零 JS 结构变动、纯 CSS 驱动和轻量级 DOM 渲染的设计。
2. 首页（`#page-home`）由三大核心区域组成：极光流光欢迎面板（`home-hero-banner`）、快捷创作入口组（`home-quick-actions`）、以及从本地缓存（`localStorage`）动态拉取渲染的极简剧本画廊（`home-recent-gallery`）。
3. 所有微交互（Hover、流光、浮动、脉冲波）全部在 CSS 中通过 GPU 加速的属性（`transform`, `opacity`, `background-position`）优雅实现，确保低配置下也顺畅无比。

**Tech Stack:** HTML5, CSS3 (CSS Variables, Flexbox/Grid, CSS Keyframe Animations)

## Global Constraints
1. 绝不引入任何“积分”、“额度”卡片或文案。
2. 完美适配亮色/暗色（`data-theme="light"` / `data-theme="dark"`）双主题。
3. 严格执行响应式布局（PC端 >= 1024px，平板 768-1023px，手机端 < 768px）。
4. 代码修改保持局部，不破坏已有的页面切换与功能路由。

---

## 任务分解

### Task 1: 首页基础 HTML 结构重塑与静态样式

**Files:**
- Modify: `index.html` 约 1728-1732 行（重写 `#page-home` 部分的 HTML 结构）。
- Modify: `index.html` 约 574-603 行（重构 `#page-home` 相关的 CSS 样式）。

**Interfaces:**
- Consumes: 已有的 `.page-container` 和全局色彩变量。
- Produces: 简约好看的首页静态骨架（Banner + 3个 Quick Actions 卡片 + 最近剧本 Grid 排版）。

- [ ] **Step 1: 阅读并确认现有的 #page-home 结构**
确认现有的 HTML 占位结构。

- [ ] **Step 2: 替换 #page-home HTML 结构**
在 `index.html` 中，将：
```html
  <!-- Page: Home -->
  <div id="page-home" class="page-container">
    <div class="placeholder-icon">🏠</div>
    <div class="placeholder-text">欢迎使用 一战晟铭</div>
    <div class="placeholder-sub">将小说章节转化为可视化剧本</div>
  </div>
```
替换为符合我们简约工作台规范的结构：
```html
  <!-- Page: Home -->
  <div id="page-home" class="page-container">
    <!-- 1. 动态欢迎面板 -->
    <div class="home-hero-banner">
      <div class="banner-glow-bg"></div>
      <h1 class="banner-title">一战晟铭</h1>
      <p class="banner-subtitle">探索文字的视觉边界，将小说章节转化为可视化剧本</p>
    </div>

    <!-- 2. 快捷入口组 -->
    <div class="home-quick-actions">
      <div class="quick-action-card card-write" onclick="document.querySelector('.nav-item[data-page=\'script\']').click()">
        <span class="card-icon">📝</span>
        <div class="card-info">
          <h3 class="card-title">新建剧本项目</h3>
          <p class="card-desc">一键导入小说，自动拆分智能分镜</p>
        </div>
        <span class="card-arrow">➔</span>
      </div>
      <div class="quick-action-card card-agent" onclick="document.querySelector('.nav-item[data-page=\'agent\']').click()">
        <span class="card-icon">🤖</span>
        <div class="card-info">
          <h3 class="card-title">AI 智能 Agent</h3>
          <p class="card-desc">专属助手对话，辅助精细化剧本包装</p>
        </div>
        <span class="card-arrow">➔</span>
      </div>
      <div class="quick-action-card card-tts" onclick="location.href='/tts'">
        <span class="card-icon">🎙️</span>
        <div class="card-info">
          <h3 class="card-title">声音配音工坊</h3>
          <p class="card-desc">多音色情感合成，让你的画面声临其境</p>
        </div>
        <span class="card-arrow">➔</span>
      </div>
    </div>

    <!-- 3. 最近剧本画廊 -->
    <div class="home-recent-section">
      <div class="section-header">
        <h2 class="section-title">📂 最近创作项目</h2>
        <button class="btn-more-projects" onclick="document.getElementById('btn-open-history').click()">查看全部历史记录</button>
      </div>
      <div id="home-recent-grid" class="recent-grid">
        <!-- 动态渲染，若无则展示极简 placeholder -->
        <div class="recent-empty">
          <div class="empty-icon">📂</div>
          <p>暂无最近的创作记录，点击上方 “新建剧本项目” 开始首个剧本吧！</p>
        </div>
      </div>
    </div>
  </div>
```

- [ ] **Step 3: 重写 #page-home 的 CSS 静态骨架和玻璃态样式**
将原本 574-603 行的 `#page-home` 占位 CSS 替换为以下精美、高质感的玻璃态工作台静态排版：
```css
/* ============================================
   Home Page - Modern Workbench Redesign
   ============================================ */
#page-home {
  flex-direction: column;
  padding: 40px;
  gap: 32px;
  overflow-y: auto;
  align-items: stretch;
  justify-content: flex-start;
  color: var(--text-primary);
}

/* 1. Welcome Hero Banner */
.home-hero-banner {
  position: relative;
  padding: 40px 32px;
  background: var(--bg-panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xl);
  overflow: hidden;
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--shadow);
}

.banner-glow-bg {
  position: absolute;
  top: -50%;
  left: -20%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle, rgba(240, 113, 103, 0.08) 0%, rgba(96, 165, 250, 0.04) 40%, transparent 70%);
  z-index: 0;
  pointer-events: none;
}

.banner-title {
  font-size: 32px;
  font-weight: 700;
  margin-bottom: 12px;
  background: linear-gradient(135deg, var(--text-primary) 0%, #f5976c 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  position: relative;
  z-index: 1;
}

.banner-subtitle {
  font-size: 15px;
  color: var(--text-secondary);
  max-width: 600px;
  line-height: 1.6;
  position: relative;
  z-index: 1;
}

/* 2. Quick Actions Card Grid */
.home-quick-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

.quick-action-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 24px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--shadow-sm);
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.3s var(--transition),
              border-color 0.3s var(--transition);
}

.card-icon {
  font-size: 36px;
  flex-shrink: 0;
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.card-info {
  flex: 1;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--text-primary);
}

.card-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.card-arrow {
  font-size: 18px;
  color: var(--text-muted);
  transition: transform 0.3s var(--transition), color 0.3s var(--transition);
}

/* 3. Recent projects gallery */
.home-recent-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.btn-more-projects {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  transition: all 0.25s var(--transition);
}

.btn-more-projects:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim);
}

.recent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.recent-empty {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  background: var(--bg-card);
  border: 1px dashed var(--border-light);
  border-radius: var(--radius-lg);
  color: var(--text-muted);
  gap: 12px;
}

.empty-icon {
  font-size: 40px;
  opacity: 0.3;
}

.recent-empty p {
  font-size: 13px;
  opacity: 0.7;
  text-align: center;
}
```

---

### Task 2: 极致灵动微动效与主题适配

**Files:**
- Modify: `index.html` 约 600 行后（追加微交互和极光流动 CSS 代码）。

**Interfaces:**
- Consumes: CSS 动画引擎和 GPU 渲染加速。
- Produces: 呼吸起伏、流光炫酷、Hover 3D 感等高级微交互动态。

- [ ] **Step 1: 新增极光流光的缓缓运动效果**
让 Banner 背景中淡雅的极光像呼吸般缓缓移动，增加质感：
```css
/* Aurora Background Motion */
@keyframes auroraMove {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(5%, 3%) scale(1.1); }
  100% { transform: translate(0, 0) scale(1); }
}
.banner-glow-bg {
  animation: auroraMove 15s ease-in-out infinite;
}
```

- [ ] **Step 2: 编写快捷卡片的 Hover 炫酷微动效**
Hover 动作会带来：
1. 整体上浮与阴影强化。
2. 卡片图标触发 3D 弹跳起伏。
3. 侧边小箭头触发向右横移与高亮。
4. 特色流光高亮边框。
```css
/* Card Hover Micro-interactions */
.quick-action-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

.quick-action-card.card-write:hover {
  border-color: var(--accent);
}
.quick-action-card.card-agent:hover {
  border-color: #60a5fa;
}
.quick-action-card.card-tts:hover {
  border-color: #4ade80;
}

.quick-action-card:hover .card-icon {
  transform: scale(1.15) rotate(-5deg);
}

.quick-action-card:hover .card-arrow {
  transform: translateX(5px);
  color: var(--text-primary);
}

/* 渐变流光文字运动 */
@keyframes textGlow {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
.banner-title {
  background-size: 200% auto;
  animation: textGlow 6s linear infinite;
}
```

---

### Task 3: 动态最近创作记录（画廊）的 JS 渲染联动

为了不写额外、繁琐的新 JS 逻辑，我们**直接借用和监听现有的历史生成记录模块**。现有系统已有完美的本地缓存及 API 机制，我们只需在首页加载时，读取并展示最新的 3 条或 4 条数据作为“最近项目”，彻底搞定画廊功能！

**Files:**
- Modify: `index.html` 约 2750 行后（追加首页动态渲染 JavaScript 函数，并在历史记录初始化时联合触发）。

**Interfaces:**
- Consumes: 历史记录模块已持有的历史列表数据。
- Produces: 首页“最近创作项目”格子的真实渲染。

- [ ] **Step 1: 新增首页最近剧本的 JS 动态渲染逻辑**
在 `renderList` 的执行结尾，追加渲染首页最近项目的逻辑：
```javascript
        // 渲染首页最近创作项目
        renderHomeRecent(entries);
```

- [ ] **Step 2: 编写 renderHomeRecent 函数**
在 JS 脚本适当位置定义此渲染逻辑（支持卡片点击“继续编辑/打开”、删除）：
```javascript
    function renderHomeRecent(entries) {
        const homeGrid = document.getElementById('home-recent-grid');
        if (!homeGrid) return;

        if (entries.length === 0) {
            homeGrid.innerHTML = `
                <div class="recent-empty">
                    <div class="empty-icon">📂</div>
                    <p>暂无最近的创作记录，点击上方 “新建剧本项目” 开始首个剧本吧！</p>
                </div>
            `;
            return;
        }

        // 取最近的 4 条记录展示
        const recentEntries = entries.slice(0, 4);
        homeGrid.innerHTML = recentEntries.map(function(e) {
            const tag = e.mode === 'hook' ? '爆款' : '连续';
            const time = formatTime(e.createdAt);
            
            return `
                <div class="recent-project-card" data-id="${esc(e.id)}">
                    <div class="proj-card-header">
                        <span class="proj-tag">${esc(tag)}</span>
                        <span class="proj-time">${esc(time)}</span>
                    </div>
                    <div class="proj-body">
                        <p class="proj-preview">${esc(e.preview || '未命名剧本')}</p>
                    </div>
                    <div class="proj-footer">
                        <span class="proj-format">${esc(e.formatName)}</span>
                        <div class="proj-actions">
                            <button class="proj-btn-delete" data-delete="${esc(e.id)}" title="删除">✕</button>
                            <span class="proj-go">打开 ➔</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
```

- [ ] **Step 3: 补充最近卡片的精致样式与点击联动**
追加卡片精细 CSS 以及快速点击打开逻辑：
```css
/* Recent Project Card Styles */
.recent-project-card {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 20px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  height: 160px;
  transition: transform 0.25s var(--transition), border-color 0.25s var(--transition), box-shadow 0.25s var(--transition);
}

.recent-project-card:hover {
  transform: translateY(-3px);
  border-color: var(--border-light);
  box-shadow: var(--shadow);
}

.proj-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.proj-tag {
  background: var(--accent-dim);
  color: var(--accent);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
}

.proj-time {
  font-size: 11px;
  color: var(--text-muted);
}

.proj-body {
  flex: 1;
  overflow: hidden;
}

.proj-preview {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.proj-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}

.proj-format {
  font-size: 11px;
  color: var(--text-muted);
}

.proj-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.proj-btn-delete {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  font-size: 12px;
  transition: color 0.2s var(--transition);
}

.proj-btn-delete:hover {
  color: var(--error);
}

.proj-go {
  font-size: 11px;
  color: var(--accent);
  font-weight: 500;
}
```
并在 JS 中，为 `#home-recent-grid` 添加委托点击事件，完美对应侧边栏/下拉框里的“打开剧本”与“删除记录”逻辑：
```javascript
    // 绑定首页卡片的点击联动
    const homeGrid = document.getElementById('home-recent-grid');
    if (homeGrid) {
        homeGrid.addEventListener('click', function(e) {
            const delBtn = e.target.closest('.proj-btn-delete');
            if (delBtn) {
                e.stopPropagation();
                // 调用历史记录模块的通用删除
                if (confirm('确认删除此创作记录吗？')) {
                    remove(delBtn.dataset.delete);
                }
                return;
            }
            const card = e.target.closest('.recent-project-card');
            if (!card) return;
            const id = card.dataset.id;
            // 联动触发历史记录中对应项目的加载逻辑
            const historyItem = document.querySelector(`#history-list .history-item[data-id="${id}"]`);
            if (historyItem) {
                historyItem.click();
            } else {
                // 如果侧边下拉尚未生成，直接拉取数据并打开
                authFetch('/api/history/' + encodeURIComponent(id))
                    .then(r => r.text())
                    .then(text => {
                        const entry = _entries.find(en => en.id === id);
                        if (entry) showOutput(text, entry.formatName, null);
                    });
            }
        });
    }
```

---

### Task 4: 完美响应式与移动端流式适配

**Files:**
- Modify: `index.html` 约 1520 行后的 `@media` 部分。

- [ ] **Step 1: 平板端适配**
在平板（768px - 1023px）视口中，将首页调整为紧凑排版：
```css
  #page-home {
    padding: 24px;
    gap: 24px;
  }
  .home-hero-banner {
    padding: 32px 24px;
  }
  .banner-title {
    font-size: 28px;
  }
  .home-quick-actions {
    gap: 16px;
  }
  .quick-action-card {
    padding: 16px;
    gap: 12px;
  }
```

- [ ] **Step 2: 手机端适配**
在手机端（< 768px）视口中，使用滑轨或极简布局：
```css
  #page-home {
    padding: 16px;
    gap: 20px;
  }
  .home-hero-banner {
    padding: 24px 16px;
    border-radius: var(--radius-lg);
  }
  .banner-title {
    font-size: 24px;
  }
  .banner-subtitle {
    font-size: 13px;
  }
  .home-quick-actions {
    grid-template-columns: 1fr; /* 手机端单列平铺 */
    gap: 12px;
  }
  .quick-action-card {
    padding: 14px;
  }
  .card-icon {
    font-size: 28px;
  }
  .recent-grid {
    grid-template-columns: 1fr; /* 手机端单列平铺 */
    gap: 12px;
  }
  .recent-project-card {
    height: 140px;
    padding: 16px;
  }
```

---

## 计划验证步骤
1. 打开浏览器登录，首页成功渲染且没有发生报错。
2. 检查亮色和暗色主题，确认 Banner、Actions、最近卡片能完美适应。
3. 检查是否有任何关于积分、Token相关的展示（确认完全无遗留）。
4. 在侧边栏“剧本生成”导入一段小说测试运行，成功后返回“首页”，观察最近项目里是否多出了这个卡片，并测试点击该卡片是否能联动打开剧本成果、是否能成功删除。
5. 按 F12 打开移动端模拟器，将视口调整至 iPad 与 iPhone，确认是否能流畅滚动排版，且最近记录与卡片无错位。
