// ============================================================
// 模块：首页快捷卡片事件（替代 onclick）
// ============================================================
(function() {
    // 快捷入口卡片：data-action="nav" data-target="xxx" / data-href="xxx"
    document.querySelectorAll('.quick-action-card[data-action="nav"]').forEach(function(card) {
        card.addEventListener('click', function() {
            var target = card.dataset.target;
            var href = card.dataset.href;
            if (target) {
                var navItem = document.querySelector('.nav-item[data-page="' + target + '"]');
                if (navItem) navItem.click();
            } else if (href) {
                location.href = href;
            }
        });
    });

    // 查看全部历史记录按钮
    var btnMore = document.getElementById('btn-more-projects');
    if (btnMore) {
        btnMore.addEventListener('click', function() {
            var btnHistory = document.getElementById('btn-open-history');
            if (btnHistory) btnHistory.click();
        });
    }
})();

// ============================================================
// 模块：提示词模板
// ============================================================

const PromptTemplates = (function() {
    var formatNamesMap = {
        'screenplay': '剧情模式',
        'storyboard': '画布模式',
        'shortdrama': '剧本模式',
        'q版': 'Q版模式'
    };

    function extractPrompt(novelText) {
        return {
            promptType: 'extract',
            novelText: novelText
        };
    }

    function scriptPrompt(mode, novelText, charsJson, scenesJson, format, duration) {
        return {
            promptType: 'script',
            mode: mode === 'hook' ? 'hook' : 'continuous',
            format: format,
            formatName: formatNamesMap[format] || '剧本',
            duration: duration || '10s',
            novelText: novelText,
            characters: charsJson,
            scenes: scenesJson
        };
    }

    return { extractPrompt, scriptPrompt };
})();
// ============================================================
// 模块：AI API 调用
// ============================================================

