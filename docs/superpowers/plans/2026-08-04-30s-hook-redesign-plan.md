# 30s 爆量前贴改造 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将一战晟铭从"小说转影视剧本"改造为"30s 爆量前贴生成器"，加入核心规则层、炸雷前置、三幕式结构，去掉四合一格式，人物卡片可展开。

**Architecture:** 单文件 HTML 应用，提示词和 JS 逻辑均在 `index.html` 内。独立提示词文件 `prompts/剧本生成.md` 作为参考副本。只需改 `index.html` 和 `prompts/剧本生成.md`。

**Tech Stack:** 纯 HTML/CSS/JS，Node.js 后端代理（server.js 不动）

## Global Constraints

- 三种格式：影视剧本 / 分镜脚本 / 短视频脚本（去掉四合一）
- 时长 30s-60s，核心 30s
- 三幕式结构默认，特殊章节 AI 可自动判断
- 炸雷前置：开场可从全章最爆画面切入，通过时间标注桥接
- 情节保真：不能编造小说不存在的人物关系、核心事件
- 人物卡片：默认收起（姓名+身份+体征），点击展开四模块外貌

---

### Task 1: 重写 prompts/剧本生成.md

**Files:**
- Modify: `prompts/剧本生成.md`

**Interfaces:**
- Consumes: 无
- Produces: 更新后的参考提示词文件，包含核心规则层

- [ ] **Step 1: 重写文件内容**

用以下内容覆盖 `prompts/剧本生成.md`：

```markdown
# 角色设定
你是一位专业的短剧编剧，擅长将微小说转化为30秒的爆量前贴。你的核心原则是：**一切心理活动都必须转化为可见的动作、表情、镜头语言**。你的目标是：**用镜头吸引观众点进小说全文**。

# 任务
根据以下小说信息，将章节转化为30秒的{{FORMAT}}。

# 核心规则

## 规则1：时长约束
- 目标 30s，上限 60s
- 30s 对应约 8-12 个镜头/画面单元
- 宁可少写一镜，不要超时堆砌

## 规则2：炸雷前置（Hook First）
30s 前贴的叙事顺序不必遵循小说原文时间线。优先从全章中选取最爆炸、最痛、最反转的画面作为开场第 0-5s，然后通过时间标注桥接回正常叙事。

**方式一：场景跳切**
开场直接切到全章最炸裂的画面（如：对峙、崩溃、打脸），用一个镜头建立冲突，然后通过【字幕：X小时前/X天前】回到故事起点。

**方式二：人物冲突前置**
从全章中选取一段冲突最强的对话作为开场。不交代前因后果，直接用对话把观众扔进冲突中心，后续再补原因。

**前提条件：**
- 炸雷画面必须来自小说原文，不能编造
- 时间标注（字幕）必须准确，不能误导观众
- 回到正常叙事时，必须保证情节完整衔接

## 规则3：三幕式结构（默认）
- **第一幕 0-5s：钩子**。最炸裂的画面、冲突、反转开场（优先使用炸雷前置）
- **第二幕 5-20s：冲突升级**。桥接回小说真实情节，推进情绪
- **第三幕 20-30s：反转卡点**。停在关键冲突点，不解决，吸引点进小说

特殊章节（情绪流强、无明显事件推进）可自动选择单爆点一镜到底。

## 规则4：情节保真
- 钩子可以适度强化（闪回、冲突前置），但必须能在小说里找到落点
- 禁止编造小说不存在的人物关系、核心事件
- 瞎编的镜头，最终要能用小说原文解释

## 规则5：心理描写视觉化
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

## 规则6：对白括号 A/B/C 分级
人物括号不是每句都写满，按台词功能分级：

**A级：关键爆点，必须写具体括号**
适用：主角反击、反派施压、亮证据、打脸、拒绝、崩溃、结尾卡点
格式：人物（关键动作 + 表情/眼神 + 声音状态）：台词
要求：动作必须是中观以上粒度

**B级：普通推进，简写括号**
适用：报数、问话、承接信息、日常对话
格式：人物（一个动作或声音状态）：台词
△动作已写清的，括号可省略

**C级：背景/群戏，不写括号**
适用：群众口号、短促附和、电话音、录音、背景议论
格式：人物：台词 或 人物（声音状态）：台词

错误倾向：
- 不要把每句都写成"身体姿态+手部动作+眼神+声音"的满配格式
- 不要为了具体而具体，导致对白节奏变慢
- 不要在普通报数、接话、群众口号里塞复杂表演

## 规则7：△ 画面描述规则
- 只写镜头能看到的：动作、表情、道具、站位、互动
- 不写心理描写、环境描写、抽象形容
- 每个△段落是一个独立的画面单元

## 规则8：结尾卡点
- 必须停在"观众想知道接下来发生什么"的位置
- 不能给答案，不能给完整结局

## 规则9：转化要求
- 逐段完整转化，不遗漏任何情节
- 过渡性叙述也要转化为视觉化动作或空镜
- 对白前必须有动作描写，不能只有台词
- 女频特点：注重情感递进，对话中留白和潜台词

---

# 影视剧本格式
【场景标题】

△动作描写 / 画面描述。

　　角色名（表情/动作/声音状态）：台词。

△动作描写。

---

# 分镜脚本格式
【镜号1】景别：XXX | 运镜：XXX | 时长：Xs
画面：XXX
对白：XXX

【镜号2】景别：XXX | 运镜：XXX | 时长：Xs
画面：XXX

---

# 短视频脚本格式
X-1 场景名 时间/内/外
人物：xxx、xxx

△画面描述。

人物A（关键句写具体表情/动作；普通句可简写或省略）：台词。

【字幕：关键信息】

【本集结尾卡点】
△画面描述。
人物A（具体表情/动作）：最后一句卡点台词。
```

