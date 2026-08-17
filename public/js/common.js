// ============================================================
// 鉴权辅助：所有 API 请求自动携带 Bearer token
// ============================================================
function authFetch(url, options) {
  options = options || {};
  options.headers = options.headers || {};
  var token = localStorage.getItem('auth_token');
  if (token) {
    options.headers['Authorization'] = 'Bearer ' + token;
  }
  return fetch(url, options);
}

// ============================================================
// 模块：主题切换
// ============================================================

(function() {
    const html = document.documentElement;
    const toggle = document.getElementById('theme-toggle');
    const icon = document.getElementById('theme-icon');

    const saved = localStorage.getItem('theme') || 'dark';
    html.setAttribute('data-theme', saved);
    if (icon) icon.textContent = saved === 'dark' ? '🌙' : '☀️';

    if (toggle) {
        toggle.addEventListener('click', () => {
            const current = html.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', next);
            if (icon) icon.textContent = next === 'dark' ? '🌙' : '☀️';
            localStorage.setItem('theme', next);
        });
    }
})();

// ============================================================
// 模块：前贴宠物（旧版 Agent 页面）
// ============================================================
(function() {
    if (document.body.dataset.activePage !== 'agent') return;

    var eventName = 'qiantie:pet-state';
    var stateRows = { idle: 0, working: 7, success: 3, error: 5 };
    var pet = document.createElement('div');
    pet.className = 'stacky-pet-legacy';
    pet.setAttribute('role', 'img');
    pet.setAttribute('aria-label', '前贴宠物 CM，空闲');

    function setState(state) {
        var nextState = Object.prototype.hasOwnProperty.call(stateRows, state) ? state : 'idle';
        pet.className = 'stacky-pet-legacy stacky-pet-legacy--' + nextState;
        pet.style.setProperty('--stacky-row', stateRows[nextState]);
        pet.setAttribute('aria-label', '前贴宠物 CM，' + ({ idle: '空闲', working: '生成中', success: '完成', error: '失败' }[nextState]));
    }

    window.addEventListener(eventName, function(event) {
        setState(event.detail && event.detail.state);
    });
    setState('idle');
    document.body.appendChild(pet);
})();

// ============================================================
// 模块：导航与页面路由
// ============================================================

(function() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('nav-toggle');

    if (!sidebar) return;

    // 导航收起/展开
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    // 移动端汉堡菜单
    const topbar = document.getElementById('topbar');
    const mobileOverlay = document.getElementById('mobile-overlay');
    if (topbar) {
        topbar.addEventListener('click', (e) => {
            if (e.target === topbar && window.innerWidth < 768) {
                sidebar.classList.add('mobile-open');
                if (mobileOverlay) mobileOverlay.classList.add('visible');
            }
        });
    }
    if (mobileOverlay) {
        mobileOverlay.addEventListener('click', () => {
            sidebar.classList.remove('mobile-open');
            mobileOverlay.classList.remove('visible');
        });
    }

    // 真实多页面跳转：任何带 data-href 的元素都可以作为入口
    document.addEventListener('click', function(e) {
        const target = e.target.closest('[data-href]');
        if (!target) return;
        const href = target.dataset.href;
        if (!href) return;
        if (target.tagName === 'A') return;
        e.preventDefault();
        window.location.href = href;
    });
})();

// ============================================================
// 模块：生成记录下拉框
// ============================================================
(function() {
    var btnHistory = document.getElementById('btn-open-history');
    var dropdown = document.getElementById('history-dropdown');
    if (!btnHistory || !dropdown) return;

    function closeDropdown() {
        dropdown.style.display = 'none';
    }

    function openDropdown() {
        var rect = btnHistory.getBoundingClientRect();
        document.body.appendChild(dropdown);
        dropdown.style.position = 'fixed';
        dropdown.style.top = (rect.bottom + 4) + 'px';
        dropdown.style.left = Math.min(rect.left, window.innerWidth - 340) + 'px';
        dropdown.style.right = 'auto';
        dropdown.style.width = '320px';
        dropdown.style.maxHeight = (window.innerHeight - rect.bottom - 20) + 'px';
        dropdown.style.display = 'flex';
    }

    btnHistory.addEventListener('click', function(e) {
        e.stopPropagation();
        if (dropdown.style.display === 'flex' || dropdown.style.display === 'block') {
            closeDropdown();
            return;
        }
        openDropdown();
    });

    document.addEventListener('click', function(e) {
        if (!dropdown.contains(e.target) && e.target !== btnHistory) {
            closeDropdown();
        }
    });
})();

