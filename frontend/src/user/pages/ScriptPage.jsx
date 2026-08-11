import { Button, Form, Input, Select, Segmented, Space, Typography, message } from 'antd';
import { useRef, useState } from 'react';
import { extractCharactersAndScenes, generateScript } from '../../shared/api/generation';
import { saveHistory } from '../../shared/api/history';

function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const match = String(text || '').match(/```json\s*([\s\S]*?)```/);
    if (match) return JSON.parse(match[1]);
    throw error;
  }
}

function aiText(response) {
  return response?.choices?.[0]?.message?.content || '';
}

function normalizeExtraction(data) {
  return {
    characters: data?.人物 || data?.characters || [],
    scenes: data?.场景 || data?.scenes || []
  };
}

function formatEntity(item) {
  if (typeof item === 'string') return item;
  return JSON.stringify(item, null, 2);
}

export function ScriptPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [extractInfo, setExtractInfo] = useState({ characters: [], scenes: [] });
  const [output, setOutput] = useState('');
  const [leftPanelWidth, setLeftPanelWidth] = useState(null);
  const workbenchRef = useRef(null);

  function handleResizeStart(event) {
    if (event.button !== 0 || !workbenchRef.current) return;

    event.preventDefault();
    const workbench = workbenchRef.current;

    function resize(moveEvent) {
      const rect = workbench.getBoundingClientRect();
      const minLeft = 320;
      const minRight = 460;
      const dividerWidth = 8;
      const nextWidth = Math.min(
        rect.width - minRight - dividerWidth,
        Math.max(minLeft, moveEvent.clientX - rect.left)
      );
      setLeftPanelWidth(nextWidth);
    }

    function finishResize() {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finishResize);
      document.body.classList.remove('is-resizing');
    }

    document.body.classList.add('is-resizing');
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finishResize, { once: true });
  }

  async function handleGenerate(values) {
    setLoading(true);
    setOutput('');
    try {
      const extractResponse = await extractCharactersAndScenes(values.novelText);
      const extraction = normalizeExtraction(extractJSON(aiText(extractResponse)));
      setExtractInfo(extraction);

      const scriptResponse = await generateScript({
        mode: values.mode,
        format: values.format,
        duration: values.duration,
        novelText: values.novelText,
        characters: extraction.characters,
        scenes: extraction.scenes
      });
      const nextOutput = aiText(scriptResponse);

      try {
        await saveHistory({
          id: 'react-' + Date.now().toString(36),
          mode: values.mode,
          format: values.format,
          formatName: { storyboard: '画布模式', shortdrama: '剧本模式', screenplay: '剧情模式' }[values.format] || '剧本',
          duration: values.duration,
          output: nextOutput
        });
      } catch (error) {
        message.warning('生成成功，但保存历史失败');
      }
      setOutput(nextOutput);
      message.success('生成完成');
    } catch (error) {
      setOutput('');
      message.error(error.message || '生成失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Form
      className="script-workbench-form"
      form={form}
      initialValues={{ mode: 'continuous', format: 'storyboard', duration: '10s' }}
      onFinish={handleGenerate}
    >
      <div
        ref={workbenchRef}
        className="script-workbench utility-workbench"
        style={leftPanelWidth ? { gridTemplateColumns: `${leftPanelWidth}px 8px minmax(460px, 1fr)` } : undefined}
      >
        <div className="script-left">
        <div className="script-left-scroll">
          <Form.Item name="novelText" rules={[{ required: true, message: '请先粘贴小说原文' }]}>
            <Input.TextArea className="legacy-input" rows={12} placeholder="在此粘贴小说章节内容..." />
          </Form.Item>
          <Button type="primary" block htmlType="submit" loading={loading}>
            {loading ? '生成中...' : '提取人物与场景并生成'}
          </Button>

          <EntitySection title="人物" count={extractInfo.characters.length} items={extractInfo.characters} />
          <EntitySection title="场景" count={extractInfo.scenes.length} items={extractInfo.scenes} />
        </div>
      </div>
        <div
          className="script-resize-handle"
          role="separator"
          aria-label="调整左右面板宽度"
          aria-orientation="vertical"
          onPointerDown={handleResizeStart}
        />
        <div className="script-right">
        <div className="script-tabs">
          <Form.Item name="mode" noStyle>
            <Segmented
              options={[
                { label: '连续开头', value: 'continuous' },
                { label: '爆款开头', value: 'hook' }
              ]}
            />
          </Form.Item>
          <div style={{ flex: 1 }} />
          <Form.Item name="duration" noStyle>
            <Segmented options={['10s', '15s']} />
          </Form.Item>
        </div>
        <div className="script-toolbar">
          <Form.Item name="format" noStyle>
            <Select
              style={{ width: 140 }}
              options={[
                { label: '画布模式', value: 'storyboard' },
                { label: '剧本模式', value: 'shortdrama' },
                { label: '剧情模式', value: 'screenplay' }
              ]}
            />
          </Form.Item>
          <Space>
            <Button onClick={() => navigator.clipboard?.writeText(output || '')} disabled={!output}>复制</Button>
            <Button disabled={!output}>导出</Button>
          </Space>
        </div>
        <div className="script-output">
          {output ? (
            <Input.TextArea className="legacy-output" value={output} rows={24} readOnly />
          ) : loading ? (
            <CmLoader />
          ) : (
            <div className="script-empty legacy-panel-card">
              <div className="script-empty-icon">📄</div>
              <div>粘贴小说内容，点击“提取人物与场景并生成”开始</div>
            </div>
          )}
        </div>
        </div>
      </div>
    </Form>
  );
}

function CmLoader() {
  return (
    <div className="cm-loader" role="status" aria-live="polite">
      <svg className="cm-loader-defs" aria-hidden="true">
        <defs>
          <linearGradient id="cm-blue">
            <stop stopColor="#973bed" />
            <stop offset="1" stopColor="#007cff" />
          </linearGradient>
          <linearGradient id="cm-spin">
            <stop stopColor="#ffc800" />
            <stop offset="1" stopColor="#ff00ff" />
          </linearGradient>
          <linearGradient id="cm-green">
            <stop stopColor="#00e0ed" />
            <stop offset="1" stopColor="#00da72" />
          </linearGradient>
        </defs>
      </svg>
      <div className="cm-loader-mark" aria-hidden="true">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <path
            className="cm-loader-dash"
            pathLength="360"
            stroke="url(#cm-blue)"
            strokeWidth="8"
            d="M54.7 4H60C59 17 49.1 27.7 36.1 29.6V60h-6.5V31.6C16.6 29.7 6.7 17 5.7 4H9.3c1.2 11.6 11 20.6 22.7 20.7C43.8 24.8 53.7 15.7 54.7 4Z"
          />
        </svg>
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <path
            className="cm-loader-spin"
            pathLength="360"
            stroke="url(#cm-spin)"
            strokeWidth="10"
            d="M32 32m0-27a27 27 0 1 1 0 54a27 27 0 1 1 0-54"
          />
        </svg>
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <path
            className="cm-loader-dash"
            pathLength="360"
            stroke="url(#cm-green)"
            strokeWidth="8"
            d="M4 4h4.6v25.9c0 11.9 9.8 21.6 21.8 21.3c11.6-.2 21-9.6 21.3-21.3V4h4.6v25.9c0 14.3-11.6 25.9-25.9 25.9C16 56.1 4 44.4 4 29.9Z"
          />
        </svg>
      </div>
      <strong>正在生成剧本</strong>
      <span>正在提取人物、场景并组织剧情</span>
    </div>
  );
}

function EntitySection({ title, count, items }) {
  return (
    <div className="entity-section legacy-panel-card">
      <div className="entity-section-header">
        <Typography.Text strong>{title}</Typography.Text>
        <span className="legacy-muted">{count}</span>
      </div>
      <div className="entity-list">
        {items.length === 0 ? (
          <div className="entity-card">生成后会显示{title}信息</div>
        ) : (
          items.map((item, index) => <div className="entity-card" key={index}>{formatEntity(item)}</div>)
        )}
      </div>
    </div>
  );
}