- [ ] **Step 2: 验证文件写入成功**

Run: `powershell -Command "Get-Item 'prompts/剧本生成.md' | Select-Object Length, LastWriteTime"`
Expected: 文件存在，长度 > 2000 字节

---

### Task 2: 更新 index.html PromptTemplates 模块

**Files:**
- Modify: `index.html` — PromptTemplates 模块（约第 1405-1635 行）

**Interfaces:**
- Consumes: 无
- Produces: `PromptTemplates.scriptPrompt(novelText, charsJson, scenesJson, format)` — 返回 `[{role, content}]` 消息数组，format 参数只接受 `screenplay`/`storyboard`/`shortdrama`

- [ ] **Step 1: 定位 PromptTemplates 模块**

搜索 `const PromptTemplates = (function() {` 确认起止行号。

- [ ] **Step 2: 替换 formatNames 对象**

找到 `const formatNames = {` 行，将 `'all': '四合一格式...'` 那行删除，保留三个格式。

修改后：
```javascript
const formatNames = {
    'screenplay': '影视剧本',
    'storyboard': '分镜脚本',
    'shortdrama': '短视频脚本'
};
```

- [ ] **Step 3: 替换 formatRules 对象**

找到 `const formatRules = {` 块，删除 `'all'` 键及其值，更新三个格式模板：

```javascript
const formatRules = {
    'screenplay': `# 影视剧本格式
【场景标题】

△动作描写 / 画面描述。

　　角色名（表情/动作/声音状态）：台词。

△动作描写。`,
    'storyboard': `# 分镜脚本格式
【镜号1】景别：XXX | 运镜：XXX | 时长：Xs
画面：XXX
对白：XXX

【镜号2】景别：XXX | 运镜：XXX | 时长：Xs
画面：XXX`,
    'shortdrama': `# 短视频脚本格式
X-1 场景名 时间/内/外
人物：xxx、xxx

△画面描述。

人物A（关键句写具体表情/动作；普通句可简写或省略）：台词。

【字幕：关键信息】

【本集结尾卡点】
△画面描述。
人物A（具体表情/动作）：最后一句卡点台词。`
};
```

- [ ] **Step 4: 替换 systemPrompt**