const AIClient = (function() {
    const API_BASE = '';

    function buildBody(requestPayload, options, stream) {
        const base = Array.isArray(requestPayload) ? { messages: requestPayload } : requestPayload;
        return JSON.stringify({
            ...base,
            max_tokens: options.maxTokens || 4096,
            temperature: options.temperature ?? 0.7,
            stream: stream
        });
    }

    async function call(requestPayload, options = {}) {
        const body = buildBody(requestPayload, options, false);
        const resp = await authFetch(API_BASE + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
        });
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

    async function callStream(requestPayload, onChunk, options = {}) {
        const body = buildBody(requestPayload, options, true);
        const resp = await authFetch(API_BASE + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
        });
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

    // 流式调用 + 返回完整文本（供需要完整结果的场景使用，如 JSON 解析）
    async function callStreamText(requestPayload, onChunk, options = {}) {
        const body = buildBody(requestPayload, options, true);
        const resp = await authFetch(API_BASE + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
        });
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
                    if (delta) { fullContent += delta; if (onChunk) onChunk(delta, fullContent); }
                } catch (e) {}
            }
        }
        return fullContent;
    }

    return { call, callStream, callStreamText };
})();

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
    let currentData = { era: '', characters: [], scenes: [] };

    function getData() { return currentData; }
    function setData(data) { currentData = data; }

    async function extract(novelText, onProgress) {
        const messages = PromptTemplates.extractPrompt(novelText);
        const response = await AIClient.callStreamText(messages, onProgress, { maxTokens: 4096, temperature: 0.3 });
        const data = extractJSON(response);
        const era = data.时代背景 || data.era || '';
        const characters = (data.人物 || data.characters || []).map(c => {
            const app = c.外貌描述 || c.appearance || {};
            return {
                name: c.姓名 || c.name || '',
                alias: c.别名 || c.alias || '',
                role: c.角色定位 || c.role || '',
                identity: c.身份标签 || c.identity || '',
                gender: c.性别 || c.gender || '',
                age: c.大致年龄 || c.age || '',
                appearance: {
                    body: app.基本体征 || app.body || '',
                    face: app.五官与妆容 || app.face || '',
                    hair: app.发型与发饰 || app.hair || '',
                    clothing: app.服饰与配饰 || app.clothing || ''
                },
                personality: c.性格关键词 || c.personality || [],
                relations: c.关系网络 || c.relations || '',
                speechStyle: c.说话风格 || c.speechStyle || '',
                function: c.在章节中的功能 || c.function || ''
            };
        });
        const scenes = (data.场景 || data.scenes || []).map(s => ({
            number: s.场景编号 || s.number || 0,
            location: s.地点 || s.location || '',
            time: s.时间 || s.time || '',
            characters: s.出场人物 || s.characters || [],
            event: s.核心事件 || s.event || '',
            mood: s.情绪基调 || s.mood || '',
            conflictType: s.冲突类型 || s.conflictType || ''
        }));
        currentData = { era, characters, scenes };
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
            var btnRegenChars = document.getElementById('btn-regen-chars');
            if (btnRegenChars) btnRegenChars.style.display = '';
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
                    + '<div class="card-name">' + (escapeHtml(c.name) || '未命名') + (c.role ? ' · ' + escapeHtml(c.role) : '') + '</div>'
                    + '<div class="card-detail">' + escapeHtml(c.identity) + '</div>'
                    + (hasDetails ? '<div class="card-body-collapsed" data-char-body="' + i + '">' + details + '</div>' : '')
                    + (hasDetails ? '<div class="card-expand-hint" data-char-expand="' + i + '">展开全部 ▼</div>' : '')
                    + '</div>';
            }).join('');
        } else { charSection.style.display = 'none'; }

        if (data.scenes.length > 0) {
            sceneSection.style.display = '';
            sceneCount.textContent = '(' + data.scenes.length + ')';
            var btnRegenScenes = document.getElementById('btn-regen-scenes');
            if (btnRegenScenes) btnRegenScenes.style.display = '';
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

    // 人物卡片展开/收起事件委托
    (function() {
        var charList = document.getElementById('char-list');
        if (!charList) return;
        charList.removeEventListener('click', handleCardExpand);
        charList.addEventListener('click', handleCardExpand);
    })();

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

    return { extract, renderCards, getData, setData, escapeHtml };
})();

// ============================================================
// 模块：编辑卡片
// ============================================================

(function() {
    const editModal = document.getElementById('edit-modal');
    const editTitle = document.getElementById('edit-modal-title');
    const editContent = document.getElementById('edit-modal-textarea');
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
            editContent.value = JSON.stringify({ name: c.name, alias: c.alias, role: c.role, identity: c.identity, gender: c.gender, age: c.age, appearance: c.appearance || { body: '', face: '', hair: '', clothing: '' }, personality: c.personality, relations: c.relations, speechStyle: c.speechStyle, function: c.function }, null, 2);
        } else {
            const s = data.scenes[editTarget.index];
            editTitle.textContent = '编辑场景' + s.number;
            editContent.value = JSON.stringify({ number: s.number, location: s.location, time: s.time, characters: s.characters, event: s.event, mood: s.mood, conflictType: s.conflictType }, null, 2);
        }
        editModal.classList.add('visible');
    }

    btnClose.addEventListener('click', () => { editModal.classList.remove('visible'); });
    editModal.addEventListener('click', (e) => { if (e.target === editModal) editModal.classList.remove('visible'); });

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
            editModal.classList.remove('visible');
            showToast('已保存', 'success');
        } catch (e) { showToast('JSON 格式错误', 'error'); }
    });
})();

// ============================================================
// 模块：生成历史记录（服务端文件存储，局域网共享）
// ============================================================

