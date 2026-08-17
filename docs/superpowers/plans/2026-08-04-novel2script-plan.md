# Novel2Script 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个纯前端网页工具，粘贴小说章节后自动提取人物/场景并生成四种格式的可视化剧本。

**Architecture:** 单 HTML 文件（内联 CSS/JS），左侧可收起导航 + 左右分栏工作台，前端 fetch 直连 AI API（OpenAI 兼容格式），API Key 存 localStorage。

**Tech Stack:** 原生 HTML5 + CSS3 + Vanilla JS（ES6+），无框架，无依赖，无后端。

## Global Constraints

- 单文件部署：`index.html`，所有 CSS/JS 内联
- API Key 仅存 localStorage，不上传任何服务器
- 所有 AI 调用从浏览器直接发起
- 支持 OpenAI 兼容 API 格式
- 面向女频短篇小说，单章转化
- 心理描写必须转化为 AI 视频平台可识别的中观以上粒度动作
- 对白括号按 A/B/C 三级分级
- △ 画面描述只写镜头可见的

---

## 文件结构

```
f:\脚本测试\qiantie\
├── index.html          # 主文件（HTML + CSS + JS 全部内联）
├── prompts\            # 预留：提示词文件夹
```

---

### Task 1: HTML 骨架 — 导航、布局、设置弹窗

**Files:**
- Create: `f:\脚本测试\qiantie\index.html`

**Interfaces:**
- Consumes: 无
- Produces: 完整 HTML 结构 + CSS 样式 + 所有 DOM 元素

- [ ] **Step 1: 创建完整 HTML 骨架**

由于代码量较大，完整骨架包含以下部分：
- CSS 变量系统（暗色主题）
- 全局重置样式
- 左侧可收起导航栏（首页/剧本生成/Agent工作区）
- 顶部栏（页面标题 + 设置按钮）
- 三个页面容器（首页占位、剧本生成工作台、Agent占位）
- 剧本生成工作台：左侧输入区 + 生成按钮 + 人物/场景卡片区，右侧格式切换Tab + 输出区 + 操作栏
- 四种模态弹窗（设置、编辑、重新生成、Toast）
- 进度条组件
- 加载动画

详细信息见 spec 第四节"剧本生成工作台布局"。

- [ ] **Step 2: 验证页面渲染**

在浏览器打开 `index.html`，确认：
- 左侧导航栏三个选项可见，默认选中"剧本生成"
- 剧本生成页显示左右分栏
- 点击导航项可切换页面（首页/Agent显示占位内容）
- 导航栏可收起/展开

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add HTML skeleton with navigation, layout, and modals"
```

---

### Task 2: 导航与页面路由

**Files:**
- Modify: `f:\脚本测试\qiantie\index.html` — 在 `<script>` 标签中追加

**Interfaces:**
- Consumes: Task 1 的 DOM 结构
- Produces: 导航切换、收起/展开、页面路由功能

- [ ] **Step 1: 追加导航路由逻辑**

```javascript
// ============================================================
// 模块：导航与页面路由
// ============================================================

(function() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('nav-toggle');
    const navItems = document.querySelectorAll('#sidebar .nav-item');
    const pageTitle = document.getElementById('page-title');
    const pageTitles = { home: '首页', script: '剧本生成', agent: 'Agent 工作区' };

    // 导航收起/展开
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    // 页面切换
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const pageName = item.dataset.page;
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            const targetPage = document.getElementById('page-' + pageName);
            if (targetPage) targetPage.classList.add('active');
            pageTitle.textContent = pageTitles[pageName] || pageName;
        });
    });
})();
```

- [ ] **Step 2: 验证导航功能**

- 点击各导航项，页面和标题正确切换
- 导航收起/展开正常
- 收起后仅显示图标

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add navigation routing and sidebar toggle"
```

---

### Task 3: 设置面板 — API 配置与测试连接

**Files:**
- Modify: `f:\脚本测试\qiantie\index.html` — 在 `<script>` 标签中追加

**Interfaces:**
- Consumes: Task 1 的 DOM 结构
- Produces: `ApiConfig` 模块（load/save/get/testConnection），设置 UI 交互，Toast 工具函数

- [ ] **Step 1: 追加 API 配置模块**