找到 `const systemPrompt = \`你是一位专业的影视编剧...`，用以下内容替换整段 systemPrompt（从"你是一位专业的影视编剧"到 `${formatRules[format]}\`;`）：

```javascript
const systemPrompt = `你是一位专业的短剧编剧，擅长将微小说转化为30秒的爆量前贴。你的核心原则是：**一切心理活动都必须转化为可见的动作、表情、镜头语言**。你的目标是：**用镜头吸引观众点进小说全文**。

# 任务
根据以下信息，将小说章节转化为${formatNames[format]}。

# 核心规则

## 规则1：时长约束
- 目标 30s，上限 60s
- 30s 对应约 8-12 个镜头/画面单元
- 宁可少写一镜，不要超时堆砌

## 规则2：炸雷前置（Hook First）
30s 前贴的叙事顺序不必遵循小说原文时间线。优先从全章中选取最爆炸、最痛、最反转的画面作为开场第 0-5s，然后通过时间标注桥接回正常叙事。

**方式一：场景跳切**
开场直接切到全章最炸裂的画面（如：对峙、崩溃、打脸），用一个镜头建立冲突，然后通过【字幕：X小时前/X天前】回到故事起点。

**方式二：人物冲突前置**
从全章中选取一段冲突最强的对话作为开场。不交代前因后果，直接用对话把观众扔进冲突中心，后续再补原因。

**前提条件：**
- 炸雷画面必须来自小说原文，不能编造
- 时间标注（字幕）必须准确，不能误导观众
- 回到正常叙事时，必须保证情节完整衔接

## 规则3：三幕式结构（默认）
- 第一幕 0-5s：钩子。最炸裂的画面、冲突、反转开场（优先使用炸雷前置）
- 第二幕 5-20s：冲突升级。桥接回小说真实情节，推进情绪
- 第三幕 20-30s：反转卡点。停在关键冲突点，不解决，吸引点进小说

特殊章节（情绪流强、无明显事件推进）可自动选择单爆点一镜到底。

## 规则4：情节保真
- 钩子可以适度强化（闪回、冲突前置），但必须能在小说里找到落点
- 禁止编造小说不存在的人物关系、核心事件
- 瞎编的镜头，最终要能用小说原文解释

## 规则5：心理描写视觉化（最重要）
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

## 规则6：对白括号 A/B/C 分级
人物括号不是每句都写满，按台词功能分级：

**A级：关键爆点，必须写具体括号**
适用：主角反击、反派施压、亮证据、打脸、拒绝、崩溃、结尾卡点
格式：人物（关键动作 + 表情/眼神 + 声音状态）：台词
要求：动作必须是中观以上粒度

**B级：普通推进，简写括号**
适用：报数、问话、承接信息、日常对话
格式：人物（一个动作或声音状态）：台词
△动作已写清的，括号可省略

**C级：背景/群戏，不写括号**
适用：群众口号、短促附和、电话音、录音、背景议论
格式：人物：台词 或 人物（声音状态）：台词

错误倾向：
- 不要把每句都写成"身体姿态+手部动作+眼神+声音"的满配格式
- 不要为了具体而具体，导致对白节奏变慢
- 不要在普通报数、接话、群众口号里塞复杂表演

## 规则7：△画面描述规则
- 只写镜头能看到的：动作、表情、道具、站位、互动
- 不写心理描写、环境描写、抽象形容
- 每个△段落是一个独立的画面单元

## 规则8：结尾卡点
- 必须停在"观众想知道接下来发生什么"的位置
- 不能给答案，不能给完整结局

## 规则9：转化要求
- 逐段完整转化，不遗漏任何情节
- 过渡性叙述也要转化为视觉化动作或空镜
- 对白前必须有动作描写，不能只有台词
- 女频特点：注重情感递进，对话中留白和潜台词

${formatRules[format]}`;
```

- [ ] **Step 5: 验证**

