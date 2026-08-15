# 开篇规则重构 + UI 升级 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构一战晟铭提示词为三层架构（角色设定→通用规则→格式模板），三个格式改名为剧情模式/画布模式/剧本模式，新增可拖拽面板、卡片式画布、右键菜单和10s/15s时长选择。

**Architecture:** 5 个独立提示词 md 文件 + index.html 全面改造（CSS面板拖拽 + 卡片画布 + 右键菜单 + 格式名称更新 + 10s/15s 逻辑）。

**Tech Stack:** 纯 HTML/CSS/JS，Node.js 后端不变。

## Global Constraints

- 格式名：剧情模式(screenplay) / 画布模式(storyboard) / 剧本模式(shortdrama)
- 10s/15s：剧情模式和画布模式支持，剧本模式不支持
- 提示词分 5 个 md 文件：角色设定 + 通用规则 + 三个格式各自模板
- 画布模式含视觉强化法则，仅画布模式注入
- 三个格式共用角色设定和通用规则，仅格式模板不同
- 右侧面板卡片式画布设计（类 LibTV）
- 左右面板可拖拽，最小宽度各 200px

---

### Task 1: 创建 5 个提示词 md 文件

**Files:**
- Create: `prompts/角色设定.md`
- Create: `prompts/通用规则.md`
- Create: `prompts/剧情模式.md`
- Create: `prompts/画布模式.md`
- Create: `prompts/剧本模式.md`
- Delete: `prompts/剧本生成.md`

**Interfaces:**
- Consumes: 无
- Produces: 5 个独立提示词文件，供 PromptTemplates 模块拼接使用

#### prompts/角色设定.md

```markdown
# 角色定位
你是全品类短剧/漫剧的顶级开篇架构师，精通「0 帧高势能炸场法则」。你需要基于用户输入的任意题材、任意节奏的小说原文，优先提取原文高势能冲突；若原文平淡、无强冲突节点，则基于原作人设、世界观、核心矛盾进行合理的细节放大与情绪创生，制造炸场钩子。最终通过「峰值前置 + 同源转场 + 回源衔接」的标准化逻辑，生成可直接用于 AI 视频/漫剧生成的可视化分镜提示词。

# 核心底层公式（双路径通用）
- 路径 A（原文有冲突）：提取原文最高势能节点 → 定格峰值临界帧 → 同源元素转场回溯 → 回落故事起点 → 无缝承接原文
- 路径 B（原文无冲突）：基于原作核心矛盾创生高势能细节 → 定格情绪/宿命峰值帧 → 同源元素转场回溯 → 回落故事起点 → 无缝承接原文

# 第一步：炸点生成双路径规则

## 路径 A：原文提取型（原文有明确冲突时优先使用）
通读全文，从 4 个通用势能维度按冲击力从高到低选取，优先选多维度叠加的节点：
- 动作势能：物理冲突爆发瞬间（掌掴、摔物、斗法、枪击、撕扯等）
- 认知势能：真相/身份/关系颠覆性反转瞬间
- 命运势能：人生境遇极致反差/关键抉择瞬间
- 情绪势能：人物情绪达到极致顶点的微瞬间

## 路径 B：细节创生型（原文平淡、无强冲突时强制启用）
创生核心原则：只放大、不篡改；只做情绪/画面/伏笔的前置强化，不新增核心剧情、不改变人物设定、不颠覆原作走向。创生的钩子必须是原作逻辑下必然会发生、或符合人物宿命感的场景。

### 6 大通用创生方向（按冲击力排序）
1. 道具细节放大：提取原文关键信物，赋予"结局感"，创生破碎/散落/尘封的定格画面
2. 情绪前置定格：基于人物最终结局/核心困境，提前将极致情绪前置为开篇特写
3. 环境隐喻创生：用环境氛围的极致反差，暗喻后续剧情走向，制造宿命感
4. 伏笔结果前置：提取后文冲突/真相的局部细节提前到开篇，只露冰山一角
5. 宿命对比创生：用分屏/前后景构图，创生"开篇美好 vs 结局破碎"的同框对比
6. 第一视角沉浸：创生第一视角的强代入画面，用感官冲击制造炸场

### 创生刚性边界（绝对不可逾越）
- ✅ 允许：放大情绪细节、补充具象道具、前置后文伏笔、强化环境隐喻、定格未来必然发生的瞬间
- ❌ 禁止：新增核心人物、篡改人物性格、改变原作核心剧情走向、添加原文完全不存在的核心矛盾、直接改写结局
```

