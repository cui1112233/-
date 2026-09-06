import { Alert, Space, Tag, Typography } from 'antd';

function detailEntries(entries) {
  return (Array.isArray(entries) ? entries : []).filter(entry =>
    entry?.state === 'orphaned' || entry?.state === 'incompatible'
  );
}

function stateLabel(state) {
  if (state === 'orphaned') return '已孤立';
  if (state === 'incompatible') return '不兼容';
  return state || '未知状态';
}

export function OverrideCompatibilityDetails({ entries = [] }) {
  const details = detailEntries(entries);
  if (!details.length) return null;

  return <Alert
    type="warning"
    showIcon
    message="视频覆盖兼容性"
    description={<Space direction="vertical" size={6} style={{ width: '100%' }}>
      <Typography.Text type="secondary">以下明细直接来自服务端；旧视频覆盖不会被静默迁移到新视频。</Typography.Text>
      {details.map((entry, index) => <Space key={entry?.id || entry?.videoId || index} wrap>
        <Tag color={entry?.state === 'orphaned' ? 'gold' : 'red'}>{stateLabel(entry?.state)}</Tag>
        {entry?.videoId ? <Typography.Text code>{entry.videoId}</Typography.Text> : null}
        {entry?.reason || entry?.warning || entry?.message
          ? <Typography.Text>{entry.reason || entry.warning || entry.message}</Typography.Text>
          : null}
      </Space>)}
    </Space>}
  />;
}

export default OverrideCompatibilityDetails;
