import { Button, Form, Input, InputNumber, Select, Slider, Space, message } from 'antd';
import { AudioLines, Download, FileUp, Plus, Save, Trash2, WandSparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { textToSpeech } from '../../shared/api/tts';
import { getConfig, saveConfig } from '../../shared/api/config';
import { dispatchPetContext, dispatchPetState } from '../../shared/pet/stacky';
import { dispatchCmSelection, registerCmBridge } from '../../shared/pet/cmBridge';

const voices = [
  { label: '晓晓（女声·温柔）', value: 'zh-CN-XiaoxiaoNeural' },
  { label: '晓辰（女声·知性）', value: 'zh-CN-XiaochenNeural' },
  { label: '云希（男声·清朗）', value: 'zh-CN-YunxiNeural' },
  { label: '云扬（男声·阳光）', value: 'zh-CN-YunyangNeural' },
  { label: '晓伊（女声·甜美）', value: 'zh-CN-XiaoyiNeural' },
  { label: '云健（男声·稳重）', value: 'zh-CN-YunjianNeural' }
];

const styles = [
  { label: '通用', value: 'general' },
  { label: '开心', value: 'cheerful' },
  { label: '悲伤', value: 'sad' },
  { label: '友好', value: 'friendly' },
  { label: '聊天', value: 'chat' }
];

const voiceValues = new Set(voices.map(item => item.value));
const styleValues = new Set(styles.map(item => item.value));

function createCard(text = '') {
  return {
    id: 'tts-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    input: text,
    voice: 'zh-CN-XiaoxiaoNeural',
    style: 'general',
    speed: 1.8,
    pitch: 10,
    loading: false,
    audioUrl: '',
    audioBlob: null
  };
}

function NumberSlider({ ariaLabel, min, max, step, value, onChange }) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : min;
  return (
    <div className="tts-number-slider">
      <Slider aria-label={ariaLabel} min={min} max={max} step={step} value={safeValue} onChange={onChange} />
      <InputNumber aria-label={`${ariaLabel}数值`} min={min} max={max} step={step} value={safeValue} onChange={next => onChange(next ?? safeValue)} />
    </div>
  );
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function TtsPage() {
  const [cards, setCards] = useState([]);
  const [defaults, setDefaults] = useState({ voice: 'zh-CN-XiaoxiaoNeural', style: 'general', speed: 1.8, pitch: 10 });
  const audioUrlsRef = useRef(new Set());
  const cardRequestRef = useRef(new Map());
  const cardsRef = useRef([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  function nextCardRequest(id) {
    const requestId = (cardRequestRef.current.get(id) || 0) + 1;
    cardRequestRef.current.set(id, requestId);
    return requestId;
  }

  function isCurrentCardRequest(id, requestId) {
    return mountedRef.current && cardRequestRef.current.get(id) === requestId;
  }

  function cardStillExists(id) {
    return cardsRef.current.some(card => card.id === id);
  }

  useEffect(() => () => {
    mountedRef.current = false;
    cardRequestRef.current.clear();
    audioUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    audioUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    getConfig().then(config => {
      if (config.tts) setDefaults(config.tts);
    }).catch(error => message.error(error.message || '读取默认配音失败'));
  }, []);

  const hasCards = cards.length > 0;

  useEffect(() => {
    const generatedCount = cards.filter(card => Boolean(card.audioUrl || card.audioBlob)).length;
    dispatchPetContext({
      page: '配音',
      pagePath: '/tts',
      summary: `配音卡片 ${cards.length} 张；已生成音频 ${generatedCount} 张；默认音色：${defaults.voice || '未设置'}`,
      entities: {
        cardCount: cards.length,
        generatedCount,
        defaultVoice: defaults.voice || '',
        speed: defaults.speed,
        pitch: defaults.pitch
      },
      actions: ['检查配音卡片', '生成全部配音']
    });
  }, [cards, defaults]);

  useEffect(() => registerCmBridge({
    page: '配音',
    pagePath: '/tts',
    capabilities: ['tts.update'],
    getContext: () => ({
      page: '配音',
      pagePath: '/tts',
      summary: `当前有 ${cards.length} 张配音卡。CM 可以调整选中卡片的文本、音色、风格、语速和音调；修改参数后需要用户重新生成音频。`
    }),
    apply: async action => {
      if (action.type !== 'tts.update') throw new Error('配音页面暂不支持这个 CM 操作。');
      const index = cards.findIndex(card => card.id === action.targetId);
      if (index < 0) throw new Error('找不到要修改的配音卡片，请重新点选后再试。');
      const current = cards[index];
      const patch = action.patch || {};
      const next = {
        ...current,
        ...(Object.prototype.hasOwnProperty.call(patch, 'input') ? { input: String(patch.input || '').slice(0, 12000) } : {}),
        ...(voiceValues.has(patch.voice) ? { voice: patch.voice } : {}),
        ...(styleValues.has(patch.style) ? { style: patch.style } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, 'speed') ? { speed: clamp(patch.speed, 0.5, 2, current.speed) } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, 'pitch') ? { pitch: clamp(patch.pitch, -50, 50, current.pitch) } : {}),
        loading: false,
        audioUrl: '',
        audioBlob: null
      };
      if (current.audioUrl) {
        URL.revokeObjectURL(current.audioUrl);
        audioUrlsRef.current.delete(current.audioUrl);
      }
      nextCardRequest(current.id);
      setCards(items => items.map(card => card.id === current.id ? next : card));
      return { ok: true, message: `已更新配音卡片 ${index + 1}，请重新生成试听。` };
    }
  }), [cards]);

  function updateCard(id, patch) {
    setCards(current => current.map(card => card.id === id ? { ...card, ...patch } : card));
  }

  function focusCard(card, index) {
    dispatchCmSelection({
      type: 'tts-card',
      id: card.id,
      label: `配音卡片 ${index + 1}`,
      meta: {
        input: card.input || '',
        voice: card.voice,
        style: card.style,
        speed: card.speed,
        pitch: card.pitch
      }
    });
  }

  function addCard(text) {
    setCards(current => [...current, { ...createCard(text), ...defaults }]);
  }

  async function saveDefaults() {
    try {
      const config = await getConfig();
      await saveConfig({ ...config, apiKey: '', tts: defaults });
      message.success('默认配音已保存');
    } catch (error) {
      message.error(error.message || '保存默认配音失败');
    }
  }

  function removeCard(id) {
    nextCardRequest(id);
    setCards(current => {
      const card = current.find(item => item.id === id);
      if (card?.audioUrl) {
        URL.revokeObjectURL(card.audioUrl);
        audioUrlsRef.current.delete(card.audioUrl);
      }
      cardRequestRef.current.delete(id);
      return current.filter(item => item.id !== id);
    });
  }

  async function generateCard(id) {
    const card = cards.find(item => item.id === id);
    if (!card?.input?.trim()) {
      message.warning('请先输入要转换的文本');
      return;
    }

    const requestId = nextCardRequest(id);
    updateCard(id, { loading: true });
    dispatchPetState('working');
    try {
      const blob = await textToSpeech(card);
      if (!blob || blob.size === 0) throw new Error('TTS 服务返回空音频');
      if (!isCurrentCardRequest(id, requestId) || !cardStillExists(id)) return;
      if (card.audioUrl) {
        URL.revokeObjectURL(card.audioUrl);
        audioUrlsRef.current.delete(card.audioUrl);
      }
      const nextAudioUrl = URL.createObjectURL(blob);
      audioUrlsRef.current.add(nextAudioUrl);
      if (!isCurrentCardRequest(id, requestId) || !cardStillExists(id)) {
        audioUrlsRef.current.delete(nextAudioUrl);
        URL.revokeObjectURL(nextAudioUrl);
        return;
      }
      updateCard(id, {
        audioUrl: nextAudioUrl,
        audioBlob: blob,
        loading: false
      });
      message.success('语音生成成功');
      dispatchPetState('success');
    } catch (error) {
      if (!isCurrentCardRequest(id, requestId) || !cardStillExists(id)) return;
      updateCard(id, { loading: false, audioUrl: '', audioBlob: null });
      message.error(error.message || '生成失败');
      dispatchPetState('error');
    }
  }

  async function generateAll() {
    if (!hasCards) {
      message.warning('先添加卡片再生成');
      return;
    }
    for (const card of cards) {
      if (card.input.trim()) await generateCard(card.id);
    }
  }

  function downloadCard(card) {
    if (!card.audioUrl || !card.audioBlob) return;
    const link = document.createElement('a');
    link.href = card.audioUrl;
    link.download = `${card.id}.mp3`;
    link.click();
  }

  function uploadNovel(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '').trim().slice(0, 1800);
      addCard(text);
      event.target.value = '';
    };
    reader.readAsText(file);
  }

  return (
    <div className="tts-workbench utility-workbench">
      <div className="tts-toolbar">
        <Button type="primary" icon={<Plus size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={() => addCard()}>添加卡片</Button>
        <Select style={{ width: 190 }} value={defaults.voice} options={voices} onChange={voice => setDefaults(current => ({ ...current, voice }))} />
        <Select style={{ width: 110 }} value={defaults.style} options={styles} onChange={style => setDefaults(current => ({ ...current, style }))} />
        <div className="tts-default-slider" title="默认语速">
          <span>语速</span>
          <NumberSlider ariaLabel="默认语速" min={0.5} max={2} step={0.1} value={defaults.speed} onChange={speed => setDefaults(current => ({ ...current, speed }))} />
        </div>
        <div className="tts-default-slider" title="默认音调">
          <span>音调</span>
          <NumberSlider ariaLabel="默认音调" min={-50} max={50} step={1} value={defaults.pitch} onChange={pitch => setDefaults(current => ({ ...current, pitch }))} />
        </div>
        <Button icon={<Save size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={saveDefaults}>保存为默认配音</Button>
        <Button icon={<FileUp size={16} strokeWidth={1.8} aria-hidden="true" />}>
          <label style={{ cursor: 'pointer' }}>
            上传小说
            <input type="file" accept=".txt" hidden onChange={uploadNovel} />
          </label>
        </Button>
        <Button type="primary" icon={<WandSparkles size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={generateAll}>全部生成</Button>
      </div>

      <div className="tts-card-grid">
        {!hasCards && (
          <div className="tts-empty">
            <div className="tts-empty-icon"><AudioLines size={28} strokeWidth={1.6} aria-hidden="true" /></div>
            <div>还没有配音卡片</div>
            <div>点击“添加卡片”输入文本，或上传小说自动填入开篇。</div>
          </div>
        )}

        {cards.map((card, index) => (
          <TtsCard
            key={card.id}
            card={card}
            index={index}
            onFocus={() => focusCard(card, index)}
            onChange={patch => updateCard(card.id, patch)}
            onGenerate={() => generateCard(card.id)}
            onDownload={() => downloadCard(card)}
            onRemove={() => removeCard(card.id)}
          />
        ))}
      </div>
    </div>
  );
}

export default TtsPage;

function TtsCard({ card, index, onFocus, onChange, onGenerate, onDownload, onRemove }) {
  const stat = useMemo(() => {
    const text = card.input || '';
    return {
      total: text.length,
      chinese: (text.match(/[\u4e00-\u9fa5]/g) || []).length,
      letters: (text.match(/[a-zA-Z]/g) || []).length
    };
  }, [card.input]);

  return (
    <div className="tts-card legacy-panel-card" tabIndex={0} onClick={onFocus} onFocus={onFocus}>
      <div className="tts-card-header">
        <strong>配音卡片 {index + 1}</strong>
        <Button size="small" danger icon={<Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />} onClick={onRemove}>删除</Button>
      </div>
      <div className="tts-card-body">
        <Input.TextArea
          className="legacy-input"
          rows={6}
          value={card.input}
          placeholder="在此输入要转换的文本..."
          onChange={event => onChange({ input: event.target.value })}
        />
        <div className="tts-stat">总计: {stat.total}　汉字: {stat.chinese}　字母: {stat.letters}</div>
        <Form layout="vertical">
          <Form.Item label="语音选择">
            <Select value={card.voice} options={voices} onChange={voice => onChange({ voice })} />
          </Form.Item>
          <Space wrap align="start">
            <Form.Item label="说话风格">
              <Select style={{ width: 140 }} value={card.style} options={styles} onChange={style => onChange({ style })} />
            </Form.Item>
            <Form.Item label="语速" style={{ width: 230 }}>
              <NumberSlider ariaLabel="卡片语速" min={0.5} max={2} step={0.1} value={card.speed} onChange={speed => onChange({ speed })} />
            </Form.Item>
            <Form.Item label="音调" style={{ width: 230 }}>
              <NumberSlider ariaLabel="卡片音调" min={-50} max={50} step={1} value={card.pitch} onChange={pitch => onChange({ pitch })} />
            </Form.Item>
          </Space>
        </Form>
        {card.audioUrl && <audio controls src={card.audioUrl} style={{ width: '100%' }} />}
      </div>
      <div className="tts-card-footer">
        <Button type="primary" icon={<WandSparkles size={16} strokeWidth={1.8} aria-hidden="true" />} loading={card.loading} onClick={onGenerate}>生成语音</Button>
        <Button icon={<Download size={16} strokeWidth={1.8} aria-hidden="true" />} disabled={!card.audioBlob} onClick={onDownload}>下载</Button>
      </div>
    </div>
  );
}
