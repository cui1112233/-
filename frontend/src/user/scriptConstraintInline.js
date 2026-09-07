const CONSTRAINT_TITLE = '约束设置';
const SLOT_CLASS = 'script-constraint-inline-slot';
const ROOT_CLASS = 'script-constraint-inline-root';
const WRAP_CLASS = 'script-constraint-inline-wrap';
const MODAL_CLASS = 'script-constraint-inline-modal';

let installed = false;
let scheduled = false;
let lastWrap = null;
let lastRoot = null;
let lastModal = null;

function constraintButton() {
  return document.querySelector('.script-constraint-button');
}

function setButtonState(open) {
  const button = constraintButton();
  if (!button) return;
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  button.title = open ? '收起约束设置' : '约束设置';

  const textNode = Array.from(button.childNodes).find(node =>
    node.nodeType === Node.TEXT_NODE && /^(收起)?约束设置$/.test(String(node.textContent || '').trim())
  );
  if (textNode) textNode.textContent = open ? '收起约束设置' : '约束设置';
}

function findConstraintModal() {
  return Array.from(document.querySelectorAll('.ant-modal')).find(modal => {
    const title = modal.querySelector('.ant-modal-title');
    if (String(title?.textContent || '').trim() !== CONSTRAINT_TITLE) return false;
    const wrap = modal.closest('.ant-modal-wrap');
    if (!wrap) return false;
    const style = window.getComputedStyle(wrap);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }) || null;
}

function ensureSlot(right, toolbar) {
  let slot = right.querySelector(`:scope > .${SLOT_CLASS}`);
  if (!slot) {
    slot = document.createElement('div');
    slot.className = SLOT_CLASS;
    slot.setAttribute('aria-hidden', 'true');
    toolbar.insertAdjacentElement('afterend', slot);
  }
  return slot;
}

function clearInlineState() {
  document.querySelectorAll(`.${SLOT_CLASS}`).forEach(slot => {
    slot.classList.remove('is-open');
    slot.style.removeProperty('--script-constraint-inline-height');
  });

  if (lastWrap) {
    lastWrap.classList.remove(WRAP_CLASS);
    ['--script-constraint-inline-left', '--script-constraint-inline-top', '--script-constraint-inline-width', '--script-constraint-inline-height']
      .forEach(name => lastWrap.style.removeProperty(name));
  }
  if (lastRoot) lastRoot.classList.remove(ROOT_CLASS);
  if (lastModal) lastModal.classList.remove(MODAL_CLASS);

  lastWrap = null;
  lastRoot = null;
  lastModal = null;
  setButtonState(false);
}

function measureAndPlace(slot, wrap, modal) {
  const rect = slot.getBoundingClientRect();
  const content = modal.querySelector('.ant-modal-content');
  const available = Math.max(280, Math.min(620, window.innerHeight - rect.top - 18));
  const desired = Math.max(280, Math.min(available, Number(content?.scrollHeight || 520)));

  slot.style.setProperty('--script-constraint-inline-height', `${desired}px`);
  wrap.style.setProperty('--script-constraint-inline-left', `${Math.round(rect.left)}px`);
  wrap.style.setProperty('--script-constraint-inline-top', `${Math.round(rect.top)}px`);
  wrap.style.setProperty('--script-constraint-inline-width', `${Math.round(rect.width)}px`);
  wrap.style.setProperty('--script-constraint-inline-height', `${Math.round(desired)}px`);
}

function syncInlinePanel() {
  scheduled = false;
  const modal = findConstraintModal();
  const right = document.querySelector('.script-right');
  const toolbar = right?.querySelector('.script-toolbar');

  if (!modal || !right || !toolbar) {
    clearInlineState();
    return;
  }

  const wrap = modal.closest('.ant-modal-wrap');
  const root = wrap?.closest('.ant-modal-root') || wrap?.parentElement;
  if (!wrap || !root) {
    clearInlineState();
    return;
  }

  const slot = ensureSlot(right, toolbar);
  slot.classList.add('is-open');
  root.classList.add(ROOT_CLASS);
  wrap.classList.add(WRAP_CLASS);
  modal.classList.add(MODAL_CLASS);

  lastWrap = wrap;
  lastRoot = root;
  lastModal = modal;
  setButtonState(true);

  requestAnimationFrame(() => measureAndPlace(slot, wrap, modal));
}

function scheduleSync() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(syncInlinePanel);
}

function collapseFromToolbar(event) {
  const button = event.target?.closest?.('.script-constraint-button');
  if (!button) return;
  const modal = findConstraintModal();
  if (!modal) return;

  event.preventDefault();
  event.stopPropagation();
  modal.querySelector('.ant-modal-close')?.click();
  scheduleSync();
}

export function installScriptConstraintInlinePanel() {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('click', collapseFromToolbar, true);
  window.addEventListener('resize', scheduleSync);
  window.addEventListener('scroll', scheduleSync, true);
  scheduleSync();
}