**Step 1: 写入 5 个文件**

用 Write 工具创建以上 5 个文件。

**Step 2: 删除旧文件**

用 DeleteFile 删除 `prompts/剧本生成.md`。

**Step 3: 验证**

```powershell
dir prompts/*.md
```

Expected: 5 个文件（角色设定、通用规则、剧情模式、画布模式、剧本模式）+ 人物场景提取.md

#### prompts/通用规则.md 内容

```markdown
# 通用规则

## 时长约束
- 目标 30s，上限 60s
- 30s 对应约 8-12 个镜头/画面单元
- 宁可少写一镜，不要超时堆砌

## 三幕式结构（默认）
- 第一幕 0-5s：钩子。最炸裂的画面、冲突、反转开场（优先使用炸点生成双路径）
- 第二幕 5-20s：冲突升级。桥接回小说真实情节，推进情绪
- 第三幕 20-30s：反转卡点。停在关键冲突点，不解决，吸引点进小说

特殊章节（情绪流强、无明显事件推进）可自动选择单爆点一镜到底。

## 情节保真
- 钩子可以适度强化（闪回、冲突前置），但必须能在小说里找到落点
- 禁止编造小说不存在的人物关系、核心事件
- 瞎编的镜头，最终要能用小说原文解释

## 心理描写视觉化（最重要）
所有心理活动必须转化为AI视频平台可识别的中观以上粒度动作。

- ✅ 身体姿态变化、大幅度肢体动作、明显面部表情变化、物体交互
- ✅ 可见的生理反应：指节发白、青筋暴起、脸色发白/涨红、眼眶泛红、嘴唇发抖
- ❌ 微观动作：指尖动作、瞳孔变化、睫毛颤动、微表情
- ❌ 不可见感受：心跳加速、手心出汗、脊背发凉、胃里翻涌
- 禁止出现"心里想""感到""觉得""内心"等词汇
- 禁止使用画外音/旁白/内心OS

心理状态转化示例：
- "内心酸涩" → "眼眶迅速泛红，别过头去，肩膀微微发抖"
- "愤怒" → "一拳砸在桌上，脖子上青筋暴起"
- "紧张" → "反复捏手指，指节发白；不停舔嘴唇"
- "压抑" → "胸口剧烈起伏，深呼吸后缓慢吐出"
- "回忆" → "盯着一个方向不动，手中动作完全停下，旁人叫了两声才回神"
- "犹豫" → "手伸出去又缩回来，拿起东西又放下"
- "恐惧" → "脸色刷白，后退两步，手抖得拿不稳东西"

## 对白括号 A/B/C 分级
人物括号不是每句都写满，按台词功能分级：

**A级：关键爆点，必须写具体括号**
适用：主角反击、反派施压、亮证据、打脸、拒绝、崩溃、结尾卡点
格式：人物（关键动作 + 表情/眼神 + 声音状态）：台词

**B级：普通推进，简写括号**
适用：报数、问话、承接信息、日常对话
格式：人物（一个动作或声音状态）：台词

**C级：背景/群戏，不写括号**
适用：群众口号、短促附和、电话音、录音、背景议论
格式：人物：台词 或 人物（声音状态）：台词

## △ 画面描述规则
- 只写镜头能看到的：动作、表情、道具、站位、互动
- 不写心理描写、环境描写、抽象形容
- 每个△段落是一个独立的画面单元

## 结尾卡点
- 必须停在"观众想知道接下来发生什么"的位置
- 不能给答案，不能给完整结局

## 转化要求
- 逐段完整转化，不遗漏任何情节
- 过渡性叙述也要转化为视觉化动作或空镜
- 对白前必须有动作描写，不能只有台词
- 女频特点：注重情感递进，对话中留白和潜台词
```

#### prompts/剧情模式.md 内容