// ============================================================
// 模块：API 设置
// ============================================================

const ApiConfig = (function() {
    const API_BASE = '';
    const defaultPet = {
        id: 'stacky',
        displayName: 'CM',
        description: 'CM，前贴的桌面宠物。',
        spriteVersionNumber: 2,
        spritesheetPath: '/pets/stacky/spritesheet.webp'
    };
    const providerDefaults = {
        openai:   { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
        qwen:     { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
        claude:   { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-20241022' },
        custom:   { baseUrl: '', model: '' }
    };

    async function get() {
        const resp = await authFetch(API_BASE + '/api/config');
        if (!resp.ok) throw new Error('获取配置失败 (HTTP ' + resp.status + ')');
        return resp.json();
    }

    async function save(cfg) {
        const resp = await authFetch(API_BASE + '/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cfg)
        });
        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            throw new Error(errData.error || '保存配置失败 (HTTP ' + resp.status + ')');
        }
    }

    async function testConnection(cfg) {
        const resp = await authFetch(API_BASE + '/api/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cfg)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.ok) {
            throw new Error(data.error || '测试连接失败 (HTTP ' + resp.status + ')');
        }
        return true;
    }

    return { get, save, testConnection, providerDefaults, defaultPet };
})();

// ============================================================
// 模块：设置 UI 交互
// ============================================================

(function() {
    const modal = document.getElementById('settings-modal');
    const btnOpen = document.querySelector('.btn-open-settings');
    const btnClose = document.getElementById('btn-close-settings');
    const btnSave = document.getElementById('btn-save-settings');
    const btnTest = document.getElementById('btn-test-connection');
    const providerSelect = document.getElementById('settings-provider');
    const apiKeyInput = document.getElementById('settings-apikey');
    const baseUrlInput = document.getElementById('settings-baseurl');
    const modelInput = document.getElementById('settings-model');
    const testResult = document.getElementById('test-result');

    if (!modal || !btnOpen || !btnClose || !btnSave || !btnTest || !providerSelect || !apiKeyInput || !baseUrlInput || !modelInput || !testResult) return;

    let backendHasKey = false;

    function ensurePetSettings() {
        if (document.getElementById('settings-pet')) return;
        const group = document.createElement('div');
        group.className = 'form-group pet-settings-group';
        group.innerHTML = [
            '<label class="form-label" for="settings-pet">前贴宠物</label>',
            '<select id="settings-pet" class="form-select">',
            '<option value="stacky">CM</option>',
            '</select>',
            '<div class="pet-preview">',
            '<div class="pet-preview-frame"><img src="' + ApiConfig.defaultPet.spritesheetPath + '" alt="CM"></div>',
            '<div><strong>CM</strong><p>' + ApiConfig.defaultPet.description + '</p></div>',
            '</div>'
        ].join('');
        testResult.parentNode.insertBefore(group, testResult);
    }

    btnOpen.addEventListener('click', async () => {
        // 先打开弹窗
        modal.classList.add('visible');
        ensurePetSettings();
        testResult.className = 'test-result';
        testResult.textContent = '';
        try {
            const cfg = await ApiConfig.get();
            providerSelect.value = cfg.provider || 'custom';
            baseUrlInput.value = cfg.baseUrl || '';
            modelInput.value = cfg.model || '';
            const petSelect = document.getElementById('settings-pet');
            if (petSelect) petSelect.value = cfg.pet && cfg.pet.id === 'stacky' ? 'stacky' : 'stacky';
            backendHasKey = cfg.hasApiKey;
            apiKeyInput.value = '';
            apiKeyInput.placeholder = cfg.hasApiKey ? '已保存，留空则不修改' : '输入你的 API Key';
        } catch (e) {
            // 加载失败也不影响弹窗，用默认值
            providerSelect.value = 'custom';
            baseUrlInput.value = '';
            modelInput.value = '';
            apiKeyInput.value = '';
            apiKeyInput.placeholder = '输入你的 API Key';
            showToast('获取配置失败，请检查后端是否启动', 'warning');
        }
    });

    btnClose.addEventListener('click', () => { modal.classList.remove('visible'); });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('visible'); });

    providerSelect.addEventListener('change', () => {
        const defaults = ApiConfig.providerDefaults[providerSelect.value];
        if (defaults && defaults.baseUrl) baseUrlInput.value = defaults.baseUrl;
        if (defaults && defaults.model) modelInput.value = defaults.model;
        if (providerSelect.value === 'custom') { baseUrlInput.value = ''; modelInput.value = ''; }
    });

    btnSave.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
            const cfg = {
                provider: providerSelect.value,
                baseUrl: baseUrlInput.value.trim(),
                model: modelInput.value.trim(),
                pet: ApiConfig.defaultPet
            };
        if (apiKey) {
            cfg.apiKey = apiKey;
        } else if (!backendHasKey) {
            showToast('请输入 API Key', 'error');
            return;
        } else {
            cfg.apiKey = '';
        }
        if (!cfg.baseUrl) { showToast('请输入 Base URL', 'error'); return; }
        if (!cfg.model) { showToast('请输入模型名称', 'error'); return; }
        try {
            await ApiConfig.save(cfg);
            modal.classList.remove('visible');
            showToast('设置已保存', 'success');
        } catch (e) {
            showToast('保存出了点小状况：' + e.message, 'error');
        }
    });

    btnTest.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        const cfg = {
            provider: providerSelect.value,
            baseUrl: baseUrlInput.value.trim(),
            model: modelInput.value.trim(),
            pet: ApiConfig.defaultPet
        };
        if (apiKey) {
            cfg.apiKey = apiKey;
        } else if (!backendHasKey) {
            showToast('请先填写完整配置', 'error');
            return;
        } else {
            cfg.apiKey = '';
        }
        if (!cfg.baseUrl || !cfg.model) { showToast('请先填写完整配置', 'error'); return; }
        btnTest.disabled = true;
        btnTest.textContent = '测试中...';
        testResult.className = 'test-result';
        testResult.textContent = '';
        try {
            await ApiConfig.save(cfg);
            await ApiConfig.testConnection(cfg);
            testResult.className = 'test-result success';
            testResult.textContent = '✓ 连接成功！';
            showToast('连接成功！', 'success');
        } catch (e) {
            testResult.className = 'test-result error';
            testResult.textContent = '✗ 连接失败：' + e.message;
            showToast('连接失败：' + e.message, 'error');
        } finally {
            btnTest.disabled = false;
            btnTest.textContent = '🔌 测试连接';
        }
    });
})();

