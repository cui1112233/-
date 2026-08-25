import { Button, Checkbox, Form, Input, InputNumber, Modal, Progress, Select, Skeleton, Tag, Tooltip, message } from 'antd';
import { Copy, KeyRound, Link2, MoreHorizontal, Pencil, Plus, RefreshCw, UserPlus, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  createTeamInvite,
  createTeamMember,
  getMemberCenter,
  getTeamInvites,
  getTeamMembers,
  getTeamMeta,
  renameTeam,
  setTeamMemberStatus
} from '../../shared/api/member';
import { MemberIdentity, PageHeader, Panel, RoleBadge, formatDate, formatTokens } from './accountCenterShared';

const SCOPE_OPTIONS = [
  { label: '文本', value: 'text' },
  { label: '生图', value: 'image' },
  { label: '配音', value: 'tts' }
];

function scopesOf(member) {
  const scopes = Array.isArray(member?.apiScopes) ? member.apiScopes : [];
  return scopes.includes('*') ? SCOPE_OPTIONS.map(item => item.value) : scopes;
}

function memberStatus(member) {
  if (member?.archive?.archivedAt) return { color: 'default', text: '已归档' };
  return member?.active ? { color: 'green', text: '正常' } : { color: 'red', text: '已停用' };
}

export default function TeamPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [center, setCenter] = useState(null);
  const [teamResult, setTeamResult] = useState(null);
  const [meta, setMeta] = useState(null);
  const [managerUsername, setManagerUsername] = useState('');
  const [invites, setInvites] = useState([]);
  const [memberOpen, setMemberOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [memberForm] = Form.useForm();
  const [inviteForm] = Form.useForm();
  const [renameForm] = Form.useForm();

  const self = center?.member;
  const availableTeams = useMemo(() => meta?.teams || [], [meta]);
  const activeTeam = useMemo(() => {
    if (self?.role === 'dev') return availableTeams.find(item => item.manager?.username === managerUsername)?.team || null;
    return meta?.team || teamResult?.team || null;
  }, [availableTeams, managerUsername, meta, self?.role, teamResult?.team]);
  const activeManager = self?.role === 'dev'
    ? availableTeams.find(item => item.manager?.username === managerUsername)?.manager || null
    : meta?.manager || self || null;
  const members = useMemo(() => {
    if (self?.role === 'dev' && managerUsername) return (teamResult?.members || []).filter(member => member.role === 'manager' ? member.username === managerUsername : member.boundTo === managerUsername);
    return teamResult?.members || [];
  }, [managerUsername, self?.role, teamResult?.members]);
  const memberCount = members.filter(member => member.role === 'member').length;
  const totalTokens = members.reduce((sum, member) => sum + Number(member.usage?.month?.totalTokens || 0), 0);
  const teamLimit = teamResult?.teamGovernance?.monthlyTokenLimit ?? null;
  const quotaPercent = teamLimit === null ? 0 : Math.min(100, Math.round(totalTokens / Math.max(teamLimit, 1) * 100));

  async function load({ silent = false } = {}) {
    if (!silent) setLoading(true);
    try {
      const [nextCenter, nextTeam, nextMeta] = await Promise.all([getMemberCenter(), getTeamMembers(), getTeamMeta()]);
      const nextManager = nextCenter.member?.role === 'dev'
        ? (managerUsername || nextMeta.teams?.[0]?.manager?.username || '')
        : (nextCenter.member?.username || '');
      const inviteResult = nextManager ? await getTeamInvites(nextManager) : { invites: [] };
      setCenter(nextCenter);
      setTeamResult(nextTeam);
      setMeta(nextMeta);
      setManagerUsername(nextManager);
      setInvites(inviteResult.invites || []);
    } catch (error) { message.error(error.message || '团队管理加载失败'); }
    finally { if (!silent) setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function changeManager(value) {
    setManagerUsername(value);
    try {
      const result = await getTeamInvites(value);
      setInvites(result.invites || []);
    } catch (error) { message.error(error.message || '邀请记录读取失败'); }
  }

  async function refresh() { await load({ silent: true }); message.success('团队数据已刷新'); }

  async function copyTeamId() {
    if (!activeTeam?.id) return;
    try { await navigator.clipboard.writeText(activeTeam.id); message.success('团队 ID 已复制'); }
    catch { message.info(`团队 ID：${activeTeam.id}`); }
  }

  async function saveRename(values) {
    if (!activeTeam?.id) return;
    setSaving(true);
    try {
      await renameTeam(activeTeam.id, values.name);
      message.success('团队名称已更新');
      setRenameOpen(false);
      await load({ silent: true });
    } catch (error) { message.error(error.message || '团队名称保存失败'); }
    finally { setSaving(false); }
  }

  async function saveMember(values) {
    setSaving(true);
    try {
      await createTeamMember({
        ...values,
        role: 'member',
        boundTo: activeManager?.username,
        apiEnabled: (values.apiScopes || []).length > 0,
        apiScopes: values.apiScopes || []
      });
      message.success('成员账号已创建');
      memberForm.resetFields();
      setMemberOpen(false);
      await load({ silent: true });
    } catch (error) { message.error(error.message || '成员创建失败'); }
    finally { setSaving(false); }
  }

  async function saveInvite(values) {
    if (!activeManager?.username) return;
    setSaving(true);
    try {
      const created = await createTeamInvite({ managerUsername: activeManager.username, ...values, apiScopes: values.apiScopes || [] });
      message.success('邀请已生成，可在邀请管理中查看状态');
      inviteForm.resetFields();
      setInviteOpen(false);
      setInvites(current => [{ ...created.invite, inviteUrl: created.inviteUrl }, ...current]);
    } catch (error) { message.error(error.message || '邀请生成失败'); }
    finally { setSaving(false); }
  }

  async function toggleMember(member) {
    setSaving(true);
    try {
      await setTeamMemberStatus(member.username, !member.active);
      message.success(member.active ? '成员账号已停用' : '成员账号已恢复');
      await load({ silent: true });
    } catch (error) { message.error(error.message || '成员状态更新失败'); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="account-center-page"><Skeleton active paragraph={{ rows: 11 }} /></div>;
  if (!self || !['dev', 'manager'].includes(self.role)) return <div className="account-center-page"><div className="ac-empty">当前身份没有团队管理权限</div></div>;

  return <div className="account-center-page team-page">
    <PageHeader title="团队管理" subtitle="成员、邀请、配额、权限与成员生命周期管理" actions={<Button icon={<RefreshCw size={15} />} loading={saving} onClick={refresh}>刷新</Button>} />

    {self.role === 'dev' && availableTeams.length > 1 ? <div className="ac-team-selector"><span>管理团队</span><Select value={managerUsername} onChange={changeManager} options={availableTeams.map(item => ({ value: item.manager.username, label: `${item.team.name} · @${item.manager.username}` }))} /></div> : null}

    {!activeTeam ? <Panel title="尚未选择团队"><div className="ac-empty">当前没有可管理团队。</div></Panel> : <>
      <div className="ac-team-reference-top">
        <Panel title="团队概览" className="ac-team-overview">
          <div className="ac-team-overview-grid">
            <div className="ac-team-mark"><UsersRound size={25} /></div>
            <div><small>团队名称</small><strong>{activeTeam.name}</strong><button type="button" className="ac-inline-icon-button" onClick={() => { renameForm.setFieldsValue({ name: activeTeam.name }); setRenameOpen(true); }} aria-label="重命名团队"><Pencil size={14} /></button></div>
            <div className="ac-team-member-total"><small>成员数量</small><strong>{memberCount}<i> / {teamLimit === null ? '—' : formatTokens(teamLimit)}</i></strong></div>
          </div>
          <div className="ac-team-id-line"><span>Team ID</span><strong>{activeTeam.id}</strong><button type="button" onClick={copyTeamId}><Copy size={13} /></button></div>
          <div className="ac-team-owner-line"><span>主要负责人</span><MemberIdentity member={activeManager} size={28} /></div>
          <div className="ac-team-quota-line"><div><span>本月团队用量</span><strong>{formatTokens(totalTokens)} <i>/ {teamLimit === null ? '不限额' : `${formatTokens(teamLimit)} Tokens`}</i></strong></div><b>{teamLimit === null ? '—' : `${quotaPercent}%`}</b></div>
          <Progress percent={quotaPercent} showInfo={false} status={quotaPercent >= 100 ? 'exception' : 'active'} />
        </Panel>
        <Panel title="快捷操作" className="ac-team-quick-panel">
          <div className="ac-team-quick-actions"><Button icon={<UserPlus size={16} />} onClick={() => { memberForm.resetFields(); setMemberOpen(true); }}>创建成员</Button><Button icon={<Link2 size={16} />} onClick={() => { inviteForm.setFieldsValue({ expiresInHours: 72, apiScopes: ['text'] }); setInviteOpen(true); }}>生成邀请</Button><Button icon={<Pencil size={16} />} onClick={() => { renameForm.setFieldsValue({ name: activeTeam.name }); setRenameOpen(true); }}>重命名团队</Button></div>
          <div className="ac-invite-default"><div><strong>默认邀请设置</strong><small>新建邀请时可在弹窗内单独调整。</small></div><span><b>默认 API 范围</b><Tag>文本</Tag><Tag>生图</Tag><Tag>TTS</Tag></span><span><b>默认月度额度</b><em>由邀请时设置</em></span></div>
        </Panel>
      </div>

      <div className="ac-team-reference-bottom">
        <Panel title="成员列表" className="ac-team-members-panel" action={<span className="ac-panel-count">共 {memberCount} 位成员</span>}>
          <div className="ac-reference-table"><div className="ac-reference-table-head"><span>成员</span><span>显示名称</span><span>角色</span><span>账号状态</span><span>API 范围</span><span>月度额度</span><span>已用 Tokens</span><span>操作</span></div>
            {members.filter(member => member.role !== 'manager').map(member => { const status = memberStatus(member); const scopes = scopesOf(member); return <div className="ac-reference-table-row" key={member.username}><MemberIdentity member={member} size={30} showUsername /><strong>{member.displayName}</strong><RoleBadge role={member.role} compact /><Tag color={status.color}>{status.text}</Tag><span>{scopes.length ? scopes.map(scope => <Tag key={scope}>{SCOPE_OPTIONS.find(item => item.value === scope)?.label || scope}</Tag>) : '未授权'}</span><span>{member.monthlyTokenLimit === null ? '不限额' : `${formatTokens(member.monthlyTokenLimit)} Tokens`}</span><strong>{formatTokens(member.usage?.month?.totalTokens)}</strong><Tooltip title={member.active ? '停用成员' : '恢复成员'}><Button type="text" icon={<MoreHorizontal size={18} />} loading={saving} onClick={() => toggleMember(member)} /></Tooltip></div>; })}
            {!memberCount ? <div className="ac-empty">尚无成员，先创建成员或生成邀请。</div> : null}
          </div>
        </Panel>
        <Panel title="邀请管理" className="ac-team-invites-panel" action={<Button type="text" size="small" icon={<RefreshCw size={14} />} onClick={() => getTeamInvites(activeManager?.username).then(result => setInvites(result.invites || [])).catch(error => message.error(error.message || '邀请读取失败'))}>刷新</Button>}>
          <div className="ac-invite-cards">{invites.slice(0, 5).map(invite => <div className="ac-invite-card" key={invite.id}><div><strong>{invite.usedBy ? `已加入 · @${invite.usedBy}` : '成员邀请'}</strong><Tag color={invite.available ? 'green' : invite.expired ? 'red' : 'blue'}>{invite.available ? '可用' : invite.expired ? '已过期' : '已使用'}</Tag></div><small>有效期至 {formatDate(invite.expiresAt)}</small><small>已使用/上限 · {invite.usedBy ? '1 / 1' : '0 / 1'}</small><span>{(invite.apiScopes || []).length ? invite.apiScopes.map(scope => <Tag key={scope}>{SCOPE_OPTIONS.find(item => item.value === scope)?.label || scope}</Tag>) : <Tag>无 API</Tag>}<em>{invite.monthlyTokenLimit === null ? '不限额' : `${formatTokens(invite.monthlyTokenLimit)} Tokens`}</em></span></div>)}{!invites.length ? <div className="ac-empty">还没有创建邀请</div> : null}</div>
          <Button block icon={<Plus size={16} />} onClick={() => { inviteForm.setFieldsValue({ expiresInHours: 72, apiScopes: ['text'] }); setInviteOpen(true); }}>生成新邀请</Button>
        </Panel>
      </div>
    </>}

    <Modal title="创建成员" open={memberOpen} onCancel={() => setMemberOpen(false)} onOk={() => memberForm.submit()} okText="创建成员" confirmLoading={saving}>
      <Form form={memberForm} layout="vertical" onFinish={saveMember}><Form.Item name="username" label="登录账号" rules={[{ required: true, pattern: /^[A-Za-z0-9_-]{3,32}$/, message: '3-32 位字母、数字、下划线或连字符' }]}><Input /></Form.Item><Form.Item name="displayName" label="显示名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="password" label="初始密码" rules={[{ required: true, min: 8 }]}><Input.Password autoComplete="new-password" /></Form.Item><Form.Item name="monthlyTokenLimit" label="月度额度"><InputNumber min={0} style={{ width: '100%' }} addonAfter="Tokens" placeholder="不限额" /></Form.Item><Form.Item name="apiScopes" label="AI 能力权限"><Checkbox.Group options={SCOPE_OPTIONS} /></Form.Item></Form>
    </Modal>
    <Modal title="生成成员邀请" open={inviteOpen} onCancel={() => setInviteOpen(false)} onOk={() => inviteForm.submit()} okText="生成邀请" confirmLoading={saving}>
      <Form form={inviteForm} layout="vertical" onFinish={saveInvite}><Form.Item name="expiresInHours" label="有效期" rules={[{ required: true }]}><InputNumber min={1} max={720} style={{ width: '100%' }} addonAfter="小时" /></Form.Item><Form.Item name="monthlyTokenLimit" label="成员月度额度"><InputNumber min={0} style={{ width: '100%' }} addonAfter="Tokens" placeholder="不限额" /></Form.Item><Form.Item name="apiScopes" label="AI 能力权限"><Checkbox.Group options={SCOPE_OPTIONS} /></Form.Item></Form>
    </Modal>
    <Modal title="重命名团队" open={renameOpen} onCancel={() => setRenameOpen(false)} onOk={() => renameForm.submit()} okText="保存" confirmLoading={saving}><Form form={renameForm} layout="vertical" onFinish={saveRename}><Form.Item name="name" label="团队名称" rules={[{ required: true, max: 60 }]}><Input autoFocus /></Form.Item></Form></Modal>
  </div>;
}