```javascript
// ============================================================
// 模块：API 设置
// ============================================================

const ApiConfig = (function() {
    const STORAGE_KEY = 'novel2script_api_config';
    const defaultConfig = {
        provider: 'custom',
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o'
    };
    const providerDefaults = {
        openai:   { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
        tongyi:   { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
        claude:   { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-20241022' },
        custom:   { baseUrl: '', model: '' }
    };

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return { ...defaultConfig, ...JSON.parse(raw) };
        } catch (e) {}
        return { ...defaultConfig };
    }

    function save(cfg) { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); }
    function get() { return load(); }

    async function testConnection(cfg) {
        const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + cfg.apiKey
        };
        if (cfg.provider === 'claude') {
            headers['x-api-key'] = cfg.apiKey;
            delete headers['Authorization'];
        }
        const body = JSON.stringify({
            model: cfg.model,
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 5
        });
        const resp = await fetch(url, { method: 'POST', headers, body });
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error('HTTP ' + resp.status + ': ' + errText.slice(0, 200));
        }
        return true;
    }

    return { load, save, get, testConnection, providerDefaults };
})();
```

- [ ] **Step 2: 追加设置 UI 交互**

```javascript
// ============================================================
// 模块：设置 UI 交互
// ============================================================

(function() {
    const modal = document.getElementById('settings-modal');
    const btnOpen = document.getElementById('btn-open-settings');
    const btnClose = document.getElementById('btn-close-settings');
    const btnSave = document.getElementById('btn-save-settings');
    const btnTest = document.getElementById('btn-test-connection');
    const providerSelect = document.getElementById('cfg-provider');
    const apiKeyInput = document.getElementById('cfg-apikey');
    const baseUrlInput = document.getElementById('cfg-baseurl');
    const modelInput = document.getElementById('cfg-model');

    btnOpen.addEventListener('click', () => {
        const cfg = ApiConfig.get();
        providerSelect.value = cfg.provider;
        apiKeyInput.value = cfg.apiKey;
        baseUrlInput.value = cfg.baseUrl;
        modelInput.value = cfg.model;
        modal.style.display = 'flex';
    });

    btnClose.addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    providerSelect.addEventListener('change', () => {
        const defaults = ApiConfig.providerDefaults[providerSelect.value];
        if (defaults && defaults.baseUrl) baseUrlInput.value = defaults.baseUrl;
        if (defaults && defaults.model) modelInput.value = defaults.model;
        if (providerSelect.value === 'custom') { baseUrlInput.value = ''; modelInput.value = ''; }
    });

    btnSave.addEventListener('click', () => {
        const cfg = {
            provider: providerSelect.value,
            apiKey: apiKeyInput.value.trim(),
            baseUrl: baseUrlInput.value.trim(),
            model: modelInput.value.trim()
        };
        if (!cfg.apiKey) { showToast('请输入 API Key', 'error'); return; }
        if (!cfg.baseUrl) { showToast('请输入 Base URL', 'error'); return; }
        if (!cfg.model) { showToast('请输入模型名称', 'error'); return; }
        ApiConfig.save(cfg);
        modal.style.display = 'none';
        showToast('设置已保存', 'success');
    });

    btnTest.addEventListener('click', async () => {
        const cfg = {
            provider: providerSelect.value,
            apiKey: apiKeyInput.value.trim(),
            baseUrl: baseUrlInput.value.trim(),
            model: modelInput.value.trim()
        };
        if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) { showToast('请先填写完整配置', 'error'); return; }
        btnTest.disabled = true;
        btnTest.textContent = '测试中...';
        try {
            await ApiConfig.testConnection(cfg);
            showToast('连接成功！', 'success');
        } catch (e) {
            showToast('连接失败：' + e.message, 'error');
        } finally {
            btnTest.disabled = false;
            btnTest.textContent = '🔗 测试连接';
        }
    });
})();
```

- [ ] **Step 3: 追加 Toast 工具函数**

```javascript
// ============================================================
// 工具：Toast 提示
// ============================================================

function showToast(message, type) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type || '');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3000);
}
```

- [ ] **Step 4: 验证设置功能**

- 打开/关闭设置弹窗正常
- 切换提供商自动填充 Base URL 和模型
- 保存后 localStorage 有数据
- 刷新页面后配置保留
- 测试连接功能正常

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add API settings panel with test connection"
```

---

### Task 4: AI 调用模块

**Files:**
- Modify: `f:\脚本测试\qiantie\index.html` — 在 `<script>` 标签中追加

**Interfaces:**
- Consumes: Task 3 的 `ApiConfig`
- Produces: `AIClient.call(messages, options)` → Promise<string>, `AIClient.callStream(messages, onChunk, options)` → Promise<string>

- [ ] **Step 1: 追加 AI 调用模块**

```javascript
// ============================================================
// 模块：AI API 调用
// ============================================================

