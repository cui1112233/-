import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { createAccount, listGlobalAccounts, updateAccount } from '../../shared/api/accountAdmin';
import { getMemberCenter } from '../../shared/api/member';

const ROLE_OPTIONS = [
  { value: 'member', label: 'MEMBER（普通成员）' },
  { value: 'manager', label: 'MANAGER（管理者）' }
];

function requestError(error, fallback) {
  try { return JSON.parse(error?.message || '').error || fallback; } catch (_) { return error?.message || fallback; }
}

function roleTag(role) {
  const color = role === 'dev' ? 'purple' : role === 'manager' ? 'blue' : 'default';
  return <Tag color={color}>{String(role || 'member').toUpperCase()}</Tag>;
}

export default function AccountRolePage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();

  async function load() {
    setLoading(true);
    setError('');
    try {
      const center = await getMemberCenter();
      if (center.member?.role !== 'dev') {
        setForbidden(true);
        setAccounts([]);
        return;
      }
      const result = await listGlobalAccounts();
      setForbidden(false);
      setAccounts(result.accounts || []);
    } catch (request) {
      if (request?.status === 403) setForbidden(true);
      else setError(requestError(request, '账号目录加载失败'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function submitCreate(values) {
    setSaving(true);
    try {
      await createAccount({ ...values, monthlyTokenLimit: null });
      message.success('账号已创建，角色已立即生效。');
      createForm.resetFields();
      setCreateOpen(false);
      await load();
    } catch (request) {
      message.error(requestError(request, '账号创建失败'));
    } finally {
      setSaving(false);
    }
  }

  function openEdit(account) {
    setEditing(account);
    editForm.setFieldsValue({ displayName: account.displayName, role: account.role, active: account.active });
  }

  async function submitEdit(values) {
    if (!editing) return;
    setSaving(true);
    try {
      await updateAccount(editing.username, values);
      message.success('账号与角色已更新。');
      setEditing(null);
      await load();
    } catch (request) {
      message.error(requestError(request, '账号更新失败'));
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { title: '账号', dataIndex: 'username', render: (username, account) => <div><strong>{account.displayName || username}</strong><br /><small>@{username}</small></div> },
    { title: '角色', dataIndex: 'role', render: roleTag },
    { title: '状态', dataIndex: 'active', render: active => <Tag color={active ? 'green' : 'default'}>{active ? '正常' : '已停用'}</Tag> },
    { title: '所属团队', render: (_, account) => account.teamOwner?.team?.name || (account.role === 'manager' ? '独立管理者' : '未归属') },
    { title: '操作', width: 116, render: (_, account) => account.role === 'dev' ? '当前开发者' : <Button size="small" onClick={() => openEdit(account)}>编辑角色</Button> }
  ];

  if (forbidden) return <section className="account-center-page"><Alert type="warning" showIcon message="当前账号没有“账号与角色”管理权限" description="只有 DEV 可以创建账号和调整全局角色。" /></section>;

  return <section className="account-center-page">
    <div className="admin-page-heading">
      <div>
        <Typography.Title level={2}>账号与角色</Typography.Title>
        <Typography.Paragraph>在这里直接新建账号并选择角色。新账号不需要先加入组员或团队；需要团队归属时，再到组员管理处理。</Typography.Paragraph>
      </div>
      <Space>
        <Button onClick={load} loading={loading}>刷新</Button>
        <Button type="primary" onClick={() => setCreateOpen(true)}>添加账号</Button>
      </Space>
    </div>
    {error ? <Alert type="error" showIcon message="无法读取账号目录" description={error} style={{ marginBottom: 16 }} /> : null}
    <Table rowKey="username" loading={loading} columns={columns} dataSource={accounts} scroll={{ x: 720 }} />

    <Modal title="添加账号并直接授权" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => createForm.submit()} confirmLoading={saving} okText="创建并授权" destroyOnClose>
      <Form form={createForm} layout="vertical" onFinish={submitCreate} initialValues={{ role: 'member' }}>
        <Form.Item name="username" label="登录账号" rules={[{ required: true, message: '请输入登录账号' }, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/, message: '账号为 2-32 位字母、数字、点、下划线或短横线' }]}><Input autoComplete="off" /></Form.Item>
        <Form.Item name="displayName" label="显示名称" rules={[{ required: true, message: '请输入显示名称' }]}><Input /></Form.Item>
        <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 8, message: '密码至少 8 位' }]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Form.Item name="role" label="直接授权为" rules={[{ required: true }]}><Select options={ROLE_OPTIONS} /></Form.Item>
        <Alert type="info" showIcon message="选择 MANAGER 后，账号创建完成即为管理者；无需先添加为组员。初始密码只用于本次创建，不会被回显。" />
      </Form>
    </Modal>

    <Modal title={editing ? `编辑 @${editing.username}` : '编辑角色'} open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => editForm.submit()} confirmLoading={saving} okText="保存" destroyOnClose>
      <Form form={editForm} layout="vertical" onFinish={submitEdit}>
        <Form.Item name="displayName" label="显示名称" rules={[{ required: true, message: '请输入显示名称' }]}><Input /></Form.Item>
        <Form.Item name="role" label="角色" rules={[{ required: true }]}><Select options={ROLE_OPTIONS} /></Form.Item>
        <Form.Item name="active" label="账号状态" rules={[{ required: true }]}><Select options={[{ value: true, label: '正常' }, { value: false, label: '停用' }]} /></Form.Item>
      </Form>
    </Modal>
  </section>;
}
