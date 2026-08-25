import { Avatar, Button, Drawer, Empty, Form, Input, InputNumber, Modal, Progress, Select, Skeleton, Switch, Tag, Typography, message } from 'antd';
import {
  Activity,
  BadgeCheck,
  Camera,
  ChevronRight,
  Crown,
  Gauge,
  KeyRound,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  UsersRound
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createTeamMember,
  getMemberCenter,
  getTeamMemberUsage,
  getTeamMembers,
  setTeamMemberApi,
  updateMemberProfile,
  updateTeamMember,
  uploadMemberAvatar
} from '../../shared/api/member';

const ROLE_META = {
  dev: { label: 'DEV', name: '开发', icon: Crown },
  manager: { label: 'MANAGER', name: '管理', icon: ShieldCheck },
  member: { label: 'MEMBER', name: '组员', icon: BadgeCheck }
};

const FEATURE_LABELS = {
  agent: 'Agent 工作区',
  chat: '文本生成',
  script: '剧本生成',
  'novel-panel': '小说面板',
  image: '生图',
  tts: '配音',
  unknown: '其他'
};

function roleMeta(role) {
  return ROLE_META[role] || ROLE_META.member;
}

function formatTokens(value) {
  const number = Number(value) || 0;
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(number >= 10_000_000_000 ? 0 : 2)}B`;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 1 : 2)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 100_000 ? 0 : 1)}K`;
  return String(number);
}

function avatarFallback(member) {
  return String(member?.displayName || member?.username || '?').trim().slice(0, 1).toUpperCase();
}