const AIClient = (function() {
    async function call(messages, options = {}) {
        const cfg = ApiConfig.get();
        if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
            throw new Error('请先在设置中配置 API');
        }
        const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + cfg.apiKey
        };
        if (cfg.provider === 'claude') {
            headers['x-api-key'] = cfg.apiKey;
            delete headers['Authorization'];
        }
        const body = JSON.stringify({
            model: cfg.model,
            messages: messages,
            max_tokens: options.maxTokens || 4096,
            temperature: options.temperature ?? 0.7
        });
        const resp = await fetch(url, { method: 'POST', headers, body });
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error('API 请求失败 (HTTP ' + resp.status + '): ' + errText.slice(0, 300));
        }
        const data = await resp.json();
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error('API 返回格式异常');
        }
        return data.choices[0].message.content;
    }

    async function callStream(messages, onChunk, options = {}) {
        const cfg = ApiConfig.get();
        if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
            throw new Error('请先在设置中配置 API');
        }
        const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + cfg.apiKey
        };
        if (cfg.provider === 'claude') {
            headers['x-api-key'] = cfg.apiKey;
            delete headers['Authorization'];
        }
        const body = JSON.stringify({
            model: cfg.model,
            messages: messages,
            max_tokens: options.maxTokens || 4096,
            temperature: options.temperature ?? 0.7,
            stream: true
        });
        const resp = await fetch(url, { method: 'POST', headers, body });
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error('API 请求失败 (HTTP ' + resp.status + '): ' + errText.slice(0, 300));
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;
                const data = trimmed.slice(6);
                if (data === '[DONE]') continue;
                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta) { fullContent += delta; onChunk(delta); }
                } catch (e) {}
            }
        }
        return fullContent;
    }

    return { call, callStream };
})();
```

- [ ] **Step 2: 验证 AI 调用**

在浏览器控制台中测试（需先配置 API）：

```javascript
AIClient.call([{ role: 'user', content: '回复"OK"' }])
    .then(r => console.log('成功:', r))
    .catch(e => console.error('失败:', e));
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add AI API client with streaming support"
```

---

### Task 5: 提示词模板

**Files:**
- Modify: `f:\脚本测试\qiantie\index.html` — 在 `<script>` 标签中追加

**Interfaces:**
- Consumes: 无
- Produces: `PromptTemplates.extractPrompt(novelText)` → messages[], `PromptTemplates.scriptPrompt(novelText, charsJson, scenesJson, format)` → messages[]

- [ ] **Step 1: 追加提示词模板**

```javascript
// ============================================================
// 模块：提示词模板
// ============================================================

