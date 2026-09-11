import { Space, Switch, Tag, Typography } from 'antd';
import { fixedVideoLabel } from './directorState.js';

export function FixedSingleVideoControl({
  checked = false,
  hasOverride = false,
  maxDurationSeconds = 0,
  onChange
}) {
  return <Space direction="vertical" size={4}>
    <Space wrap>
      <Switch checked={checked === true} onChange={value => onChange?.(value)} />
      {hasOverride
        ? <Tag color="purple">当前批次已覆盖：{checked ? '开启' : '关闭'}</Tag>
        : <Tag>当前批次未覆盖</Tag>}
    </Space>
    <Typography.Text type="secondary">
      {fixedVideoLabel({ maxDurationSeconds })}；开启后由 Go Director 保证整本只持久化一个 VIDEO identity。
    </Typography.Text>
  </Space>;
}

export default FixedSingleVideoControl;