```markdown
# 剧情模式输出格式

按以下爆款短剧风格输出，严格遵循格式：

## 输出格式模板
```
[风格]
国产爆款短剧(Viral Short Drama)，竖屏构图(9:16 Portrait Ratio)，{根据小说题材适配的基调描述}，{场景氛围}，{光影风格}。

[时长]
{10s或15s总时长} | {主要人物A简要描述} VS {主要人物B简要描述}

[00:00-00:05] 镜头1：{标题}（{English Title}）。
{画面描述}。[角色状态] {关键角色的表情/动作状态}。

[00:05-00:10] 镜头2：{标题}（{English Title}）。
{画面描述}。[核心台词口型指导] {角色名}：{台词}（{表情/情绪状态}）。

[00:10-00:15] 镜头3：{标题}（{English Title}）。
{画面描述}。{收尾镜头调度}
```

## 10s/15s 拆分规则
- 10s 模式：将 30s 故事拆成 3 个镜头，每个镜头 10 秒，时间标注 [00:00-00:10]、[00:10-00:20]、[00:20-00:30]
- 15s 模式：将 30s 故事拆成 2 个镜头，每个镜头 15 秒，时间标注 [00:00-00:15]、[00:15-00:30]
- 当前选择的模式是：**{10s或15s}**
```

#### prompts/画布模式.md 内容

```markdown
# 画布模式输出格式

按以下四段式分镜格式输出，严格遵循格式：

## 第二步：全题材通用视觉炸裂强化法则
所有开篇炸点帧，必须至少应用 3 项以下强化手段，道具、元素自动适配题材：

- 构图机位：极端低机位仰拍、极端高机位俯拍、超近怼脸特写、倾斜构图、分屏对比、前景遮挡构图
- 光影氛围：高对比明暗切割、单侧硬光、冷暖极致反差、频闪光效、剪影效果、丁达尔光束
- 动态元素：物体飞溅、衣物发丝飞扬、肢体剧烈晃动、慢动作定格、颗粒下落（灰尘、雪、雨、灰烬）
- 核心道具：提取/创生与冲突强相关的关键信物，以破碎/散落/折断/尘封状态强化张力
- 音效锚点：匹配对应强音效（脆响、碎裂、惊雷、心跳骤停、风声、时钟滴答），标注在画面内容末尾

## 输出格式模板
```
【基础设定】
主角（主体A）：{已提取的人物外貌描述}
配角群像（主体B）：{已提取的配角外貌描述}
场景环境：{已提取的场景描述}

【声音设计】
同期声：{环境音+动作音效描述}
旁白/配乐：{如有旁白或配乐}

【氛围与画质规范】
风格核心：{题材适配的风格描述}
视觉基调：{画面幅型/镜头感描述}
色彩与影调：{色调/光影描述}

【画面内容：多镜头叙事时序脚本（总时长：{X}秒）】
分镜1：{镜头名称}（0-{X}s）
运镜：{运镜描述，必须至少应用3项视觉炸裂强化法则}
画面内容：{画面描述}（音效：{匹配的音效锚点}）

分镜2：{镜头名称}（{X}-{2X}s）
运镜：{运镜描述}
画面内容：{画面描述}（音效：{匹配的音效锚点}）
```

## 10s/15s 拆分规则
- 10s 模式：将 30s 故事拆成 3 套独立镜头，每套含完整四段结构，画面内容总时长 10s
- 15s 模式：将 30s 故事拆成 2 套独立镜头，每套含完整四段结构，画面内容总时长 15s
- 当前选择的模式是：**{10s或15s}**

## 输出顺序
先输出"镜头一"的完整四段结构，再输出"镜头二"，以此类推。每个镜头用分隔线 `---` 隔开。
```

#### prompts/剧本模式.md 内容

```markdown
# 剧本模式输出格式

按以下专业短剧剧本格式输出，严格遵循格式：

## 输出格式模板
```
第 X 集

X-1 具体地点·【内/外】·时间
人物：人物A、人物B、人物C

