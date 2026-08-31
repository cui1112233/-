import { Alert, Button, Collapse, Drawer, Input, List, Space, Tabs, Tag, Typography } from 'antd';
import { Archive, FileText, FolderPlus, Upload, WandSparkles } from 'lucide-react';
import { useState } from 'react';

const HISTORY = [
  { id: '20260831-01', title: '批次 20260831-01', count: 100, directorDone: 46, review: 8, failed: 2, state: '制作中' },
  { id: '20260830-03', title: '批次 20260830-03', count: 80, directorDone: 80, review: 0, failed: 1, state: '待合并' },
  { id: '20260830-02', title: '批次 20260830-02', count: 100, directorDone: 100, review: 0, failed: 0, state: '已发布' },
  { id: '20260829-01', title: '批次 20260829-01', count: 60, directorDone: 60, review: 0, failed: 0, state: '已完成' }
];

export function BatchFactoryV11BatchManager({ open, initialTab = 'new', onClose, onOpenProductionSettings }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [manualText, setManualText] = useState('');

  const newBatch = <div className="bf11-batch-manager-pane">
    <Alert
      type="success"
      showIcon
      message="已接收小说获取任务 · 100 本"
      description="小说获取已经提供 sourceTaskId、Book ID、标题、平台、TXT 与来源元数据；批量工厂不会重新抓小说或再次要求输入 Book ID。"
    />

    <section className="bf11-batch-intake-card">
      <div>
        <Typography.Text strong>待建立批次</Typography.Text>
        <Typography.Text type="secondary">来源任务 NF-20260831-001 · 番茄小说 · 已选择 100 本</Typography.Text>
      </div>
      <Space wrap>
        <Tag>100 × TXT</Tag>
        <Tag>{'{bookId}.txt'}</Tag>
        <Tag color="green">来源完整</Tag>
      </Space>
    </section>

    <section className="bf11-batch-intake-actions">
      <div>
        <Typography.Text strong>创建前检查</Typography.Text>
        <Typography.Text type="secondary">先检查生产方式、模型、画幅、配置版本与约束，再由用户明确开始制作。</Typography.Text>
      </div>
      <Space wrap>
        <Button icon={<WandSparkles size={15} />} onClick={onOpenProductionSettings}>检查生产统一设置</Button>
        <Button type="primary" disabled>应用统一设置并开始制作</Button>
      </Space>
      <Typography.Text type="secondary">“开始制作”属于第二阶段真实逻辑；第一阶段不自动导演。</Typography.Text>
    </section>

    <Collapse
      ghost
      items={[{
        key: 'fallback',
        label: '其他导入方式（备用）',
        children: <div className="bf11-fallback-import">
          <Typography.Text type="secondary">正常批量用户从“小说获取”转入；这里只保留临时文案和本地文件的备用入口。</Typography.Text>
          <Typography.Text strong>手动粘贴</Typography.Text>
          <Input.TextArea
            rows={8}
            value={manualText}
            onChange={event => setManualText(event.target.value)}
            placeholder="粘贴小说正文；多篇可按分隔符拆分…"
          />
          <Space wrap>
            <Button icon={<FileText size={14} />} disabled={!manualText.trim()}>加入文案</Button>
            <Button icon={<Upload size={14} />}>上传 TXT / MD</Button>
          </Space>
          <Typography.Text type="secondary">第一阶段按钮只展示最终交互位置，不写入后端。</Typography.Text>
        </div>
      }]}
    />
  </div>;

  const history = <div className="bf11-batch-manager-pane">
    <div className="bf11-batch-manager-heading">
      <div>
        <Typography.Text strong>历史批次</Typography.Text>
        <Typography.Text type="secondary">重新进入以前创建过的批量生产任务。</Typography.Text>
      </div>
      <Tag>{HISTORY.length} 个示例批次</Tag>
    </div>
    <List
      dataSource={HISTORY}
      renderItem={item => <List.Item
        actions={[<Button key="open" size="small" disabled>打开</Button>]}
      >
        <List.Item.Meta
          avatar={<Archive size={18} />}
          title={<Space wrap><Typography.Text strong>{item.title}</Typography.Text><Tag>{item.state}</Tag></Space>}
          description={`${item.count} 本 · 导演完成 ${item.directorDone}/${item.count} · 待审核 ${item.review} · 失败 ${item.failed}`}
        />
      </List.Item>}
    />
    <Typography.Text type="secondary">历史批次读取与切换在第二阶段接 V11；UI 不调用旧 Node Batch 数据。</Typography.Text>
  </div>;

  return <Drawer
    title={<Space><FolderPlus size={18} /><span>批次管理</span></Space>}
    width={760}
    open={open}
    onClose={onClose}
  >
    <Tabs
      activeKey={activeTab}
      onChange={setActiveTab}
      items={[
        { key: 'new', label: '新建批次', children: newBatch },
        { key: 'history', label: '历史批次', children: history }
      ]}
    />
  </Drawer>;
}

export default BatchFactoryV11BatchManager;
