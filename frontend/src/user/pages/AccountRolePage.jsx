import { Button, Drawer, Form, Input, InputNumber, Modal, Select, Skeleton, Switch, Tag, message } from 'antd';
import { KeyRound, MoreHorizontal, Plus, RefreshCw, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createAccount, getAccountDirectory, getAccountTransferPreview, transferAccountMember, updateAccount } from '../../shared/api/accountAdmin';
import { createAdminGrant, listAdminGrants, revokeAdminGrant } from '../../shared/api/admin';
import { getMemberCenter } from '../../shared/api/member';
import { MemberIdentity, PageHeader, Panel, RoleBadge, formatTokens } from './accountCenterShared';
import '../../shared/styles/account-role.css';

const ROLE_OPTIONS = [{ value: '', label: '全部角色' }, { value: 'dev', label: 'DEV' }, { value: 'manager', label: 'MANAGER' }, { value: 'member', label: 'MEMBER' }];
const STATE_OPTIONS = [{ value: '', label: '全部状态' }, { value: 'true', label: '正常' }, { value: 'false', label: '已停用' }];
const BACKEND_SCOPE_OPTIONS = [
  { value: '*', label: '全部模块' },
  { value: 'script', label: '剧本生成' },
  { value: 'novel-panel', label: '小说面板' }
];
const MANAGER_BACKEND_CAPABILITIES = [
  { value: 'admin:access', label: '管理后台访问', description: '允许进入管理后台。', fixedScope: '*' },
  { value: 'account:review', label: '账号审核', description: '允许审核账号申请与维护账号状态。', fixedScope: '*' },
  { value: 'preset:draft', label: '预设词草稿', description: '允许在指定模块创建和编辑预设草稿。' },
  { value: 'preset:publish', label: '预设词发布', description: '允许在指定模块发布或回滚预设版本。' }
];

function statusTag(account) {
  if (!account.active) return <Tag color="red">已停用</Tag>;
  return <Tag color="green">正常</Tag>;
}

function onlineTag(account) {
  return <Tag color={account.presence?.online ? 'blue' : 'default'}>{account.presence?.online ? '在线' : '离线'}</Tag>;
}

function permissionDraftFor(username, grants) {
  const subjectGrants = grants.filter(grant => grant.subject === username);
  return Object.fromEntries(MANAGER_BACKEND_CAPABILITIES.map(capability => {
    const matches = subjectGrants.filter(grant => grant.capability === capability.value);
    return [capability.value, {
      enabled: matches.length > 0,
      scope: capability.fixedScope || matches[0]?.scope || '*'
    }];
  }));
}

function permissionKey(capability, scope) {
  return `${capability}::${scope}`;
}

