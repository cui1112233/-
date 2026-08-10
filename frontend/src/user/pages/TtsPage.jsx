import { Button, Form, Input, Select, Slider, Space, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
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

export function TtsPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioBlob, setAudioBlob] = useState(null);

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  async function handleGenerate(values) {
    setLoading(true);
    try {
      const blob = await textToSpeech(values);
      if (!blob || blob.size === 0) throw new Error('TTS 服务返回空音频');
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const nextUrl = URL.createObjectURL(blob);
      setAudioUrl(nextUrl);
      setAudioBlob(blob);
      message.success('语音生成成功');
    } catch (error) {
      message.error(error.message || '生成失败');
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!audioUrl || !audioBlob) return;
    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = `tts_${new Date().toISOString().slice(0, 10)}.mp3`;
    link.click();
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3}>文本配音</Typography.Title>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          voice: 'zh-CN-XiaoxiaoNeural',
          style: 'general',
          speed: 1,
          pitch: 0
        }}
        onFinish={handleGenerate}
      >
        <Form.Item label="配音文本" name="input" rules={[{ required: true, message: '请输入需要配音的文本' }]}>
          <Input.TextArea rows={8} placeholder="输入需要配音的文本" />
        </Form.Item>
        <Space wrap align="start">
          <Form.Item label="音色" name="voice">
            <Select style={{ width: 220 }} options={voices} />
          </Form.Item>
          <Form.Item label="风格" name="style">
            <Select style={{ width: 120 }} options={styles} />
          </Form.Item>
          <Form.Item label="语速" name="speed" style={{ width: 220 }}>
            <Slider min={0.5} max={2} step={0.1} />
          </Form.Item>
          <Form.Item label="音调" name="pitch" style={{ width: 220 }}>
            <Slider min={-50} max={50} step={1} />
          </Form.Item>
        </Space>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>生成音频</Button>
            <Button onClick={handleDownload} disabled={!audioBlob}>下载</Button>
          </Space>
        </Form.Item>
      </Form>
      {audioUrl && <audio controls src={audioUrl} style={{ width: '100%' }} />}
    </Space>
  );
}
