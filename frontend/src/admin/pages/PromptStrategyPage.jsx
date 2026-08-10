import { Table, Tag, Typography } from 'antd';

const rows = [
  { key: 'continuous', name: '连续开头', type: '叙事策略', status: '启用' },
  { key: 'hook', name: '爆款开头', type: '叙事策略', status: '启用' },
  { key: 'screenplay', name: '剧情模式', type: '输出格式', status: '启用' },
  { key: 'storyboard', name: '画布模式', type: '输出格式', status: '启用' },
  { key: 'shortdrama', name: '剧本模式', type: '输出格式', status: '启用' }
];

export function PromptStrategyPage() {
  return (
    <>
      <Typography.Title level={3}>Prompt 策略</Typography.Title>
      <Typography.Paragraph>
        本页只展示策略元信息，不展示真实 prompt 原文。
      </Typography.Paragraph>
      <Table
        rowKey="key"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: '策略', dataIndex: 'name' },
          { title: '类型', dataIndex: 'type' },
          { title: '状态', dataIndex: 'status', render: value => <Tag color="green">{value}</Tag> }
        ]}
      />
    </>
  );
}
