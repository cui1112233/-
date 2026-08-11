import { Button, Form, Input, Select, Slider, Space, message } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { textToSpeech } from '../../shared/api/tts';

const voices = [
  { label: '晓晓（女声·温柔）', value: 'zh-CN-XiaoxiaoNeural' },
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

function createCard(text = '') {
  return {
    id: 'tts-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    input: text,
    voice: 'zh-CN-XiaoxiaoNeural',
    style: 'general',
    speed: 1,
    pitch: 0,
    loading: false,
    audioUrl: '',
    audioBlob: null
  };
}

export function TtsPage() {
  const [cards, setCards] = useState([]);
  const audioUrlsRef = useRef(new Set());

  useEffect(() => () => {
    audioUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    audioUrlsRef.current.clear();
  }, []);

  const hasCards = cards.length > 0;

  function updateCard(id, patch) {
    setCards(current => current.map(card => card.id === id ? { ...card, ...patch } : card));
  }

  function addCard(text) {
    setCards(current => [...current, createCard(text)]);
  }

  function removeCard(id) {
    setCards(current => {
      const card = current.find(item => item.id === id);
      if (card?.audioUrl) {
        URL.revokeObjectURL(card.audioUrl);
        audioUrlsRef.current.delete(card.audioUrl);
      }
      return current.filter(item => item.id !== id);
    });
  }

  async function generateCard(id) {
    const card = cards.find(item => item.id === id);
    if (!card?.input?.trim()) {
      message.warning('请先输入要转换的文本');
      return;
    }

    updateCard(id, { loading: true });
    try {
      const blob = await textToSpeech(card);
      if (!blob || blob.size === 0) throw new Error('TTS 服务返回空音频');
      if (card.audioUrl) {
        URL.revokeObjectURL(card.audioUrl);
        audioUrlsRef.current.delete(card.audioUrl);
      }
      const nextAudioUrl = URL.createObjectURL(blob);
      audioUrlsRef.current.add(nextAudioUrl);
      updateCard(id, {
        audioUrl: nextAudioUrl,
        audioBlob: blob,
        loading: false
      });
      message.success('语音生成成功');
    } catch (error) {
      updateCard(id, { loading: false, audioUrl: '', audioBlob: null });
      message.error(error.message || '生成失败');
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
        <Button type="primary" onClick={() => addCard()}>+ 添加卡片</Button>
        <Button>
          <label style={{ cursor: 'pointer' }}>
            上传小说
            <input type="file" accept=".txt" hidden onChange={uploadNovel} />
          </label>
        </Button>
        <Button type="primary" onClick={generateAll}>全部生成</Button>
      </div>

      <div className="tts-card-grid">
        {!hasCards && (
          <div className="tts-empty">
            <div className="tts-empty-icon">🎙</div>
            <div>还没有配音卡片</div>
            <div>点击“添加卡片”输入文本，或上传小说自动填入开篇。</div>
          </div>
        )}

        {cards.map((card, index) => (
          <TtsCard
            key={card.id}
            card={card}
            index={index}
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

function TtsCard({ card, index, onChange, onGenerate, onDownload, onRemove }) {
  const stat = useMemo(() => {
    const text = card.input || '';
    return {
      total: text.length,
      chinese: (text.match(/[\u4e00-\u9fa5]/g) || []).length,
      letters: (text.match(/[a-zA-Z]/g) || []).length
    };
  }, [card.input]);

  return (
    <div className="tts-card legacy-panel-card">
      <div className="tts-card-header">
        <strong>配音卡片 {index + 1}</strong>
        <Button size="small" onClick={onRemove}>删除</Button>
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
            <Form.Item label="语速" style={{ width: 170 }}>
              <Slider min={0.5} max={2} step={0.1} value={card.speed} onChange={speed => onChange({ speed })} />
            </Form.Item>
            <Form.Item label="音调" style={{ width: 170 }}>
              <Slider min={-50} max={50} step={1} value={card.pitch} onChange={pitch => onChange({ pitch })} />
            </Form.Item>
          </Space>
        </Form>
        {card.audioUrl && <audio controls src={card.audioUrl} style={{ width: '100%' }} />}
      </div>
      <div className="tts-card-footer">
        <Button type="primary" loading={card.loading} onClick={onGenerate}>生成语音</Button>
        <Button disabled={!card.audioBlob} onClick={onDownload}>下载</Button>
      </div>
    </div>
  );
}
