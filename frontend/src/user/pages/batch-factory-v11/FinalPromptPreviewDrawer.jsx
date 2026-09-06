import { Alert, Descriptions, Drawer, Empty, Space, Spin, Tag, Typography } from 'antd';

function sourceLabel(source) {
  return {
    system: '系统默认',
    batch: '生产统一设置',
    book: '当前小说设置',
    video: '当前视频设置'
  }[source] || source || '未知来源';
}

function decoded(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function FinalPromptPreviewDrawer({ open, loading = false, data = null, error = '', onClose }) {
  const prompt = data?.finalPrompt || null;
  const effective = data?.effectiveSettings || prompt?.effectiveSettings || null;
  const values = effective?.values || {};
  const sources = effective?.sourceByField || {};
  const notices = effective?.compatibility || [];

  return <Drawer title="最终提示词预览" width={820} open={open} onClose={onClose} destroyOnClose={false}>
    {loading ? <div style={{ minHeight: 260, display: 'grid', placeItems: 'center' }}><Spin tip="服务端正在解析实际设置并编译提示词…" /></div> : null}
    {!loading && error ? <Alert type="error" showIcon message="无法生成预览" description={error} /> : null}
    {!loading && !error && !prompt ? <Empty description="请选择已完成编排的单个视频" /> : null}
    {!loading && prompt ? <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert type="info" showIcon message="只读预览" description="这里展示的内容由服务端按系统 → 批次 → 当前小说 → 单个视频的顺序生成；真正提交视频生产时会复用同一个编译器。" />
      <Descriptions size="small" bordered column={1}>
        <Descriptions.Item label="编排记录">{prompt.directorRevisionId}</Descriptions.Item>
        <Descriptions.Item label="设置快照">{prompt.snapshotHash}</Descriptions.Item>
        <Descriptions.Item label="视频 ID">{prompt.videoId}</Descriptions.Item>
      </Descriptions>
      {notices.map(item => <Alert key={`${item.field}:${item.state}`} type={item.state === 'incompatible' ? 'error' : 'warning'} showIcon message={`${item.field} · ${item.state}`} description={item.reason} />)}
      <section>
        <Typography.Title level={5}>编译结果</Typography.Title>
        <Typography.Paragraph copyable style={{ whiteSpace: 'pre-wrap', background: '#0f172a', color: '#e2e8f0', padding: 16, borderRadius: 8 }}>{prompt.compiledPrompt}</Typography.Paragraph>
      </section>
      <section>
        <Typography.Title level={5}>组成部分</Typography.Title>
        <Space direction="vertical" style={{ width: '100%' }}>
          {(prompt.components || []).map(item => <div key={item.key}><Tag color="blue">{item.label}</Tag><Typography.Text>{item.content}</Typography.Text></div>)}
        </Space>
      </section>
      <section>
        <Typography.Title level={5}>实际生效设置与来源</Typography.Title>
        <Descriptions size="small" bordered column={1}>
          {Object.keys(values).sort().map(key => <Descriptions.Item key={key} label={<Space><span>{key}</span><Tag>{sourceLabel(sources[key])}</Tag></Space>}>{decoded(values[key])}</Descriptions.Item>)}
        </Descriptions>
      </section>
    </Space> : null}
  </Drawer>;
}

export default FinalPromptPreviewDrawer;
