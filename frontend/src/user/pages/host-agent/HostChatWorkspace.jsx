import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Drawer, Input, Modal, Select, Space, Tag, Typography, theme } from 'antd';
import { apiRequest, getToken } from '../../../shared/api/client';
import { buildPrompt, createHostClient, defaultModelLabel, getInitialTask, normalizeTask, readableFailure, replyTargetIsCurrent, selectExistingSkill, sourceContext, taskAfterReply, taskURL, resolvedModelLabel } from './host-chat-core.mjs';
import './host-chat.css';

const api = createHostClient(apiRequest);
const KIND = { text: '文本', image: '图片', video: '视频' };
const STARTERS = ['把这段小说做成前贴，先看文案和分镜', '帮我把开头写得更吸引人，不改变剧情', '根据刚才的文案整理画面提示词'];

// Reuses the host's UserLayout, authenticated API client and ORIGINAL Agent.
// No login, provider endpoint, credential form, new backend or false tool receipt.
export default function HostChatWorkspace({ onProduction, onClassic }) {
  const { token } = theme.useToken();
  const [task, setTask] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [skills, setSkills] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [modelLabel, setModelLabel] = useState('原后台默认对话模型');
  const [selectedTextModel, setSelectedTextModel] = useState('');
  const [selectionReady, setSelectionReady] = useState(false);
  const [resolvedLabel, setResolvedLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [history, setHistory] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [detail, setDetail] = useState(false);
  const [artifact, setArtifact] = useState(null);
  const [width, setWidth] = useState(420);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [modal, modalContext] = Modal.useModal();
  const control = useRef({ epoch: 0, id: '', token: getToken(), sending: false, alive: false });
  const requestAbort = useRef(null);
  const fileInput = useRef(null);
  const scroller = useRef(null);
  const composer = useRef(null);
  const drag = useRef(null);
  const styles = { '--hc-bg': token.colorBgContainer, '--hc-soft': token.colorFillQuaternary, '--hc-line': token.colorBorderSecondary, '--hc-text': token.colorText, '--hc-muted': token.colorTextSecondary, '--hc-accent': token.colorPrimary, '--hc-chat-width': `${width}px` };
  const replies = useMemo(() => (task?.messages || []).filter(m => m.role === 'assistant'), [task]);
  function still(captured) { return control.current.alive && replyTargetIsCurrent(captured, { ...control.current, token: getToken() }); }
  function syncURL(id) { window.history.replaceState({}, '', taskURL(window.location, id)); }
  function setActive(next) { control.current.id = next?.id || ''; setTask(next); syncURL(next?.id || ''); }
  async function reloadTasks() { const result = await api.listTasks(); if (control.current.alive) setTasks(Array.isArray(result.tasks) ? result.tasks : []); }
  async function reloadCatalog() {
    const captured = getToken();
    const [list, config, skillList, caps] = await Promise.allSettled([api.catalog(), api.config(), api.listSkills(), api.capabilities()]);
    if (!control.current.alive || captured !== getToken()) return;
    if (list.status === 'fulfilled') setCatalog(list.value);
    setSelectionReady(caps.status === 'fulfilled' && caps.value?.version === 1 && caps.value.textModelSelection === true);
    if (config.status === 'fulfilled') setModelLabel(defaultModelLabel(config.value));
    if (skillList.status === 'fulfilled') setSkills(Array.isArray(skillList.value.skills) ? skillList.value.skills : []);
  }
  async function selectTask(id) {
    if (control.current.sending) return;
    const captured = { epoch: ++control.current.epoch, id, token: getToken() };
    control.current.id = id; setLoading(true); setTask(null); setArtifact(null); setResolvedLabel(''); setFailure(''); setUncertain(false); setHistory(false);
    try { const next = normalizeTask(await api.getTask(id)); if (still(captured)) setActive(next); }
    catch (e) { if (still(captured)) setFailure(readableFailure(e)); }
    finally { if (still(captured)) setLoading(false); }
  }
  function fresh() {
    if (control.current.sending) return;
    ++control.current.epoch; control.current.id = ''; setActive(null); setArtifact(null); setResolvedLabel(''); setText(''); setAttachment(null); setFailure(''); setUncertain(false); setLoading(false);
  }
  useEffect(() => {
    control.current.alive = true; control.current.token = getToken();
    const startEpoch = control.current.epoch;
    reloadTasks().catch(e => { if (control.current.alive) setFailure(readableFailure(e)); });
    reloadCatalog();
    const id = getInitialTask(window.location.search); if (id && control.current.epoch === startEpoch) selectTask(id);
    const pop = () => { if (!control.current.sending) { const id = getInitialTask(window.location.search); if (id) selectTask(id); else fresh(); } };
    const expired = () => { ++control.current.epoch; requestAbort.current?.abort(); control.current.id = ''; control.current.sending = false; setTask(null); setTasks([]); setCatalog([]); setSkills([]); setSelectedTextModel(''); setSelectionReady(false); setResolvedLabel(''); setArtifact(null); setBusy(false); setFailure('请通过原系统主导航重新登录。'); };
    window.addEventListener('popstate', pop); window.addEventListener('qiantie:auth-expired', expired);
    return () => { control.current.alive = false; ++control.current.epoch; requestAbort.current?.abort(); window.removeEventListener('popstate', pop); window.removeEventListener('qiantie:auth-expired', expired); };
  }, []);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [task?.messages?.length, busy]);
  async function send() {
    if (control.current.sending || loading || uncertain) return;
    let prompt;
    try { prompt = buildPrompt(text, attachment); } catch (e) { setFailure(e.message); return; }
    if (selectedTextModel && !selectionReady) { setFailure('后台模型选择接口尚未就绪，请先更新并重启原后台。没有改用默认模型。'); return; }
    const requestedModel = selectedTextModel;
    const originalText = text; const hadAttachment = Boolean(attachment);
    control.current.sending = true; setBusy(true); setFailure('');
    const captured = { epoch: control.current.epoch, token: getToken(), id: control.current.id };
    let currentTask = task; let submitted = false; let timer;
    try {
      if (!currentTask) {
        currentTask = normalizeTask(await api.createTask());
        if (!still(captured)) return;
        captured.id = currentTask.id; control.current.id = currentTask.id; setActive(currentTask);
      }
      if (!still(captured)) return;
      const ac = new AbortController(); requestAbort.current = ac;
      timer = setTimeout(() => ac.abort(), 150000);
      submitted = true;
      const result = await api.send({ taskId: currentTask.id, prompt, context: sourceContext(window.location.pathname, hadAttachment), skillIds: selectExistingSkill(originalText, skills), textModelId: requestedModel, signal: ac.signal });
      if (!still(captured)) return;
      const label = resolvedModelLabel(result, requestedModel);
      if (requestedModel && !label) throw new Error('后台未返回本轮模型回执。请核对当前服务版本，没有自动重发。');
      setResolvedLabel(label);
      const next = taskAfterReply(result, currentTask);
      setActive(next); setText(''); setAttachment(null);
      reloadTasks().catch(() => {});
    } catch (e) {
      if (!still(captured)) return;
      setFailure((e?.name === 'AbortError' ? '请求等待超时，服务端可能仍在处理。' : readableFailure(e)) + (submitted ? ' 没有自动重发；请先读取会话核对。' : ''));
      setUncertain(submitted);
      if (submitted && currentTask?.id) {
        try { const saved = normalizeTask(await api.getTask(currentTask.id)); if (still(captured)) setActive(saved); } catch { /* Keep original uncertainty; never resubmit. */ }
      }
    } finally {
      clearTimeout(timer);
      if (still(captured)) { control.current.sending = false; setBusy(false); requestAbort.current = null; }
    }
  }
  async function readAgain() {
    if (!control.current.id || control.current.sending) return;
    const capture = { ...control.current, token: getToken() };
    try { const saved = normalizeTask(await api.getTask(capture.id)); if (still(capture)) setActive(saved); } catch (e) { if (still(capture)) setFailure(readableFailure(e)); }
  }
  async function attach(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name) || file.size > 30000) { setFailure('此接入口支持小型 TXT / MD 原文。文件未发送；不把图片、PDF 或 DOCX 当作已读取文字。'); return; }
    try {
      const content = await file.text();
      if (!content.trim() || content.includes('\u0000') || content.includes('\uFFFD')) throw new Error('文字编码不可读，请另存为 UTF-8 TXT 后再使用。');
      if (content.length > 5400) throw new Error('附件超过当前原 Agent 的单轮安全长度，请明确选择较短片段；没有截断或发送。');
      setAttachment({ name: file.name.slice(0, 160), content }); setFailure('');
    } catch (e) { setFailure(e.message); }
  }
  function exportText(content) {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = '创作文稿.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function panStart(e) { if (e.button !== 0 || e.target.closest('article,button,input,textarea,a')) return; drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, pan }; e.currentTarget.setPointerCapture(e.pointerId); }
  function move(e) {
    const d = drag.current; if (!d) return;
    if (d.kind === 'pan') setPan({ x: d.pan.x + e.clientX - d.x, y: d.pan.y + e.clientY - d.y });
    else setWidth(Math.max(300, Math.min(640, d.width + e.clientX - d.x)));
  }
  function end() { drag.current = null; }
  return <section className={`hc-native ${artifact ? 'hc-native--art' : ''} ${!task?.messages?.length && !loading && !busy && !artifact ? 'hc-native--empty' : ''}`} style={styles}>
    {modalContext}
    <header className="hc-native__toolbar"><div><b>聊天创作</b><span> · 原系统账号与会话</span></div><Space size={4}>
      <Button type="text" disabled={busy} onClick={fresh}>新对话</Button><Button type="text" disabled={busy} onClick={() => { setHistory(true); reloadTasks().catch(e => setFailure(readableFailure(e))); }}>历史</Button>
      {onProduction && <Button type="text" disabled={busy} onClick={onProduction}>原生产工作区</Button>}
      <Button type="text" onClick={() => setDetail(true)}>帮助</Button>
    </Space></header>
    <div className="hc-native__body">
      <div className="hc-native__conversation">
        <div className="hc-native__messages" ref={scroller} aria-live="polite" aria-busy={busy || loading}>
          {!task?.messages?.length && !loading && <div className="hc-native__welcome"><div className="hc-native__eyebrow">一战晟铭 · 创作对话</div><h1>把想法说出来。</h1><p>贴一段原文，或者说说你想改哪里。</p><div className="hc-native__starters">{STARTERS.map(s => <button key={s} onClick={() => { setText(s); composer.current?.focus(); }}>{s}<span>↗</span></button>)}</div></div>}
          {loading && <p className="hc-native__muted">正在读取原会话…</p>}
          {(task?.messages || []).map((m, index) => <article className={`hc-native__message hc-native__message--${m.role}`} key={m.id || `${m.role}-${index}`}><span className="hc-native__speaker">{m.role === 'user' ? '你' : '创作助手'}</span><div className="hc-native__content">{m.content}</div>{m.role === 'assistant' && <div className="hc-native__message-actions"><Button size="small" type="text" onClick={() => { setArtifact(m); setPan({ x: 0, y: 0 }); setZoom(1); }}>打开文稿</Button><Button size="small" type="text" onClick={() => exportText(m.content)}>导出文字</Button></div>}</article>)}
          {busy && <p className="hc-native__muted" role="status">原后台正在处理本轮对话… 不会自动重发请求。</p>}
        </div>
        <div className="hc-native__bottom">
          {failure && <Alert type="warning" showIcon message={failure} action={uncertain ? <Space direction="vertical"><Button size="small" onClick={readAgain}>读取会话核对</Button><Button size="small" onClick={() => modal.confirm({ title: '允许手动重新发送？', content: '原接口没有客户端幂等键。网络失败不代表模型没收到请求。确认前请核对原会话；再次发送可能再次计费。', onOk: () => { setUncertain(false); setFailure('可编辑后手动发送；没有自动重发。'); } })}>我已核对</Button></Space> : null} />}
          <div className="hc-native__composer">
            {attachment && <Tag closable onClose={() => setAttachment(null)}>原文 · {attachment.name} · {attachment.content.length} 字符</Tag>}
            <Input.TextArea ref={composer} value={text} onChange={e => setText(e.target.value)} autoSize={{ minRows: 2, maxRows: 8 }} variant="borderless" placeholder="说出需求，或粘贴原文；Enter 发送，Shift + Enter 换行" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
            <div className="hc-native__composer-tools"><Space size={4}><Button type="text" disabled={busy} aria-label="附加原文" onClick={() => fileInput.current?.click()}>＋ 原文</Button><Button type="text" className="hc-native__model-label" onClick={() => { setModelsOpen(true); reloadCatalog(); }}>{selectedTextModel ? (catalog.find(c => c.kind === 'text')?.models.find(m => m.id === selectedTextModel)?.name || '所选文本模型') : modelLabel} ⌄</Button></Space><Button type="primary" shape="round" loading={busy} disabled={loading || uncertain || !text.trim()} onClick={send}>发送 ↑</Button></div>
            <input ref={fileInput} type="file" accept=".txt,.md,text/plain,text/markdown" hidden onChange={attach} />
          </div>
          <p className="hc-native__note">{resolvedLabel || '使用原后台授权文本模型，不需要重新填写密钥。发送可能产生原平台费用。'}</p>
        </div>
      </div>
      {artifact && <><div className="hc-native__divider" role="separator" aria-label="拖动调整聊天区宽度" aria-orientation="vertical" aria-valuenow={width} aria-valuemin={300} aria-valuemax={640} tabIndex={0} onDoubleClick={() => setWidth(420)} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); setWidth(w => Math.max(300, Math.min(640, w + (e.key === 'ArrowRight' ? 20 : -20)))); } }} onPointerDown={e => { e.preventDefault(); drag.current = { kind: 'resize', x: e.clientX, width }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>↔</div><div className="hc-native__canvas" onPointerDown={panStart} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <div className="hc-native__canvas-toolbar"><Space><Button onClick={() => setZoom(z => Math.max(.5, z - .1))}>−</Button><span>{Math.round(zoom * 100)}%</span><Button onClick={() => setZoom(z => Math.min(1.5, z + .1))}>＋</Button><Button onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1); }}>归位</Button></Space><Button onClick={() => setArtifact(null)}>收起文稿</Button></div>
        <article className="hc-native__paper" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}><span className="hc-native__eyebrow">已保存的原会话回复</span><h2>创作文稿</h2><pre>{artifact.content}</pre><Button onClick={() => { setText('请修改以下选中的文稿，保留未要求变动的部分：\n' + artifact.content + '\n\n我的修改要求：'); composer.current?.focus(); }}>回到对话继续修改</Button></article>
      </div></>}
    </div>
    <Drawer title="原系统会话" open={history} onClose={() => setHistory(false)} width={380}><p>读取现有 Agent 历史，不导入或覆盖 18089 试用会话。</p>{tasks.map(t => <button className="hc-native__history" key={t.id} onClick={() => selectTask(t.id)} disabled={busy}><b>{t.title || '未命名对话'}</b><span>{t.updatedAt ? new Date(t.updatedAt).toLocaleString() : ''}</span></button>)}</Drawer>
    <Drawer title="原后台模型" open={modelsOpen} onClose={() => setModelsOpen(false)} width={440}>
      <Alert type="info" showIcon message="复用原后台模型与权限" description="文本模型的选择会发送到原 Agent 后台；后台验证权限并返回实际使用的模型。选择失效时不会悄悄改用默认模型。" />
      {!selectionReady && <Alert type="warning" showIcon message="原后台尚未启用模型选择接口" description="可以继续使用默认对话模型。切换功能需原后台更新并重启，不需要重新配置密钥。" />}
      <Typography.Paragraph style={{ marginTop: 16 }}>当前文本模型</Typography.Paragraph>
      <Select aria-label="选择原后台文本模型" style={{ width: '100%' }} disabled={busy || !selectionReady} value={selectedTextModel} onChange={value => { setSelectedTextModel(value); setResolvedLabel(''); }} options={[{ value: '', label: modelLabel }, ...(catalog.find(c => c.kind === 'text')?.models || []).filter(m => m.enabled).map(m => ({ value: m.id, label: m.name }))]} />
      <p>{resolvedLabel}</p>
      {catalog.filter(c => c.kind !== 'text').map(c => <div key={c.kind}><h3>{KIND[c.kind]}模型目录</h3><p>这是原生产后台的目录，本批没有改变其调用配置。</p>{c.error ? <p>{c.error}</p> : c.models.map(m => <Tag key={m.id}>{m.name}</Tag>)}</div>)}
      <Button onClick={reloadCatalog}>重新读取目录</Button>
    </Drawer>
    <Drawer title="本版功能说明" open={detail} onClose={() => setDetail(false)} width={480}><Alert type="info" message="已切换前端入口，接口状态以原后台返回为准" description="页面使用原导航、主题、登录请求和会话接口。不连接 18089，不修改原模型配置。" /><h3>已接通的接口</h3><p>原 Agent 对话、原会话历史、原后台模型目录。发送成功仅表示得到真实文本回复。</p><h3>没有接上的部分</h3><p>新版 Go 前贴多步执行、从聊天生成图片/视频、局部重绘与上传，不在本次前端入口补丁中。原生产区仍保留原有功能；不会把它们显示成聊天已经自动执行。</p><h3>模型与原文边界</h3><p>文本模型可在原后台能力接口就绪后切换，返回实际模型回执。单轮需求与附件限制 5800 文本单位，超过会拒绝发送，不截断原文。原接口的历史上下文窗口仍由原服务决定。</p>{onClassic && <Button onClick={() => { setDetail(false); onClassic(); }} disabled={busy}>打开原 Agent 界面</Button>}<p>已有文字回复：{replies.length} 条</p></Drawer>
  </section>;
}