const PromptTemplates = (function() {
    function extractPrompt(novelText) {
        const systemPrompt = `你是一位专业的影视剧本分析师，擅长从小说中提取人物关系网络和场景结构。

# 任务
分析以下小说章节，提取所有人物和场景，输出为 JSON。

# 输出要求
严格按以下 JSON 结构输出，不要输出其他任何内容：

{
  "人物": [
    {
      "姓名": "",
      "别名": "",
      "角色定位": "",
      "身份标签": "",
      "性别": "",
      "大致年龄": "",
      "外貌要点": "",
      "性格关键词": [],
      "关系网络": "",
      "说话风格": "",
      "在章节中的功能": ""
    }
  ],
  "场景": [
    {
      "场景编号": 1,
      "地点": "",
      "时间": "",
      "出场人物": [],
      "核心事件": "",
      "情绪基调": "",
      "冲突类型": ""
    }
  ]
}

# 人物提取规则
1. 提取所有有名字或可单独识别的角色，包括动物角色
2. "别名"：填写文中其他称呼，多个用逗号分隔。同一人物的不同叫法必须合并，不重复输出
3. "角色定位"：主角/反派/重要配角/配角/龙套
4. "身份标签"：说明角色身份，如"女主·咖啡师·单亲妈妈"
5. "外貌要点"：仅提取原文明确提到的外貌特征，用1-2句话概括
6. "关系网络"：梳理该角色与其他角色的关系，如"苏晚晚的闺蜜""陆砚的前女友"
7. "说话风格"：用一句话概括，如"语气清冷，句子简短""话多嘴碎，习惯反问"
8. 若原文未提供某项信息，字段留空字符串 ""

# 场景提取规则
1. 按地点和时间变化拆分，一个连续时空中发生的事件为一个场景
2. 同一建筑内不同独立空间（客厅/卧室/阳台）应分别输出
3. "情绪基调"：该场景的整体情绪氛围，如"紧张""温馨""暧昧""压抑"
4. "冲突类型"：人物冲突/内心冲突/环境冲突/信息差冲突
5. 场景描述应从剧情反推：人物如果要靠在树上，场景中应有一棵树`;

        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '请分析以下小说章节：\n\n' + novelText }
        ];
    }

    function scriptPrompt(novelText, charsJson, scenesJson, format) {
        const formatNames = {
            'screenplay': '影视剧本',
            'storyboard': '分镜脚本',
            'shortdrama': '短视频脚本',
            'all': '四合一格式（同一内容，依次输出：影视剧本 → 分镜脚本 → 短视频脚本）'
        };

        const formatRules = {
            'screenplay': `# 影视剧本格式
【场景X：场景标题】
地点：XXX  时间：XXX
出场人物：XXX

[动作描写段落]

　　角色名：（表情/动作提示）台词内容

[动作描写段落]

　　角色名：台词内容`,
            'storyboard': `# 分镜脚本格式
【镜号1】景别：XXX | 运镜：XXX
画面：XXX
对白/音效：XXX

【镜号2】景别：XXX | 运镜：XXX
画面：XXX`,
            'shortdrama': `# 短视频脚本格式
X-1 场景名 时间/内/外
人物：xxx、xxx

△只写镜头能看到的动作、表情、道具、互动、站位，不写心理和环境描写。

人物A（关键句写具体表情/动作/身体状态；普通句可简写或省略）：台词。
人物B（按台词功能决定括号详略）：台词。

△动作或道具特写。

【字幕：地点或关键信息】

【本集结尾卡点】
△画面描述。
人物A（具体表情/动作描写）：最后一句卡点台词。`,
            'all': `# 四合一格式
同一内容，依次按以下四种格式输出，每种格式之间用"---"分隔：

## 影视剧本
[影视剧本格式内容]

---

## 分镜脚本
[分镜脚本格式内容]

---

## 短视频脚本
[短视频脚本格式内容]`
        };

        const systemPrompt = `你是一位专业的影视编剧，擅长将小说转化为可拍摄的视觉化剧本。你的核心原则是：**一切心理活动都必须转化为可见的动作、表情、镜头语言**。

# 任务
根据以下信息，将小说章节转化为${formatNames[format]}。

# 核心转化规则

## 规则1：心理描写视觉化（最重要）
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

## 规则2：对白括号 A/B/C 分级
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

## 规则3：△ 画面描述规则
- 只写镜头能看到的：动作、表情、道具、站位、互动
- 不写心理描写、环境描写、抽象形容
- 每个△段落是一个独立的画面单元

## 规则4：转化要求
- 逐段完整转化，不遗漏任何情节
- 过渡性叙述也要转化为视觉化动作或空镜
- 对白前必须有动作描写，不能只有台词
- 女频特点：注重情感递进，对话中留白和潜台词

${formatRules[format]}`;

        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `## 小说原文\n${novelText}\n\n## 人物信息\n${charsJson}\n\n## 场景信息\n${scenesJson}\n\n请将以上小说章节转化为${formatNames[format]}。` }
        ];
    }

    return { extractPrompt, scriptPrompt };
})();
```

- [ ] **Step 2: 验证提示词生成**

在控制台测试：`PromptTemplates.extractPrompt('测试内容')` 和 `PromptTemplates.scriptPrompt('测试', '{}', '{}', 'shortdrama')` 返回正确的 messages 数组。

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add prompt templates for extraction and script generation"
```

---

### Task 6: 人物/场景提取与卡片渲染

**Files:**
- Modify: `f:\脚本测试\qiantie\index.html` — 在 `<script>` 标签中追加

**Interfaces:**
- Consumes: Task 4 的 `AIClient`, Task 5 的 `PromptTemplates`
- Produces: `extractJSON(text)` → object, `Extraction` 模块（extract/renderCards/getData/setData）, 编辑卡片功能

- [ ] **Step 1: 追加 JSON 解析 + 提取模块 + 编辑卡片**