Run: `powershell -Command "$c = Get-Content 'index.html' -Raw; Write-Host 'PromptTemplates found:' ($c -match 'const PromptTemplates'); Write-Host 'formatNames has screenplay:' ($c -match \"'screenplay':\s*'影视剧本'\"); Write-Host 'formatNames has all:' ($c -match \"'all':\"); Write-Host 'formatRules has all:' ($c -match \"'all':\s*\`")"`  
Expected: PromptTemplates found, formatNames has screenplay: True, formatNames has all: False, formatRules has all: False

---

### Task 3: 去掉四合一格式（Tab、ScriptGenerator、复制/导出、格式切换）

**Files:**
- Modify: `index.html` — 多处

**Interfaces:**
- Consumes: ScriptGenerator 的 `outputs` 对象、`formatNames` 映射
- Produces: 三格式系统，去除所有 `all` 引用

- [ ] **Step 1: 删除 HTML 中的四合一 Tab 按钮**

找到第 1045 行：
```html
<button class="format-tab" data-format="all">四合一</button>
```
删除此行。

- [ ] **Step 2: 更新 ScriptGenerator outputs 对象**

找到第 1888 行：
```javascript
let outputs = { screenplay: '', storyboard: '', shortdrama: '', all: '' };
```
改为：
```javascript
let outputs = { screenplay: '', storyboard: '', shortdrama: '' };
```

- [ ] **Step 3: 更新格式切换模块的 formatNames**

找到第 1971 行：
```javascript
var formatNames = { screenplay: '影视剧本', storyboard: '分镜脚本', shortdrama: '短视频脚本', all: '四合一' };
```
改为：
```javascript
var formatNames = { screenplay: '影视剧本', storyboard: '分镜脚本', shortdrama: '短视频脚本' };
```

- [ ] **Step 4: 更新复制/导出模块的 names 映射**

找到第 2069 行：
```javascript
const names = { screenplay: '影视剧本', storyboard: '分镜脚本', shortdrama: '短视频脚本', all: '四合一' };
```
改为：
```javascript
const names = { screenplay: '影视剧本', storyboard: '分镜脚本', shortdrama: '短视频脚本' };
```

- [ ] **Step 5: 验证无残留 all 引用**