▲【开场全景/环境描述】【人物大动作/走位描述】
人物A（【状态】【情绪，语气描述】【互动动作】）："台词原文，一字不差还原视频内容。"
人物B（【状态】【情绪，语气描述】【互动动作】）："台词原文，一字不差还原视频内容。"
人物 (V.O.画外)："台词原文。"（画外音标注，人物不在画面中）
人物 (O.S.内心)："台词原文。"（电话音标注，人物在画面外但在同一空间）
▲画面描述

X-2 具体地点·【内/外】·时间
人物：人物A、人物D

▲【人物大动作/走位描述】
人物A（【状态】【情绪，语气描述】【互动动作】）："台词原文，一字不差还原视频内容。"
```

## 标注规则
- V.O. = Voice Over，画外音（人物不在画面中）
- O.S. = Off Screen，画面外音（人物在画面外但在同一空间）
- ▲ 表示画面描述 / 动作描写
- 人物括号内用中文顿号「、」分隔状态、情绪、互动动作
- 台词必须一字不差还原视频中人物会说出的原文内容
```

**Step 3: 验证**

```powershell
dir prompts/*.md
```

Expected: 6 个文件（含先前的人物场景提取.md）

**Commit:**
```bash
git -C "f:\脚本测试\qiantie" add prompts/角色设定.md prompts/通用规则.md prompts/剧情模式.md prompts/画布模式.md prompts/剧本模式.md ; git -C "f:\脚本测试\qiantie" rm prompts/剧本生成.md ; git -C "f:\脚本测试\qiantie" commit -m "feat: split prompts into 5 layered files, delete old unified prompt"
```

---

### Task 2: 更新 PromptTemplates 模块（从文件读取 + 格式名称更新）

**Files:**
- Modify: `index.html` — PromptTemplates 模块（`scriptPrompt` 函数，约第 1950-2091 行）

**Interfaces:**
- Consumes: `prompts/角色设定.md`、`prompts/通用规则.md`、`prompts/剧情模式.md`、`prompts/画布模式.md`、`prompts/剧本模式.md`（通过 `/api/prompt?file=xxx` 接口）
- Produces: `scriptPrompt(novelText, charsJson, scenesJson, format, duration)` 返回 `[{role, content}]`，新增 `duration` 参数（`'10s'` / `'15s'`，剧本模式忽略）

**Step 1: 添加后端接口读取提示词文件**

在 `server.js` 的 `routeRequest` 函数中，添加 GET `/api/prompt` 路由（在 `/api/config` GET 路由之后）：

```javascript
if (req.method === 'GET' && requestUrl.pathname === '/api/prompt') {
  var fileName = requestUrl.searchParams.get('file') || '';
  // 安全检查：只允许 prompts/*.md
  if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    sendJson(res, 400, { error: 'Invalid file name' });
    return;
  }
  var filePath = path.join(ROOT_DIR, 'prompts', fileName);
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: 'Prompt file not found: ' + fileName });
    return;
  }
  var content = fs.readFileSync(filePath, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(content);
  return;
}
```

Restart server after change.

**Step 2: 在 PromptTemplates 中添加异步加载函数**

在 `scriptPrompt` 函数前面添加 `loadPrompt` 函数：

```javascript
// 缓存已加载的提示词
var promptCache = {};

async function loadPrompt(fileName) {
    if (promptCache[fileName]) return promptCache[fileName];
    var resp = await fetch('http://127.0.0.1:3000/api/prompt?file=' + encodeURIComponent(fileName));
    if (!resp.ok) throw new Error('Failed to load prompt: ' + fileName);
    var text = await resp.text();
    promptCache[fileName] = text;
    return text;
}
```

**Step 3: 重写 scriptPrompt 为异步函数**

将 `function scriptPrompt(novelText, charsJson, scenesJson, format)` 改为 `async function scriptPrompt(novelText, charsJson, scenesJson, format, duration)`。

函数体内：
1. 加载三个文件：`await loadPrompt('角色设定.md')`、`await loadPrompt('通用规则.md')`、`await loadPrompt(format + '.md')`（需要映射 screenplay→剧情模式、storyboard→画布模式、shortdrama→剧本模式）
2. 如果 format 是 storyboard，额外拼接视觉强化法则
3. 替换 `{10s或15s}` 占位符为实际值
4. systemPrompt = 角色设定 + 通用规则 + 格式模板
5. 删除旧的 `formatNames`、`formatRules`、`systemPrompt` 三件套

