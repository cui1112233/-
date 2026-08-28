import { Alert, Button, Form, Input, Modal, Popconfirm, Segmented, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { createPresetDraft, listAdminPresets, publishPreset, rollbackPreset } from '../../shared/api/admin';

const modules = [
  { label: '剧本生成', value: 'script' },
  { label: '小说面板', value: 'novel-panel' },
  { label: '批量工厂', value: 'batch-factory' }
];

const destinationMap = {
  script: [
    { value: 'script-addon', label: '剧本生成 / 通用补充规则', prefix: 'script-addon-custom', kind: 'addon', protocolLock: { format: 'script' } },
    { value: 'script-prefix', label: '剧本生成 / 画面前缀词', prefix: 'script-constraint-prefix-custom', kind: 'addon', protocolLock: { format: 'constraint', category: 'prefix' } },
    { value: 'script-quality', label: '剧本生成 / 画质约束', prefix: 'script-constraint-quality-custom', kind: 'addon', protocolLock: { format: 'constraint', category: 'quality' } },
    { value: 'script-restriction', label: '剧本生成 / 画面限制', prefix: 'script-constraint-restriction-custom', kind: 'addon', protocolLock: { format: 'constraint', category: 'restriction' } },
    { value: 'script-negative', label: '剧本生成 / 负面提示词', prefix: 'script-constraint-negative-custom', kind: 'addon', protocolLock: { format: 'constraint', category: 'negative' } }
  ],
  'novel-panel': [
    { value: 'novel-analysis', label: '小说面板 / 内容分析', prefix: 'novel-analysis-custom', kind: 'base', protocolLock: { format: 'json', operation: 'analysis' } },
    { value: 'novel-character', label: '小说面板 / 人物卡', prefix: 'novel-character-custom', kind: 'base', protocolLock: { format: 'json', operation: 'character' } },
    { value: 'novel-outline', label: '小说面板 / 分镜生成', prefix: 'novel-outline-custom', kind: 'base', protocolLock: { format: 'json', operation: 'outline', qualityGate: true } }
  ],
  'batch-factory': [
    { value: 'batch-script', label: '批量工厂 / 剧本提示词', prefix: 'batch-script-custom', kind: 'base', protocolLock: { format: 'batch-factory-preset', category: 'script' } },
    { value: 'batch-asset', label: '批量工厂 / 人物场景提示词', prefix: 'batch-asset-custom', kind: 'base', protocolLock: { format: 'batch-factory-preset', category: 'asset' } }
  ]
};

function errorMessage(error) {
  try {
    return JSON.parse(error.message).error || error.message;
  } catch (_) {
    return error.message || '操作失败';
  }
}

function randomSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function destinationForPreset(preset) {
  const lock = preset?.protocolLock || {};
  if (preset?.module === 'batch-factory') {
    if (lock.format === 'batch-factory-preset' && lock.category === 'script') return 'batch-script';
    if (lock.format === 'batch-factory-preset' && lock.category === 'asset') return 'batch-asset';
    return 'batch-internal';
  }
  if (preset?.module === 'script') {
    if (lock.format === 'constraint') return `script-${lock.category}`;
    return 'script-addon';
  }
  if (preset?.module === 'novel-panel') {
    if (lock.operation === 'character') return 'novel-character';
    if (lock.operation === 'outline') return 'novel-outline';
    return 'novel-analysis';
  }
  return '';
}

function destinationConfig(module, destination) {
  return (destinationMap[module] || []).find(item => item.value === destination) || null;
}

function currentRows(items) {
  const grouped = new Map();
  for (const item of items) {
    const previous = grouped.get(item.id);
    if (!previous || Number(item.version) > Number(previous.version)) grouped.set(item.id, item);
  }
  return [...grouped.values()];
}

function historyRows(items) {
  const current = new Map(currentRows(items).map(item => [item.id, item.version]));
  return items.filter(item => Number(current.get(item.id)) !== Number(item.version));
}

export function PresetLibraryPage() {
  const [module, setModule] = useState('script');
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingExisting, setEditingExisting] = useState(false);
  const [editingPreset, setEditingPreset] = useState(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState('current');
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await listAdminPresets(module);
      setPresets(result.presets || []);
    } catch (requestError) {
      setPresets([]);
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [module]);

  function applyDestination(nextModule, destination, { keepId = false, id = '' } = {}) {
    const config = destinationConfig(nextModule, destination);
    if (!config) return;
    form.setFieldsValue({
      destination,
      kind: config.kind,
      id: keepId && id ? id : `${config.prefix}-${randomSuffix()}`,
      protocolLock: JSON.stringify(config.protocolLock, null, 2)
    });
  }

  function openCreate() {
    const destination = destinationMap[module]?.[0]?.value || '';
    setEditingExisting(false);
    setEditingPreset(null);
    form.resetFields();
    form.setFieldsValue({
      module,
      name: '',
      description: '',
      body: '',
      compatibleBaseIds: []
    });
    applyDestination(module, destination);
    setEditorOpen(true);
  }

  function openEdit(preset) {
    setEditingExisting(true);
    setEditingPreset(preset);
    form.resetFields();
    form.setFieldsValue({
      ...preset,
      destination: destinationForPreset(preset),
      protocolLock: JSON.stringify(preset.protocolLock || {}, null, 2)
    });
    setEditorOpen(true);
  }

  async function saveAndPublish() {
    let values;
    try {
      values = await form.validateFields();
    } catch (_) {
      return;
    }
    let protocolLock;
    try {
      protocolLock = JSON.parse(values.protocolLock || '{}');
    } catch (_) {
      form.setFields([{ name: 'protocolLock', errors: ['自动协议锁异常，请重新选择归属'] }]);
      return;
    }
    setSaving(true);
    try {
      const result = await createPresetDraft({
        id: values.id,
        module,
        name: values.name,
        kind: values.kind,
        description: values.description || '',
        compatibleBaseIds: [],
        body: values.body,
        protocolLock
      });
      await publishPreset(result.preset.id, result.preset.version);
      message.success(editingExisting ? '提示词已保存并覆盖当前生效版本。' : '提示词已添加并立即发布。');
      setEditorOpen(false);
      await load();
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

  const dataSource = useMemo(() => (
    view === 'current' ? currentRows(presets) : historyRows(presets)
  ), [presets, view]);

  const columns = [
    { title: '名称', dataIndex: 'name', width: 190 },
    { title: '预设词 ID', dataIndex: 'id', width: 230, ellipsis: true },
    {
      title: '归属', key: 'destination', width: 190,
      render: (_, preset) => {
        const destination = destinationForPreset(preset);
        const label = (destinationMap[preset.module] || []).find(item => item.value === destination)?.label;
        return <Tag color={preset.module === 'batch-factory' ? 'purple' : 'blue'}>{label || '系统内部预设'}</Tag>;
      }
    },
    { title: '说明', dataIndex: 'description', ellipsis: true },
    { title: '版本', dataIndex: 'version', width: 72 },
    {
      title: '状态', dataIndex: 'status', width: 94,
      render: status => <Tag color={status === 'published' ? 'green' : status === 'draft' ? 'gold' : 'default'}>{status === 'published' ? '已发布' : status === 'draft' ? '草稿' : '历史'}</Tag>
    },
    {
      title: '操作', key: 'actions', width: 250,
      render: (_, preset) => (
        <Space size="small">
          {preset.status !== 'archived' ? <Button size="small" onClick={() => openEdit(preset)}>直接编辑</Button> : null}
          {preset.status === 'draft' ? <Popconfirm title="发布后将立即影响后续生成请求" onConfirm={() => publish(preset)}><Button size="small" type="primary">发布现有草稿</Button></Popconfirm> : null}
          {preset.status === 'archived' ? <Popconfirm title="确认将此历史版本设为当前线上版本" onConfirm={() => rollback(preset)}><Button size="small">回滚</Button></Popconfirm> : null}
        </Space>
      )
    }
  ];

  const destinationOptions = destinationMap[module] || [];
  const editingInternalBatchPreset = editingExisting && module === 'batch-factory' && destinationForPreset(editingPreset) === 'batch-internal';

  return (
    <section style={{ width: '100%' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <Typography.Title level={3} style={{ marginTop: 0 }}>系统预设词</Typography.Title>
            <Typography.Paragraph>直接编辑后可立即覆盖当前生效版本；历史版本单独收纳，不再在主列表无限叠加。</Typography.Paragraph>
          </div>
          <Button type="primary" onClick={openCreate}>添加提示词</Button>
        </div>

        <Space wrap>
          <Segmented options={modules} value={module} onChange={value => { setModule(value); setView('current'); }} />
          <Segmented value={view} onChange={setView} options={[{ value: 'current', label: '当前预设' }, { value: 'history', label: '历史版本' }]} />
        </Space>

        {module === 'batch-factory' ? <Alert
          type="info"
          showIcon
          message="批量工厂提示词"
          description="添加时只需要选择归属、填写名称和正文。预设词 ID 与协议锁自动生成。发布后会自动出现在个人中心提示词库和批量工厂生产统一设置中。"
        /> : null}
        {error ? <Alert type="error" showIcon message="无法读取此模块预设词" description={error} /> : null}

        <Table
          rowKey={preset => `${preset.id}-${preset.version}`}
          dataSource={dataSource}
          columns={columns}
          loading={loading}
          pagination={{ pageSize: 12, showSizeChanger: false, showTotal: total => view === 'current' ? `共 ${total} 个预设` : `共 ${total} 个历史版本` }}
        />
      </Space>

      <Modal
        title={editingExisting ? '直接编辑系统提示词' : '添加系统提示词'}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        footer={null}
        width={820}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          {editingInternalBatchPreset ? <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="这是批量工厂内部流程预设"
            description="内部元提示词保留原 ID 和协议锁。普通用户可选的新提示词请使用“添加提示词”，归属选择剧本提示词或人物场景提示词。"
          /> : null}

          {!editingInternalBatchPreset ? <Form.Item label="归属" name="destination" rules={[{ required: true, message: '请选择归属' }]}>
            <Select
              disabled={editingExisting}
              options={destinationOptions}
              fieldNames={{ label: 'label', value: 'value' }}
              onChange={value => applyDestination(module, value)}
              placeholder="选择后自动生成 ID 与协议锁"
            />
          </Form.Item> : null}

          <Space size="middle" style={{ width: '100%' }} align="start">
            <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]} style={{ flex: 1 }}>
              <Input placeholder="例如 我的强冲突短剧分镜" />
            </Form.Item>
            <Form.Item label="预设词 ID（自动）" name="id" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input readOnly />
            </Form.Item>
          </Space>

          <Form.Item name="kind" hidden><Input /></Form.Item>
          <Form.Item label="用途说明" name="description">
            <Input placeholder="说明这个提示词适合什么生产场景" />
          </Form.Item>
          <Form.Item label="提示词正文" name="body" rules={[{ required: true, message: '请输入提示词正文' }]}>
            <Input.TextArea rows={15} spellCheck={false} placeholder="直接在这里编辑完整提示词内容" />
          </Form.Item>
          <Form.Item label="协议锁（系统自动）" name="protocolLock" rules={[{ required: true }]}>
            <Input.TextArea rows={4} readOnly spellCheck={false} />
          </Form.Item>

          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 16 }}
            message="保存会直接成为当前生效版本"
            description="系统仍保留历史版本用于回滚，但历史版本只在“历史版本”页查看，不会在当前预设列表反复叠加。"
          />

          <Space>
            <Button onClick={() => setEditorOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={saveAndPublish}>{editingExisting ? '保存并覆盖生效' : '添加并发布'}</Button>
          </Space>
        </Form>
      </Modal>
    </section>
  );
}