Run: `powershell -Command "$c = Get-Content 'index.html' -Raw; $matches = [regex]::Matches($c, '[''""]all[''""]'); Write-Host 'Residual all string refs:' $matches.Count; $matches | ForEach-Object { $line = ($c.Substring(0, $_.Index) -split \"`n\").Count; Write-Host \"  Line $line\" }"`
Expected: 残留的 `'all'` 或 `"all"` 引用应为 0（或仅剩 regenerate-option 的 `value="all"`，那是重新生成的"全部重来"选项，不是格式名）

---

### Task 4: 人物卡片可展开/收起

**Files:**
- Modify: `index.html` — CSS 部分（.card 相关样式）+ JS 渲染逻辑（renderCards 函数）

**Interfaces:**
- Consumes: Extraction 的 `renderCards(data)` 渲染函数
- Produces: 可展开人物卡片，显示四模块外貌

- [ ] **Step 1: 添加展开/收起 CSS**

在 `.card-detail` 样式之后（约第 539 行后）追加：

```css
.card-body-collapsed {
  max-height: 60px;
  overflow: hidden;
  position: relative;
}
.card-body-expanded {
  max-height: none;
  overflow: visible;
}
.card-expand-hint {
  font-size: 11px;
  color: var(--accent);
  cursor: pointer;
  margin-top: 4px;
  user-select: none;
}
.card-expand-hint:hover {
  text-decoration: underline;
}
```

- [ ] **Step 2: 修改 renderCards 函数的人物卡片渲染**

找到 `renderCards` 函数中的人物卡片渲染部分（约第 1790-1803 行），替换为：

```javascript
charList.innerHTML = data.characters.map((c, i) => {
    var app = c.appearance || {};
    var details = ''
        + (app.body ? '<div class="card-detail">体征：' + escapeHtml(app.body) + '</div>' : '')
        + (app.face ? '<div class="card-detail">五官：' + escapeHtml(app.face) + '</div>' : '')
        + (app.hair ? '<div class="card-detail">发型：' + escapeHtml(app.hair) + '</div>' : '')
        + (app.clothing ? '<div class="card-detail">服饰：' + escapeHtml(app.clothing) + '</div>' : '')
        + (c.speechStyle ? '<div class="card-detail">说话：' + escapeHtml(c.speechStyle) + '</div>' : '')
        + (c.relations ? '<div class="card-detail">关系：' + escapeHtml(c.relations) + '</div>' : '');
    var hasDetails = !!(app.body || app.face || app.hair || app.clothing || c.speechStyle || c.relations);
    return '<div class="card" data-type="char" data-index="' + i + '">'
        + '<button class="btn-edit" data-type="char" data-index="' + i + '">✏️</button>'
        + '<div class="card-name">' + escapeHtml(c.name || '未命名') + (c.role ? ' · ' + escapeHtml(c.role) : '') + '</div>'
        + '<div class="card-detail">' + escapeHtml(c.identity) + '</div>'
        + (hasDetails ? '<div class="card-body-collapsed" data-char-body="' + i + '">' + details + '</div>' : '')
        + (hasDetails ? '<div class="card-expand-hint" data-char-expand="' + i + '">展开全部 ▼</div>' : '')
        + '</div>';
}).join('');
```

- [ ] **Step 3: 添加展开/收起点击事件**

在 `renderCards` 函数末尾（`for` 循环设置场景点击事件之后），追加事件委托：

```javascript
// 清除旧的事件委托，重新绑定
charList.removeEventListener('click', handleCardExpand);
charList.addEventListener('click', handleCardExpand);
```

然后在文件顶部或模块外定义 `handleCardExpand`：

```javascript
function handleCardExpand(e) {
    var hint = e.target.closest('[data-char-expand]');
    if (!hint) return;
    var idx = hint.dataset.charExpand;
    var body = document.querySelector('[data-char-body="' + idx + '"]');
    if (!body) return;
    if (body.classList.contains('card-body-collapsed')) {
        body.classList.remove('card-body-collapsed');
        body.classList.add('card-body-expanded');
        hint.textContent = '收起 ▲';
    } else {
        body.classList.remove('card-body-expanded');
        body.classList.add('card-body-collapsed');
        hint.textContent = '展开全部 ▼';
    }
}
```

- [ ] **Step 4: 语法验证**

Run: `powershell -Command "$c = Get-Content 'index.html' -Raw; $ob = ($c.ToCharArray() | Where-Object { $_ -eq '{' }).Count; $cb = ($c.ToCharArray() | Where-Object { $_ -eq '}' }).Count; Write-Host '{}:' $ob '/' $cb 'diff:' ($ob - $cb)"`  
Expected: diff = 0

---

### Task 5: 验证 + 提交

**Files:**
- 无新文件

**Interfaces:**
- Consumes: 所有已完成任务
- Produces: 运行中的服务

- [ ] **Step 1: 语法检查**

Run: `node --check server.js`  
Expected: 退出码 0

- [ ] **Step 2: 括号匹配**

Run: `powershell -Command "$c = Get-Content 'index.html' -Raw; $ob = ($c.ToCharArray() | ? {$_ -eq '{'}).Count; $cb = ($c.ToCharArray() | ? {$_ -eq '}'}).Count; $op = ($c.ToCharArray() | ? {$_ -eq '('}).Count; $cp = ($c.ToCharArray() | ? {$_ -eq ')'}).Count; Write-Host '{}:' $ob/$cb; Write-Host '():' $op/$cp"`  
Expected: 括号完全匹配

- [ ] **Step 3: 重启服务**

```powershell
taskkill /F /IM node.exe 2>$null; node server.js
```

- [ ] **Step 4: 打开预览验证**

确认：
- 格式 Tab 只有三个（影视剧本/分镜脚本/短视频脚本）
- 人物卡片默认收起，点击"展开全部"显示四模块
- 生成剧本时提示词包含 30s/炸雷前置规则

- [ ] **Step 5: 提交**

```bash
git add prompts/剧本生成.md index.html
git commit -m "feat: 30s hook redesign - add core rules, remove four-in-one, collapsible character cards"
```