// ============================================================
// 工具：Toast 提示
// ============================================================

function showToast(message, type) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    // 优先使用 #toast-container 居中定位（避免被 body flex 布局推到右侧）
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type || '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3000);
}

// ============================================================
// 模块：登录系统
// ============================================================
(function() {
    var loginOverlay = document.getElementById('login-overlay');
    var btnLogin = document.getElementById('btn-login');
    var inputUser = document.getElementById('login-username');
    var inputPass = document.getElementById('login-password');
    var loginError = document.getElementById('login-error');
    var userDisplay = document.getElementById('login-user-display');
    var btnLogout = document.getElementById('btn-logout');

    if (!loginOverlay || !btnLogin || !inputUser || !inputPass || !loginError || !userDisplay || !btnLogout) return;

    function showLogin() {
        loginOverlay.classList.add('visible');
        inputUser.focus();
    }

    function hideLogin() {
        loginOverlay.classList.remove('visible');
        userDisplay.style.display = '';
        userDisplay.textContent = '👤 ' + (localStorage.getItem('auth_username') || '');
        btnLogout.style.display = '';
    }

    function showError(msg) {
        loginError.style.display = '';
        loginError.textContent = msg;
    }

    function hideError() {
        loginError.style.display = 'none';
    }

    btnLogin.addEventListener('click', async function() {
        var username = inputUser.value.trim();
        var password = inputPass.value;
        if (!username || !password) {
            showError('请输入账号和密码');
            return;
        }
        hideError();
        btnLogin.disabled = true;
        btnLogin.textContent = '登录中...';
        try {
            var resp = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username, password: password })
            });
            var data = await resp.json();
            if (!resp.ok) {
                showError(data.error || '登录失败');
                btnLogin.disabled = false;
                btnLogin.textContent = '登 录';
                return;
            }
            localStorage.setItem('auth_token', data.token);
            localStorage.setItem('auth_username', data.username);
            hideLogin();
        } catch (e) {
            showError('网络错误，请检查服务器连接');
            btnLogin.disabled = false;
            btnLogin.textContent = '登 录';
        }
    });

    inputPass.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') btnLogin.click();
    });

    btnLogout.addEventListener('click', function() {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_username');
        location.reload();
    });

    // 页面加载：验证已有 token
    (async function init() {
        var token = localStorage.getItem('auth_token');
        if (!token) {
            showLogin();
            return;
        }
        try {
            var resp = await authFetch('/api/config');
            if (!resp.ok) throw new Error('invalid');
            hideLogin();
        } catch (e) {
            localStorage.removeItem('auth_token');
            showLogin();
        }
    })();
})();
