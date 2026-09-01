const bridge = window.yiZhanExecutor;
const ui = window.YiZhanUiState;

const elements = {
  pairForm: document.getElementById('pairForm'),
  baseUrl: document.getElementById('baseUrl'),
  pairCode: document.getElementById('pairCode'),
  pairButton: document.getElementById('pairButton'),
  pairBadge: document.getElementById('pairBadge'),
  pairDetail: document.getElementById('pairDetail'),
  addAccount: document.getElementById('addAccount'),
  accountList: document.getElementById('accountList'),
  accountEmpty: document.getElementById('accountEmpty'),
  automationText: document.getElementById('automationText'),
  currentTask: document.getElementById('currentTask'),
  globalError: document.getElementById('globalError')
};

function showError(message) {
  elements.globalError.hidden = !message;
  elements.globalError.textContent = message || '';
}

function render(state) {
  const pairing = state?.pairing || { paired: false };
  elements.pairBadge.textContent = ui.pairingStatusText(pairing);
  elements.pairBadge.dataset.state = pairing.paired ? 'ok' : 'idle';
  elements.pairDetail.textContent = pairing.paired
    ? `已绑定：${pairing.baseUrl} · ${pairing.executorId}`
    : '当前未绑定。';
  if (pairing.baseUrl && !elements.baseUrl.value) elements.baseUrl.value = pairing.baseUrl;

  const accounts = Array.isArray(state?.accounts) ? state.accounts : [];
  elements.accountEmpty.hidden = accounts.length > 0;
  elements.accountList.replaceChildren(...accounts.map(renderAccount));

  elements.automationText.textContent = state?.automation?.reason || '真实豆包网页接入完成前不可开启。';
  elements.currentTask.textContent = state?.currentTask?.id || '暂无';
  showError(state?.lastError || '');
}

function renderAccount(account) {
  const row = document.createElement('article');
  row.className = 'account-row';

  const info = document.createElement('div');
  info.className = 'account-info';
  const name = document.createElement('strong');
  name.textContent = account.name || account.id;
  const status = document.createElement('span');
  status.className = 'account-status';
  status.dataset.state = account.state || 'unknown';
  status.textContent = ui.accountStatusText(account.state);
  info.append(name, status);

  const actions = document.createElement('div');
  actions.className = 'account-actions';
  const openButton = document.createElement('button');
  openButton.className = 'secondary';
  openButton.type = 'button';
  openButton.textContent = account.state === 'human_verification' ? '打开人工验证' : '打开豆包';
  openButton.setAttribute('aria-label', `打开 ${account.name || account.id}`);
  openButton.addEventListener('click', () => invoke(() => bridge.openAccount(account.id)));
  actions.append(openButton);

  if (account.state === 'auth_required') {
    const readyButton = document.createElement('button');
    readyButton.className = 'primary';
    readyButton.type = 'button';
    readyButton.textContent = '我已登录';
    readyButton.setAttribute('aria-label', `标记 ${account.name || account.id} 已登录`);
    readyButton.addEventListener('click', () => invoke(() => bridge.markAccountAvailable(account.id)));
    actions.append(readyButton);
  }

  row.append(info, actions);
  return row;
}

async function invoke(fn) {
  try {
    showError('');
    const result = await fn();
    if (result?.pairing || result?.accounts) render(result);
    else render(await bridge.getState());
    return result;
  } catch (error) {
    showError(error?.message || String(error));
    return null;
  }
}

elements.pairForm.addEventListener('submit', async event => {
  event.preventDefault();
  elements.pairButton.disabled = true;
  elements.pairButton.textContent = '绑定中…';
  await invoke(() => bridge.pair({
    baseUrl: elements.baseUrl.value.trim(),
    code: elements.pairCode.value.trim()
  }));
  elements.pairButton.disabled = false;
  elements.pairButton.textContent = '绑定';
});

elements.addAccount.addEventListener('click', () => invoke(() => bridge.addAccount()));

bridge.onState(render);
invoke(() => bridge.getState());
