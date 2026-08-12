import { useEffect, useRef, useState } from 'react';
import { askAgent, createAgentTask, getAgentTask } from '../api/agent';
import { PET_APPLY_EVENT, PET_CONTEXT_EVENT, PET_EVENT, PET_SKILLS_EVENT, dispatchPetApply, dispatchPetState, normalizePetState, petAtlasRow, petFrameCount, petLookFrame, petSpeech } from './stacky';

const resetDelayMs = 2400;
const overlayStorageKey = 'qiantie-stacky-overlay';
const petWidth = 120;
const petHeight = 130;
const chatGap = 12;
const chatWidth = 360;
const viewportPadding = 8;

function getViewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function getChatPanelLayout(overlay, viewport) {
  const width = Math.max(0, Math.min(chatWidth, viewport.width - viewportPadding * 2));
  const petLeft = overlay.left === null ? viewport.width - petWidth - 22 : overlay.left;
  const opensRight = petLeft + petWidth + chatGap + width <= viewport.width - viewportPadding || petLeft < viewport.width / 2;
  const unclampedLeft = opensRight ? petLeft + petWidth + chatGap : petLeft - chatGap - width;
  const left = Math.max(viewportPadding, Math.min(viewport.width - viewportPadding - width, unclampedLeft));
  const bottom = viewport.width <= 480 ? petHeight + 14 : viewportPadding;
  return {
    side: opensRight ? 'right' : 'left',
    style: {
      '--stacky-agent-panel-left': `${left}px`,
      '--stacky-agent-panel-bottom': `${bottom}px`,
      '--stacky-agent-panel-width': `${width}px`
    }
  };
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
    left: Math.max(0, Math.min(Math.max(0, window.innerWidth - petWidth), overlay.left)),
    top: Math.max(0, Math.min(Math.max(0, window.innerHeight - petHeight), overlay.top))
  };
}

export function StackyPet() {
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
  const spriteRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const contextRef = useRef({ page: window.location.pathname });
  const skillIdsRef = useRef([]);
  const petTaskIdRef = useRef(null);

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
      contextRef.current = { ...contextRef.current, ...(event.detail || {}) };
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
      if (event.key === 'Escape') setChatOpen(false);
    }

    window.addEventListener('keydown', closeChatWithEscape);
    return () => window.removeEventListener('keydown', closeChatWithEscape);
  }, []);

  async function openChat() {
    setChatOpen(true);
    if (!petTaskIdRef.current) return;
    await loadPetTask(petTaskIdRef.current);
  }

  async function loadPetTask(taskId) {
    try {
      const task = await getAgentTask(taskId);
      if (petTaskIdRef.current === taskId) setMessages(Array.isArray(task.task?.messages) ? task.task.messages : []);
    } catch (error) {
      setReply('暂时无法读取聊天记录。');
    }
  }

  async function ensureTask() {
    if (petTaskIdRef.current) return petTaskIdRef.current;
    const result = await createAgentTask();
    const taskId = result.task?.id;
    if (!taskId) throw new Error('未能创建聊天任务');
    petTaskIdRef.current = taskId;
    setMessages(Array.isArray(result.task.messages) ? result.task.messages : []);
    return taskId;
  }

  async function sendQuestion(prompt) {
    const content = String(prompt || '').trim();
    if (!content || asking) return;
    setAsking(true);
    setChatOpen(true);
    setQuestion('');
    dispatchPetState('working');
    try {
      const taskId = await ensureTask();
      const result = await askAgent({
        taskId,
        prompt: content,
        context: { ...contextRef.current, page: contextRef.current.page || window.location.pathname },
        skillIds: skillIdsRef.current
      });
      petTaskIdRef.current = result.task?.id || taskId;
      if (petTaskIdRef.current === taskId) setMessages(Array.isArray(result.task?.messages) ? result.task.messages : current => [...current, result.user, result.assistant]);
      setReply('我整理好了。');
      dispatchPetState('success');
    } catch (error) {
      const taskId = petTaskIdRef.current;
      if (taskId) loadPetTask(taskId).catch(() => undefined);
      setReply(error.message || '这次没有连上 Agent。');
      dispatchPetState('error');
    } finally {
      setAsking(false);
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

  const spriteRow = lookFrame && state === 'idle' ? lookFrame.row : petAtlasRow(state);
  const spriteFrame = lookFrame && state === 'idle' ? lookFrame.column : frame;
  const positionStyle = overlay.left === null
    ? undefined
    : { left: overlay.left, top: overlay.top, right: 'auto', bottom: 'auto' };
  const panelLayout = getChatPanelLayout(overlay, viewport);

  function updateOverlay(patch) {
    setOverlay(current => {
      const next = { ...current, ...patch };
      saveOverlay(next);
      return next;
    });
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    suppressClickRef.current = false;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      left: spriteRef.current.getBoundingClientRect().left,
      top: spriteRef.current.getBoundingClientRect().top,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) {
      drag.moved = true;
      suppressClickRef.current = true;
    }
    const nextLeft = Math.max(0, Math.min(window.innerWidth - petWidth, drag.left + deltaX));
    const nextTop = Math.max(0, Math.min(window.innerHeight - petHeight, drag.top + deltaY));
    updateOverlay({ left: nextLeft, top: nextTop });
  }

  function handlePointerUp(event) {
    if (!dragRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  function handlePetClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setLookFrame(null);
    openChat();
  }

  function handlePetDoubleClick() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) return;
    setLookFrame(null);
    openChat();
    sendQuestion('请分析我当前页面的内容，指出下一步最值得处理的事项。');
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
      <div className="stacky-pet-bubble">{reply || petSpeech(state)}</div>
      {chatOpen && (
        <section className={`stacky-agent-panel stacky-agent-panel--opens-${panelLayout.side} cm-conversation-frame`} style={panelLayout.style} aria-label="CM 互动">
          <button className="stacky-agent-close" type="button" aria-label="关闭 CM 对话" title="关闭对话" onClick={() => setChatOpen(false)}>×</button>
          <div className="stacky-agent-history">
            {messages.length === 0 ? <span>双击 CM 让它分析当前页面，或直接提问。</span> : messages.slice(-4).map((message, index) => (
              <article key={`${message.createdAt || index}-${message.role}`} className={`stacky-agent-message stacky-agent-message--${message.role}`}>
                <span>{message.content}</span>
                {message.role === 'assistant' && message.content.includes('【修改稿】') && contextRef.current.scriptOutput ? (
                  <button type="button" onClick={() => dispatchPetApply(message.content.split('【修改稿】').slice(1).join('【修改稿】').trim())}>应用到剧本</button>
                ) : null}
              </article>
            ))}
          </div>
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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handlePetClick}
        onDoubleClick={handlePetDoubleClick}
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