const History = (function() {
    var _entries = [];

    async function loadFromServer() {
        try {
            var resp = await authFetch('/api/history');
            if (!resp.ok) throw new Error('加载失败');
            var data = await resp.json();
            _entries = data.entries || [];
        } catch (e) {
            console.error('加载历史记录失败:', e);
            _entries = [];
        }
    }

    function getAll() { return _entries; }

    async function save(entry) {
        try {
            var resp = await authFetch('/api/history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(entry)
            });
            if (!resp.ok) throw new Error('保存失败');
            await loadFromServer();
            renderList();
        } catch (e) {
            console.error('保存历史记录失败:', e);
        }
    }

    async function remove(id) {
        try {
            await authFetch('/api/history/' + encodeURIComponent(id), { method: 'DELETE' });
            await loadFromServer();
            renderList();
        } catch (e) {
            console.error('删除历史记录失败:', e);
        }
    }

    async function clearAll() {
        try {
            await authFetch('/api/history', { method: 'DELETE' });
            await loadFromServer();
            renderList();
        } catch (e) {
            console.error('清空历史记录失败:', e);
        }
    }

    function renderHomeRecent(entries) {
        var homeGrid = document.getElementById('home-recent-grid');
        if (!homeGrid) return;

        if (!entries || entries.length === 0) {
            homeGrid.innerHTML = `
                <div class="recent-empty">
                    <div class="empty-icon">📂</div>
                    <p>暂无最近的创作记录，点击上方 "新建剧本项目" 开始首个剧本吧！</p>
                </div>
            `;
            return;
        }

        // 取最近的 4 条记录展示
        var recentEntries = entries.slice(0, 4);
        homeGrid.innerHTML = recentEntries.map(function(e) {
            var tag = e.mode === 'hook' ? '爆款' : '连续';
            var time = formatTime(e.createdAt);
            
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

    function renderList() {
        var entries = _entries;
        var dropdown = document.getElementById('history-dropdown');
        var list = document.getElementById('history-list');
        var empty = document.getElementById('history-empty');
        var count = document.getElementById('history-count');

        if (entries.length === 0) {
            empty.style.display = 'block';
            list.innerHTML = '';
        } else {
            empty.style.display = 'none';
            list.innerHTML = entries.map(function(e) {
                var tag = e.mode === 'hook' ? '爆款' : '连续';
                var time = formatTime(e.createdAt);
                return '<div class="history-item" data-id="' + esc(e.id) + '">' +
                    '<span class="history-item-tag">' + esc(tag) + '</span>' +
                    '<span class="history-item-text" title="' + esc(e.formatName) + ' · ' + esc(e.duration) + '">' + esc(e.preview || '') + '</span>' +
                    '<span class="history-item-time">' + esc(time) + '</span>' +
                    '<button class="history-item-delete" data-delete="' + esc(e.id) + '">✕</button>' +
                    '</div>';
            }).join('');
        }
        count.textContent = entries.length;

        // 联动渲染首页最近创作项目
        renderHomeRecent(entries);
    }

    function formatTime(iso) {
        var d = new Date(iso);
        var now = new Date();
        var diff = now - d;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
        if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
        var MM = String(d.getMonth() + 1).padStart(2, '0');
        var DD = String(d.getDate()).padStart(2, '0');
        return MM + '-' + DD;
    }

    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // 初始化事件
    function init() {
        var btnHistory = document.getElementById('btn-open-history');
        var dropdown = document.getElementById('history-dropdown');
        if (!btnHistory || !dropdown) return;

        // 开关下拉
        btnHistory.addEventListener('click', function(e) {
            e.stopPropagation();
            var isOpen = dropdown.style.display === 'block';
            if (isOpen) {
                dropdown.style.display = 'none';
                // 放回 topbar
                var topbar = document.getElementById('topbar');
                if (topbar && dropdown.parentNode !== topbar) {
                    topbar.appendChild(dropdown);
                }
            } else {
                var rect = btnHistory.getBoundingClientRect();
                document.body.appendChild(dropdown);
                dropdown.style.position = 'fixed';
                dropdown.style.top = (rect.bottom + 4) + 'px';
                dropdown.style.left = Math.min(rect.left, window.innerWidth - 340) + 'px';
                dropdown.style.right = 'auto';
                dropdown.style.width = '320px';
                dropdown.style.maxHeight = (window.innerHeight - rect.bottom - 20) + 'px';
                dropdown.style.display = 'block';
            }
        });

        // 点击外部关闭
        document.addEventListener('click', function(e) {
            if (!dropdown.contains(e.target) && e.target !== btnHistory) {
                dropdown.style.display = 'none';
            }
        });

        document.getElementById('history-list').addEventListener('click', function(e) {
            var delBtn = e.target.closest('.history-item-delete');
            if (delBtn) { e.stopPropagation(); remove(delBtn.dataset.delete); return; }
            var item = e.target.closest('.history-item');
            if (!item) return;
            var id = item.dataset.id;
            var entry = _entries.find(function(en) { return en.id === id; });
            if (!entry) return;
            if (entry.output) {
                showOutput(entry.output, entry.formatName, item);
            } else {
                authFetch('/api/history/' + encodeURIComponent(id))
                    .then(function(r) { return r.text(); })
                    .then(function(text) {
                        entry.output = text;
                        showOutput(text, entry.formatName, item);
                    })
                    .catch(function(err) { console.error('读取记录失败:', err); });
            }
            // 点击后关闭下拉
            dropdown.style.display = 'none';
        });

        // 绑定首页卡片的点击联动与删除联动
        var homeGrid = document.getElementById('home-recent-grid');
        if (homeGrid) {
            homeGrid.addEventListener('click', function(e) {
                var delBtn = e.target.closest('.proj-btn-delete');
                if (delBtn) {
                    e.stopPropagation();
                    if (confirm('确认删除此创作记录吗？')) {
                        remove(delBtn.dataset.delete);
                    }
                    return;
                }
                var card = e.target.closest('.recent-project-card');
                if (!card) return;
                var id = card.dataset.id;
                
                // 联动触发历史记录中对应项目的加载逻辑
                var historyItem = document.querySelector('#history-list .history-item[data-id="' + id + '"]');
                var entry = _entries.find(function(en) { return en.id === id; });
                if (!entry) return;

                if (entry.output) {
                    showOutput(entry.output, entry.formatName, historyItem);
                } else {
                    authFetch('/api/history/' + encodeURIComponent(id))
                        .then(function(r) { return r.text(); })
                        .then(function(text) {
                            entry.output = text;
                            showOutput(text, entry.formatName, historyItem);
                        })
                        .catch(function(err) { console.error('读取记录失败:', err); });
                }
                
                // 自动导航跳转至剧本生成（Page: Script）
                var scriptNav = document.querySelector('.nav-item[data-page="script"]');
                if (scriptNav) scriptNav.click();
            });
        }

        document.getElementById('history-clear').addEventListener('click', function() {
            if (confirm('确定清空所有生成记录？')) clearAll();
        });

        function showOutput(text, formatName, item) {
            var outputArea = document.getElementById('output-area');
            outputArea.innerHTML = '';
            var div = document.createElement('div');
            div.style.whiteSpace = 'pre-wrap';
            div.style.lineHeight = '1.8';
            div.textContent = text;
            outputArea.appendChild(div);
            document.querySelectorAll('#history-list .history-item').forEach(function(el) { el.classList.remove('active'); });
            if (item) item.classList.add('active');
            ScriptGenerator.setHistoryOutput(text);
            ScriptGenerator.showActionButtons();
            var modeName = document.getElementById('canvas-mode-name');
            if (modeName) modeName.textContent = formatName;
        }

        // 初始加载
        loadFromServer().then(function() { renderList(); });
    }

    // DOM 就绪后再初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { save: save, remove: remove, clearAll: clearAll, getAll: getAll, renderList: renderList };
})();

// ============================================================
// 模块：剧本生成与输出
// ============================================================

const ScriptGenerator = (function() {
    let currentFormat = 'shortdrama';
    let outputs = { screenplay: '', storyboard: '', shortdrama: '' };
    let currentNovelText = '';
    let currentMode = 'continuous';
    let _historyOutput = '';

    function getCurrentFormat() { return currentFormat; }
    function setCurrentFormat(f) { currentFormat = f; }
    function getCurrentOutput() { return _historyOutput || outputs[currentFormat] || ''; }
    function setHistoryOutput(text) { _historyOutput = text; }
    function hasOutput(format) { return !!outputs[format]; }
    function getCurrentNovelText() { return currentNovelText; }
    function setCurrentNovelText(t) { currentNovelText = t; }

    function getMode() { return currentMode; }
    function setMode(mode) {
        currentMode = mode;
        var labels = document.querySelectorAll('#mode-switch .mode-switch-label');
        var slider = document.querySelector('#mode-switch .mode-switch-slider');
        labels.forEach(function(l) {
            l.classList.toggle('active', l.dataset.mode === mode);
        });
        if (slider) {
            slider.className = 'mode-switch-slider ' + (mode === 'hook' ? 'right' : 'left');
        }
    }

    async function generate(novelText, format, duration) {
        duration = duration || '10s';
        setCurrentNovelText(novelText);
        currentFormat = format;
        outputs[format] = '';
        _historyOutput = '';

        // 清空输出区，准备流式写入
        const outputArea = document.getElementById('output-area');
        outputArea.innerHTML = '';
        const contentDiv = document.createElement('div');
        contentDiv.style.whiteSpace = 'pre-wrap';
        contentDiv.style.lineHeight = '1.8';
        outputArea.appendChild(contentDiv);

        const data = Extraction.getData();
        const charsJson = JSON.stringify(data.characters, null, 2);
        const scenesJson = JSON.stringify(data.scenes, null, 2);
        const messages = await PromptTemplates.scriptPrompt(currentMode, novelText, charsJson, scenesJson, format, duration);
        const response = await AIClient.callStream(messages, (chunk) => {
            contentDiv.textContent += chunk;
            outputArea.scrollTop = outputArea.scrollHeight;
        }, { maxTokens: 8192, temperature: 0.7 });
        outputs[format] = response;
        _historyOutput = '';
        showActionButtons();

        // 自动保存到历史记录
        var fNames = { screenplay: '剧情模式', storyboard: '画布模式', shortdrama: '剧本模式', q版: 'Q版模式' };
        History.save({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            format: format,
            formatName: fNames[format] || '剧本模式',
            mode: currentMode,
            duration: duration,
            output: response,
            createdAt: new Date().toISOString()
        });

        return response;
    }

    function switchToFormat(format) {
        currentFormat = format;
        var outputArea = document.getElementById('output-area');
        outputArea.innerHTML = '';

        var fNames = { screenplay: '剧情模式', storyboard: '画布模式', shortdrama: '剧本模式', q版: 'Q版模式' };

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

    function showActionButtons() {
        document.getElementById('btn-regenerate').style.display = '';
        document.getElementById('btn-copy').style.display = '';
        document.getElementById('btn-export').style.display = '';
        // Canvas toolbar
        var canvasActions = document.querySelector('.canvas-actions');
        var btnDuration = document.getElementById('canvas-btn-duration');
        var currentFmt = currentFormat;
        if (canvasActions) canvasActions.style.display = 'flex';
        if (btnDuration) btnDuration.style.display = (currentFmt === 'screenplay' || currentFmt === 'storyboard') ? '' : 'none';
        // 同步 duration-toggle
        StoryDuration.updateUI();
    }

    function hideActionButtons() {
        document.getElementById('btn-regenerate').style.display = 'none';
        document.getElementById('btn-copy').style.display = 'none';
        document.getElementById('btn-export').style.display = 'none';
        var canvasActions = document.querySelector('.canvas-actions');
        if (canvasActions) canvasActions.style.display = 'none';
    }

    function clearOutputs() {
        outputs = { screenplay: '', storyboard: '', shortdrama: '' };
    }

    return { generate: generate, getCurrentFormat: getCurrentFormat, setCurrentFormat: setCurrentFormat, getCurrentOutput: getCurrentOutput, getCurrentNovelText: getCurrentNovelText, setCurrentNovelText: setCurrentNovelText, getMode: getMode, setMode: setMode, showActionButtons: showActionButtons, hideActionButtons: hideActionButtons, switchToFormat: switchToFormat, hasOutput: hasOutput, clearOutputs: clearOutputs, setHistoryOutput: setHistoryOutput };
})();

// ============================================================
// 模块：格式切换（统一通过 switchToFormat）
// ============================================================

(function() {
    document.querySelectorAll('#format-tabs .format-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
            var newFormat = tab.dataset.format;
            if (newFormat === ScriptGenerator.getCurrentFormat()) return;
            ScriptGenerator.switchToFormat(newFormat);
        });
    });
})();

