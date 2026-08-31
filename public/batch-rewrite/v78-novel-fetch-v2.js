(() => {
  function enforceFixedPlatformUi() {
    const toggle = document.getElementById('fetchAutoDetectPlatform');
    if (!toggle) return;
    toggle.checked = false;
    toggle.disabled = true;
    const label = toggle.closest('label');
    if (label) label.hidden = true;

    const container = label?.parentElement || document.querySelector('.toggles');
    if (!container || document.getElementById('v78FixedPlatformNotice')) return;
    const notice = document.createElement('span');
    notice.id = 'v78FixedPlatformNotice';
    notice.className = 'form-hint';
    notice.textContent = 'V78：原文抓取固定使用当前选择的平台，不会自动切换到其他平台。';
    container.appendChild(notice);
  }

  function boot() {
    enforceFixedPlatformUi();
    let attempts = 0;
    const timer = window.setInterval(() => {
      enforceFixedPlatformUi();
      attempts += 1;
      if (attempts >= 20) window.clearInterval(timer);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
  window.addEventListener('load', enforceFixedPlatformUi, { once: true });
})();