export default function AccountRolePage() {
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [teamOwners, setTeamOwners] = useState([]);
  const [grants, setGrants] = useState([]);
  const [filters, setFilters] = useState({ role: '', active: '', online: '', owner: '', query: '' });
  const [selected, setSelected] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [transferOwner, setTransferOwner] = useState('');
  const [resetLimit, setResetLimit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [permissionSaving, setPermissionSaving] = useState(false);
  const [permissionDraft, setPermissionDraft] = useState({});
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();
  const [createForm] = Form.useForm();

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const center = await getMemberCenter();
      if (center.member?.role !== 'dev') { setForbidden(true); setAccounts([]); setGrants([]); return; }
      const [result, ownerResult, grantResult] = await Promise.all([
        getAccountDirectory(filters),
        getAccountDirectory({ active: true }),
        listAdminGrants()
      ]);
      setForbidden(false);
      setAccounts(result.accounts || []);
      setTeamOwners((ownerResult.accounts || []).filter(item => ['dev', 'manager'].includes(item.role)));
      setGrants(grantResult.grants || []);
    } catch (error) {
      if (error.status === 403) setForbidden(true);
      else message.error(error.message || '账号目录加载失败');
    } finally { if (!silent) setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const owners = useMemo(() => teamOwners.filter(item => item.active), [teamOwners]);
  const grantsBySubject = useMemo(() => grants.reduce((map, grant) => {
    map[grant.subject] = [...(map[grant.subject] || []), grant];
    return map;
  }, {}), [grants]);
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
    setPermissionDraft(permissionDraftFor(account.username, grants));
    form.setFieldsValue({ displayName: account.displayName, role: account.role, monthlyTokenLimit: account.monthlyTokenLimit, active: account.active });
    setDrawerOpen(true);
  }

  async function saveAccount(values) {
    if (!selected) return;
    setSaving(true);
    try {
      const result = await updateAccount(selected.username, values);
      setSelected(result.member);
      if (result.member.role !== 'manager') setPermissionDraft({});
      message.success('账号设置已保存');
      await load({ silent: true });
    } catch (error) { message.error(error.message || '账号设置保存失败'); }
    finally { setSaving(false); }
  }

  async function saveBackendPermissions() {
    if (!selected || selected.role !== 'manager') return;
    setPermissionSaving(true);
    try {
      const current = grants.filter(grant => grant.subject === selected.username);
      const desired = MANAGER_BACKEND_CAPABILITIES.flatMap(capability => {
        const draft = permissionDraft[capability.value];
        if (!draft?.enabled) return [];
        return [{ capability: capability.value, scope: capability.fixedScope || draft.scope || '*' }];
      });
      const desiredKeys = new Set(desired.map(item => permissionKey(item.capability, item.scope)));
      const currentKeys = new Set(current.map(item => permissionKey(item.capability, item.scope)));

      for (const grant of current) {
        if (!desiredKeys.has(permissionKey(grant.capability, grant.scope))) await revokeAdminGrant(grant.id);
      }
      for (const item of desired) {
        if (!currentKeys.has(permissionKey(item.capability, item.scope))) {
          await createAdminGrant({ subject: selected.username, capability: item.capability, scope: item.scope });
        }
      }
      const result = await listAdminGrants();
      const nextGrants = result.grants || [];
      setGrants(nextGrants);
      setPermissionDraft(permissionDraftFor(selected.username, nextGrants));
      message.success('后台权限已保存');
    } catch (error) { message.error(error.message || '后台权限保存失败'); }
    finally { setPermissionSaving(false); }
  }

  function updatePermission(capability, patch) {
    setPermissionDraft(current => ({
      ...current,
      [capability]: { ...(current[capability] || { enabled: false, scope: '*' }), ...patch }
    }));
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
    <PageHeader title="账号与角色" subtitle="统一管理 DEV / MANAGER / MEMBER、团队归属、账号状态和 MANAGER 后台权限。" actions={<><Button icon={<RefreshCw size={16} />} onClick={() => load({ silent: true })}>刷新</Button><Button type="primary" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>创建账号</Button></>} />
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
        <div className="account-role-table-head"><span>账号</span><span>角色</span><span>后台权限</span><span>当前团队</span><span>API 托管负责人</span><span>状态</span><span>在线</span><span>本月用量</span><span /></div>
        {accounts.map(account => <div className="account-role-table-row" key={account.username}>
          <MemberIdentity member={account} /><RoleBadge role={account.role} compact /><span>{account.role === 'manager' ? `${(grantsBySubject[account.username] || []).length} 项` : '—'}</span><span>{account.teamOwner?.team?.name || '未归属'}</span><span>{account.teamOwner ? account.teamOwner.displayName : '未设置'}</span>{statusTag(account)}{onlineTag(account)}<span>{formatTokens(account.usage?.month?.totalTokens)} Tokens</span><Button type="text" aria-label={`管理 ${account.username}`} icon={<MoreHorizontal size={18} />} onClick={() => openDrawer(account)} />
        </div>)}
        {!accounts.length ? <div className="ac-empty">没有符合条件的账号</div> : null}
      </div>
    </Panel>
    <Drawer className="account-role-drawer" title={selected ? `管理 @${selected.username}` : '账号管理'} width={560} open={drawerOpen} onClose={() => setDrawerOpen(false)} destroyOnClose>
      {selected ? <div className="account-role-drawer-content">
        <MemberIdentity member={selected} size={48} />
        <Form form={form} layout="vertical" onFinish={saveAccount}>
          <Form.Item name="displayName" label="显示名称" rules={[{ required: true, message: '请输入显示名称' }]}><Input /></Form.Item>
          <Form.Item name="role" label="角色"><Select options={ROLE_OPTIONS.filter(item => item.value)} disabled={selected.isOwner} /></Form.Item>
          <Form.Item name="monthlyTokenLimit" label="个人月度 Token 额度"><InputNumber min={0} precision={0} placeholder="不限额" className="account-role-full" /></Form.Item>
          <Form.Item name="active" label="账号状态" valuePropName="checked"><Switch checkedChildren="正常" unCheckedChildren="停用" disabled={selected.isOwner} /></Form.Item>
          <Button htmlType="submit" type="primary" loading={saving}>保存账号设置</Button>
        </Form>
        {selected.role === 'manager' ? <section className="account-role-backend-permissions">
          <h3><KeyRound size={17} /> 后台权限</h3>
          <p>只有 DEV 可以调整这里。MANAGER 不能给自己或其他账号加权限；降级为 MEMBER 时服务端会自动撤销已有后台权限。</p>
          <div className="account-role-permission-list">
            {MANAGER_BACKEND_CAPABILITIES.map(capability => {
              const draft = permissionDraft[capability.value] || { enabled: false, scope: '*' };
              return <div className="account-role-permission-row" key={capability.value}>
                <div><strong>{capability.label}</strong><small>{capability.description}</small></div>
                <Switch checked={draft.enabled} onChange={enabled => updatePermission(capability.value, { enabled })} />
                {capability.fixedScope ? <Tag>全部模块</Tag> : <Select disabled={!draft.enabled} value={draft.scope} options={BACKEND_SCOPE_OPTIONS} onChange={scope => updatePermission(capability.value, { scope })} />}
              </div>;
            })}
          </div>
          <div className="account-role-permission-actions"><Button type="primary" loading={permissionSaving} onClick={saveBackendPermissions}>保存后台权限</Button></div>
        </section> : null}
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
