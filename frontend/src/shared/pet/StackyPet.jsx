import { useEffect, useRef, useState } from 'react';
import { ExternalLink, GripVertical, ScanSearch, X } from 'lucide-react';
import { askAgent, createAgentTask, getAgentTask } from '../api/agent';
import { PET_APPLY_EVENT, PET_CONTEXT_EVENT, PET_EVENT, PET_SKILLS_EVENT, dispatchPetApply, dispatchPetState, normalizePetContext, normalizePetState, petAtlasRow, petFrameCount, petLookFrame, readCmTaskId, writeCmTaskId } from './stacky';
import { cmDraftToApply, cmInteractionView } from './cmInteraction';
import { didDrag, getOverlayLayout, PET_SIZE } from './overlayGeometry';

const resetDelayMs = 2400;
const overlayStorageKey = 'qiantie-stacky-overlay';

function getViewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function loadOverlay() {
  try {
    const saved = JSON.parse(localStorage.getItem(overlayStorageKey) || '{}');
    return {
      tucked: Boolean(saved.tucked),
      left: Number.isFinite(saved.left) ? saved.left : null,
      top: Number.isFinite(saved.top) ? saved.top : null
    };
  } catch (error) {
    return { tucked: false, left: null, top: null };
  }
}

function saveOverlay(overlay) {
  localStorage.setItem(overlayStorageKey, JSON.stringify(overlay));
}

function clampOverlayToViewport(overlay) {
  if (overlay.left === null || overlay.top === null) return overlay;
  return {
    ...overlay,
    left: Math.max(0, Math.min(Math.max(0, window.innerWidth - PET_SIZE.width), overlay.left)),
    top: Math.max(0, Math.min(Math.max(0, window.innerHeight - PET_SIZE.height), overlay.top))
  };
}

function isMissingTask(error) {
  const status = error?.status || error?.response?.status || error?.details?.status;
  return status === 404 || /\b404\b|not found|不存在/i.test(String(error?.message || error || ''));
}

