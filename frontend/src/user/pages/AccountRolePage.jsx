import { Button, Drawer, Form, Input, InputNumber, Modal, Select, Skeleton, Switch, Tag, message } from 'antd';
import { MoreHorizontal, Plus, RefreshCw, ShieldAlert, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createAccount, getAccountDirectory, getAccountTransferPreview, transferAccountMember, updateAccount } from '../../shared/api/accountAdmin';
import { getMemberCenter } from '../../shared/api/member';
import { MemberIdentity, PageHeader, Panel, RoleBadge, formatTokens } from './accountCenterShared';

const ROLE_OPTIONS = [{ value: '', label: '全部角色' }, { value: 'dev', label: 'DEV' }, { value: 'manager', label: 'MANAGER' }, { value: 'member', label: 'MEMBER' }];
const STATE_OPTIONS = [{ value: '', label: '全部状态' }, { value: 'true', label: '正常' }, { value: 'false', label: '已停用' }];

function statusTag(account) {
  if (!account.active) return <Tag color="red">已停用</Tag>;
  return <Tag color="green">正常</Tag>;
}

function onlineTag(account) {
  return <Tag color={account.presence?.online ? 'blue' : 'default'}>{account.presence?.online ? '在线' : '离线'}</Tag>;
}

export default function AccountRolePage() {
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [teamOwners, setTeamOwners] = useState([]);
  const [filters, setFilters] = useState({ role: '', active: '', online: '', owner: '', query: '' });
  const [selected, setSelected] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [transferOwner, setTransferOwner] = useState('');
  const [resetLimit, setResetLimit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();
  const [createForm] = Form.useForm();

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const center = await getMemberCenter();
      if (center.member?.role !== 'dev') { setForbidden(true); setAccounts([]); return; }
      const [result, ownerResult] = await Promise.all([getAccountDirectory(filters), getAccountDirectory({ active: true })]);
      setForbidden(false);
      setAccounts(result.accounts || []);
      setTeamOwners((ownerResult.accounts || []).filter(item => ['dev', 'manager'].includes(item.role)));
    } catch (error) {
      if (error.status === 403) setForbidden(true);
      else message.error(error.message || '账号目录加载失败');
    } finally { if (!silent) setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const owners = useMemo(() => teamOwners.filter(item => item.active), [teamOwners]);
  const stats = useMemo(() => ({
    total: accounts.length,
    online: accounts.filter(item => item.presence?.online).length,
    disabled: accounts.filter(item => !item.active).length,
    unassigned: accounts.filter(item => item.role === 'member' && !item.boundTo).length
  }), [accounts]);

  function openDrawer(account) {
    setSelected(account);
    setTransferOwner('');
    setPreview(null);
    setResetLimit(false);
    form.setFieldsValue({ displayName: account.displayName, role: account.role, monthlyTokenLimit: account.monthlyTokenLimit, active: account.active });
    setDrawerOpen(true);
  }

  async function saveAccount(values) {
    if (!selected) return;
    setSaving(true);
    try {
      const result = await updateAccount(selected.username, values);
      setSelected(result.member);
      message.success('账号设置已保存');
      await load({ silent: true });
    } catch (error) { message.error(error.message || '账号设置保存失败'); }
    finally { setSaving(false); }
  }

  async function loadPreview() {
    if (!selected || !transferOwner) return;
    setSaving(true);
    try {
      const result = await getAccountTransferPreview(selected.username, transferOwner, { resetMonthlyTokenLimit: resetLimit });
      setPreview(result.preview);
    } catch (error) { message.error(error.message || '无法生成转移影响预览'); setPreview(null); }
    finally { setSaving(false); }
  }

  async function commitTransfer() {
    if (!selected || !preview?.requiresReauthorization) return;
    setSaving(true);
    try {
      await transferAccountMember(selected.username, { boundTo: transferOwner, resetMonthlyTokenLimit: resetLimit });
      message.success('成员已转移，状态为待重新授权');
      setDrawerOpen(false);
      await load({ silent: true });
    } catch (error) { message.error(error.message || '团队转移失败'); }
    finally { setSaving(false); }
  }

  async function submitCreate(values) {
    setSaving(true);
    try {
      await createAccount({ ...values, monthlyTokenLimit: values.monthlyTokenLimit ?? null, boundTo: values.role === 'member' ? values.boundTo : undefined });
      message.success('账号已创建');
      createForm.resetFields();
      setCreateOpen(false);
      await load({ silent: true });
    } catch (error) { message.error(error.message || '账号创建失败'); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="account-center-page"><Skeleton active paragraph={{ rows: 12 }} /></div>;
  if (forbidden) return <div className="account-center-page"><div className="ac-empty ac-load-error"><ShieldAlert size={24} /><strong>当前账号没有访问账号与角色的权限</strong><Button onClick={() => load()}>重试</Button></div></div>;

  return <div className="account-center-page account-role-page">
    <PageHeader title="账号与角色" subtitle="管理全局账号、团队归属和账号状态。成员转移后必须由新团队重新授权 AI 能力。" actions={<><Button icon={<RefreshCw size={16} />} onClick={() => load({ silent: true })}>刷新</Button><Button type="primary" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>创建账号</Button></>} />
    <div className="account-role-metrics"><span><b>{stats.total}</b>总账号</span><span><b>{stats.online}</b>在线</span><span><b>{stats.disabled}</b>已停用</span><span><b>{stats.unassigned}</b>未归属成员</span></div>
    <Panel className="account-role-directory" title="账号目录" action={<span className="ac-muted-copy">当前筛选 {accounts.length} 个账号</span>}>
      <div className="account-role-filters">
        <Select value={filters.role} options={ROLE_OPTIONS} onChange={value => setFilters(current => ({ ...current, role: value }))} />
        <Select value={filters.active} options={STATE_OPTIONS} onChange={value => setFilters(current => ({ ...current, active: value }))} />
        <Select value={filters.online} options={[{ value: '', label: '全部在线状态' }, { value: 'true', label: '在线' }, { value: 'false', label: '离线' }]} onChange={value => setFilters(current => ({ ...current, online: value }))} />
        <Select value={filters.owner} options={[{ value: '', label: '全部所属团队' }, ...owners.map(owner => ({ value: owner.username, label: owner.displayName || owner.username }))]} onChange={value => setFilters(current => ({ ...current, owner: value }))} />
        <Input.Search allowClear placeholder="搜索账号或显示名称" value={filters.query} onChange={event => setFilters(current => ({ ...current, query: event.target.value }))} onSearch={() => load()} />
      </div>
      <div className="account-role-table">
        <div className="account-role-table-head"><span>账号</span><span>角色</span><span>当前团队</span><span>API 托管负责人</span><span>状态</span><span>在线</span><span>本月用量</span><span /></div>
        {accounts.map(account => <div className="account-role-table-row" key={account.username}>
          <MemberIdentity member={account} /><RoleBadge role={account.role} compact /><span>{account.teamOwner?.team?.name || '未归属'}</span><span>{account.teamOwner ? account.teamOwner.displayName : '未设置'}</span>{statusTag(account)}{onlineTag(account)}<span>{formatTokens(account.usage?.month?.totalTokens)} Tokens</span><Button type="text" aria-label={`管理 ${account.username}`} icon={<MoreHorizontal size={18} />} onClick={() => openDrawer(account)} />
        </div>)}
        {!accounts.length ? <div className="ac-empty">没有符合条件的账号</div> : null}
      </div>
    </Panel>
    <Drawer className="account-role-drawer" title={selected ? `管理 @${selected.username}` : '账号管理'} width={520} open={drawerOpen} onClose={() => setDrawerOpen(false)} destroyOnClose>
      {selected ? <div className="account-role-drawer-content">
        <MemberIdentity member={selected} size={48} />
        <Form form={form} layout="vertical" onFinish={saveAccount}>
          <Form.Item name="displayName" label="显示名称" rules={[{ required: true, message: '请输入显示名称' }]}><Input /></Form.Item>
          <Form.Item name="role" label="角色"><Select options={ROLE_OPTIONS.filter(item => item.value)} disabled={selected.isOwner} /></Form.Item>
          <Form.Item name="monthlyTokenLimit" label="个人月度 Token 额度"><InputNumber min={0} precision={0} placeholder="不限额" className="account-role-full" /></Form.Item>
          <Form.Item name="active" label="账号状态" valuePropName="checked"><Switch checkedChildren="正常" unCheckedChildren="停用" disabled={selected.isOwner} /></Form.Item>
          <Button htmlType="submit" type="primary" loading={saving}>保存账号设置</Button>
        </Form>
        {selected.role === 'member' ? <section className="account-role-transfer"><h3>转移团队</h3><p>现有 API 授权会被清除，新团队须在组员管理页重新授予文本、生图或配音能力。</p>
          <Select placeholder="选择新的团队负责人" value={transferOwner || undefined} options={owners.filter(owner => owner.username !== selected.boundTo).map(owner => ({ value: owner.username, label: `${owner.displayName} · ${owner.role.toUpperCase()}` }))} onChange={value => { setTransferOwner(value); setPreview(null); }} />
          <Switch checked={resetLimit} onChange={value => { setResetLimit(value); setPreview(null); }} /> <span>同时重置个人额度为不限额</span>
          <Button disabled={!transferOwner} loading={saving} onClick={loadPreview}>查看影响预览</Button>
          {preview ? <div className="account-role-preview"><strong>待重新授权</strong><span>{preview.from?.team?.name || '未归属'} → {preview.to.team.name}</span><span>将清除：{preview.oldScopes.length ? preview.oldScopes.join(' / ') : '无 API 授权'}</span><Button type="primary" danger loading={saving} onClick={commitTransfer}>确认转移</Button></div> : null}
        </section> : null}
      </div> : null}
    </Drawer>
    <Modal title="创建账号" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} destroyOnClose><Form form={createForm} layout="vertical" initialValues={{ role: 'member' }} onFinish={submitCreate}>
      <Form.Item name="username" label="账号" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="displayName" label="显示名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="password" label="初始密码" rules={[{ required: true, min: 8 }]}><Input.Password /></Form.Item><Form.Item name="role" label="角色"><Select options={ROLE_OPTIONS.filter(item => item.value)} /></Form.Item><Form.Item noStyle shouldUpdate={(previous, current) => previous.role !== current.role}>{({ getFieldValue }) => getFieldValue('role') === 'member' ? <Form.Item name="boundTo" label="所属团队负责人" rules={[{ required: true, message: 'MEMBER 必须选择团队负责人' }]}><Select options={owners.map(owner => ({ value: owner.username, label: owner.displayName || owner.username }))} /></Form.Item> : null}</Form.Item><Form.Item name="monthlyTokenLimit" label="个人月度 Token 额度"><InputNumber min={0} precision={0} className="account-role-full" placeholder="不限额" /></Form.Item><Button htmlType="submit" type="primary" loading={saving}>创建</Button></Form></Modal>
  </div>;
}
