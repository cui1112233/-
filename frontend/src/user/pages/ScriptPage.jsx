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
      setOutput(nextOutput);

      await saveHistory({
        id: 'react-' + Date.now().toString(36),
        mode: values.mode,
        format: values.format,
        formatName: { storyboard: '画布模式', shortdrama: '剧本模式', screenplay: '剧情模式' }[values.format] || '剧本',
        duration: values.duration,
        output: nextOutput
      });
      message.success('生成完成');
    } catch (error) {
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