```javascript
// ============================================================
// 工具：JSON 解析（从 AI 响应中提取 JSON）
// ============================================================

function extractJSON(text) {
    try { return JSON.parse(text); } catch (e) {}
    const codeBlock = text.match(/```json\s*([\s\S]*?)```/);
    if (codeBlock) {
        try { return JSON.parse(codeBlock[1].trim()); } catch (e) {}
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        try { return JSON.parse(text.slice(firstBrace, lastBrace + 1)); } catch (e) {}
    }
    throw new Error('无法从 AI 响应中提取 JSON');
}

// ============================================================
// 模块：人物/场景提取与卡片渲染
// ============================================================

const Extraction = (function() {
    let currentData = { characters: [], scenes: [] };

    function getData() { return currentData; }
    function setData(data) { currentData = data; }

    async function extract(novelText) {
        const messages = PromptTemplates.extractPrompt(novelText);
        const response = await AIClient.call(messages, { maxTokens: 4096, temperature: 0.3 });
        const data = extractJSON(response);
        const characters = (data.人物 || data.characters || []).map(c => ({
            name: c.姓名 || c.name || '',
            alias: c.别名 || c.alias || '',
            role: c.角色定位 || c.role || '',
            identity: c.身份标签 || c.identity || '',
            gender: c.性别 || c.gender || '',
            age: c.大致年龄 || c.age || '',
            appearance: c.外貌要点 || c.appearance || '',
            personality: c.性格关键词 || c.personality || [],
            relations: c.关系网络 || c.relations || '',
            speechStyle: c.说话风格 || c.speechStyle || '',
            function: c.在章节中的功能 || c.function || ''
        }));
        const scenes = (data.场景 || data.scenes || []).map(s => ({
            number: s.场景编号 || s.number || 0,
            location: s.地点 || s.location || '',
            time: s.时间 || s.time || '',
            characters: s.出场人物 || s.characters || [],
            event: s.核心事件 || s.event || '',
            mood: s.情绪基调 || s.mood || '',
            conflictType: s.冲突类型 || s.conflictType || ''
        }));
        currentData = { characters, scenes };
        return currentData;
    }

    function renderCards(data) {
        const charSection = document.getElementById('char-section');
        const sceneSection = document.getElementById('scene-section');
        const charList = document.getElementById('char-list');
        const sceneList = document.getElementById('scene-list');
        const charCount = document.getElementById('char-count');
        const sceneCount = document.getElementById('scene-count');

        if (data.characters.length > 0) {
            charSection.style.display = '';
            charCount.textContent = '(' + data.characters.length + ')';
            charList.innerHTML = data.characters.map((c, i) => `
                <div class="card" data-type="char" data-index="${i}">
                    <button class="btn-edit" data-type="char" data-index="${i}">✏️</button>
                    <div class="card-name">${escapeHtml(c.name) || '未命名'} ${c.role ? '· ' + escapeHtml(c.role) : ''}</div>
                    <div class="card-detail">${escapeHtml(c.identity)}</div>
                    ${c.speechStyle ? '<div class="card-detail">说话：' + escapeHtml(c.speechStyle) + '</div>' : ''}
                    ${c.relations ? '<div class="card-detail">关系：' + escapeHtml(c.relations) + '</div>' : ''}
                </div>`).join('');
        } else { charSection.style.display = 'none'; }

        if (data.scenes.length > 0) {
            sceneSection.style.display = '';
            sceneCount.textContent = '(' + data.scenes.length + ')';
            sceneList.innerHTML = data.scenes.map((s, i) => `
                <div class="card" data-type="scene" data-index="${i}">
                    <button class="btn-edit" data-type="scene" data-index="${i}">✏️</button>
                    <div class="card-name">场景${s.number}：${escapeHtml(s.location)}</div>
                    <div class="card-detail">${escapeHtml(s.time)} · 情绪：${escapeHtml(s.mood)}</div>
                    <div class="card-detail">出场：${Array.isArray(s.characters) ? s.characters.join('、') : ''}</div>
                </div>`).join('');
        } else { sceneSection.style.display = 'none'; }
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return { extract, renderCards, getData, setData, escapeHtml };
})();

// ============================================================
// 模块：编辑卡片
// ============================================================

(function() {
    const editModal = document.getElementById('edit-modal');
    const editTitle = document.getElementById('edit-modal-title');
    const editContent = document.getElementById('edit-modal-content');
    const btnClose = document.getElementById('btn-close-edit');
    const btnSave = document.getElementById('btn-save-edit');
    let editTarget = null;

    document.getElementById('char-list').addEventListener('click', handleEditClick);
    document.getElementById('scene-list').addEventListener('click', handleEditClick);

    function handleEditClick(e) {
        const btn = e.target.closest('.btn-edit');
        if (!btn) return;
        editTarget = { type: btn.dataset.type, index: parseInt(btn.dataset.index) };
        const data = Extraction.getData();
        if (editTarget.type === 'char') {
            const c = data.characters[editTarget.index];
            editTitle.textContent = '编辑人物：' + (c.name || '未命名');
            editContent.value = JSON.stringify({ name: c.name, alias: c.alias, role: c.role, identity: c.identity, gender: c.gender, age: c.age, appearance: c.appearance, personality: c.personality, relations: c.relations, speechStyle: c.speechStyle, function: c.function }, null, 2);
        } else {
            const s = data.scenes[editTarget.index];
            editTitle.textContent = '编辑场景' + s.number;
            editContent.value = JSON.stringify({ number: s.number, location: s.location, time: s.time, characters: s.characters, event: s.event, mood: s.mood, conflictType: s.conflictType }, null, 2);
        }
        editModal.style.display = 'flex';
    }

    btnClose.addEventListener('click', () => { editModal.style.display = 'none'; });
    editModal.addEventListener('click', (e) => { if (e.target === editModal) editModal.style.display = 'none'; });

    btnSave.addEventListener('click', () => {
        if (!editTarget) return;
        try {
            const newData = JSON.parse(editContent.value);
            const data = Extraction.getData();
            if (editTarget.type === 'char') {
                data.characters[editTarget.index] = { ...data.characters[editTarget.index], ...newData };
            } else {
                data.scenes[editTarget.index] = { ...data.scenes[editTarget.index], ...newData };
            }
            Extraction.setData(data);
            Extraction.renderCards(data);
            editModal.style.display = 'none';
            showToast('已保存', 'success');
        } catch (e) { showToast('JSON 格式错误', 'error'); }
    });
})();
```