export function StackyPet({ username, accountSessionKey }) {
  const [state, setState] = useState('idle');
  const [frame, setFrame] = useState(0);
  const [lookFrame, setLookFrame] = useState(null);
  const [reply, setReply] = useState('');
  const [overlay, setOverlay] = useState(loadOverlay);
  const [viewport, setViewport] = useState(getViewport);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [failedRequest, setFailedRequest] = useState(null);
  const [petTaskId, setPetTaskId] = useState(null);
  const spriteRef = useRef(null);
  const dragRef = useRef(null);
  const dragListenersRef = useRef(null);
  const draggedRef = useRef(false);
  const contextRef = useRef(normalizePetContext({ pagePath: window.location.pathname }));
  const skillIdsRef = useRef([]);
  const petTaskIdRef = useRef(null);
  const conversationRequestRef = useRef(0);
  const accountSessionGenerationRef = useRef(0);
  const historyRef = useRef(null);

  function isCurrentConversationRequest(requestId, accountSessionGeneration) {
    return conversationRequestRef.current === requestId
      && accountSessionGenerationRef.current === accountSessionGeneration;
  }

  function dispatchConversationPetState(requestId, accountSessionGeneration, nextState) {
    if (isCurrentConversationRequest(requestId, accountSessionGeneration)) {
      dispatchPetState(nextState);
    }
  }

  function clearPetTask(messageText = '', accountSessionGeneration = accountSessionGenerationRef.current) {
    if (accountSessionGenerationRef.current !== accountSessionGeneration) return;
    petTaskIdRef.current = null;
    setPetTaskId(null);
    writeCmTaskId(username, '');
    setMessages([]);
    setFailedRequest(null);
    if (messageText) setReply(messageText);
  }

  useEffect(() => {
    accountSessionGenerationRef.current += 1;
    conversationRequestRef.current += 1;
    const storedTaskId = readCmTaskId(username) || null;
    petTaskIdRef.current = storedTaskId;
    setPetTaskId(storedTaskId);
    setMessages([]);
    setQuestion('');
    setReply('');
    setFailedRequest(null);
    setAsking(false);
    return () => {
      clearDragListeners();
      dragRef.current = null;
      accountSessionGenerationRef.current += 1;
      conversationRequestRef.current += 1;
    };
  }, [accountSessionKey, username]);

  useEffect(() => {
    function handlePetState(event) {
      setState(normalizePetState(event.detail?.state));
      setReply('');
      setLookFrame(null);
    }

    window.addEventListener(PET_EVENT, handlePetState);
    return () => window.removeEventListener(PET_EVENT, handlePetState);
  }, []);

  useEffect(() => {
    function handleSkills(event) {
      skillIdsRef.current = Array.isArray(event.detail?.skillIds) ? event.detail.skillIds : [];
    }
    window.addEventListener(PET_SKILLS_EVENT, handleSkills);
    return () => window.removeEventListener(PET_SKILLS_EVENT, handleSkills);
  }, []);

  useEffect(() => {
    if (state === 'idle' || state === 'working') return undefined;
    const timeoutId = window.setTimeout(() => {
      setState('idle');
      setReply('');
    }, resetDelayMs);
    return () => window.clearTimeout(timeoutId);
  }, [state]);

  useEffect(() => {
    function handleContext(event) {
      contextRef.current = normalizePetContext(event.detail);
    }
    window.addEventListener(PET_CONTEXT_EVENT, handleContext);
    return () => window.removeEventListener(PET_CONTEXT_EVENT, handleContext);
  }, []);

  useEffect(() => {
    function keepOverlayVisible() {
      setViewport(getViewport());
      setOverlay(current => {
        const next = clampOverlayToViewport(current);
        if (next.left === current.left && next.top === current.top) return current;
        saveOverlay(next);
        return next;
      });
    }

    keepOverlayVisible();
    window.addEventListener('resize', keepOverlayVisible);
    return () => window.removeEventListener('resize', keepOverlayVisible);
  }, []);

  useEffect(() => {
    function closeChatWithEscape(event) {
      if (chatOpen && event.key === 'Escape') closeChat();
    }

    window.addEventListener('keydown', closeChatWithEscape);
    return () => window.removeEventListener('keydown', closeChatWithEscape);
  }, [chatOpen]);

  useEffect(() => {
    if (!chatOpen || !historyRef.current) return;
    historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [chatOpen, messages, failedRequest]);

  async function openChat() {
    setChatOpen(true);
    if (!petTaskIdRef.current) return;
    await loadPetTask(petTaskIdRef.current);
  }

  async function loadPetTask(taskId) {
    const requestId = conversationRequestRef.current + 1;
    const accountSessionGeneration = accountSessionGenerationRef.current;
    conversationRequestRef.current = requestId;
    try {
      const task = await getAgentTask(taskId);
      if (petTaskIdRef.current === taskId && isCurrentConversationRequest(requestId, accountSessionGeneration)) {
        setMessages(Array.isArray(task.task?.messages) ? task.task.messages : []);
      }
    } catch (error) {
      if (!isCurrentConversationRequest(requestId, accountSessionGeneration)) return;
      if (isMissingTask(error)) {
        clearPetTask('当前对话已失效，已为你准备新对话。', accountSessionGeneration);
        return;
      }
      setReply('暂时无法读取聊天记录。');
    }
  }

  async function ensureTask(requestId, accountSessionGeneration) {
    if (petTaskIdRef.current) return petTaskIdRef.current;
    const result = await createAgentTask();
    const taskId = result.task?.id;
    if (!taskId) throw new Error('未能创建聊天任务');
    if (!isCurrentConversationRequest(requestId, accountSessionGeneration)) return null;
    petTaskIdRef.current = taskId;
    writeCmTaskId(username, taskId);
    setPetTaskId(taskId);
    setMessages(Array.isArray(result.task.messages) ? result.task.messages : []);
    return taskId;
  }

  async function sendQuestion(prompt) {
    const content = String(prompt || '').trim();
    if (!content || asking) return;
    const requestId = conversationRequestRef.current + 1;
    const accountSessionGeneration = accountSessionGenerationRef.current;
    conversationRequestRef.current = requestId;
    setAsking(true);
    setChatOpen(true);
    dispatchConversationPetState(requestId, accountSessionGeneration, 'working');
    try {
      const taskId = await ensureTask(requestId, accountSessionGeneration);
      if (!taskId || !isCurrentConversationRequest(requestId, accountSessionGeneration)) return;
      const result = await askAgent({
        taskId,
        prompt: content,
        context: {
          ...contextRef.current,
          page: contextRef.current.page || window.location.pathname,
          pagePath: contextRef.current.pagePath || window.location.pathname
        },
        skillIds: skillIdsRef.current
      });
      if (!isCurrentConversationRequest(requestId, accountSessionGeneration)) return;
      petTaskIdRef.current = result.task?.id || taskId;
      writeCmTaskId(username, petTaskIdRef.current);
      if (petTaskIdRef.current === taskId) {
        setPetTaskId(petTaskIdRef.current);
        setMessages(Array.isArray(result.task?.messages) ? result.task.messages : current => [...current, result.user, result.assistant]);
      }
      setFailedRequest(null);
      setQuestion(current => current === content ? '' : current);
      setReply('我整理好了。');
      dispatchConversationPetState(requestId, accountSessionGeneration, 'success');
    } catch (error) {
      if (!isCurrentConversationRequest(requestId, accountSessionGeneration)) return;
      if (isMissingTask(error)) {
        clearPetTask('当前对话已失效，已为你准备新对话。', accountSessionGeneration);
        dispatchConversationPetState(requestId, accountSessionGeneration, 'error');
        return;
      }
      const message = error.message || '这次没有连上 Agent。';
      setFailedRequest({ prompt: content, error: message });
      setReply(message);
      dispatchConversationPetState(requestId, accountSessionGeneration, 'error');
    } finally {
      if (isCurrentConversationRequest(requestId, accountSessionGeneration)) setAsking(false);
    }
  }

  useEffect(() => {
    function followPointer(event) {
      if (state !== 'idle' || !spriteRef.current) return;
      const rect = spriteRef.current.getBoundingClientRect();
      setLookFrame(petLookFrame(
        event.clientX - rect.left - rect.width / 2,
        event.clientY - rect.top - rect.height / 2
      ));
    }

    window.addEventListener('pointermove', followPointer);
    return () => window.removeEventListener('pointermove', followPointer);
  }, [state]);

  useEffect(() => {
    const frameDelay = state === 'working' ? 120 : 180;
    setFrame(0);
    const intervalId = window.setInterval(() => {
      setFrame(current => (current + 1) % petFrameCount(state));
    }, frameDelay);
    return () => window.clearInterval(intervalId);
  }, [state]);

  const label = {
    idle: '空闲',
    working: '生成中',
    success: '完成',
    error: '失败'
  }[state];

  const { bubbleText, quickActions } = cmInteractionView(state, contextRef.current);
  const spriteRow = lookFrame && state === 'idle' ? lookFrame.row : petAtlasRow(state);
  const spriteFrame = lookFrame && state === 'idle' ? lookFrame.column : frame;
  const positionStyle = overlay.left === null
    ? undefined
    : { left: overlay.left, top: overlay.top, right: 'auto', bottom: 'auto' };
  const petPosition = overlay.left === null || overlay.top === null
    ? { left: Math.max(0, viewport.width - PET_SIZE.width - 22), top: Math.max(0, viewport.height - PET_SIZE.height - 18) }
    : { left: overlay.left, top: overlay.top };
  const panelLayout = getOverlayLayout({
    viewport: { width: viewport.width, height: viewport.height, topInset: 56 },
    pet: petPosition
  }).panel;
  const panelStyle = {
    left: panelLayout.left,
    top: panelLayout.top,
    width: panelLayout.width,
    height: panelLayout.height
  };

  function updateOverlay(patch) {
    setOverlay(current => {
      const next = { ...current, ...patch };
      saveOverlay(next);
      return next;
    });
  }

  function clearDragListeners() {
    const listeners = dragListenersRef.current;
    if (!listeners) return;
    window.removeEventListener('pointermove', listeners.move);
    window.removeEventListener('pointerup', listeners.end);
    window.removeEventListener('pointercancel', listeners.end);
    dragListenersRef.current = null;
  }

  function handleDragStart(event) {
    if (event.button !== 0) return;
    clearDragListeners();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      left: spriteRef.current.getBoundingClientRect().left,
      top: spriteRef.current.getBoundingClientRect().top,
      pointerId: event.pointerId,
      target: event.currentTarget
    };
    draggedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = nextEvent => handleDragMove(nextEvent);
    const end = nextEvent => handleDragEnd(nextEvent);
    dragListenersRef.current = { move, end };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function handleDragMove(event) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!didDrag({ x: drag.startX, y: drag.startY }, { x: event.clientX, y: event.clientY })) return;
    draggedRef.current = true;
    const nextLeft = Math.max(0, Math.min(window.innerWidth - PET_SIZE.width, drag.left + event.clientX - drag.startX));
    const nextTop = Math.max(0, Math.min(window.innerHeight - PET_SIZE.height, drag.top + event.clientY - drag.startY));
    updateOverlay({ left: nextLeft, top: nextTop });
  }

  function handleDragEnd(event) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.target?.hasPointerCapture?.(event.pointerId)) drag.target.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    clearDragListeners();
  }

  function handlePetClick() {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    setLookFrame(null);
    openChat();
  }

  function closeChat() {
    conversationRequestRef.current += 1;
    setChatOpen(false);
    setAsking(false);
    spriteRef.current?.focus();
  }

  function analyzeCurrentPage() {
    sendQuestion('请分析当前页面的内容，指出下一步最值得处理的事项。');
  }

  function openInAgentWorkspace() {
    const taskId = petTaskId;
    if (taskId) window.location.href = `/agent?task=${encodeURIComponent(taskId)}`;
  }

  if (overlay.tucked) {
    return (
      <div className="stacky-pet-shell" style={positionStyle}>
        <button
          className="stacky-pet-tab"
          type="button"
          title="唤醒 CM"
          aria-label="唤醒 CM"
          onClick={() => updateOverlay({ tucked: false })}
        >
          <img src="/pets/stacky/spritesheet.webp" alt="" />
        </button>
      </div>
    );
  }

  return (
    <div className="stacky-pet-shell" style={positionStyle} aria-live="polite" aria-label={`前贴宠物 CM，${label}`}>
      <button type="button" className="stacky-pet-bubble stacky-pet-bubble--interactive" onClick={openChat} title="打开 CM 对话">
        {reply || bubbleText}
      </button>
      {chatOpen && (
        <section className={`stacky-agent-panel stacky-agent-panel--opens-${panelLayout.placement} cm-conversation-frame`} style={panelStyle} role="dialog" aria-label="CM 互动">
          <header className="stacky-agent-header">
            <strong>CM</strong>
            <div>
              <button className="stacky-agent-icon" type="button" title="分析当前页面" aria-label="分析当前页面" onClick={analyzeCurrentPage} disabled={asking}>
                <ScanSearch size={16} aria-hidden="true" />
              </button>
              <button className="stacky-agent-icon" type="button" title="在 Agent 工作区继续" aria-label="在 Agent 工作区继续" onClick={openInAgentWorkspace} disabled={!petTaskId}>
                <ExternalLink size={16} aria-hidden="true" />
              </button>
              <button className="stacky-agent-close" type="button" aria-label="关闭 CM 对话" title="关闭对话" onClick={closeChat}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </header>
          <div className="stacky-agent-history" ref={historyRef}>
            {messages.length === 0 ? <span>点击分析当前页面，或直接提问。</span> : messages.map((message, index) => (
              <article key={`${message.createdAt || index}-${message.role}`} className={`stacky-agent-message stacky-agent-message--${message.role}`}>
                <span>{message.content}</span>
                {message.role === 'assistant' && cmDraftToApply(message.content, contextRef.current.entities.hasOutput) ? (
                  <button type="button" onClick={() => dispatchPetApply(cmDraftToApply(message.content, contextRef.current.entities.hasOutput))}>应用到剧本</button>
                ) : null}
              </article>
            ))}
            {failedRequest ? (
              <div className="stacky-agent-retry" role="alert">
                <span>{failedRequest.error}</span>
                <button type="button" onClick={() => sendQuestion(failedRequest.prompt)} disabled={asking}>重新发送</button>
              </div>
            ) : null}
          </div>
          {quickActions.length ? <div className="stacky-agent-quick-actions" aria-label="CM 建议操作">
            {quickActions.map(action => <button
              key={action.id}
              type="button"
              className={action.mode === 'rewrite' ? 'stacky-agent-quick-action stacky-agent-quick-action--rewrite' : 'stacky-agent-quick-action'}
              onClick={() => sendQuestion(action.prompt)}
              disabled={asking}
            >{action.label}</button>)}
          </div> : null}
          <form className="stacky-agent-input" onSubmit={event => { event.preventDefault(); sendQuestion(question); }}>
            <input value={question} onChange={event => setQuestion(event.target.value)} placeholder="问问 CM..." aria-label="向 CM 提问" />
            <button type="submit" disabled={!question.trim() || asking}>{asking ? '...' : '↗'}</button>
          </form>
        </section>
      )}
      <div
        ref={spriteRef}
        className={`stacky-pet stacky-pet--${state}`}
        style={{ '--stacky-row': spriteRow, '--stacky-frame': spriteFrame }}
        role="button"
        tabIndex={0}
        aria-label="打开 CM 对话"
        onPointerDown={handleDragStart}
        onClick={handlePetClick}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handlePetClick();
          }
        }}
      >
        <img src="/pets/stacky/spritesheet.webp" alt="" />
      </div>
      <button
        className="stacky-pet-drag-handle"
        type="button"
        title="拖动移动 CM"
        aria-label="拖动移动 CM"
        onPointerDown={handleDragStart}
      >
        <GripVertical size={14} aria-hidden="true" />
      </button>
      <button
        className="stacky-pet-tuck"
        type="button"
        title="收起 CM"
        aria-label="收起 CM"
        onClick={() => updateOverlay({ tucked: true })}
      >
        ×
      </button>
    </div>
  );
}
