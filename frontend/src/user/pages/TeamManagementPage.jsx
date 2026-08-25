import { Avatar, Button, Checkbox, Drawer, Empty, Form, Input, InputNumber, Modal, Progress, Select, Skeleton, Switch, Tag, message } from 'antd';
import { Archive, ArchiveRestore, BarChart3, ChevronRight, Copy, Download, KeyRound, Link2, PauseCircle, Plus, RotateCcw, Search, ShieldCheck, UserPlus, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  archiveTeamMember,
  createTeamInvite,
  createTeamMember,
  getMemberCenter,
  getTeamGovernance,
  getTeamInvites,
  getTeamMemberUsage,
  getTeamMembers,
  renameTeam,
  resetTeamMemberPassword,
  restoreArchivedMember,
  setTeamMemberApi,
  setTeamMemberApiScopes,
  setTeamMemberStatus,
  updateTeamGovernance,
  updateTeamMember
} from '../../shared/api/member';
import { MemberIdentity, MetricCard, PageHeader, RoleBadge, avatarFallback, formatDate, formatTokens } from './accountCenterShared';

const API_SCOPE_OPTIONS = [
  { label: '文本 API', value: 'text' },
  { label: '生图 API', value: 'image' },
  { label: 'TTS', value: 'tts' }
];

function explicitScopes(member) {
  const scopes = Array.isArray(member?.apiScopes) ? member.apiScopes : [];
  return scopes.includes('*') ? API_SCOPE_OPTIONS.map(item => item.value) : scopes.filter(scope => API_SCOPE_OPTIONS.some(item => item.value === scope));
}

function quotaTone(quota) {
  if (!quota || quota.level === 'unlimited') return { color: 'default', text: '不限额' };
  if (quota.level === 'exhausted') return { color: 'red', text: '100% · 已暂停' };
  if (quota.level === 'critical') return { color: 'orange', text: `${quota.percent}% · 高风险` };
  if (quota.level === 'warning') return { color: 'gold', text: `${quota.percent}% · 预警` };
  return { color: 'green', text: `${quota.percent}% · 正常` };
}

function formatCost(summary) {
  if (!summary?.costCurrency || summary.estimatedCost === null || summary.estimatedCost === undefined) return '—';
  return `${summary.costCurrency} ${Number(summary.estimatedCost).toFixed(4)}`;
}

