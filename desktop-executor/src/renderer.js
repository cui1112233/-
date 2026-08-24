const form = document.querySelector('#pair-form');
const paired = document.querySelector('#paired');
const notice = document.querySelector('#notice');
const setNotice = (text, kind = '') => { notice.className = kind; notice.textContent = text; };

async function refresh() {
  const current = await window.executor.state();
  document.querySelector('#server-url').value = current.serverUrl || 'http://10.0.100.183:14000';
  document.querySelector('#display-name').value = current.displayName || '';
  paired.hidden = !current.paired;
  form.hidden = current.paired;
  if (current.paired) document.querySelector('#paired-name').textContent = `${current.displayName} · ${current.executorId}`;
  if (!current.encryptionAvailable) setNotice('此设备不能使用系统加密存储，配对令牌将以受限文件权限保存。', 'warning');
}
form.addEventListener('submit', async event => {
  event.preventDefault(); setNotice('正在安全配对…');
  try { await window.executor.pair({ serverUrl: document.querySelector('#server-url').value, displayName: document.querySelector('#display-name').value, code: document.querySelector('#pair-code').value }); setNotice('配对成功，执行器已在线。', 'success'); await refresh(); } catch (error) { setNotice(error.message || '配对失败', 'error'); }
});
document.querySelector('#heartbeat').addEventListener('click', async () => { try { await window.executor.heartbeat(); setNotice('在线状态已刷新。', 'success'); } catch (error) { setNotice(error.message || '刷新失败', 'error'); } });
document.querySelector('#unpair').addEventListener('click', async () => { await window.executor.unpair(); setNotice('已解除这台电脑的配对。'); await refresh(); });
refresh().catch(error => setNotice(error.message || '初始化失败', 'error'));
