const form = document.querySelector('#pair-form');
const paired = document.querySelector('#paired');
const notice = document.querySelector('#notice');
const setNotice = (text, kind = '') => { notice.className = kind; notice.textContent = text; };
let activeJob = null;
let availableUpdate = null;
let latestState = null;

function showPage(page) {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === page));
  document.querySelectorAll('[data-page-panel]').forEach(item => item.classList.toggle('active', item.dataset.pagePanel === page));
}

async function refreshAccounts() {
  const accounts = await window.executor.accounts();
  const available = accounts.filter(account => !String(account.status || '').includes('受限')).length;
  document.querySelector('#account-total').textContent = `共 ${accounts.length} 个账号`;
  document.querySelector('#account-available').textContent = `可用：${available} 个`;
  document.querySelector('#status-accounts').textContent = `${accounts.length} 个`;
  document.querySelector('#account-list').innerHTML = accounts.map((account, index) => `<div class="account-row"><span class="account-index">#${index + 1}</span><span class="account-avatar">豆</span><div class="account-info"><b>${account.name}</b><span>本机浏览器会话 · ${account.status || '未检测'}</span></div><span class="account-status">${account.status || '未检测'}</span><button class="secondary remove-account" data-id="${account.id}">移除</button></div>`).join('') || '<div class="empty-state"><b>尚未添加豆包账号</b><span>添加后会打开登录窗口，账号凭证仅保存在这台电脑。</span></div>';
  document.querySelector('#job-account').innerHTML = accounts.map(account => `<option value="${account.id}">${account.name}</option>`).join('') || '<option value="">请先登录账号</option>';
  document.querySelectorAll('.remove-account').forEach(button => { button.onclick = async () => { await window.executor.removeAccount(button.dataset.id); await refreshAccounts(); setNotice('账号已从这台电脑移除。', 'success'); }; });
}

function renderJob(job) {
  activeJob = job || null;
  document.querySelector('#job-card').hidden = !activeJob;
  document.querySelector('#empty-job').hidden = Boolean(activeJob);
  if (!activeJob) return;
  document.querySelector('#job-title').textContent = `任务 ${activeJob.id}`;
  document.querySelector('#job-prompt').textContent = activeJob.prompt || '';
}

async function refresh() {
  const current = await window.executor.state();
  latestState = current;
  document.querySelector('#server-url').value = current.serverUrl || 'http://10.0.100.183:14000';
  document.querySelector('#display-name').value = current.displayName || '';
  paired.hidden = !current.paired;
  document.querySelector('#jobs').hidden = !current.paired;
  form.hidden = current.paired;
  document.querySelector('#online-pill').textContent = current.paired ? '● 已配对在线' : '● 未配对';
  document.querySelector('#online-pill').classList.toggle('online', current.paired);
  document.querySelector('#status-pairing').textContent = current.paired ? '已配对在线' : '未配对';
  document.querySelector('#status-version').textContent = current.version || '本地版本';
  if (current.paired) document.querySelector('#paired-name').textContent = `${current.displayName} · ${current.executorId}`;
  document.querySelector('#auto-submit').checked = current.autoSubmit !== false;
  await refreshAccounts();
  renderJob(current.activeJob);
  if (!current.encryptionAvailable) setNotice('此设备不能使用系统加密存储，配对令牌将以受限文件权限保存。', 'warning');
}

async function checkUpdate(silent = false) {
  try {
    const update = await window.executor.checkUpdate();
    availableUpdate = update.updateAvailable ? update : null;
    document.querySelector('#update-card').hidden = !availableUpdate;
    document.querySelector('#update-dot').hidden = !availableUpdate;
    if (availableUpdate) {
      document.querySelector('#update-message').textContent = `发现新版本 ${update.latestVersion}（当前 ${update.currentVersion}）`;
      if (!silent) setNotice('发现新版本，点击下载并安装更新。', 'success');
    } else if (!silent) setNotice(`当前已是最新版本 ${update.currentVersion}。`, 'success');
  } catch (error) { if (!silent) setNotice(error.message || '检查更新失败', 'error'); }
}