```javascript
var formatFileMap = {
    'screenplay': '剧情模式.md',
    'storyboard': '画布模式.md',
    'shortdrama': '剧本模式.md'
};

async function scriptPrompt(novelText, charsJson, scenesJson, format, duration) {
    var roleContent = await loadPrompt('角色设定.md');
    var rulesContent = await loadPrompt('通用规则.md');
    var formatContent = await loadPrompt(formatFileMap[format] || '剧情模式.md');
    
    // 替换占位符
    formatContent = formatContent.replace(/\{10s或15s\}/g, duration || '10s');
    formatContent = formatContent.replace(/\{X\}/g, duration === '15s' ? '15' : '10');
    
    var systemPrompt = roleContent + '\n\n---\n\n' + rulesContent + '\n\n---\n\n' + formatContent;
    
    var formatNames = {
        'screenplay': '剧情模式',
        'storyboard': '画布模式',
        'shortdrama': '剧本模式'
    };
    
    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '## 小说原文\n' + novelText + '\n\n## 人物信息\n' + charsJson + '\n\n## 场景信息\n' + scenesJson + '\n\n请将以上小说章节转化为' + (formatNames[format] || '剧本') + '。' }
    ];
}
```

**Step 4: 更新 return 暴露的接口**

```javascript
return { extractPrompt, scriptPrompt, loadPrompt };
```

**Step 5: 验证**

```powershell
# 检查 server.js 有 /api/prompt 路由
powershell -Command "(Get-Content 'server.js' -Raw) -match '/api/prompt'"
# 检查 index.html 有 loadPrompt 函数
powershell -Command "(Get-Content 'index.html' -Raw) -match 'loadPrompt'"
```

Expected：两个都 True。

**Commit:**
```bash
git -C "f:\脚本测试\qiantie" add index.html server.js ; git -C "f:\脚本测试\qiantie" commit -m "feat: load prompts from files via API, async PromptTemplates"
```

---

### Task 3: 格式名称全局更新 + 右侧面板卡片式画布 + 可拖拽面板

**Files:**
- Modify: `index.html` — CSS + HTML 多处

**Interfaces:**
- Consumes: 现有 DOM 结构（`.left-panel`、`.right-panel`、`#format-tabs`、`#output-area`）
- Produces: 可拖拽面板 + 卡片式画布容器 + 格式名称更新

**Step 1: 更新格式 Tab 按钮文本**

将 HTML 中三行 button 文本替换：
```html
<button class="format-tab" data-format="screenplay">剧情模式</button>
<button class="format-tab" data-format="storyboard">画布模式</button>
<button class="format-tab active" data-format="shortdrama">剧本模式</button>
```

**Step 2: 更新所有 JS 中 formatNames 映射**

搜索所有 `formatNames` 对象，将值更新：
- `'screenplay': '剧情模式'`
- `'storyboard': '画布模式'`
- `'shortdrama': '剧本模式'`

需要修改的位置：`PromptTemplates.scriptPrompt` 内、格式切换 IIFE 内、复制/导出模块内。

**Step 3: 添加可拖拽分隔线 CSS**

在 `.right-panel` CSS 块之前添加：

```css
/* Resize handle */
.resize-handle {
  width: 6px;
  cursor: col-resize;
  background: var(--border);
  flex-shrink: 0;
  transition: background var(--transition);
  position: relative;
}
.resize-handle:hover,
.resize-handle.active {
  background: var(--accent);
}
.resize-handle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 2px;
  height: 24px;
  border-radius: 1px;
  background: var(--text-muted);
  transition: background var(--transition);
}
.resize-handle:hover::after,
.resize-handle.active::after {
  background: #fff;
}
```

**Step 4: 修改左面板 CSS 支持拖拽**

将 `.left-panel` 的 `width: 35%; min-width: 280px; max-width: 420px;` 改为：

```css
.left-panel {
  width: 35%;
  min-width: 200px;
  max-width: 60%;
  background: var(--bg-panel);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: none;
}
```

**Step 5: 在 HTML 中添加分隔线元素**

在 `.left-panel` 关闭 `</div>` 之后、`.right-panel` 开始之前添加：