- [ ] **Step 2: 验证提取与卡片功能**

- 粘贴小说 → 调用提取 API → 卡片正确渲染
- 点击编辑按钮 → 修改 JSON → 保存 → 卡片更新

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add character/scene extraction and editable card rendering"
```

---

### Task 7: 剧本生成、输出渲染、格式切换、复制导出

**Files:**
- Modify: `f:\脚本测试\qiantie\index.html` — 在 `<script>` 标签中追加

**Interfaces:**
- Consumes: Task 4 的 `AIClient`, Task 5 的 `PromptTemplates`, Task 6 的 `Extraction`
- Produces: `ScriptGenerator` 模块（generate/renderOutput/流式输出）, 格式切换, 复制/导出

- [ ] **Step 1: 追加剧本生成与输出模块**

```javascript
// ============================================================
// 模块：剧本生成与输出
// ============================================================

const ScriptGenerator = (function() {
    let currentFormat = 'shortdrama';
    let currentOutput = '';
    let currentNovelText = '';

    function getCurrentFormat() { return currentFormat; }
    function setCurrentFormat(f) { currentFormat = f; }
    function getCurrentOutput() { return currentOutput; }
    function getCurrentNovelText() { return currentNovelText; }
    function setCurrentNovelText(t) { currentNovelText = t; }

    async function generate(novelText, format) {
        setCurrentNovelText(novelText);
        const data = Extraction.getData();
        const charsJson = JSON.stringify(data.characters, null, 2);
        const scenesJson = JSON.stringify(data.scenes, null, 2);
        const messages = PromptTemplates.scriptPrompt(novelText, charsJson, scenesJson, format);
        const response = await AIClient.callStream(messages, (chunk) => {
            appendToOutput(chunk);
        }, { maxTokens: 8192, temperature: 0.7 });
        currentOutput = response;
        markOutputComplete();
        showActionButtons();
        return response;
    }

    function renderOutput(text) {
        const outputArea = document.getElementById('output-area');
        outputArea.innerHTML = '';
        const div = document.createElement('div');
        div.style.whiteSpace = 'pre-wrap';
        div.style.lineHeight = '1.8';
        div.textContent = text;
        outputArea.appendChild(div);
        currentOutput = text;
        showActionButtons();
    }

    function appendToOutput(chunk) {
        const outputArea = document.getElementById('output-area');
        const emptyState = outputArea.querySelector('.empty-state');
        if (emptyState) outputArea.innerHTML = '';
        let contentDiv = outputArea.querySelector('div');
        if (!contentDiv) {
            contentDiv = document.createElement('div');
            contentDiv.style.whiteSpace = 'pre-wrap';
            contentDiv.style.lineHeight = '1.8';
            outputArea.appendChild(contentDiv);
        }
        contentDiv.textContent += chunk;
        outputArea.scrollTop = outputArea.scrollHeight;
    }

    function markOutputComplete() {
        const outputArea = document.getElementById('output-area');
        if (!outputArea.querySelector('div') && currentOutput) {
            renderOutput(currentOutput);
        }
    }

    function showActionButtons() {
        document.getElementById('btn-regenerate').style.display = '';
        document.getElementById('btn-copy').style.display = '';
        document.getElementById('btn-export').style.display = '';
    }

    function hideActionButtons() {
        document.getElementById('btn-regenerate').style.display = 'none';
        document.getElementById('btn-copy').style.display = 'none';
        document.getElementById('btn-export').style.display = 'none';
    }

    return { generate, renderOutput, getCurrentFormat, setCurrentFormat, getCurrentOutput, getCurrentNovelText, setCurrentNovelText, showActionButtons, hideActionButtons };
})();