function RoleBadge({ role, compact = false }) {
  const meta = roleMeta(role);
  const Icon = meta.icon;
  return (
    <span className={`member-role-badge role-${role || 'member'}${compact ? ' compact' : ''}`}>
      <Icon size={compact ? 12 : 14} strokeWidth={2} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function UsageStat({ label, value, suffix, icon: Icon }) {
  return (
    <div className="member-usage-stat">
      <span className="member-usage-stat-icon"><Icon size={17} strokeWidth={1.8} aria-hidden="true" /></span>
      <div><small>{label}</small><strong>{value}</strong>{suffix ? <em>{suffix}</em> : null}</div>
    </div>
  );
}

function FeatureUsage({ byFeature = {}, total = 0 }) {
  const entries = Object.entries(byFeature)
    .filter(([, value]) => Number(value) > 0)
    .sort((left, right) => right[1] - left[1]);
  if (!entries.length) return <div className="member-empty-usage">本月还没有可统计的 Token 消耗</div>;
  return (
    <div className="member-feature-list">
      {entries.map(([feature, value]) => {
        const percent = total ? Math.round((value / total) * 100) : 0;
        return <div className="member-feature-row" key={feature}>
          <div><strong>{FEATURE_LABELS[feature] || feature}</strong><span>{formatTokens(value)} Tokens</span></div>
          <Progress percent={percent} showInfo={false} size="small" />
          <b>{percent}%</b>
        </div>;
      })}
    </div>
  );
}

export default function MemberCenterPage() {
  const [loading, setLoading] = useState(true);
  const [center, setCenter] = useState(null);
  const [team, setTeam] = useState([]);
  const [tab, setTab] = useState('membership');
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [memberDrawer, setMemberDrawer] = useState(null);
  const [memberUsage, setMemberUsage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [nameForm] = Form.useForm();
  const [createForm] = Form.useForm();
  const [memberForm] = Form.useForm();
  const avatarInputRef = useRef(null);

  const self = center?.member;
  const isTeamAdmin = ['dev', 'manager'].includes(self?.role);
  const managers = useMemo(() => team.filter(item => item.role === 'manager' && item.active), [team]);
  const teamMembers = useMemo(() => team.filter(item => item.role === 'member'), [team]);
  const teamMonthTokens = useMemo(() => teamMembers.reduce((total, item) => total + (item.usage?.month?.totalTokens || 0), 0), [teamMembers]);
  const teamDayTokens = useMemo(() => teamMembers.reduce((total, item) => total + (item.usage?.day?.totalTokens || 0), 0), [teamMembers]);
  const authorizedCount = teamMembers.filter(item => item.apiEnabled).length;

  async function load({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    try {
      const nextCenter = await getMemberCenter();
      setCenter(nextCenter);
      if (['dev', 'manager'].includes(nextCenter.member?.role)) {
        const result = await getTeamMembers();
        setTeam(result.members || []);
      } else {
        setTeam([]);
      }
    } catch (error) {
      message.error(error.message || '会员中心加载失败');
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function submitDisplayName(values) {
    setSaving(true);
    try {
      await updateMemberProfile(values.displayName);
      message.success('名字已更新');
      setEditNameOpen(false);
      await load({ quiet: true });
      window.dispatchEvent(new CustomEvent('qiantie:profile-updated'));
    } catch (error) {
      message.error(error.message || '名字更新失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return message.error('请选择 PNG、JPG 或 WebP 图片');
    if (file.size > 2 * 1024 * 1024) return message.error('头像不能超过 2MB');
    const reader = new FileReader();
    reader.onload = async () => {
      setSaving(true);
      try {
        await uploadMemberAvatar(reader.result);
        message.success('头像已更新');
        await load({ quiet: true });
        window.dispatchEvent(new CustomEvent('qiantie:profile-updated'));
      } catch (error) {
        message.error(error.message || '头像上传失败');
      } finally {
        setSaving(false);
      }
    };
    reader.readAsDataURL(file);
  }

  async function submitCreate(values) {
    setSaving(true);
    try {
      await createTeamMember({
        ...values,
        role: self.role === 'manager' ? 'member' : values.role,
        boundTo: self.role === 'manager' ? self.username : values.boundTo,
        monthlyTokenLimit: values.monthlyTokenLimit ?? null
      });
      message.success('成员已创建');
      setCreateOpen(false);
      createForm.resetFields();
      await load({ quiet: true });
    } catch (error) {
      message.error(error.message || '创建成员失败');
    } finally {
      setSaving(false);
    }
  }

  async function toggleApi(member, enabled) {
    try {
      await setTeamMemberApi(member.username, enabled);
      message.success(enabled ? 'API 已授权' : 'API 已暂停');
      await load({ quiet: true });
      if (memberDrawer?.username === member.username) setMemberDrawer(current => ({ ...current, apiEnabled: enabled }));
    } catch (error) {
      message.error(error.message || 'API 状态更新失败');
    }
  }

  async function openMember(member) {
    setMemberDrawer(member);
    setMemberUsage(null);
    memberForm.setFieldsValue({
      displayName: member.displayName,
      role: member.role,
      boundTo: member.boundTo || undefined,
      monthlyTokenLimit: member.monthlyTokenLimit
    });
    try {
      const usage = await getTeamMemberUsage(member.username);
      setMemberUsage(usage);
    } catch (error) {
      message.error(error.message || '读取成员用量失败');
    }
  }

  async function saveMember(values) {
    if (!memberDrawer) return;
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
      await updateTeamMember(memberDrawer.username, payload);
      message.success('成员信息已更新');
      setMemberDrawer(null);
      await load({ quiet: true });
    } catch (error) {
      message.error(error.message || '成员更新失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="member-center-page"><Skeleton active paragraph={{ rows: 8 }} /></div>;
  if (!self) return <div className="member-center-page"><Empty description="无法读取会员资料" /></div>;

  const monthUsage = center.usage?.month || {};
  const dayUsage = center.usage?.day || {};
  const quota = self.monthlyTokenLimit;
  const quotaPercent = quota === null ? 0 : Math.min(100, Math.round(((monthUsage.totalTokens || 0) / Math.max(quota, 1)) * 100));

  return (
    <div className="member-center-page">
      <section className={`membership-hero role-${self.role}`}>
        <div className="membership-hero-glow" aria-hidden="true" />
        <div className="membership-identity">
          <button className="membership-avatar-button" type="button" onClick={() => avatarInputRef.current?.click()} disabled={saving}>
            <Avatar size={92} src={self.avatarUrl}>{avatarFallback(self)}</Avatar>
            <span><Camera size={16} aria-hidden="true" /></span>
          </button>
          <input ref={avatarInputRef} className="member-hidden-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarFile} />
          <div className="membership-name-block">
            <div className="membership-role-line"><RoleBadge role={self.role} /><span>{roleMeta(self.role).name}成员</span></div>
            <div className="membership-name-row">
              <Typography.Title level={2}>{self.displayName}</Typography.Title>
              <Button type="text" icon={<Pencil size={16} />} onClick={() => {
                nameForm.setFieldsValue({ displayName: self.displayName });
                setEditNameOpen(true);
              }} />
            </div>
            <p>@{self.username}</p>
            <div className="membership-status-row">
              {self.role === 'member' ? <span><UsersRound size={15} />{center.manager ? `所属管理 · ${center.manager.displayName}` : '暂未绑定管理'}</span> : <span><UsersRound size={15} />qiantie 团队</span>}
              <span className={self.role === 'member' && !self.apiEnabled ? 'is-off' : 'is-on'}><KeyRound size={15} />{self.role === 'member' ? (self.apiEnabled ? 'API 已授权' : 'API 未授权') : 'API 自主管理'}</span>
            </div>
          </div>
        </div>
        <div className="membership-hero-stats">
          <UsageStat label="本月消耗" value={formatTokens(monthUsage.totalTokens)} suffix="Tokens" icon={Sparkles} />
          <UsageStat label="今日调用" value={dayUsage.calls || 0} suffix="次" icon={Activity} />
          <UsageStat label="本月调用" value={monthUsage.calls || 0} suffix="次" icon={Gauge} />
        </div>
      </section>

      <nav className="member-tabs" aria-label="个人中心导航">
        <button className={tab === 'membership' ? 'active' : ''} onClick={() => setTab('membership')} type="button">会员区</button>
        {isTeamAdmin ? <button className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')} type="button">团队管理</button> : null}
      </nav>

      {tab === 'membership' ? (
        <div className="member-overview-grid">
          <section className="member-panel member-quota-panel">
            <div className="member-panel-heading"><div><small>MONTHLY USAGE</small><h2>本月额度</h2></div><Gauge size={21} /></div>
            {quota === null ? (
              <div className="member-unlimited"><strong>{formatTokens(monthUsage.totalTokens)}</strong><span>Tokens 已使用</span><Tag>不限额</Tag></div>
            ) : (
              <>
                <div className="member-quota-numbers"><strong>{formatTokens(monthUsage.totalTokens)}</strong><span>/ {formatTokens(quota)} Tokens</span></div>
                <Progress percent={quotaPercent} status={quotaPercent >= 100 ? 'exception' : 'active'} />
                <p>剩余 {formatTokens(Math.max(0, quota - (monthUsage.totalTokens || 0)))} Tokens</p>
              </>
            )}
          </section>

          <section className="member-panel member-api-panel">
            <div className="member-panel-heading"><div><small>AI ACCESS</small><h2>AI 服务</h2></div><KeyRound size={21} /></div>
            <div className={`member-api-state ${self.role === 'member' && !self.apiEnabled ? 'off' : 'on'}`}>
              <span className="member-state-dot" />
              <div><strong>{self.role === 'member' ? (self.apiEnabled ? '已授权' : '尚未授权') : '已启用'}</strong><p>{self.role === 'member' ? (center.manager ? `由 ${center.manager.displayName} 提供团队 API` : '等待 DEV 为你绑定管理') : '使用当前账号自己的模型连接'}</p></div>
            </div>
            {self.role === 'member' ? <div className="member-managed-note">组员不会看到团队 API Key，也无需在工作台设置模型连接。</div> : <Button href="/settings">管理模型连接 <ChevronRight size={15} /></Button>}
          </section>

          <section className="member-panel member-feature-panel">
            <div className="member-panel-heading"><div><small>USAGE BREAKDOWN</small><h2>消耗构成</h2></div><Activity size={21} /></div>
            <FeatureUsage byFeature={monthUsage.byFeature} total={monthUsage.totalTokens} />
          </section>

          <section className="member-panel member-recent-panel">
            <div className="member-panel-heading"><div><small>RECENT ACTIVITY</small><h2>最近使用</h2></div><Sparkles size={21} /></div>
            <div className="member-recent-list">
              {(center.usage?.recent || []).length ? center.usage.recent.slice(0, 8).map(item => <div key={item.id}>
                <span className="member-recent-icon"><Activity size={14} /></span>
                <div><strong>{FEATURE_LABELS[item.feature] || item.feature}</strong><small>{item.model || '模型调用'} · {new Date(item.at).toLocaleString('zh-CN', { hour12: false })}</small></div>
                <b>{item.usageKnown ? `${formatTokens(item.totalTokens)} T` : '已调用'}</b>
              </div>) : <div className="member-empty-usage">暂无调用记录</div>}
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'team' && isTeamAdmin ? (
        <div className="team-center">
          <section className="team-summary-row">
            <div><small>成员</small><strong>{teamMembers.length}</strong><span>名组员</span></div>
            <div><small>API 已授权</small><strong>{authorizedCount}</strong><span>/ {teamMembers.length || 0}</span></div>
            <div><small>今日消耗</small><strong>{formatTokens(teamDayTokens)}</strong><span>Tokens</span></div>
            <div><small>本月团队消耗</small><strong>{formatTokens(teamMonthTokens)}</strong><span>Tokens</span></div>
          </section>

          <section className="member-panel team-member-panel">
            <div className="team-list-heading">
              <div><small>TEAM MEMBERS</small><h2>{self.role === 'dev' ? '全部团队成员' : '我的组员'}</h2></div>
              <Button type="primary" icon={<Plus size={16} />} onClick={() => {
                createForm.resetFields();
                createForm.setFieldsValue({ role: 'member', apiEnabled: true });
                setCreateOpen(true);
              }}>添加成员</Button>
            </div>
            <div className="team-member-table">
              <div className="team-member-table-head"><span>成员</span><span>身份 / 归属</span><span>今日</span><span>本月</span><span>API</span><span /></div>
              {team.filter(item => item.username !== self.username).map(member => {
                const manager = team.find(item => item.username === member.boundTo);
                const percent = member.monthlyTokenLimit === null ? null : Math.min(100, Math.round(((member.usage?.month?.totalTokens || 0) / Math.max(member.monthlyTokenLimit, 1)) * 100));
                return <div className="team-member-row" key={member.username}>
                  <div className="team-member-person"><Avatar size={40} src={member.avatarUrl}>{avatarFallback(member)}</Avatar><div><strong>{member.displayName}</strong><small>@{member.username}</small></div></div>
                  <div><RoleBadge role={member.role} compact />{member.role === 'member' ? <small>{manager ? `· ${manager.displayName}` : '· 未绑定'}</small> : null}</div>
                  <div><strong>{formatTokens(member.usage?.day?.totalTokens)}</strong><small>Tokens</small></div>
                  <div className="team-month-cell"><strong>{formatTokens(member.usage?.month?.totalTokens)}</strong><small>{percent === null ? '不限额' : `${percent}% / ${formatTokens(member.monthlyTokenLimit)}`}</small></div>
                  <div>{member.role === 'member' ? <Switch size="small" checked={member.apiEnabled} onChange={checked => toggleApi(member, checked)} /> : <span className="team-self-api">自主</span>}</div>
                  <div><Button type="text" size="small" onClick={() => openMember(member)}><ChevronRight size={17} /></Button></div>
                </div>;
              })}
              {!team.filter(item => item.username !== self.username).length ? <Empty description="还没有团队成员" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : null}
            </div>
          </section>
        </div>
      ) : null}

      <Modal title="修改名字" open={editNameOpen} onCancel={() => setEditNameOpen(false)} onOk={() => nameForm.submit()} confirmLoading={saving} okText="保存">
        <Form form={nameForm} layout="vertical" onFinish={submitDisplayName}>
          <Form.Item label="显示名称" name="displayName" rules={[{ required: true, whitespace: true, max: 40, message: '请输入 1-40 个字符的名字' }]}><Input maxLength={40} /></Form.Item>
          <p className="member-form-tip">登录账号 @{self.username} 不会改变，qiantie 内将优先显示这个名字。</p>
        </Form>
      </Modal>

      <Drawer title="添加团队成员" width={460} open={createOpen} onClose={() => setCreateOpen(false)} extra={<Button type="primary" loading={saving} onClick={() => createForm.submit()}>创建</Button>}>
        <Form form={createForm} layout="vertical" onFinish={submitCreate} initialValues={{ role: 'member', apiEnabled: true }}>
          <Form.Item label="名字" name="displayName" rules={[{ required: true, whitespace: true, max: 40, message: '请输入成员名字' }]}><Input placeholder="例如：小林" /></Form.Item>
          <Form.Item label="登录账号" name="username" rules={[{ required: true, pattern: /^[A-Za-z0-9_-]{3,32}$/, message: '3-32 位字母、数字、下划线或短横线' }]}><Input autoComplete="off" placeholder="xiaolin" /></Form.Item>
          <Form.Item label="初始密码" name="password" rules={[{ required: true, min: 8, message: '密码至少 8 位' }]}><Input.Password autoComplete="new-password" /></Form.Item>
          {self.role === 'dev' ? <Form.Item label="身份" name="role" rules={[{ required: true }]}><Select options={[
            { label: 'DEV · 开发', value: 'dev' },
            { label: 'MANAGER · 管理', value: 'manager' },
            { label: 'MEMBER · 组员', value: 'member' }
          ]} /></Form.Item> : <div className="member-locked-role"><RoleBadge role="member" />MANAGER 创建的账号固定为组员</div>}
          {self.role === 'dev' ? <Form.Item noStyle shouldUpdate={(before, after) => before.role !== after.role}>{({ getFieldValue }) => getFieldValue('role') === 'member' ? <Form.Item label="所属管理" name="boundTo"><Select allowClear placeholder="可稍后绑定" options={managers.map(item => ({ label: `${item.displayName} · @${item.username}`, value: item.username }))} /></Form.Item> : null}</Form.Item> : null}
          <Form.Item label="月度 Token 额度" name="monthlyTokenLimit"><InputNumber min={0} max={10_000_000_000} style={{ width: '100%' }} placeholder="留空表示不限额" /></Form.Item>
          <Form.Item label="创建后允许使用团队 API" name="apiEnabled" valuePropName="checked"><Switch /></Form.Item>
          <p className="member-form-tip">组员只会获得调用权限，不会看到管理员的 API Key。</p>
        </Form>
      </Drawer>

      <Drawer title={memberDrawer ? `${memberDrawer.displayName} · @${memberDrawer.username}` : '成员详情'} width={500} open={Boolean(memberDrawer)} onClose={() => setMemberDrawer(null)} extra={<Button type="primary" loading={saving} onClick={() => memberForm.submit()}>保存</Button>}>
        {memberDrawer ? <>
          <div className="member-detail-identity"><Avatar size={58} src={memberDrawer.avatarUrl}>{avatarFallback(memberDrawer)}</Avatar><div><strong>{memberDrawer.displayName}</strong><RoleBadge role={memberDrawer.role} /></div>{memberDrawer.role === 'member' ? <Switch checked={memberDrawer.apiEnabled} onChange={checked => toggleApi(memberDrawer, checked)} /> : null}</div>
          <div className="member-detail-stats">
            <div><small>今日</small><strong>{formatTokens(memberUsage?.day?.totalTokens)}</strong><span>Tokens</span></div>
            <div><small>本月</small><strong>{formatTokens(memberUsage?.month?.totalTokens)}</strong><span>Tokens</span></div>
            <div><small>调用</small><strong>{memberUsage?.month?.calls || 0}</strong><span>次</span></div>
          </div>
          <Form form={memberForm} layout="vertical" onFinish={saveMember}>
            <Form.Item label="显示名称" name="displayName" rules={[{ required: true, max: 40 }]}><Input /></Form.Item>
            {self.role === 'dev' ? <Form.Item label="身份" name="role"><Select options={[
              { label: 'DEV', value: 'dev' }, { label: 'MANAGER', value: 'manager' }, { label: 'MEMBER', value: 'member' }
            ]} /></Form.Item> : null}
            {self.role === 'dev' ? <Form.Item noStyle shouldUpdate={(before, after) => before.role !== after.role}>{({ getFieldValue }) => getFieldValue('role') === 'member' ? <Form.Item label="所属管理" name="boundTo"><Select allowClear options={managers.filter(item => item.username !== memberDrawer.username).map(item => ({ label: `${item.displayName} · @${item.username}`, value: item.username }))} /></Form.Item> : null}</Form.Item> : null}
            <Form.Item label="月度 Token 额度" name="monthlyTokenLimit"><InputNumber min={0} max={10_000_000_000} style={{ width: '100%' }} placeholder="留空表示不限额" /></Form.Item>
          </Form>
          <section className="member-detail-recent"><h3>最近调用</h3>{(memberUsage?.recent || []).slice(0, 10).map(item => <div key={item.id}><span>{FEATURE_LABELS[item.feature] || item.feature}</span><small>{item.model || '-'}</small><b>{item.usageKnown ? formatTokens(item.totalTokens) : '—'}</b></div>)}</section>
        </> : null}
      </Drawer>
    </div>
  );
}