document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', () => showPage(item.dataset.page)));
document.querySelector('#open-add-account').addEventListener('click', () => { showPage('accounts'); document.querySelector('#account-name').focus(); });
form.addEventListener('submit', async event => { event.preventDefault(); setNotice('正在安全配对…'); try { await window.executor.pair({ serverUrl: document.querySelector('#server-url').value, displayName: document.querySelector('#display-name').value, code: document.querySelector('#pair-code').value }); setNotice('配对成功，执行器已在线。', 'success'); await refresh(); } catch (error) { setNotice(error.message || '配对失败', 'error'); } });
document.querySelector('#heartbeat').addEventListener('click', async () => { try { await window.executor.heartbeat(); setNotice('在线状态已刷新。', 'success'); } catch (error) { setNotice(error.message || '刷新失败', 'error'); } });
document.querySelector('#check-update').addEventListener('click', () => checkUpdate(false));
document.querySelector('#status-check-update').addEventListener('click', () => checkUpdate(false));
document.querySelector('#update-dot').addEventListener('click', () => { showPage('status'); checkUpdate(false); });
document.querySelector('#download-update').addEventListener('click', async () => { try { const result = await window.executor.downloadUpdate(); setNotice(result.installedDirectly ? '更新已下载，执行器正在自动替换并重启。' : '已在浏览器打开新安装包下载。下载后按系统提示安装即可。', 'success'); } catch (error) { setNotice(error.message || '下载更新失败', 'error'); } });
document.querySelector('#auto-submit').addEventListener('change', async event => { try { await window.executor.setAutoSubmit(event.target.checked); setNotice(event.target.checked ? '已开启自动点击生成。' : '已关闭自动点击生成。'); } catch (error) { setNotice(error.message || '设置失败', 'error'); } });
document.querySelector('#unpair').addEventListener('click', async () => { await window.executor.unpair(); setNotice('已解除这台电脑的配对。'); await refresh(); });
document.querySelector('#account-form').addEventListener('submit', async event => { event.preventDefault(); try { await window.executor.addAccount(document.querySelector('#account-name').value); document.querySelector('#account-name').value = ''; setNotice('已打开豆包登录窗口。登录完成后关闭窗口即可。', 'success'); await refreshAccounts(); } catch (error) { setNotice(error.message || '添加账号失败', 'error'); } });
document.querySelector('#claim-job').addEventListener('click', async () => { try { setNotice('正在领取视频任务…'); const job = await window.executor.claimJob(); renderJob(job); setNotice(job ? '任务已领取，执行器会自动打开可用豆包账号。' : '暂无等待领取的视频任务。', job ? 'success' : ''); } catch (error) { setNotice(error.message || '领取任务失败', 'error'); } });
document.querySelector('#copy-job').addEventListener('click', async () => { try { await window.executor.copyJobPrompt(); setNotice('提示词已复制。', 'success'); } catch (error) { setNotice(error.message || '复制失败', 'error'); } });
document.querySelector('#open-job').addEventListener('click', async () => { try { const result = await window.executor.openJob(document.querySelector('#job-account').value); setNotice(`已打开 ${result.accountName} 的豆包窗口；生成后下载视频即可自动回传。`, 'success'); } catch (error) { setNotice(error.message || '打开豆包失败', 'error'); } });
document.querySelector('#upload-result').addEventListener('click', async () => { try { const result = await window.executor.uploadResult(); if (!result.cancelled) { renderJob(null); setNotice('视频已回传到平台。', 'success'); } } catch (error) { setNotice(error.message || '视频回传失败', 'error'); } });
document.querySelector('#fail-job').addEventListener('click', async () => { try { if (!activeJob || !confirm('确认标记此视频任务失败？')) return; await window.executor.failJob('用户在本地执行器中止任务'); renderJob(null); setNotice('任务已标记失败。'); } catch (error) { setNotice(error.message || '操作失败', 'error'); } });
refresh().then(() => { if (latestState?.paired) checkUpdate(true); }).catch(error => setNotice(error.message || '初始化失败', 'error'));