```html
<div class="resize-handle" id="resize-handle"></div>
```

**Step 6: 添加拖拽 JS 逻辑**

在 `<script>` 末尾、所有模块之后添加：

```javascript
// 面板拖拽
(function() {
    var handle = document.getElementById('resize-handle');
    var leftPanel = document.querySelector('.left-panel');
    if (!handle || !leftPanel) return;
    
    var isDragging = false;
    
    handle.addEventListener('mousedown', function(e) {
        isDragging = true;
        handle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        var container = leftPanel.parentElement;
        var rect = container.getBoundingClientRect();
        var pct = ((e.clientX - rect.left) / rect.width) * 100;
        pct = Math.max(20, Math.min(60, pct));
        leftPanel.style.width = pct + '%';
    });
    
    document.addEventListener('mouseup', function() {
        if (!isDragging) return;
        isDragging = false;
        handle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
})();
```

**Step 7: 右侧面板卡片式画布 CSS**

在 `.right-panel` CSS 块中修改 `background`，并在 `.output-area` 中添加画布样式：

```css
.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  background: var(--bg-secondary);
}

/* Canvas wrapper — 卡片式画布容器 */
.output-canvas-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: hidden;
}

.output-canvas {
  width: 100%;
  max-width: 800px;
  height: 100%;
  max-height: calc(100vh - var(--topbar-height) - 120px);
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Canvas toolbar */
.canvas-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  flex-shrink: 0;
}

.canvas-toolbar .canvas-mode-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.canvas-toolbar .canvas-actions {
  display: flex;
  gap: 4px;
}

.canvas-toolbar .canvas-action-btn {
  padding: 5px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.canvas-toolbar .canvas-action-btn:hover {
  color: var(--text-primary);
  background: var(--bg-card-hover);
  border-color: var(--border);
}

/* Canvas content */
.canvas-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.canvas-content pre,
.canvas-content .output-text {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.8;
  font-size: 13px;
  color: var(--text-primary);
  font-family: inherit;
}
```

**Step 8: 在 HTML 中包装输出区**

将 `#output-area` 包装在画布容器中。替换 `.right-panel` 内的 HTML 结构：

```html
<div class="right-panel">
  <div id="format-tabs" class="format-tabs">
    <button class="format-tab" data-format="screenplay">剧情模式</button>
    <button class="format-tab" data-format="storyboard">画布模式</button>
    <button class="format-tab active" data-format="shortdrama">剧本模式</button>
  </div>

  <div class="output-canvas-wrapper">
    <div class="output-canvas" id="output-canvas">
      <div class="canvas-toolbar" id="canvas-toolbar">
        <span class="canvas-mode-name" id="canvas-mode-name">剧本模式</span>
        <div class="canvas-actions">
          <button class="canvas-action-btn" id="canvas-btn-duration" style="display:none;">10s ▼</button>
          <button class="canvas-action-btn" id="canvas-btn-regenerate" style="display:none;">🔄 重新生成</button>
          <button class="canvas-action-btn" id="canvas-btn-copy" style="display:none;">📋 复制</button>
          <button class="canvas-action-btn" id="canvas-btn-export" style="display:none;">💾 导出</button>
        </div>
      </div>
      <div class="canvas-content" id="output-area">
        <div class="empty-state">
          <div class="empty-icon">📄</div>
          <div class="empty-text">粘贴小说内容，点击"一键生成"开始</div>
        </div>
      </div>
    </div>
  </div>
</div>
```

**Step 9: 同步更新 JS 中所有 `document.getElementById('output-area')` 引用**

`output-area` 现在是 `.canvas-content` 而不是顶级元素，但 `getElementById` 不受影响（ID 不变）。需要同步更新 `canvas-toolbar` 按钮的显示/隐藏逻辑：

在 `showActionButtons` 中同步更新画布工具栏按钮显示，在 `hideActionButtons` 中隐藏它们。并在切换格式时更新 `#canvas-mode-name` 文本。

**Step 10: 验证**

```powershell
powershell -Command "(Get-Content 'index.html' -Raw) -match '剧情模式'"
powershell -Command "(Get-Content 'index.html' -Raw) -match 'resize-handle'"
powershell -Command "(Get-Content 'index.html' -Raw) -match 'output-canvas'"
```

