import { Button, Checkbox, Form, Input, InputNumber, Modal, Select, Skeleton, Tag, message } from 'antd';
import { Fingerprint, KeyRound, ShieldCheck, Trash2, UserCog, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getMemberCenter } from '../../shared/api/member';
import { purgeMemberAccount } from '../../shared/api/accountRecovery';
import {
  getDelegatedTeamMembers,
  getManageableTeams,
  resetDelegatedMemberPassword,
  setDelegatedMemberScopes,
  setDelegatedMemberStatus,
  setTeamCoManagers,
  updateDelegatedTeamGovernance
} from '../../shared/api/teamAdmin';
import { MemberIdentity, PageHeader, Panel, RoleBadge, formatTokens } from './accountCenterShared';

const SCOPE_OPTIONS = [
  { label: '文本', value: 'text' },
  { label: '生图', value: 'image' },
  { label: 'TTS', value: 'tts' }
];

function explicitScopes(member) {
  const scopes = Array.isArray(member?.apiScopes) ? member.apiScopes : [];
  return scopes.includes('*') ? SCOPE_OPTIONS.map(item => item.value) : scopes.filter(item => SCOPE_OPTIONS.some(option => option.value === item));
}

export default function AdvancedTeamAdminPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [center, setCenter] = useState(null);
  const [teams, setTeams] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [members, setMembers] = useState([]);
  const [memberOpen, setMemberOpen] = useState(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [coManagerForm] = Form.useForm();
  const [memberForm] = Form.useForm();
  const [purgeForm] = Form.useForm();
  const [passwordForm] = Form.useForm();

  async function load() {
    setLoading(true);
    try {
      const [memberCenter, result] = await Promise.all([getMemberCenter(), getManageableTeams()]);
      setCenter(memberCenter);
      setTeams(result.teams || []);
      setSelectedTeamId(current => current || result.teams?.[0]?.team?.id || null);
    } catch (error) { message.error(error.message || '联合管理加载失败'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const self = center?.member;
  const selectedTeam = useMemo(() => teams.find(item => item.team?.id === selectedTeamId) || null, [teams, selectedTeamId]);
  const isPrimary = Boolean(selectedTeam && (self?.role === 'dev' || selectedTeam.team.managerUsername === self?.username));

  useEffect(() => {
    if (!selectedTeamId) { setMembers([]); return; }
    getDelegatedTeamMembers(selectedTeamId).then(result => setMembers(result.members || [])).catch(error => message.error(error.message || '团队成员读取失败'));
  }, [selectedTeamId]);

  useEffect(() => {
    if (!selectedTeam) return;
    coManagerForm.setFieldsValue({ usernames: selectedTeam.team.coManagers || [], monthlyTokenLimit: selectedTeam.governance?.monthlyTokenLimit });
  }, [selectedTeamId, selectedTeam, coManagerForm]);

  async function saveTeam(values) {
    if (!selectedTeam) return;
    setSaving(true);
    try {
      if (isPrimary) await setTeamCoManagers(selectedTeam.team.id, values.usernames || []);
      await updateDelegatedTeamGovernance(selectedTeam.team.id, values.monthlyTokenLimit ?? null);
      message.success('团队治理设置已更新');
      await load();
    } catch (error) { message.error(error.message || '团队治理保存失败'); }
    finally { setSaving(false); }
  }

  function openMember(member) {
    setMemberOpen(member);
    memberForm.setFieldsValue({ scopes: explicitScopes(member), active: member.active });
  }

  async function saveMember(values) {
    if (!selectedTeam || !memberOpen) return;
    setSaving(true);
    try {
      if (values.active !== memberOpen.active) await setDelegatedMemberStatus(selectedTeam.team.id, memberOpen.username, values.active);
      if (values.active) await setDelegatedMemberScopes(selectedTeam.team.id, memberOpen.username, values.scopes || []);
      message.success('成员治理设置已更新');
      const result = await getDelegatedTeamMembers(selectedTeam.team.id);
      setMembers(result.members || []);
      setMemberOpen(null);
    } catch (error) { message.error(error.message || '成员治理失败'); }
    finally { setSaving(false); }
  }

  async function resetPassword(values) {
    if (!selectedTeam || !memberOpen) return;
    setSaving(true);
    try {
      await resetDelegatedMemberPassword(selectedTeam.team.id, memberOpen.username, values.password);
      message.success('密码已重置，该成员旧会话已撤销');
      setPasswordOpen(false);
      passwordForm.resetFields();
    } catch (error) { message.error(error.message || '密码重置失败'); }
    finally { setSaving(false); }
  }

  async function purge(values) {
    setSaving(true);
    try {
      await purgeMemberAccount(values.username, {
        currentPassword: values.currentPassword,
        confirmation: values.confirmation,
        reason: values.reason
      });
      message.success('账号已永久删除，保留最小审计墓碑');
      purgeForm.resetFields();
      setPurgeOpen(false);
      await load();
    } catch (error) { message.error(error.message || '永久删除失败'); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="account-center-page"><Skeleton active paragraph={{ rows: 10 }} /></div>;
  if (!self || !['dev', 'manager'].includes(self.role)) return <div className="account-center-page"><div className="ac-empty">当前身份没有联合管理权限</div></div>;

  return <div className="account-center-page advanced-team-admin-page">
    <PageHeader title="联合治理" subtitle="Co-Manager 跨团队协作、强权限操作与不可逆删除" actions={self.role === 'dev' ? <Button danger icon={<Trash2 size={16} />} onClick={() => setPurgeOpen(true)}>永久删除已归档 MEMBER</Button> : null} />

    <div className="ac-two-column">
      <Panel title="可管理团队" eyebrow="TEAM ADMINISTRATION">
        <div className="ac-ranking-list">
          {teams.map(item => <button type="button" className={`ac-delegated-team${item.team.id === selectedTeamId ? ' active' : ''}`} key={item.team.id} onClick={() => setSelectedTeamId(item.team.id)}>
            <span className="ac-session-icon"><UsersRound size={17} /></span>
            <div><strong>{item.team.name}</strong><small>主管理 @{item.team.managerUsername} · {item.memberCount} 名 MEMBER</small></div>
            <Tag color={item.team.managerUsername === self.username ? 'blue' : 'purple'}>{item.team.managerUsername === self.username ? '主 MANAGER' : 'CO-MANAGER'}</Tag>
          </button>)}
          {!teams.length ? <div className="ac-empty">暂无可管理团队</div> : null}
        </div>
      </Panel>

      {selectedTeam ? <Panel title={selectedTeam.team.name} eyebrow="TEAM POLICY">
        <div className="ac-team-brand"><span className="ac-team-logo">{selectedTeam.team.name.slice(0, 1)}</span><div><strong>{selectedTeam.team.name}</strong><small>Team ID · {selectedTeam.team.id}</small></div></div>
        <Form form={coManagerForm} layout="vertical" onFinish={saveTeam}>
          <Form.Item label="联合管理员账号" name="usernames" extra={isPrimary ? '输入已有 MANAGER 账号，可添加多个。' : '只有主 MANAGER 或 DEV 可以修改联合管理员。'}>
            <Select mode="tags" disabled={!isPrimary} tokenSeparators={[',', ' ']} placeholder="输入 @manager 账号" />
          </Form.Item>
          <Form.Item label="团队自然月总额度" name="monthlyTokenLimit"><InputNumber min={0} max={100_000_000_000} style={{ width: '100%' }} addonAfter="Tokens" placeholder="不限额" /></Form.Item>
          <div className="ac-side-summary"><span>本月团队用量</span><strong>{formatTokens(selectedTeam.usage?.totalTokens)} Tokens</strong></div>
          <Button type="primary" htmlType="submit" loading={saving}>保存团队治理</Button>
        </Form>
      </Panel> : null}
    </div>

    {selectedTeam ? <Panel title="团队成员治理" eyebrow="DELEGATED MEMBER CONTROL">
      <div className="ac-team-table">
        <div className="ac-team-table-head"><span>成员</span><span>角色</span><span>状态</span><span>API scopes</span><span>本月 Tokens</span><span /></div>
        {members.filter(item => item.role === 'member').map(member => <div className="ac-team-table-row" key={member.username}>
          <MemberIdentity member={member} size={38} />
          <RoleBadge role={member.role} compact />
          <Tag color={member.active ? 'green' : 'red'}>{member.active ? '正常' : '停用'}</Tag>
          <span>{explicitScopes(member).join(' / ') || '无权限'}</span>
          <strong>{formatTokens(member.usage?.month?.totalTokens)}</strong>
          <Button type="text" icon={<UserCog size={16} />} onClick={() => openMember(member)}>治理</Button>
        </div>)}
      </div>
    </Panel> : null}

    <Modal title={memberOpen ? `治理 ${memberOpen.displayName}` : '成员治理'} open={Boolean(memberOpen)} onCancel={() => setMemberOpen(null)} onOk={() => memberForm.submit()} okText="保存" confirmLoading={saving}>
      <Form form={memberForm} layout="vertical" onFinish={saveMember}>
        <Form.Item label="账号状态" name="active" valuePropName="checked"><Checkbox>允许该成员登录</Checkbox></Form.Item>
        <Form.Item label="API scopes" name="scopes"><Checkbox.Group options={SCOPE_OPTIONS} /></Form.Item>
        <Button icon={<KeyRound size={15} />} onClick={() => { passwordForm.resetFields(); setPasswordOpen(true); }}>重置该成员密码</Button>
      </Form>
    </Modal>

    <Modal title="重置成员密码" open={passwordOpen} onCancel={() => setPasswordOpen(false)} onOk={() => passwordForm.submit()} confirmLoading={saving}>
      <Form form={passwordForm} layout="vertical" onFinish={resetPassword}>
        <Form.Item label="新密码" name="password" rules={[{ required: true, min: 8 }]}><Input.Password /></Form.Item>
        <Form.Item label="确认新密码" name="confirm" dependencies={['password']} rules={[{ required: true }, ({ getFieldValue }) => ({ validator(_, value) { return value === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error('两次密码不一致')); } })]}><Input.Password /></Form.Item>
      </Form>
    </Modal>

    <Modal title="永久删除已归档 MEMBER" open={purgeOpen} onCancel={() => setPurgeOpen(false)} onOk={() => purgeForm.submit()} okButtonProps={{ danger: true }} okText="永久删除" confirmLoading={saving}>
      <div className="ac-session-control"><span><ShieldCheck size={22} /></span><div><h3>不可逆账号清除</h3><p>清除凭据、Passkey、MFA、API scope、个人资料和头像；保留最小审计墓碑与历史 usage。仅支持已经归档的 MEMBER。</p></div></div>
      <Form form={purgeForm} layout="vertical" onFinish={purge}>
        <Form.Item label="目标 MEMBER 账号" name="username" rules={[{ required: true }]}><Input placeholder="member_username" /></Form.Item>
        <Form.Item label="再次输入完整账号名" name="confirmation" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item label="你的 DEV 登录密码" name="currentPassword" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
        <Form.Item label="删除原因" name="reason"><Input.TextArea maxLength={300} /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
