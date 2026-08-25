import { Avatar, Button, Drawer, Empty, Form, Input, InputNumber, Progress, Select, Skeleton, Switch, Tag, message } from 'antd';
import { BarChart3, ChevronRight, Download, Plus, Search, UserPlus, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  createTeamMember,
  getMemberCenter,
  getTeamMemberUsage,
  getTeamMembers,
  setTeamMemberApi,
  updateTeamMember
} from '../../shared/api/member';
import {
  MemberIdentity,
  MetricCard,
  PageHeader,
  RoleBadge,
  avatarFallback,
  formatDate,
  formatTokens
} from './accountCenterShared';

export default function TeamManagementPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [center, setCenter] = useState(null);
  const [team, setTeam] = useState([]);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [apiFilter, setApiFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedUsage, setSelectedUsage] = useState(null);
  const [createForm] = Form.useForm();
  const [memberForm] = Form.useForm();

  async function load({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    try {
      const [nextCenter, teamResult] = await Promise.all([getMemberCenter(), getTeamMembers()]);
      setCenter(nextCenter);
      setTeam(teamResult.members || []);
    } catch (error) {
      message.error(error.message || '团队管理加载失败');
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const self = center?.member;
  const managers = useMemo(() => team.filter(item => item.role === 'manager' && item.active), [team]);
  const members = useMemo(() => team.filter(item => item.role === 'member'), [team]);
  const authorized = members.filter(item => item.apiEnabled).length;
  const teamMonth = useMemo(() => members.reduce((sum, item) => sum + Number(item.usage?.month?.totalTokens || 0), 0), [members]);
  const ranking = useMemo(() => [...members].sort((a, b) => (b.usage?.month?.totalTokens || 0) - (a.usage?.month?.totalTokens || 0)).slice(0, 5), [members]);
  const filtered = useMemo(() => team.filter(item => {
    if (item.username === self?.username) return true;
    const text = `${item.displayName || ''} ${item.username || ''}`.toLowerCase();
    if (query && !text.includes(query.trim().toLowerCase())) return false;
    if (roleFilter !== 'all' && item.role !== roleFilter) return false;
    if (apiFilter === 'on' && !item.apiEnabled && item.role === 'member') return false;
    if (apiFilter === 'off' && (item.apiEnabled || item.role !== 'member')) return false;
    return true;
  }), [team, query, roleFilter, apiFilter, self?.username]);

  async function toggleApi(member, enabled) {
    try {
      await setTeamMemberApi(member.username, enabled);
      message.success(enabled ? 'API 已授权' : 'API 已暂停');
      await load({ quiet: true });
      if (selected?.username === member.username) setSelected(current => ({ ...current, apiEnabled: enabled }));
    } catch (error) {
      message.error(error.message || 'API 状态更新失败');
    }
  }

  async function openMember(member) {
    setSelected(member);
    setSelectedUsage(null);
    memberForm.setFieldsValue({
      displayName: member.displayName,
      role: member.role,
      boundTo: member.boundTo || undefined,
      monthlyTokenLimit: member.monthlyTokenLimit
    });
    try {
      setSelectedUsage(await getTeamMemberUsage(member.username));
    } catch (error) {
      message.error(error.message || '成员用量加载失败');
    }
  }

  async function create(values) {
    setSaving(true);
    try {
      await createTeamMember({
        ...values,
        role: self.role === 'manager' ? 'member' : values.role,
        boundTo: self.role === 'manager' ? self.username : values.boundTo,
        monthlyTokenLimit: values.monthlyTokenLimit ?? null
      });
      message.success('成员已创建');
      createForm.resetFields();
      setCreateOpen(false);
      await load({ quiet: true });
    } catch (error) {
      message.error(error.message || '成员创建失败');
    } finally {
      setSaving(false);
    }
  }

  async function saveMember(values) {
    if (!selected) return;
    setSaving(true);
    try {
      const payload = {
        displayName: values.displayName,
        monthlyTokenLimit: values.monthlyTokenLimit ?? null
      };
      if (self.role === 'dev') {
        payload.role = values.role;
        payload.boundTo = values.role === 'member' ? (values.boundTo || null) : null;
      }
      await updateTeamMember(selected.username, payload);
      message.success('成员信息已更新');
      setSelected(null);
      await load({ quiet: true });
    } catch (error) {
      message.error(error.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  function exportUsage() {
    const rows = [['username', 'displayName', 'role', 'boundTo', 'apiEnabled', 'monthTokens', 'monthCalls']];
    for (const item of team) rows.push([
      item.username,
      item.displayName,
      item.role,
      item.boundTo || '',
      item.apiEnabled ? 'true' : 'false',
      item.usage?.month?.totalTokens || 0,
      item.usage?.month?.calls || 0
    ]);
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `qiantie-team-usage-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="account-center-page"><Skeleton active paragraph={{ rows: 11 }} /></div>;
  if (!self || !['dev', 'manager'].includes(self.role)) return <div className="account-center-page"><Empty description="当前身份没有团队管理权限" /></div>;

  return <div className="account-center-page team-management-page">
    <PageHeader title="团队管理" subtitle="管理成员、角色、API 权限与用量额度" actions={<>
      <Button icon={<Download size={16} />} onClick={exportUsage}>导出用量</Button>
      <Button type="primary" icon={<UserPlus size={16} />} onClick={() => {
        createForm.resetFields();
        createForm.setFieldsValue({ role: 'member', apiEnabled: false });
        setCreateOpen(true);
      }}>添加成员</Button>
    </>} />

    <div className="ac-metrics-grid four">
      <MetricCard label="成员总数" value={members.length} suffix="人" icon={UsersRound} accent="violet" hint={`管理 ${managers.length} 人`} />
      <MetricCard label="已授权成员" value={authorized} suffix="人" icon={UserPlus} accent="blue" hint={`${members.length ? Math.round((authorized / members.length) * 100) : 0}% 已启用`} />
      <MetricCard label="本月团队消耗" value={formatTokens(teamMonth)} suffix="Tokens" icon={BarChart3} accent="green" hint="按实际使用成员归属统计" />
      <MetricCard label="团队额度" value="—" suffix="" icon={BarChart3} accent="gold" hint="成员额度单独配置" />
    </div>

    <div className="ac-team-workspace">
      <section className="ac-panel ac-team-table-panel">
        <div className="ac-team-toolbar">
          <div className="ac-search-box"><Search size={16} /><Input variant="borderless" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索成员（昵称 / @用户名）" /></div>
          <Select value={roleFilter} onChange={setRoleFilter} options={[
            { label: '全部角色', value: 'all' },
            { label: 'DEV', value: 'dev' },
            { label: 'MANAGER', value: 'manager' },
            { label: 'MEMBER', value: 'member' }
          ]} />
          <Select value={apiFilter} onChange={setApiFilter} options={[
            { label: '全部 API 状态', value: 'all' },
            { label: 'API 已启用', value: 'on' },
            { label: 'API 已暂停', value: 'off' }
          ]} />
        </div>

        <div className="ac-team-table">
          <div className="ac-team-table-head"><span>成员</span><span>角色</span><span>绑定管理</span><span>API 状态</span><span>本月额度</span><span>已用 Tokens</span><span /></div>
          {filtered.map(member => {
            const manager = team.find(item => item.username === member.boundTo);
            const percent = member.monthlyTokenLimit === null ? null : Math.min(100, Math.round((Number(member.usage?.month?.totalTokens || 0) / Math.max(member.monthlyTokenLimit, 1)) * 100));
            return <div className={`ac-team-table-row${member.username === self.username ? ' is-self' : ''}`} key={member.username}>
              <MemberIdentity member={member} size={40} />
              <RoleBadge role={member.role} compact />
              <span>{member.role === 'member' ? (manager?.displayName || '未绑定') : '—'}</span>
              <span>{member.role === 'member' ? <Switch size="small" checked={member.apiEnabled} onChange={checked => toggleApi(member, checked)} disabled={member.username === self.username} /> : <Tag color="blue">自主</Tag>}</span>
              <span>{member.monthlyTokenLimit === null ? '不限额' : formatTokens(member.monthlyTokenLimit)}</span>
              <div className="ac-team-used"><strong>{formatTokens(member.usage?.month?.totalTokens)}</strong>{percent === null ? null : <Progress percent={percent} showInfo={false} size="small" />}</div>
              <Button type="text" icon={<ChevronRight size={17} />} disabled={member.username === self.username} onClick={() => openMember(member)} />
            </div>;
          })}
          {!filtered.length ? <div className="ac-empty">没有符合条件的成员</div> : null}
        </div>
      </section>

      <aside className="ac-team-side">
        <section className="ac-panel">
          <div className="ac-panel-header"><div><small>TEAM RANKING</small><h2>团队排行 TOP5</h2></div></div>
          <div className="ac-ranking-list">
            {ranking.map((member, index) => <div className="ac-ranking-row" key={member.username}>
              <span className={`rank rank-${index + 1}`}>{index + 1}</span>
              <MemberIdentity member={member} size={32} />
              <div className="ac-ranking-value"><strong>{formatTokens(member.usage?.month?.totalTokens)}</strong><small>Tokens</small></div>
            </div>)}
            {!ranking.length ? <div className="ac-empty">暂无成员用量</div> : null}
          </div>
        </section>

        <section className="ac-panel">
          <div className="ac-panel-header"><div><small>QUICK ACTIONS</small><h2>快捷操作</h2></div></div>
          <div className="ac-quick-grid three">
            <button type="button" onClick={() => setCreateOpen(true)}><span><Plus size={18} /></span><b>添加成员</b></button>
            <button type="button" onClick={() => setApiFilter('off')}><span><UsersRound size={18} /></span><b>未授权成员</b></button>
            <button type="button" onClick={exportUsage}><span><Download size={18} /></span><b>导出用量</b></button>
          </div>
        </section>
      </aside>
    </div>

    <Drawer title="添加团队成员" width={480} open={createOpen} onClose={() => setCreateOpen(false)} extra={<Button type="primary" onClick={() => createForm.submit()} loading={saving}>创建</Button>}>
      <Form form={createForm} layout="vertical" onFinish={create} initialValues={{ role: 'member', apiEnabled: false }}>
        <Form.Item label="显示名称" name="displayName" rules={[{ required: true, whitespace: true, max: 40, message: '请输入成员名称' }]}><Input placeholder="例如：小林" /></Form.Item>
        <Form.Item label="登录账号" name="username" rules={[{ required: true, pattern: /^[A-Za-z0-9_-]{3,32}$/, message: '3-32 位字母、数字、下划线或短横线' }]}><Input autoComplete="off" /></Form.Item>
        <Form.Item label="初始密码" name="password" rules={[{ required: true, min: 8, message: '密码至少 8 位' }]}><Input.Password autoComplete="new-password" /></Form.Item>
        {self.role === 'dev' ? <Form.Item label="角色" name="role"><Select options={[
          { label: 'DEV · 开发', value: 'dev' },
          { label: 'MANAGER · 管理', value: 'manager' },
          { label: 'MEMBER · 组员', value: 'member' }
        ]} /></Form.Item> : <div className="ac-locked-role"><RoleBadge role="member" /> MANAGER 创建的账号固定为 MEMBER</div>}
        {self.role === 'dev' ? <Form.Item noStyle shouldUpdate={(a, b) => a.role !== b.role}>{({ getFieldValue }) => getFieldValue('role') === 'member' ? <Form.Item label="绑定管理" name="boundTo"><Select allowClear options={managers.map(item => ({ label: `${item.displayName} · @${item.username}`, value: item.username }))} placeholder="选择 MANAGER" /></Form.Item> : null}</Form.Item> : null}
        <Form.Item label="月度 Token 额度" name="monthlyTokenLimit"><InputNumber min={0} max={10_000_000_000} style={{ width: '100%' }} placeholder="留空表示不限额" /></Form.Item>
        <Form.Item label="创建后开启 API" name="apiEnabled" valuePropName="checked"><Switch /></Form.Item>
        <p className="ac-form-tip">MEMBER 只能使用绑定 MANAGER 的模型服务，不会读取或看到管理员 API Key。</p>
      </Form>
    </Drawer>

    <Drawer title={selected ? `${selected.displayName} · @${selected.username}` : '成员详情'} width={520} open={Boolean(selected)} onClose={() => setSelected(null)} extra={<Button type="primary" onClick={() => memberForm.submit()} loading={saving}>保存</Button>}>
      {selected ? <>
        <div className="ac-drawer-member-head"><Avatar size={66} src={selected.avatarUrl}>{avatarFallback(selected)}</Avatar><div><h2>{selected.displayName}</h2><p>@{selected.username}</p><RoleBadge role={selected.role} /></div></div>
        <div className="ac-drawer-usage-grid">
          <div><small>今日</small><strong>{formatTokens(selectedUsage?.day?.totalTokens)}</strong><span>Tokens</span></div>
          <div><small>本月</small><strong>{formatTokens(selectedUsage?.month?.totalTokens)}</strong><span>Tokens</span></div>
          <div><small>调用</small><strong>{selectedUsage?.month?.calls || 0}</strong><span>次</span></div>
        </div>
        <Form form={memberForm} layout="vertical" onFinish={saveMember}>
          <Form.Item label="显示名称" name="displayName" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
          {self.role === 'dev' ? <Form.Item label="角色" name="role"><Select options={[
            { label: 'DEV', value: 'dev' }, { label: 'MANAGER', value: 'manager' }, { label: 'MEMBER', value: 'member' }
          ]} /></Form.Item> : null}
          {self.role === 'dev' ? <Form.Item noStyle shouldUpdate={(a, b) => a.role !== b.role}>{({ getFieldValue }) => getFieldValue('role') === 'member' ? <Form.Item label="绑定管理" name="boundTo"><Select allowClear options={managers.map(item => ({ label: `${item.displayName} · @${item.username}`, value: item.username }))} /></Form.Item> : null}</Form.Item> : null}
          <Form.Item label="月度 Token 额度" name="monthlyTokenLimit"><InputNumber min={0} max={10_000_000_000} style={{ width: '100%' }} placeholder="留空表示不限额" /></Form.Item>
        </Form>
        <section className="ac-drawer-activity"><h3>最近使用</h3>{(selectedUsage?.recent || []).slice(0, 6).map(item => <div key={item.id}><span>{item.feature || '模型调用'}</span><small>{formatDate(item.at)}</small><b>{formatTokens(item.totalTokens)} T</b></div>)}</section>
      </> : null}
    </Drawer>
  </div>;
}
