// ============================================================
// TTS 页面逻辑
// ============================================================
(function() {
  const cardsContainer = document.getElementById('tts-cards');
  const btnAdd = document.getElementById('btn-add-card');
  const btnUpload = document.getElementById('btn-upload-novel');
  const btnGenerateAll = document.getElementById('btn-generate-all');
  const fileInput = document.getElementById('novel-file-input');

  const voices = [
    { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓 (女声·温柔)' },
    { value: 'zh-CN-YunxiNeural', label: '云希 (男声·清朗)' },
    { value: 'zh-CN-YunyangNeural', label: '云扬 (男声·阳光)' },
    { value: 'zh-CN-XiaoyiNeural', label: '晓伊 (女声·甜美)' },
    { value: 'zh-CN-YunjianNeural', label: '云健 (男声·稳重)' },
    { value: 'zh-CN-XiaochenNeural', label: '晓辰 (女声·知性)' },
    { value: 'zh-CN-XiaohanNeural', label: '晓涵 (女声·优雅)' },
    { value: 'zh-CN-XiaomengNeural', label: '晓梦 (女声·梦幻)' },
    { value: 'zh-CN-XiaomoNeural', label: '晓墨 (女声·文艺)' },
    { value: 'zh-CN-XiaoqiuNeural', label: '晓秋 (女声·成熟)' },
    { value: 'zh-CN-XiaoruiNeural', label: '晓睿 (女声·智慧)' },
    { value: 'zh-CN-XiaoshuangNeural', label: '晓双 (女声·活泼)' },
    { value: 'zh-CN-XiaoxuanNeural', label: '晓萱 (女声·清新)' },
    { value: 'zh-CN-XiaoyanNeural', label: '晓颜 (女声·柔美)' },
    { value: 'zh-CN-XiaoyouNeural', label: '晓悠 (女声·悠扬)' },
    { value: 'zh-CN-XiaozhenNeural', label: '晓甄 (女声·端庄)' },
    { value: 'zh-CN-YunfengNeural', label: '云枫 (男声·磁性)' },
    { value: 'zh-CN-YunhaoNeural', label: '云皓 (男声·豪迈)' },
    { value: 'zh-CN-YunxiaNeural', label: '云夏 (男声·热情)' },
    { value: 'zh-CN-YunyeNeural', label: '云野 (男声·野性)' },
    { value: 'zh-CN-YunzeNeural', label: '云泽 (男声·深沉)' }
  ];

  const styles = [
    { value: 'general', label: '通用' },
    { value: 'cheerful', label: '开心' },
    { value: 'sad', label: '悲伤' },
    { value: 'friendly', label: '友好' },
    { value: 'chat', label: '聊天' }
  ];

  let cardCounter = 0;
  const cards = new Map();

  function createVoiceOptions(selected) {
    return voices.map(v => '<option value="' + v.value + '"' + (v.value === selected ? ' selected' : '') + '>' + v.label + '</option>').join('');
  }

  function createStyleOptions(selected) {
    return styles.map(s => '<option value="' + s.value + '"' + (s.value === selected ? ' selected' : '') + '>' + s.label + '</option>').join('');
  }

  function updateStats(textarea, statsEl) {
    const text = textarea.value;
    const total = text.length;
    const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const letters = (text.match(/[a-zA-Z]/g) || []).length;
    statsEl.innerHTML = '总计: <span>' + total + '</span> 汉字: <span>' + chinese + '</span> 字母: <span>' + letters + '</span>';
  }

  function addCard(text) {
    cardCounter++;
    const id = 'tts-card-' + cardCounter;
    const card = document.createElement('div');
    card.className = 'tts-card';
    card.id = id;
    card.dataset.id = String(cardCounter);

    card.innerHTML =
      '<div class="tts-card-header">' +
        '<div class="tts-card-title">' +
          '<span class="tts-card-number">' + cardCounter + '</span>' +
          '<span>配音卡片</span>' +
        '</div>' +
        '<div class="tts-card-actions">' +
          '<button class="tts-card-btn btn-drag" title="拖拽排序" type="button">⋮⋮</button>' +
          '<button class="tts-card-btn btn-delete" title="删除卡片" type="button">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="tts-card-body">' +
        '<textarea class="tts-textarea" placeholder="在此输入要转换的文本...">' + escapeHtml(text || '') + '</textarea>' +
        '<div class="tts-stats">总计: <span>0</span> 汉字: <span>0</span> 字母: <span>0</span></div>' +
        '<div class="tts-params">' +
          '<div class="tts-param full-width">' +
            '<label class="tts-param-label">语音选择</label>' +
            '<select class="tts-voice">' + createVoiceOptions('zh-CN-XiaoxiaoNeural') + '</select>' +
          '</div>' +
          '<div class="tts-param">' +
            '<label class="tts-param-label">说话风格</label>' +
            '<select class="tts-style">' + createStyleOptions('general') + '</select>' +
          '</div>' +
          '<div class="tts-param">' +
            '<label class="tts-param-label">语速</label>' +
            '<div class="tts-slider-row">' +
              '<input type="range" class="tts-speed-slider" min="0.5" max="2" step="0.1" value="1">' +
              '<input type="number" class="tts-speed-input" min="0.5" max="2" step="0.1" value="1">' +
            '</div>' +
          '</div>' +
          '<div class="tts-param">' +
            '<label class="tts-param-label">音调</label>' +
            '<div class="tts-slider-row">' +
              '<input type="range" class="tts-pitch-slider" min="-50" max="50" step="1" value="0">' +
              '<input type="number" class="tts-pitch-input" min="-50" max="50" step="1" value="0">' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="tts-card-footer">' +
        '<button class="btn btn-generate" type="button">🎵 生成语音</button>' +
        '<button class="btn btn-download" type="button" disabled>⬇️ 下载</button>' +
      '</div>' +
      '<div class="tts-status"></div>' +
      '<div class="tts-player">' +
        '<audio controls></audio>' +
      '</div>';

    cardsContainer.appendChild(card);

    const textarea = card.querySelector('.tts-textarea');
    const statsEl = card.querySelector('.tts-stats');
    const speedSlider = card.querySelector('.tts-speed-slider');
    const speedInput = card.querySelector('.tts-speed-input');
    const pitchSlider = card.querySelector('.tts-pitch-slider');
    const pitchInput = card.querySelector('.tts-pitch-input');
    const btnGenerate = card.querySelector('.btn-generate');
    const btnDownload = card.querySelector('.btn-download');
    const btnDelete = card.querySelector('.btn-delete');

    updateStats(textarea, statsEl);
    textarea.addEventListener('input', () => updateStats(textarea, statsEl));

    speedSlider.addEventListener('input', () => { speedInput.value = speedSlider.value; });
    speedInput.addEventListener('input', () => { speedSlider.value = speedInput.value; });
    pitchSlider.addEventListener('input', () => { pitchInput.value = pitchSlider.value; });
    pitchInput.addEventListener('input', () => { pitchSlider.value = pitchInput.value; });

    btnGenerate.addEventListener('click', () => generateCard(id));
    btnDownload.addEventListener('click', () => downloadCard(id));
    btnDelete.addEventListener('click', () => removeCard(id));

    setupDragAndDrop(card, textarea);

    cards.set(id, {
      id,
      element: card,
      audioUrl: null,
      audioBlob: null
    });

    updateEmptyState();
    return id;
  }

  function removeCard(id) {
    const card = cards.get(id);
    if (!card) return;
    if (card.audioUrl) URL.revokeObjectURL(card.audioUrl);
    card.element.remove();
    cards.delete(id);
    updateEmptyState();
  }

  function updateEmptyState() {
    const emptyEl = cardsContainer.querySelector('.tts-empty');
    if (cards.size === 0) {
      if (!emptyEl) {
        cardsContainer.innerHTML =
          '<div class="tts-empty">' +
            '<div class="tts-empty-icon">🎙️</div>' +
            '<div class="tts-empty-text">还没有配音卡片</div>' +
            '<div class="tts-empty-sub">点击"添加卡片"输入文本，或上传小说自动提取开篇</div>' +
          '</div>';
      }
    } else if (emptyEl) {
      emptyEl.remove();
    }
  }

  function getCardData(id) {
    const card = document.getElementById(id);
    if (!card) return null;
    return {
      input: card.querySelector('.tts-textarea').value.trim(),
      voice: card.querySelector('.tts-voice').value,
      style: card.querySelector('.tts-style').value,
      speed: card.querySelector('.tts-speed-input').value,
      pitch: card.querySelector('.tts-pitch-input').value
    };
  }

  function setCardStatus(id, message) {
    const card = document.getElementById(id);
    if (!card) return;
    const statusEl = card.querySelector('.tts-status');
    statusEl.textContent = message;
    statusEl.classList.toggle('show', !!message);
  }

  async function generateCard(id) {
    const card = cards.get(id);
    if (!card) return;

    const data = getCardData(id);
    if (!data || !data.input) {
      showToast('请先输入要转换的文本', 'warning');
      return;
    }

    const btnGenerate = card.element.querySelector('.btn-generate');
    const btnDownload = card.element.querySelector('.btn-download');
    const player = card.element.querySelector('.tts-player');
    const audio = card.element.querySelector('audio');

    btnGenerate.disabled = true;
    btnGenerate.textContent = '生成中...';
    const statusEl = card.element.querySelector('.tts-status');
    statusEl.classList.remove('error');
    statusEl.textContent = '⏳ 正在生成语音...';
    statusEl.classList.add('show');
    player.classList.remove('show');
    btnDownload.disabled = true;
    audio.onerror = null;

    try {
      const response = await authFetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || '生成失败 (HTTP ' + response.status + ')');
      }

      const blob = await response.blob();
      if (blob.size === 0) {
        throw new Error('返回的音频文件为空');
      }
      if (card.audioUrl) URL.revokeObjectURL(card.audioUrl);
      const url = URL.createObjectURL(blob);
      card.audioUrl = url;
      card.audioBlob = blob;

      audio.onerror = () => {
        audio.onerror = null;
        player.classList.remove('show');
        btnDownload.disabled = true;
        const statusEl = card.element.querySelector('.tts-status');
        statusEl.textContent = '错误: 音频无法播放，返回内容可能不是有效音频';
        statusEl.classList.add('show', 'error');
        showToast('生成失败: 音频无法播放', 'error');
      };
      audio.onloadeddata = () => {
        audio.onerror = null;
      };
      audio.src = url;
      player.classList.add('show');
      btnDownload.disabled = false;
      setCardStatus(id, '');
      showToast('语音生成成功', 'success');
    } catch (err) {
      player.classList.remove('show');
      audio.src = '';
      audio.onerror = null;
      btnDownload.disabled = true;
      const statusEl = card.element.querySelector('.tts-status');
      statusEl.textContent = '错误: ' + err.message;
      statusEl.classList.add('show', 'error');
      showToast('生成失败: ' + err.message, 'error');
    } finally {
      btnGenerate.disabled = false;
      btnGenerate.textContent = '🎵 生成语音';
    }
  }

  function downloadCard(id) {
    const card = cards.get(id);
    if (!card || !card.audioBlob) return;
    const a = document.createElement('a');
    a.href = card.audioUrl;
    a.download = 'tts_' + card.id.replace('tts-card-', '') + '_' + new Date().toISOString().slice(0, 10) + '.mp3';
    a.click();
  }

  async function generateAll() {
    if (cards.size === 0) {
      showToast('先添加卡片再生成哦', 'warning');
      return;
    }
    for (const id of cards.keys()) {
      const data = getCardData(id);
      if (data && data.input) {
        await generateCard(id);
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function extractOpening(text) {
    const trimmed = text.trim();
    if (!trimmed) return '';

    // 按行检测章节/分段标记，取标记之前的文本作为开篇
    const patterns = [
      /^第\s*[一二三四五六七八九十百零0-9]+\s*[章话回节卷]/,
      /^Chapter\s*\d+/i,
      /^\d+\s*[、．.]\s*\S/,
      /^[一二三四五六七八九十]+\s*[、．.]\s*\S/,
      /^\d+$/,                  // 单独一行的数字，常见于 "1" 开始正文
      /^【?第[01]?\d[章话回节】]/
    ];

    const lines = trimmed.split(/\r?\n/);
    let cutIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (patterns.some(p => p.test(line))) {
        cutIndex = i;
        break;
      }
    }

    if (cutIndex > 0) {
      return lines.slice(0, cutIndex).join('\n').trim();
    }

    // 没有任何标记时，取前 1200 字符并在段落边界截断
    const maxLen = 1200;
    if (trimmed.length <= maxLen) return trimmed;
    const chunk = trimmed.slice(0, maxLen);
    const lastBreak = chunk.lastIndexOf('\n\n');
    if (lastBreak > 100) return chunk.slice(0, lastBreak).trim();
    const lastNewline = chunk.lastIndexOf('\n');
    if (lastNewline > 100) return chunk.slice(0, lastNewline).trim();
    return chunk.trim();
  }

  function handleNovelUpload(file) {
    if (!file) return;
    if (!file.name.endsWith('.txt')) {
      showToast('请上传 .txt 文本文件', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
      const text = e.target.result;
      const opening = extractOpening(text);
      if (!opening) {
        showToast('未能提取到开篇内容', 'warning');
        return;
      }
      const id = addCard(opening);
      const textarea = document.getElementById(id).querySelector('.tts-textarea');
      textarea.focus();
      showToast('已提取开篇内容到卡片', 'success');
    };
    reader.onerror = function() {
      showToast('文件读取失败', 'error');
    };
    reader.readAsText(file, 'UTF-8');
  }

  function setupDragAndDrop(card, textarea) {
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const droppedText = e.dataTransfer.getData('text/plain');
      if (droppedText) {
        textarea.value = textarea.value ? textarea.value + '\n' + droppedText : droppedText;
        textarea.dispatchEvent(new Event('input'));
      }
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        handleNovelUpload(files[0]);
      }
    });
  }

  btnAdd.addEventListener('click', () => {
    addCard('');
    const lastCard = cardsContainer.querySelector('.tts-card:last-child');
    if (lastCard) {
      lastCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      lastCard.querySelector('.tts-textarea').focus();
    }
  });

  btnUpload.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    handleNovelUpload(e.target.files[0]);
    fileInput.value = '';
  });

  btnGenerateAll.addEventListener('click', generateAll);

  // 初始添加一个空卡片
  addCard('');
})();