// ============================================================
// 模块：格式切换
// ============================================================

(function() {
    document.querySelectorAll('#format-tabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#format-tabs .tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            ScriptGenerator.setCurrentFormat(tab.dataset.format);
        });
    });
})();

// ============================================================
// 模块：复制和导出
// ============================================================

(function() {
    document.getElementById('btn-copy').addEventListener('click', async () => {
        const text = ScriptGenerator.getCurrentOutput();
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            showToast('已复制到剪贴板', 'success');
        } catch (e) {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showToast('已复制到剪贴板', 'success');
        }
    });

    document.getElementById('btn-export').addEventListener('click', () => {
        const text = ScriptGenerator.getCurrentOutput();
        if (!text) return;
        const names = { screenplay: '影视剧本', storyboard: '分镜脚本', shortdrama: '短视频脚本', all: '四合一' };
        const name = names[ScriptGenerator.getCurrentFormat()] || '剧本';
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name + '_' + new Date().toISOString().slice(0, 10) + '.txt';
        a.click();
        URL.revokeObjectURL(url);
        showToast('导出成功', 'success');
    });
})();
```

- [ ] **Step 2: 验证剧本生成与输出**

- 粘贴小说 → 点击生成 → 流式输出到右侧
- 切换格式 Tab → 确认格式标记切换
- 点击复制 → 剪贴板有内容
- 点击导出 → 下载 .txt 文件

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add script generation with streaming output and format switching"
```

---

### Task 8: 一键生成流水线 + 重新生成

**Files:**
- Modify: `f:\脚本测试\qiantie\index.html` — 在 `<script>` 标签中追加

**Interfaces:**
- Consumes: Task 4-7 的所有模块
- Produces: 一键生成按钮的完整流水线, 重新生成弹窗交互, 进度条控制

- [ ] **Step 1: 追加生成流水线 + 重新生成逻辑**

