import { Alert, Button, Form, Input, Modal, Popconfirm, Segmented, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { createPresetDraft, listAdminPresets, publishPreset, rollbackPreset } from '../../shared/api/admin';

const modules = [
  { label: '剧本生成', value: 'script' },
  { label: '小说面板', value: 'novel-panel' },
  { label: '小说获取', value: 'novel-fetch' }
];

const constraintCategories = [
  { label: '画面前缀词', value: 'prefix' },
  { label: '画质约束', value: 'quality' },
  { label: '画面限制', value: 'restriction' },
  { label: '负面提示词', value: 'negative' }
];

const formatPriority = [
  'script-format-qban',
  'script-format-shotlist',
  'script-format-storyboard',
  'script-format-shortdrama',
  'script-format-screenplay'
];

function sortPresets(items) {
  return [...items].sort((left, right) => {
    const leftPriority = formatPriority.indexOf(left.id);
    const rightPriority = formatPriority.indexOf(right.id);
    const leftRank = leftPriority === -1 ? formatPriority.length : leftPriority;
    const rightRank = rightPriority === -1 ? formatPriority.length : rightPriority;
    return leftRank - rightRank || left.name.localeCompare(right.name, 'zh-CN');
  });
}

function errorMessage(error) {
  try {
    return JSON.parse(error.message).error || error.message;
  } catch (_) {
    return error.message || '操作失败';
  }
}

function emptyDraft(module) {
  return {
    id: '',
    module,
    name: '',
    kind: 'base',
    description: '',
    compatibleBaseIds: [],
    body: '',
    protocolLock: {}
  };
}

export function PresetLibraryPage() {
  const [module, setModule] = useState('script');
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingExisting, setEditingExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await listAdminPresets(module);
      setPresets(sortPresets(result.presets || []));
    } catch (requestError) {
      setPresets([]);
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [module]);

  function openCreate() {
    form.setFieldsValue({ ...emptyDraft(module), kind: 'addon' });
    setEditingExisting(false);
    setEditorOpen(true);
  }

  function openEdit(preset) {
    form.setFieldsValue({
      ...preset,
      constraintCategory: preset.protocolLock?.format === 'constraint' ? preset.protocolLock.category : '',
      protocolLock: JSON.stringify(preset.protocolLock || {}, null, 2)
    });
    setEditingExisting(true);
    setEditorOpen(true);
  }

  async function saveDraft(values) {
    let protocolLock;
    try {
      protocolLock = JSON.parse(values.protocolLock || '{}');
    } catch (_) {
      form.setFields([{ name: 'protocolLock', errors: ['协议锁必须是合法 JSON'] }]);
      return;
    }
    if (values.constraintCategory) {
      const prefix = `script-constraint-${values.constraintCategory}-`;
      if (module !== 'script' || values.kind !== 'addon' || !values.id.startsWith(prefix)) {
        form.setFields([{ name: 'id', errors: [`${values.constraintCategory} 类约束预设 ID 必须以 ${prefix} 开头`] }]);
        return;
      }
      protocolLock = { ...protocolLock, format: 'constraint', category: values.constraintCategory };
    }
    setSaving(true);
    try {
      await createPresetDraft({
        ...values,
        module,
        compatibleBaseIds: [],
        protocolLock
      });
      message.success('已保存为草稿，发布后才会影响用户生成。');
      setEditorOpen(false);
      load();
    } catch (requestError) {
      message.error(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function publish(preset) {
    try {
      await publishPreset(preset.id, preset.version);
      message.success('已发布，后续生成请求将立即使用此版本。');
      load();
    } catch (requestError) {
      message.error(errorMessage(requestError));
    }
  }

  async function rollback(preset) {
    try {
      await rollbackPreset(preset.id, preset.version);
      message.success('已回滚，后续生成请求将立即使用该历史版本。');
      load();
    } catch (requestError) {
      message.error(errorMessage(requestError));
    }
  }

  // 同一预设 ID 的多个版本折叠为一行：默认只显示“当前版本”，展开查看全部历史版本
  const grouped = useMemo(() => {
    const map = new Map();
    presets.forEach(preset => {
      if (!map.has(preset.id)) map.set(preset.id, []);
      map.get(preset.id).push(preset);
    });
    return [...map.entries()].map(([id, versions]) => {
      const sorted = [...versions].sort((a, b) => b.version - a.version);
      const published = versions.find(version => version.status === 'published');
      return {
        id,
        name: sorted[0].name,
        description: sorted[0].description,
        versions: sorted,
        current: published || sorted[0]
      };
    });
  }, [presets]);

  function statusTag(status) {
    return <Tag color={status === 'published' ? 'green' : status === 'draft' ? 'gold' : 'default'}>{status === 'published' ? '已发布' : status === 'draft' ? '草稿' : '已归档'}</Tag>;
  }

  const columns = [
    { title: '名称', dataIndex: 'name', width: 170 },
    { title: '预设词 ID', dataIndex: 'id', width: 190, ellipsis: true },
    { title: '说明', dataIndex: 'description', ellipsis: true },
    {
      title: '当前版本', width: 120,
      render: (_, row) => statusTag(row.current.status)
    },
    { title: '版本数', width: 84, render: (_, row) => row.versions.length },
    {
      title: '操作', key: 'actions', width: 150,
      render: (_, row) => <Button size="small" onClick={() => openEdit(row.current)}>编辑当前版本</Button>
    }
  ];

  const versionColumns = [
    { title: '版本', dataIndex: 'version', width: 76 },
    { title: '状态', dataIndex: 'status', width: 100, render: statusTag },
    { title: '更新时间', dataIndex: 'publishedAt', width: 180, render: value => value ? new Date(value).toLocaleString() : '' },
    {
      title: '操作', key: 'actions', width: 260,
      render: (_, preset) => (
        <Space size="small">
          <Button size="small" onClick={() => openEdit(preset)}>编辑为草稿</Button>
          {preset.status === 'draft' && <Popconfirm title="发布后将立即影响后续生成请求" onConfirm={() => publish(preset)}><Button size="small" type="primary">发布</Button></Popconfirm>}
          {preset.status === 'archived' && <Popconfirm title="确认将此历史版本设为当前线上版本" onConfirm={() => rollback(preset)}><Button size="small">回滚</Button></Popconfirm>}
        </Space>
      )
    }
  ];

  return (
    <section className="admin-preset-library">
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div className="admin-page-heading">
          <div>
            <Typography.Title level={3}>系统预设词</Typography.Title>
            <Typography.Paragraph>保存生成草稿，发布后自动由后端用于后续请求。普通用户无法读取正文。</Typography.Paragraph>
          </div>
          <Button type="primary" onClick={openCreate}>添加预设词</Button>
        </div>
        <Segmented options={modules} value={module} onChange={setModule} />
        {error && <Alert type="error" showIcon message="无法读取此模块预设词" description={error} />}
        <Table
          rowKey={row => row.id}
          dataSource={grouped}
          columns={columns}
          loading={loading}
          expandable={{
            rowExpandable: row => row.versions.length > 1,
            expandedRowRender: row => (
              <Table
                rowKey={version => `${row.id}-${version.version}`}
                size="small"
                pagination={false}
                dataSource={row.versions}
                columns={versionColumns}
              />
            )
          }}
          pagination={{ pageSize: 10, showSizeChanger: false, showTotal: total => `共 ${total} 个预设词` }}
        />
      </Space>
      <Modal title="系统预设词草稿" open={editorOpen} onCancel={() => setEditorOpen(false)} footer={null} width={760} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={saveDraft} initialValues={emptyDraft(module)}>
          <Space size="middle" style={{ width: '100%' }} align="start">
            <Form.Item label="预设词 ID" name="id" rules={[{ required: true, message: '请输入固定 ID' }, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, message: '只能使用字母、数字、点、下划线或短横线' }]} style={{ flex: 1 }}>
              <Input placeholder="例如 script-custom" />
            </Form.Item>
            <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]} style={{ flex: 1 }}>
              <Input placeholder="供管理员识别" />
            </Form.Item>
          </Space>
          <Form.Item name="kind" hidden><Input /></Form.Item>
          {!editingExisting && <Alert type="info" showIcon message="普通补充预设发布后会自动追加到模块请求；约束类别预设只会在用户明确选择时注入。" />}
          {module === 'script' && <Form.Item label="约束类别（可选）" name="constraintCategory">
            <Select allowClear placeholder="普通模块补充规则" options={constraintCategories} />
          </Form.Item>}
          <Form.Item label="用途说明" name="description"><Input placeholder="说明此预设词会影响的生成环节" /></Form.Item>
          <Form.Item label="系统预设词正文" name="body" rules={[{ required: true, message: '请输入系统预设词正文' }]}>
            <Input.TextArea rows={11} spellCheck={false} />
          </Form.Item>
          <Form.Item label="协议锁 JSON" name="protocolLock" rules={[{ required: true, message: '请输入协议锁 JSON' }]}>
            <Input.TextArea rows={4} spellCheck={false} />
          </Form.Item>
          <Space>
            <Button onClick={() => setEditorOpen(false)}>取消</Button>
            <Button type="primary" htmlType="submit" loading={saving}>保存草稿</Button>
          </Space>
        </Form>
      </Modal>
    </section>
  );
}