Expected: 全部 True。

**Commit:**
```bash
git -C "f:\脚本测试\qiantie" add index.html ; git -C "f:\脚本测试\qiantie" commit -m "feat: rename formats, add draggable panels, canvas container"
```

---

### Task 4: 画布模式导航栏右键菜单（10s/15s + 操作按钮）

**Files:**
- Modify: `index.html` — CSS（右键菜单样式）+ JS（右键菜单逻辑 + 10s/15s 状态管理）

**Interfaces:**
- Consumes: `ScriptGenerator.generate(novelText, format, duration)` — 新增 `duration` 参数
- Produces: 右键菜单（10s/15s 切换 + 复制 + 导出）、10s/15s 状态存储

**Step 1: 添加右键菜单 CSS**

在样式末尾添加：

```css
/* Context menu */
.context-menu {
  position: fixed;
  z-index: 1000;
  background: var(--bg-modal);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 6px;
  min-width: 160px;
  display: none;
}

.context-menu.visible { display: block; }

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
  white-space: nowrap;
}

.context-menu-item:hover { background: var(--bg-card-hover); }

.context-menu-item.danger { color: var(--error); }

.context-menu-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 8px;
}

.context-menu-item .checkmark {
  margin-left: auto;
  color: var(--accent);
  font-weight: 700;
}
```

**Step 2: 添加右键菜单 HTML**

在 `</body>` 之前添加：

```html
<div class="context-menu" id="context-menu">
  <div class="context-menu-item" data-action="duration-10s">
    <span>⏱ 10秒模式</span><span class="checkmark" id="check-10s">✓</span>
  </div>
  <div class="context-menu-item" data-action="duration-15s">
    <span>⏱ 15秒模式</span><span class="checkmark" id="check-15s"></span>
  </div>
  <div class="context-menu-divider" id="ctx-divider-duration"></div>
  <div class="context-menu-item" data-action="regenerate">🔄 重新生成</div>
  <div class="context-menu-item" data-action="copy">📋 复制</div>
  <div class="context-menu-item" data-action="export">💾 导出</div>
  <div class="context-menu-divider"></div>
  <div class="context-menu-item" data-action="fullscreen">📺 全屏</div>
</div>
```

**Step 3: 添加右键菜单 JS 逻辑**

在 `<script>` 末尾添加：

```javascript
// 10s/15s 状态管理
var StoryDuration = (function() {
    var duration = '10s'; // 默认 10s
    
    function get() { return duration; }
    function set(d) { duration = d; updateUI(); }
    
    function updateUI() {
        var check10 = document.getElementById('check-10s');
        var check15 = document.getElementById('check-15s');
        if (check10) check10.textContent = duration === '10s' ? '✓' : '';
        if (check15) check15.textContent = duration === '15s' ? '✓' : '';
        
        var btnDuration = document.getElementById('canvas-btn-duration');
        if (btnDuration) btnDuration.textContent = duration + ' ▼';
        
        // 只有剧情模式和画布模式显示时长选择
        var currentFormat = ScriptGenerator.getCurrentFormat();
        var showDuration = currentFormat === 'screenplay' || currentFormat === 'storyboard';
        var divider = document.getElementById('ctx-divider-duration');
        var item10 = document.querySelector('[data-action="duration-10s"]');
        var item15 = document.querySelector('[data-action="duration-15s"]');
        if (divider) divider.style.display = showDuration ? '' : 'none';
        if (item10) item10.style.display = showDuration ? '' : 'none';
        if (item15) item15.style.display = showDuration ? '' : 'none';
    }
    
    return { get: get, set: set, updateUI: updateUI };
})();

// 右键菜单
(function() {
    var menu = document.getElementById('context-menu');
    var canvas = document.getElementById('output-canvas');
    if (!menu || !canvas) return;
    
    canvas.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        menu.style.display = 'block';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        menu.classList.add('visible');
        StoryDuration.updateUI();
    });
    
    document.addEventListener('click', function(e) {
        if (!menu.contains(e.target)) {
            menu.classList.remove('visible');
            menu.style.display = 'none';
        }
    });
    
    menu.addEventListener('click', function(e) {
        var item = e.target.closest('.context-menu-item');
        if (!item) return;
        var action = item.dataset.action;
        
        menu.classList.remove('visible');
        menu.style.display = 'none';
        
        switch (action) {
            case 'duration-10s':
                StoryDuration.set('10s');
                break;
            case 'duration-15s':
                StoryDuration.set('15s');
                break;
            case 'regenerate':
                document.getElementById('btn-regenerate').click();
                break;
            case 'copy':
                document.getElementById('canvas-btn-copy').click();
                break;
            case 'export':
                document.getElementById('canvas-btn-export').click();
                break;
            case 'fullscreen':
                if (canvas.requestFullscreen) { canvas.requestFullscreen(); }
                else if (canvas.webkitRequestFullscreen) { canvas.webkitRequestFullscreen(); }
                break;
        }
    });
    
    // 工具栏按钮也绑定
    document.getElementById('canvas-btn-duration').addEventListener('click', function() {
        StoryDuration.set(StoryDuration.get() === '10s' ? '15s' : '10s');
    });
    document.getElementById('canvas-btn-regenerate').addEventListener('click', function() {
        document.getElementById('btn-regenerate').click();
    });
    document.getElementById('canvas-btn-copy').addEventListener('click', function() {
        var text = ScriptGenerator.getCurrentOutput();
        if (!text) return;
        navigator.clipboard.writeText(text).then(function() { showToast('已复制', 'success'); });
    });
    document.getElementById('canvas-btn-export').addEventListener('click', function() {
        document.getElementById('btn-export').click();
    });
})();
```

