import { Button, Input, Modal, Popconfirm, Space, Table, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { clearHistory, deleteHistory, getHistory, listHistory } from '../../shared/api/history';

export function HistoryPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState({ open: false, title: '', content: '' });

  async function loadHistory() {
    setLoading(true);
    try {
      const data = await listHistory();
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (error) {
      message.error(error.message || '读取历史失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function handleOpen(entry) {
    try {
      const content = await getHistory(entry.id);
      setPreview({ open: true, title: entry.formatName || entry.format || '生成记录', content });
    } catch (error) {
      message.error(error.message || '读取记录失败');
    }
  }

  async function handleDelete(id) {
    try {
      await deleteHistory(id);
      message.success('已删除');
      await loadHistory();
    } catch (error) {
      message.error(error.message || '删除失败');
    }
  }

  async function handleClear() {
    try {
      await clearHistory();
      message.success('已清空');
      await loadHistory();
    } catch (error) {
      message.error(error.message || '清空失败');
    }
  }

  return (
    <Space className="utility-page history-page" direction="vertical" size={16} style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={3} style={{ margin: 0 }}>生成历史</Typography.Title>
        <Popconfirm title="清空全部历史？" onConfirm={handleClear}>
          <Button danger disabled={entries.length === 0}>清空</Button>
        </Popconfirm>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={entries}
        columns={[
          { title: '格式', dataIndex: 'formatName', render: (value, row) => value || row.format || '-' },
          { title: '模式', dataIndex: 'mode', render: value => <Tag>{value === 'hook' ? '爆款开头' : '连续开头'}</Tag> },
          { title: '时长', dataIndex: 'duration', width: 90 },
          { title: '预览', dataIndex: 'preview', ellipsis: true },
          { title: '时间', dataIndex: 'createdAt', width: 190, render: value => value ? new Date(value).toLocaleString() : '-' },
          {
            title: '操作',
            width: 150,
            render: (_, row) => (
              <Space>
                <Button size="small" onClick={() => handleOpen(row)}>查看</Button>
                <Popconfirm title="删除这条记录？" onConfirm={() => handleDelete(row.id)}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            )
          }
        ]}
      />
      <Modal
        title={preview.title}
        open={preview.open}
        width={860}
        footer={<Button onClick={() => setPreview({ open: false, title: '', content: '' })}>关闭</Button>}
        onCancel={() => setPreview({ open: false, title: '', content: '' })}
      >
        <Input.TextArea value={preview.content} rows={18} readOnly />
      </Modal>
    </Space>
  );
}