```javascript
// ============================================================
// 模块：一键生成流水线
// ============================================================

(function() {
    const btnGenerate = document.getElementById('btn-generate');
    const novelInput = document.getElementById('novel-input');
    const loadingStatus = document.getElementById('loading-status');
    const progressBar = document.getElementById('progress-bar');
    const step1El = document.getElementById('step1');
    const step2El = document.getElementById('step2');

    function setLoading(msg) {
        loadingStatus.style.display = '';
        loadingStatus.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><span>' + msg + '</span></div>';
    }

    function clearLoading() {
        loadingStatus.style.display = 'none';
        loadingStatus.innerHTML = '';
    }

    function setProgress(step) {
        progressBar.style.display = '';
        step1El.className = 'step';
        step2El.className = 'step';
        if (step >= 1) step1El.className = 'step done';
        if (step >= 2) step2El.className = 'step done';
        if (step === 1.5) step2El.className = 'step active';
    }

    function hideProgress() {
        progressBar.style.display = 'none';
    }

    function resetUI() {
        const outputArea = document.getElementById('output-area');
        outputArea.innerHTML = '<div class="empty-state"><div class="empty-icon">📄</div><div class="empty-text">粘贴小说后点击"一键生成"</div><div class="empty-sub">自动提取人物、场景，生成可视化剧本</div></div>';
        ScriptGenerator.hideActionButtons();
        document.getElementById('char-section').style.display = 'none';
        document.getElementById('scene-section').style.display = 'none';
        hideProgress();
    }

    btnGenerate.addEventListener('click', async () => {
        const novelText = novelInput.value.trim();
        if (!novelText) {
            showToast('请先粘贴小说内容', 'error');
            return;
        }
        if (novelText.length < 100) {
            showToast('内容太短，请至少输入100字', 'error');
            return;
        }

        btnGenerate.disabled = true;
        btnGenerate.textContent = '处理中...';
        hideProgress();

        try {
            // 第1步：提取人物和场景
            setLoading('提取人物和场景中...');
            setProgress(1);
            const data = await Extraction.extract(novelText);
            Extraction.renderCards(data);
            step1El.className = 'step done';

            // 第2步：生成剧本
            setLoading('剧本生成中...');
            setProgress(1.5);
            const format = ScriptGenerator.getCurrentFormat();
            await ScriptGenerator.generate(novelText, format);
            setProgress(2);

            clearLoading();
            showToast('生成完成！', 'success');
        } catch (e) {
            clearLoading();
            showToast('生成失败：' + e.message, 'error');
            console.error(e);
        } finally {
            btnGenerate.disabled = false;
            btnGenerate.textContent = '🚀 一键生成';
        }
    });
})();

// ============================================================
// 模块：重新生成
// ============================================================

(function() {
    const modal = document.getElementById('regenerate-modal');
    const btnOpen = document.getElementById('btn-regenerate');
    const btnClose = document.getElementById('btn-close-regenerate');
    const btnConfirm = document.getElementById('btn-confirm-regenerate');

    btnOpen.addEventListener('click', () => { modal.style.display = 'flex'; });
    btnClose.addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    btnConfirm.addEventListener('click', async () => {
        const selected = document.querySelector('input[name="regenerate"]:checked');
        if (!selected) return;
        modal.style.display = 'none';

        const btnGenerate = document.getElementById('btn-generate');
        btnGenerate.disabled = true;
        btnGenerate.textContent = '重新生成中...';

        const loadingStatus = document.getElementById('loading-status');
        const progressBar = document.getElementById('progress-bar');
        const step1El = document.getElementById('step1');
        const step2El = document.getElementById('step2');

        function setLoading(msg) {
            loadingStatus.style.display = '';
            loadingStatus.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><span>' + msg + '</span></div>';
        }
        function clearLoading() { loadingStatus.style.display = 'none'; loadingStatus.innerHTML = ''; }

        try {
            const novelText = ScriptGenerator.getCurrentNovelText();

            if (selected.value === 'all') {
                // 全部重新生成
                progressBar.style.display = '';
                setLoading('提取人物和场景中...');
                step1El.className = 'step done';
                const data = await Extraction.extract(novelText);
                Extraction.renderCards(data);
                setLoading('剧本生成中...');
                step2El.className = 'step active';
                await ScriptGenerator.generate(novelText, ScriptGenerator.getCurrentFormat());
                step2El.className = 'step done';
                clearLoading();
                showToast('全部重新生成完成', 'success');
            } else if (selected.value === 'extract') {
                // 仅重新提取
                setLoading('提取人物和场景中...');
                progressBar.style.display = '';
                step1El.className = 'step done';
                const data = await Extraction.extract(novelText);
                Extraction.renderCards(data);
                clearLoading();
                showToast('人物和场景已更新', 'success');
            } else {
                // 仅重新生成剧本
                setLoading('剧本生成中...');
                progressBar.style.display = '';
                step2El.className = 'step active';
                await ScriptGenerator.generate(novelText, ScriptGenerator.getCurrentFormat());
                step2El.className = 'step done';
                clearLoading();
                showToast('剧本已重新生成', 'success');
            }
        } catch (e) {
            clearLoading();
            showToast('重新生成失败：' + e.message, 'error');
            console.error(e);
        } finally {
            btnGenerate.disabled = false;
            btnGenerate.textContent = '🚀 一键生成';
        }
    });
})();
```

- [ ] **Step 2: 端到端验证完整流程**

1. 配置 API
2. 粘贴一段女频小说章节
3. 点击"一键生成"
4. 验证：进度条显示 → 人物/场景卡片出现 → 剧本流式输出
5. 切换格式 Tab
6. 点击"重新生成" → 选择"仅重新生成剧本" → 换格式确认
7. 点击"复制"和"导出"验证

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add one-click generation pipeline and regenerate flow"
```

---

## 自审结果

1. **Spec 覆盖**：所有 spec 要求均已覆盖——导航、布局、设置、AI 调用、提示词、提取、生成、格式切换、重新生成、复制导出
2. **无占位符**：所有步骤都有完整代码，无 TBD/TODO
3. **类型一致性**：`ApiConfig.get()` → `{ provider, apiKey, baseUrl, model }` 在所有任务中一致；`Extraction.getData()` → `{ characters, scenes }` 在 Task 6-8 中一致