**Step 4: 更新 ScriptGenerator.generate 调用传入 duration**

在 `generate` 函数中，添加 `duration` 参数并在调用 `scriptPrompt` 时传入。同时更新格式切换 IIFE 中的 `generate` 调用。

找到 `const messages = PromptTemplates.scriptPrompt(novelText, charsJson, scenesJson, format);` 改为：
```javascript
const messages = await PromptTemplates.scriptPrompt(novelText, charsJson, scenesJson, format, StoryDuration.get());
```

同步更新 `generate` 函数签名：`async function generate(novelText, format, duration)`。

**Step 5: 在 switchToFormat 中同步更新工具栏**

在 `switchToFormat` 函数中，更新 `#canvas-mode-name` 文本为当前格式名称。

**Step 6: 验证**

```powershell
powershell -Command "(Get-Content 'index.html' -Raw) -match 'context-menu'"
powershell -Command "(Get-Content 'index.html' -Raw) -match 'StoryDuration'"
```

Expected: 全部 True。

**Commit:**
```bash
git -C "f:\脚本测试\qiantie" add index.html ; git -C "f:\脚本测试\qiantie" commit -m "feat: add context menu with 10s/15s switch, canvas toolbar"
```

---

### Task 5: 验证 + 重启服务

**Files:**
- 无新文件

**Interfaces:**
- Consumes: 所有已完成任务
- Produces: 运行中的服务

**Step 1: 语法检查**

```powershell
node --check "f:\脚本测试\qiantie\server.js"
```

Expected: 退出码 0。

**Step 2: 大括号匹配检查**

在 index.html 上运行 Grep 统计 `{` 和 `}` 数量是否相等。

**Step 3: 重启服务**

```powershell
taskkill /F /IM node.exe 2>$null ; node "f:\脚本测试\qiantie\server.js"
```

**Step 4: 验证关键功能**

```powershell
powershell -Command "(Invoke-WebRequest 'http://127.0.0.1:3000/api/prompt?file=角色设定.md' -UseBasicParsing).StatusCode"
```

Expected: 200。

**Step 5: 打开预览确认**

确认：
- 格式 Tab 显示"剧情模式/画布模式/剧本模式"
- 左右面板可拖拽
- 右侧面板为卡片式画布容器
- 画布模式右键菜单可切换 10s/15s
- 生成时工具栏按钮正确显示/隐藏

**Commit:**
```bash
git -C "f:\脚本测试\qiantie" commit --allow-empty -m "chore: verification complete, all features working"
```