// ============================================================
// 模块：复制和导出
// ============================================================

(function() {
    var btnCopy = document.getElementById('btn-copy');
    if (btnCopy) {
        btnCopy.addEventListener('click', async () => {
            const text = ScriptGenerator.getCurrentOutput();
            if (!text) { showToast('还没生成内容呢，先去点"一键生成"吧~', 'warning'); return; }
            try {
                await navigator.clipboard.writeText(text);
                showToast('复制成功，快去粘贴吧~', 'success');
            } catch (e) {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                showToast('复制成功，快去粘贴吧~', 'success');
            }
        });
    }

    var btnExport = document.getElementById('btn-export');
    if (btnExport) {
        btnExport.addEventListener('click', () => {
        const text = ScriptGenerator.getCurrentOutput();
        if (!text) return;
        const names = { screenplay: '剧情模式', storyboard: '画布模式', shortdrama: '剧本模式', q版: 'Q版模式' };
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
    }
})();

// ============================================================
// 模块：两步生成流水线（第1步：提取人物+场景 / 第2步：选择模式生成）
// ============================================================

(function() {
    const btnGenerate = document.getElementById('btn-generate');
    const novelInput = document.getElementById('novel-input');
    const loadingStatus = document.getElementById('loading-status');
    const progressBar = document.getElementById('progress-bar');
    const step1El = document.getElementById('step1');
    const step2El = document.getElementById('step2');

    function setLoading(msg) {
        loadingStatus.style.display = 'flex';
        loadingStatus.innerHTML = '<div class="spinner"></div><span>' + msg + '</span>';
    }

    function clearLoading() {
        loadingStatus.style.display = 'none';
        loadingStatus.innerHTML = '';
    }

    function setProgress(step) {
        progressBar.style.display = 'flex';
        step1El.className = 'step1 step';
        step2El.className = 'step2 step';
        if (step >= 1) step1El.className = 'step1 step done';
        if (step >= 2) step2El.className = 'step2 step done';
        if (step === 1.5) step2El.className = 'step2 step active';
    }

    function hideProgress() {
        progressBar.style.display = 'none';
    }

    function resetUI() {
        const outputArea = document.getElementById('output-area');
        outputArea.innerHTML = '<div class="empty-state"><div class="empty-icon">📄</div><div class="empty-text">粘贴小说后点击"提取人物与场景"</div><div class="empty-sub">提取完成后可选择生成模式</div></div>';
        ScriptGenerator.hideActionButtons();
        document.getElementById('char-section').style.display = 'none';
        document.getElementById('scene-section').style.display = 'none';
        document.getElementById('gen-controls').style.display = 'none';
        hideProgress();
    }

    btnGenerate.addEventListener('click', async () => {
        const novelText = novelInput.value.trim();
        if (!novelText) {
            showToast('先粘贴小说内容再点我哦~', 'error');
            return;
        }

        btnGenerate.disabled = true;
        btnGenerate.textContent = '处理中...';
        hideProgress();

        try {
            // 第1步：仅提取人物和场景（流式输出）
            setLoading('正在挖掘小说里的人物和场景...');
            var outputArea = document.getElementById('output-area');
            outputArea.innerHTML = '<div class="extract-stream" id="extract-stream" style="max-height:300px;overflow-y:auto;padding:16px;background:var(--bg-card);border-radius:var(--radius);font-size:13px;line-height:1.7;color:var(--text-secondary);white-space:pre-wrap;word-break:break-word;"></div>';
            var streamEl = document.getElementById('extract-stream');
            const data = await Extraction.extract(novelText, function(chunk, fullText) {
                if (streamEl) streamEl.textContent = fullText;
            });
            Extraction.renderCards(data);
            // 保存小说文本，供后续生成使用
            ScriptGenerator.setCurrentNovelText(novelText);
            setProgress(1);
            progressBar.style.display = 'flex';

            clearLoading();
            // 清空之前的剧本输出，显示工具栏生成按钮
            ScriptGenerator.clearOutputs();
            ScriptGenerator.hideActionButtons();
            document.getElementById('gen-controls').style.display = 'flex';
            outputArea.innerHTML = '<div class="empty-state"><div class="empty-icon">🎯</div><div class="empty-text">人物与场景提取完成</div><div class="empty-sub">选好格式后点击"一键生成"</div></div>';
            showToast('人物和场景提取好啦，选个模式一键生成吧！', 'success');
            btnGenerate.textContent = '🔄 重新提取';
        } catch (e) {
            clearLoading();
            showToast('哎呀，人物提取出了点小状况，再试试？', 'error');
            console.error(e);
        } finally {
            btnGenerate.disabled = false;
        }
    });
})();

// ============================================================
// 模块：重新生成（人物 / 场景 / 剧本各自独立）
// ============================================================

(function() {
    function setLoading(msg) {
        var loadingStatus = document.getElementById('loading-status');
        loadingStatus.style.display = 'flex';
        loadingStatus.innerHTML = '<div class="spinner"></div><span>' + msg + '</span>';
    }
    function clearLoading() {
        var loadingStatus = document.getElementById('loading-status');
        loadingStatus.style.display = 'none';
        loadingStatus.innerHTML = '';
    }

    // --- 仅重新提取人物+场景 ---
    var btnRegenChars = document.getElementById('btn-regen-chars');
    var btnRegenScenes = document.getElementById('btn-regen-scenes');

    async function reExtract() {
        var novelText = ScriptGenerator.getCurrentNovelText();
        if (!novelText) { showToast('先粘贴小说内容再点我哦~', 'warning'); return; }
        setLoading('正在挖掘小说里的人物和场景...');
        try {
            var data = await Extraction.extract(novelText, null);
            Extraction.renderCards(data);
            showToast('人物和场景已更新', 'success');
        } catch (e) { showToast('哎呀，人物提取出了点小状况，再试试？', 'error'); }
        finally { clearLoading(); }
    }

    if (btnRegenChars) btnRegenChars.addEventListener('click', reExtract);
    if (btnRegenScenes) btnRegenScenes.addEventListener('click', reExtract);

    // --- 重新生成当前格式剧本 ---
    var btnRegen = document.getElementById('btn-regenerate');
    if (btnRegen) {
        btnRegen.addEventListener('click', async function() {
            var novelText = ScriptGenerator.getCurrentNovelText();
            if (!novelText) { showToast('先粘贴小说内容再点我哦~', 'warning'); return; }
            var fmt = ScriptGenerator.getCurrentFormat();
            setLoading('正在施展魔法，剧本即将出现...');
            try {
                await ScriptGenerator.generate(novelText, fmt, StoryDuration.get());
                showToast('剧本已重新出炉！', 'success');
            } catch (e) { showToast('啊哦，网络悄悄跑到外星球去了~', 'error'); }
            finally { clearLoading(); }
        });
    }
})();

// ============================================================
// 模块：一键生成按钮
// ============================================================

(function() {
    var btnExec = document.getElementById('btn-exec-generate');
    var genFormatSelect = document.getElementById('gen-format-select');
    var loadingStatus = document.getElementById('loading-status');
    var fNames = { screenplay: '剧情模式', storyboard: '画布模式', shortdrama: '剧本模式', q版: 'Q版模式' };

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
        if (!novelText) { showToast('先提取人物与场景再生成哦~', 'warning'); return; }

        btnExec.disabled = true;
        btnExec.textContent = '魔法吟唱中...';

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

// ============================================================
// 面板拖拽
// ============================================================
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

// ============================================================
// 模块：10s/15s 时长管理
// ============================================================
var StoryDuration = (function() {
    var duration = '10s';
    
    function get() { return duration; }
    function set(d) { duration = d; updateUI(); }
    
    function updateUI() {
        var toggle = document.getElementById('duration-toggle');
        if (!toggle) return;
        
        var currentFormat = ScriptGenerator.getCurrentFormat();
        var showDuration = currentFormat === 'screenplay' || currentFormat === 'storyboard';
        toggle.style.display = showDuration ? 'flex' : 'none';
        
        var btns = toggle.querySelectorAll('.duration-btn');
        btns.forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.dur === duration);
        });
    }
    
    return { get: get, set: set, updateUI: updateUI };
})();

// 时长切换按钮点击
(function() {
    var toggle = document.getElementById('duration-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', function(e) {
        var btn = e.target.closest('.duration-btn');
        if (!btn) return;
        StoryDuration.set(btn.dataset.dur);
    });
})();

// 模式开关点击（点击整体切换）
(function() {
    var sw = document.getElementById('mode-switch');
    if (!sw) return;
    sw.addEventListener('click', function() {
        var current = ScriptGenerator.getMode();
        var next = current === 'hook' ? 'continuous' : 'hook';
        ScriptGenerator.setMode(next);
    });
})();

// ============================================================
// 模块：工具栏按钮
// ============================================================
(function() {
    // 工具栏时长按钮切换
    var btnDuration = document.getElementById('canvas-btn-duration');
    if (btnDuration) {
        btnDuration.addEventListener('click', function() {
            StoryDuration.set(StoryDuration.get() === '10s' ? '15s' : '10s');
        });
    }
    
    // 工具栏复制按钮
    var btnCopy = document.getElementById('canvas-btn-copy');
    if (btnCopy) {
        btnCopy.addEventListener('click', function() {
            var text = ScriptGenerator.getCurrentOutput();
            if (!text) { showToast('还没生成内容呢，先去点"一键生成"吧~', 'warning'); return; }
            navigator.clipboard.writeText(text).then(function() {
                showToast('复制成功，快去粘贴吧~', 'success');
            }).catch(function() {
                var ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                showToast('复制成功，快去粘贴吧~', 'success');
            });
        });
    }
    
    // 工具栏导出按钮
    var btnExport = document.getElementById('canvas-btn-export');
    if (btnExport) {
        btnExport.addEventListener('click', function() {
            document.getElementById('btn-export').click();
        });
    }
    
    // 工具栏重新生成按钮
    var btnRegen = document.getElementById('canvas-btn-regenerate');
    if (btnRegen) {
        btnRegen.addEventListener('click', function() {
            document.getElementById('btn-regenerate').click();
        });
    }

    // 工具栏全屏按钮
    var btnFullscreen = document.getElementById('canvas-btn-fullscreen');
    if (btnFullscreen) {
        btnFullscreen.addEventListener('click', function() {
            var canvas = document.querySelector('.right-panel');
            if (canvas) {
                if (canvas.requestFullscreen) { canvas.requestFullscreen(); }
                else if (canvas.webkitRequestFullscreen) { canvas.webkitRequestFullscreen(); }
            }
        });
    }
})();