export default function TeamManagementPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [center, setCenter] = useState(null);
  const [team, setTeam] = useState([]);
  const [teamEntities, setTeamEntities] = useState([]);
  const [governance, setGovernance] = useState([]);
  const [teamLimits, setTeamLimits] = useState({});
  const [collabManager, setCollabManager] = useState('');
  const [teamName, setTeamName] = useState('');
  const [invites, setInvites] = useState([]);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [apiFilter, setApiFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedUsage, setSelectedUsage] = useState(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [memberForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [inviteForm] = Form.useForm();

  async function loadInvites(managerUsername) {
    if (!managerUsername) { setInvites([]); return; }
    try { setInvites((await getTeamInvites(managerUsername)).invites || []); }
    catch { setInvites([]); }
  }

  async function load({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    try {
      const [nextCenter, teamResult, governanceResult] = await Promise.all([getMemberCenter(), getTeamMembers(), getTeamGovernance().catch(() => ({ teams: [] }))]);
      const nextSelf = nextCenter.member;
      const nextEntities = nextSelf?.role === 'manager' ? [teamResult.team].filter(Boolean) : (teamResult.teams || []);
      const managersList = (teamResult.members || []).filter(item => item.role === 'manager' && item.active);
      const targetManager = nextSelf?.role === 'manager' ? nextSelf.username : (collabManager && managersList.some(item => item.username === collabManager) ? collabManager : managersList[0]?.username || '');
      setCenter(nextCenter);
      setTeam(teamResult.members || []);
      setTeamEntities(nextEntities);
      setGovernance(governanceResult.teams || []);
      setTeamLimits(Object.fromEntries((governanceResult.teams || []).map(item => [item.manager?.username || item.managerUsername, item.monthlyTokenLimit])));
      setCollabManager(targetManager);
      const entity = nextEntities.find(item => item?.managerUsername === targetManager);
      setTeamName(entity?.name || '');
      await loadInvites(targetManager);
    } catch (error) { message.error(error.message || '团队管理加载失败'); }
    finally { if (!quiet) setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const self = center?.member;
  const managers = useMemo(() => team.filter(item => item.role === 'manager' && item.active), [team]);
  const members = useMemo(() => team.filter(item => item.role === 'member'), [team]);
  const activeMembers = members.filter(item => item.active && !item.archive);
  const authorized = activeMembers.filter(item => item.apiEnabled).length;
  const teamMonth = useMemo(() => members.reduce((sum, item) => sum + Number(item.usage?.month?.totalTokens || 0), 0), [members]);
  const teamCost = useMemo(() => members.reduce((sum, item) => sum + Number(item.usage?.month?.estimatedCost || 0), 0), [members]);
  const teamCurrency = members.find(item => item.usage?.month?.costCurrency)?.usage?.month?.costCurrency || null;
  const ranking = useMemo(() => [...members].sort((a, b) => (b.usage?.month?.totalTokens || 0) - (a.usage?.month?.totalTokens || 0)).slice(0, 5), [members]);
  const ownGovernance = governance.find(item => (item.manager?.username || item.managerUsername) === self?.username) || null;
  const collabTeam = teamEntities.find(item => item?.managerUsername === collabManager) || null;
  const filtered = useMemo(() => team.filter(item => {
    if (item.username === self?.username) return true;
    const text = `${item.displayName || ''} ${item.username || ''}`.toLowerCase();
    if (query && !text.includes(query.trim().toLowerCase())) return false;
    if (roleFilter !== 'all' && item.role !== roleFilter) return false;
    if (apiFilter === 'on' && !item.apiEnabled && item.role === 'member') return false;
    if (apiFilter === 'off' && (item.apiEnabled || item.role !== 'member')) return false;
    return true;
  }), [team, query, roleFilter, apiFilter, self?.username]);

  async function chooseCollabManager(username) {
    setCollabManager(username);
    setTeamName(teamEntities.find(item => item?.managerUsername === username)?.name || '');
    await loadInvites(username);
  }

  async function saveTeamName() {
    if (!collabTeam || !teamName.trim()) return;
    setSaving(true);
    try {
      const result = await renameTeam(collabTeam.id, teamName.trim());
      setTeamEntities(current => current.map(item => item.id === result.team.id ? result.team : item));
      message.success('团队名称已更新');
    } catch (error) { message.error(error.message || '团队名称更新失败'); }
    finally { setSaving(false); }
  }

  async function createInvite(values) {
    setSaving(true);
    try {
      const result = await createTeamInvite({ ...values, managerUsername: collabManager, monthlyTokenLimit: values.monthlyTokenLimit ?? null });
      const fullUrl = `${window.location.origin}${result.inviteUrl}`;
      await navigator.clipboard?.writeText(fullUrl).catch(() => undefined);
      message.success('邀请链接已生成并复制');
      inviteForm.resetFields();
      setInviteOpen(false);
      await loadInvites(collabManager);
    } catch (error) { message.error(error.message || '邀请创建失败'); }
    finally { setSaving(false); }
  }

  async function toggleApi(member, enabled) {
    try { await setTeamMemberApi(member.username, enabled); message.success(enabled ? 'API 已授权' : 'API 已暂停'); await load({ quiet: true }); }
    catch (error) { message.error(error.message || 'API 状态更新失败'); }
  }

  async function openMember(member) {
    setSelected(member); setSelectedUsage(null);
    memberForm.setFieldsValue({ displayName: member.displayName, role: member.role, boundTo: member.boundTo || undefined, monthlyTokenLimit: member.monthlyTokenLimit, apiScopes: explicitScopes(member) });
    try { setSelectedUsage(await getTeamMemberUsage(member.username)); }
    catch (error) { message.error(error.message || '成员用量加载失败'); }
  }

  async function create(values) {
    setSaving(true);
    try {
      const scopes = Array.isArray(values.apiScopes) ? values.apiScopes : [];
      await createTeamMember({ ...values, role: self.role === 'manager' ? 'member' : values.role, boundTo: self.role === 'manager' ? self.username : values.boundTo, monthlyTokenLimit: values.monthlyTokenLimit ?? null, apiEnabled: scopes.length > 0, apiScopes: scopes });
      message.success('成员已创建'); createForm.resetFields(); setCreateOpen(false); await load({ quiet: true });
    } catch (error) { message.error(error.message || '成员创建失败'); }
    finally { setSaving(false); }
  }

  async function saveMember(values) {
    if (!selected) return;
    setSaving(true);
    try {
      const payload = { displayName: values.displayName, monthlyTokenLimit: values.monthlyTokenLimit ?? null };
      if (self.role === 'dev') { payload.role = values.role; payload.boundTo = values.role === 'member' ? (values.boundTo || null) : null; }
      const updated = await updateTeamMember(selected.username, payload);
      if ((updated.member?.role || selected.role) === 'member' && selected.active && !selected.archive) await setTeamMemberApiScopes(selected.username, Array.isArray(values.apiScopes) ? values.apiScopes : []);
      message.success('成员信息已更新'); setSelected(null); await load({ quiet: true });
    } catch (error) { message.error(error.message || '保存失败'); }
    finally { setSaving(false); }
  }

  async function saveTeamLimit(username) {
    setSaving(true);
    try { await updateTeamGovernance(username, teamLimits[username] ?? null); message.success('团队总额度已更新'); await load({ quiet: true }); }
    catch (error) { message.error(error.message || '团队额度更新失败'); }
    finally { setSaving(false); }
  }

  async function changeStatus(active) {
    if (!selected) return;
    setSaving(true);
    try { const result = await setTeamMemberStatus(selected.username, active); message.success(active ? '账号已恢复' : '账号已停用，登录会话已撤销'); setSelected(result.member); await load({ quiet: true }); }
    catch (error) { message.error(error.message || '账号状态更新失败'); }
    finally { setSaving(false); }
  }

  async function archiveSelected() {
    if (!selected) return;
    setSaving(true);
    try { await archiveTeamMember(selected.username, '管理员归档'); message.success('成员已归档，历史用量和审计记录已保留'); setSelected(null); await load({ quiet: true }); }
    catch (error) { message.error(error.message || '归档失败'); }
    finally { setSaving(false); }
  }

  async function restoreSelected() {
    if (!selected) return;
    setSaving(true);
    try { await restoreArchivedMember(selected.username); message.success('成员已从归档恢复，请重新配置 API 权限'); setSelected(null); await load({ quiet: true }); }
    catch (error) { message.error(error.message || '恢复失败'); }
    finally { setSaving(false); }
  }

  async function resetPassword(values) {
    if (!selected) return;
    setSaving(true);
    try { await resetTeamMemberPassword(selected.username, values.password); message.success('密码已重置，该成员其他登录会话已退出'); passwordForm.resetFields(); setPasswordOpen(false); }
    catch (error) { message.error(error.message || '密码重置失败'); }
    finally { setSaving(false); }
  }

  function exportUsage() {
    const rows = [['username', 'displayName', 'role', 'boundTo', 'active', 'archived', 'apiScopes', 'monthTokens', 'monthCalls', 'estimatedCost', 'currency']];
    for (const item of team) rows.push([item.username, item.displayName, item.role, item.boundTo || '', item.active ? 'true' : 'false', item.archive ? 'true' : 'false', explicitScopes(item).join('|'), item.usage?.month?.totalTokens || 0, item.usage?.month?.calls || 0, item.usage?.month?.estimatedCost ?? '', item.usage?.month?.costCurrency || '']);
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `qiantie-team-usage-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  if (loading) return <div className="account-center-page"><Skeleton active paragraph={{ rows: 11 }} /></div>;
  if (!self || !['dev', 'manager'].includes(self.role)) return <div className="account-center-page"><Empty description="当前身份没有团队管理权限" /></div>;

  return <div className="account-center-page team-management-page">
    <PageHeader title="团队管理" subtitle="团队身份、邀请、成员生命周期、API 权限与资源治理" actions={<><Button icon={<Download size={16} />} onClick={exportUsage}>导出用量</Button><Button type="primary" icon={<UserPlus size={16} />} onClick={() => { createForm.resetFields(); createForm.setFieldsValue({ role: 'member', apiScopes: ['text'] }); setCreateOpen(true); }}>添加成员</Button></>} />

    <div className="ac-collab-grid">
      <section className="ac-panel">
        <div className="ac-panel-header"><div><small>TEAM IDENTITY</small><h2>团队身份与邀请</h2></div>{self.role === 'dev' ? <Select style={{ minWidth: 180 }} value={collabManager || undefined} onChange={chooseCollabManager} options={managers.map(item => ({ label: `${item.displayName} · @${item.username}`, value: item.username }))} placeholder="选择 MANAGER" /> : <Tag color="blue">TEAM</Tag>}</div>
        {collabTeam ? <>
          <div className="ac-team-meta"><div className="ac-team-meta-copy"><h3>{collabTeam.name}</h3><p>Team ID · {collabTeam.id} · Manager @{collabTeam.managerUsername}</p></div><Button type="primary" icon={<Link2 size={16} />} onClick={() => { inviteForm.resetFields(); inviteForm.setFieldsValue({ expiresInHours: 72, apiScopes: ['text'] }); setInviteOpen(true); }}>生成邀请</Button></div>
          <div className="ac-team-name-edit"><Input value={teamName} onChange={event => setTeamName(event.target.value)} maxLength={60} /><Button loading={saving} onClick={saveTeamName}>保存团队名</Button></div>
          <div className="ac-invite-list">{invites.slice(0, 4).map(invite => <div className="ac-invite-row" key={invite.id}><div><strong>{invite.available ? '可用邀请' : invite.expired ? '已过期' : `已由 @${invite.usedBy} 使用`}</strong><small>{invite.apiScopes?.join(' / ') || '无 AI 权限'} · 有效至 {formatDate(invite.expiresAt)}</small></div><Tag color={invite.available ? 'green' : 'default'}>{invite.available ? '可用' : '失效'}</Tag></div>)}{!invites.length ? <div className="ac-empty">还没有邀请记录</div> : null}</div>
        </> : <div className="ac-empty">请选择一个 MANAGER 团队</div>}
      </section>
      <section className="ac-panel"><div className="ac-panel-header"><div><small>MEMBER LIFECYCLE</small><h2>成员生命周期</h2></div></div><div className="ac-check-list"><div><ShieldCheck size={16} /><span>正常成员</span><b>{activeMembers.length}</b></div><div><PauseCircle size={16} /><span>停用账号</span><b>{members.filter(item => !item.active && !item.archive).length}</b></div><div><Archive size={16} /><span>已归档</span><b>{members.filter(item => item.archive).length}</b></div></div><p className="ac-muted-copy">归档会保留历史用量与审计，但清除 AI scopes；恢复后需重新授权。</p></section>
    </div>

    <div className="ac-metrics-grid four">
      <MetricCard label="成员总数" value={members.length} suffix="人" icon={UsersRound} accent="violet" hint={`${activeMembers.length} 个活跃成员`} />
      <MetricCard label="已授权成员" value={authorized} suffix="人" icon={UserPlus} accent="blue" hint={`${activeMembers.length ? Math.round((authorized / activeMembers.length) * 100) : 0}% 有 API 权限`} />
      <MetricCard label="本月团队消耗" value={formatTokens(teamMonth)} suffix="Tokens" icon={BarChart3} accent="green" hint={teamCurrency ? `估算 ${teamCurrency} ${teamCost.toFixed(4)}` : '按调用发生时团队归属统计'} />
      <MetricCard label="团队额度状态" value={self.role === 'manager' ? (ownGovernance?.quota?.percent ?? '∞') : governance.length} suffix={self.role === 'manager' && ownGovernance?.quota?.percent !== null ? '%' : self.role === 'dev' ? '组' : ''} icon={ShieldCheck} accent="gold" hint={self.role === 'manager' ? quotaTone(ownGovernance?.quota).text : `${governance.filter(item => item.monthlyTokenLimit !== null).length} 组设置总额度`} />
    </div>

    <section className="ac-panel ac-governance-panel"><div className="ac-panel-header"><div><small>TEAM QUOTA · 70 / 90 / 100</small><h2>团队总额度与预警</h2></div><Tag color="gold">自然月</Tag></div><div className="ac-governance-list">{governance.map(item => { const username = item.manager?.username || item.managerUsername; const tone = quotaTone(item.quota); return <div className="ac-governance-row" key={username}><MemberIdentity member={item.manager || { username, displayName: username, role: 'manager' }} size={38} /><div className="ac-governance-progress"><div><span>{formatTokens(item.usage?.totalTokens)} / {item.monthlyTokenLimit === null ? '不限额' : formatTokens(item.monthlyTokenLimit)}</span><Tag color={tone.color}>{tone.text}</Tag></div><Progress percent={item.quota?.percent || 0} showInfo={false} status={item.quota?.level === 'exhausted' ? 'exception' : 'normal'} /></div><InputNumber min={0} max={100_000_000_000} value={teamLimits[username]} onChange={value => setTeamLimits(current => ({ ...current, [username]: value }))} placeholder="不限额" addonAfter="Tokens" /><Button loading={saving} onClick={() => saveTeamLimit(username)}>保存</Button></div>; })}{!governance.length ? <div className="ac-empty">暂无 MANAGER 团队</div> : null}</div></section>

    <div className="ac-team-workspace">
      <section className="ac-panel ac-team-table-panel"><div className="ac-team-toolbar"><div className="ac-search-box"><Search size={16} /><Input variant="borderless" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索成员（昵称 / @用户名）" /></div><Select value={roleFilter} onChange={setRoleFilter} options={[{ label: '全部角色', value: 'all' }, { label: 'DEV', value: 'dev' }, { label: 'MANAGER', value: 'manager' }, { label: 'MEMBER', value: 'member' }]} /><Select value={apiFilter} onChange={setApiFilter} options={[{ label: '全部 API 状态', value: 'all' }, { label: 'API 已启用', value: 'on' }, { label: 'API 已暂停', value: 'off' }]} /></div>
        <div className="ac-team-table"><div className="ac-team-table-head"><span>成员</span><span>角色</span><span>绑定管理</span><span>账号 / API</span><span>额度</span><span>已用 Tokens</span><span /></div>{filtered.map(member => { const manager = team.find(item => item.username === member.boundTo); const tone = quotaTone(member.quota); return <div className={`ac-team-table-row${member.username === self.username ? ' is-self' : ''}${!member.active ? ' is-disabled' : ''}`} key={member.username}><MemberIdentity member={member} size={40} /><RoleBadge role={member.role} compact /><span>{member.role === 'member' ? (manager?.displayName || '未绑定') : '—'}</span><span className="ac-account-api-state"><Tag color={member.archive ? 'gold' : member.active ? 'green' : 'red'}>{member.archive ? '已归档' : member.active ? '账号正常' : '已停用'}</Tag>{member.role === 'member' && !member.archive ? <Switch size="small" checked={member.apiEnabled} onChange={checked => toggleApi(member, checked)} disabled={!member.active || member.username === self.username} /> : member.role !== 'member' ? <Tag color="blue">自主</Tag> : null}</span><span><Tag color={tone.color}>{tone.text}</Tag></span><div className="ac-team-used"><strong>{formatTokens(member.usage?.month?.totalTokens)}</strong>{member.quota?.percent === null ? null : <Progress percent={member.quota?.percent || 0} showInfo={false} size="small" status={member.quota?.level === 'exhausted' ? 'exception' : 'normal'} />}<small>{formatCost(member.usage?.month)}</small></div><Button type="text" icon={<ChevronRight size={17} />} disabled={member.username === self.username} onClick={() => openMember(member)} /></div>; })}{!filtered.length ? <div className="ac-empty">没有符合条件的成员</div> : null}</div>
      </section>
      <aside className="ac-team-side"><section className="ac-panel"><div className="ac-panel-header"><div><small>TEAM RANKING</small><h2>团队排行 TOP5</h2></div></div><div className="ac-ranking-list">{ranking.map((member, index) => <div className="ac-ranking-row" key={member.username}><span className={`rank rank-${index + 1}`}>{index + 1}</span><MemberIdentity member={member} size={32} /><div className="ac-ranking-value"><strong>{formatTokens(member.usage?.month?.totalTokens)}</strong><small>{formatCost(member.usage?.month)}</small></div></div>)}{!ranking.length ? <div className="ac-empty">暂无成员用量</div> : null}</div></section><section className="ac-panel"><div className="ac-panel-header"><div><small>QUICK ACTIONS</small><h2>快捷操作</h2></div></div><div className="ac-quick-grid three"><button type="button" onClick={() => setCreateOpen(true)}><span><Plus size={18} /></span><b>添加成员</b></button><button type="button" onClick={() => setApiFilter('off')}><span><UsersRound size={18} /></span><b>未授权成员</b></button><button type="button" onClick={exportUsage}><span><Download size={18} /></span><b>导出用量</b></button></div></section></aside>
    </div>

    <Drawer title="添加团队成员" width={500} open={createOpen} onClose={() => setCreateOpen(false)} extra={<Button type="primary" onClick={() => createForm.submit()} loading={saving}>创建</Button>}><Form form={createForm} layout="vertical" onFinish={create} initialValues={{ role: 'member', apiScopes: ['text'] }}><Form.Item label="显示名称" name="displayName" rules={[{ required: true, whitespace: true, max: 40 }]}><Input /></Form.Item><Form.Item label="登录账号" name="username" rules={[{ required: true, pattern: /^[A-Za-z0-9_-]{3,32}$/ }]}><Input /></Form.Item><Form.Item label="初始密码" name="password" rules={[{ required: true, min: 8 }]}><Input.Password /></Form.Item>{self.role === 'dev' ? <Form.Item label="角色" name="role"><Select options={[{ label: 'DEV · 开发', value: 'dev' }, { label: 'MANAGER · 管理', value: 'manager' }, { label: 'MEMBER · 组员', value: 'member' }]} /></Form.Item> : <div className="ac-locked-role"><RoleBadge role="member" /> MANAGER 创建的账号固定为 MEMBER</div>}{self.role === 'dev' ? <Form.Item noStyle shouldUpdate={(a, b) => a.role !== b.role}>{({ getFieldValue }) => getFieldValue('role') === 'member' ? <Form.Item label="绑定管理" name="boundTo"><Select allowClear options={managers.map(item => ({ label: `${item.displayName} · @${item.username}`, value: item.username }))} /></Form.Item> : null}</Form.Item> : null}<Form.Item label="月度 Token 额度" name="monthlyTokenLimit"><InputNumber min={0} max={10_000_000_000} style={{ width: '100%' }} /></Form.Item><Form.Item label="API 授权范围" name="apiScopes"><Checkbox.Group options={API_SCOPE_OPTIONS} /></Form.Item><p className="ac-form-tip">也可以使用上方邀请链接，让成员自己设置登录账号和密码。</p></Form></Drawer>

    <Drawer title={selected ? `${selected.displayName} · @${selected.username}` : '成员详情'} width={560} open={Boolean(selected)} onClose={() => setSelected(null)} extra={<Button type="primary" onClick={() => memberForm.submit()} loading={saving} disabled={Boolean(selected?.archive)}>保存</Button>}>{selected ? <><div className="ac-drawer-member-head"><Avatar size={66} src={selected.avatarUrl}>{avatarFallback(selected)}</Avatar><div><h2>{selected.displayName}</h2><p>@{selected.username}</p><div><RoleBadge role={selected.role} /><Tag color={selected.archive ? 'gold' : selected.active ? 'green' : 'red'}>{selected.archive ? '已归档' : selected.active ? '账号正常' : '账号停用'}</Tag></div></div></div><div className="ac-drawer-usage-grid"><div><small>今日</small><strong>{formatTokens(selectedUsage?.day?.totalTokens)}</strong><span>Tokens</span></div><div><small>本月</small><strong>{formatTokens(selectedUsage?.month?.totalTokens)}</strong><span>Tokens</span></div><div><small>估算费用</small><strong>{formatCost(selectedUsage?.month)}</strong><span>{selectedUsage?.month?.pricedCalls || 0} 次有价格</span></div></div>
      {!selected.archive ? <Form form={memberForm} layout="vertical" onFinish={saveMember}><Form.Item label="显示名称" name="displayName" rules={[{ required: true }]}><Input /></Form.Item>{self.role === 'dev' ? <Form.Item label="角色" name="role"><Select options={[{ label: 'DEV', value: 'dev' }, { label: 'MANAGER', value: 'manager' }, { label: 'MEMBER', value: 'member' }]} /></Form.Item> : null}{self.role === 'dev' ? <Form.Item noStyle shouldUpdate={(a, b) => a.role !== b.role}>{({ getFieldValue }) => getFieldValue('role') === 'member' ? <Form.Item label="绑定管理" name="boundTo"><Select allowClear options={managers.map(item => ({ label: `${item.displayName} · @${item.username}`, value: item.username }))} /></Form.Item> : null}</Form.Item> : null}<Form.Item label="月度 Token 额度" name="monthlyTokenLimit"><InputNumber min={0} max={10_000_000_000} style={{ width: '100%' }} /></Form.Item>{selected.role === 'member' ? <Form.Item label="API 授权范围" name="apiScopes"><Checkbox.Group options={API_SCOPE_OPTIONS} disabled={!selected.active} /></Form.Item> : null}</Form> : <p className="ac-muted-copy">该成员已归档。历史用量与审计仍保留；恢复后 API 权限不会自动恢复。</p>}
      <section className="ac-member-actions">{selected.archive ? <Button type="primary" icon={<ArchiveRestore size={16} />} loading={saving} onClick={restoreSelected}>从归档恢复</Button> : <><Button icon={selected.active ? <PauseCircle size={16} /> : <RotateCcw size={16} />} danger={selected.active} loading={saving} onClick={() => changeStatus(!selected.active)}>{selected.active ? '停用账号' : '恢复账号'}</Button><Button icon={<KeyRound size={16} />} onClick={() => { passwordForm.resetFields(); setPasswordOpen(true); }}>重置密码</Button>{selected.role === 'member' ? <Button danger icon={<Archive size={16} />} loading={saving} onClick={archiveSelected}>归档成员</Button> : null}</>}</section>
      <section className="ac-drawer-activity"><h3>最近使用</h3>{(selectedUsage?.recent || []).slice(0, 6).map(item => <div key={item.id}><span>{item.feature || '模型调用'}</span><small>{formatDate(item.at)}</small><b>{formatTokens(item.totalTokens)} T · {item.costKnown ? `${item.costCurrency} ${Number(item.estimatedCost).toFixed(4)}` : '未计价'}</b></div>)}</section></> : null}</Drawer>

    <Modal title="生成一次性团队邀请" open={inviteOpen} onCancel={() => setInviteOpen(false)} onOk={() => inviteForm.submit()} okText="生成并复制链接" confirmLoading={saving}><Form form={inviteForm} layout="vertical" onFinish={createInvite}><Form.Item label="有效期（小时）" name="expiresInHours" rules={[{ required: true }]}><InputNumber min={1} max={720} style={{ width: '100%' }} /></Form.Item><Form.Item label="成员默认月额度" name="monthlyTokenLimit"><InputNumber min={0} max={10_000_000_000} style={{ width: '100%' }} placeholder="留空表示不限额" /></Form.Item><Form.Item label="默认 API 权限" name="apiScopes"><Checkbox.Group options={API_SCOPE_OPTIONS} /></Form.Item><p className="ac-form-tip">链接只能使用一次。接受邀请的人自己设置账号和密码。</p></Form></Modal>

    <Modal title={selected ? `重置 ${selected.displayName} 的密码` : '重置密码'} open={passwordOpen} onCancel={() => setPasswordOpen(false)} onOk={() => passwordForm.submit()} okText="确认重置" confirmLoading={saving}><Form form={passwordForm} layout="vertical" onFinish={resetPassword}><Form.Item label="新密码" name="password" rules={[{ required: true, min: 8 }]}><Input.Password /></Form.Item><Form.Item label="确认新密码" name="confirm" dependencies={['password']} rules={[{ required: true }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue('password') === value ? Promise.resolve() : Promise.reject(new Error('两次输入的密码不一致')); } })]}><Input.Password /></Form.Item></Form></Modal>
  </div>;
}
