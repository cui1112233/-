import { Avatar, Button, Progress, Skeleton, Tag, message } from 'antd';
import { Activity, ArrowUpRight, Gauge, KeyRound, Sparkles, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getMemberCenter, getTeamMembers } from '../../shared/api/member';
import { Link } from '../../shared/components/Link';
import {
  FeatureBars,
  MemberIdentity,
  PageHeader,
  Panel,
  RoleBadge,
  avatarFallback,
  formatDate,
  formatTokens
} from './accountCenterShared';

export default function MemberCenterPage() {
  const [loading, setLoading] = useState(true);
  const [center, setCenter] = useState(null);
  const [team, setTeam] = useState([]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getMemberCenter(),
      getTeamMembers().catch(() => ({ members: [] }))
    ]).then(([nextCenter, teamResult]) => {
      if (!alive) return;
      setCenter(nextCenter);
      setTeam(teamResult.members || []);
    }).catch(error => message.error(error.message || '会员中心加载失败'))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const self = center?.member;
  const month = center?.usage?.month || {};
  const day = center?.usage?.day || {};
  const recent = center?.usage?.recent || [];
  const members = useMemo(() => team.filter(item => item.role === 'member'), [team]);
  const teamMonth = useMemo(() => members.reduce((sum, item) => sum + Number(item.usage?.month?.totalTokens || 0), 0), [members]);
  const teamDay = useMemo(() => members.reduce((sum, item) => sum + Number(item.usage?.day?.totalTokens || 0), 0), [members]);
  const ranking = useMemo(() => [...members].sort((a, b) => (b.usage?.month?.totalTokens || 0) - (a.usage?.month?.totalTokens || 0)).slice(0, 5), [members]);

  if (loading) return <div className="account-center-page"><Skeleton active paragraph={{ rows: 10 }} /></div>;
  if (!self) return <div className="account-center-page"><div className="ac-empty">无法读取会员资料</div></div>;

  const quota = self.monthlyTokenLimit;
  const quotaPercent = quota === null ? 0 : Math.min(100, Math.round((Number(month.totalTokens || 0) / Math.max(quota, 1)) * 100));
  const canManageTeam = ['dev', 'manager'].includes(self.role);
  const apiEnabled = self.role === 'member' ? self.apiEnabled : true;

  return <div className="account-center-page member-dashboard-page">
    <PageHeader title="会员中心" subtitle="身份、额度、团队与 AI 服务状态总览" />

    <div className="ac-member-layout">
      <div className="ac-member-main">
        <section className={`ac-identity-hero role-${self.role}`}>
          <div className="ac-identity-glow" />
          <div className="ac-hero-profile">
            <div className="ac-hero-avatar"><Avatar size={104} src={self.avatarUrl}>{avatarFallback(self)}</Avatar></div>
            <div className="ac-hero-copy">
              <div className="ac-hero-name-line"><h2>{self.displayName}</h2><RoleBadge role={self.role} /></div>
              <p>@{self.username}</p>
              <div className="ac-hero-meta">
                <span><UsersRound size={15} />{self.role === 'member' ? (center.manager ? `所属管理 · ${center.manager.displayName}` : '暂未绑定管理') : 'qiantie 核心团队'}</span>
                <span><KeyRound size={15} />{apiEnabled ? 'AI 服务已启用' : 'AI 服务未授权'}</span>
              </div>
            </div>
          </div>
          <div className="ac-hero-facts">
            <div><small>所属团队</small><strong>qiantie</strong></div>
            <div><small>当前身份</small><strong>{self.role === 'dev' ? '开发（最高权限）' : self.role === 'manager' ? '团队管理' : '团队成员'}</strong></div>
            <div><small>加入时间</small><strong>{formatDate(self.createdAt).slice(0, 10)}</strong></div>
            <div><small>API 服务</small><strong className={apiEnabled ? 'success' : 'danger'}>{apiEnabled ? '● 已启用' : '● 未授权'}</strong></div>
          </div>
        </section>

        <div className="ac-dashboard-grid ac-dashboard-grid-3">
          <Panel title="本月额度" eyebrow="MONTHLY QUOTA">
            <div className="ac-quota-value"><strong>{formatTokens(month.totalTokens)}</strong><span>/ {quota === null ? '不限额' : `${formatTokens(quota)} Tokens`}</span></div>
            <Progress percent={quota === null ? 0 : quotaPercent} showInfo={quota !== null} status={quotaPercent >= 100 ? 'exception' : 'active'} />
            <div className="ac-panel-footnote">{quota === null ? '当前账号没有设置月度上限' : `剩余 ${formatTokens(Math.max(0, quota - Number(month.totalTokens || 0)))} Tokens`}</div>
          </Panel>

          <Panel title="AI 服务状态" eyebrow="AI ACCESS">
            <div className="ac-service-list">
              {['Agent 对话', '剧本生成', '小说创作', '生图工具'].map(label => <div key={label}><span className={apiEnabled ? 'dot-on' : 'dot-off'} />{label}<b>{apiEnabled ? '已启用' : '未授权'}</b></div>)}
            </div>
            <Link href="/api-config" className="ac-text-link">查看 API 配置 <ArrowUpRight size={14} /></Link>
          </Panel>

          <Panel title="用量构成" eyebrow="USAGE BREAKDOWN">
            <FeatureBars byFeature={month.byFeature} total={month.totalTokens} limit={5} />
          </Panel>
        </div>

        <Panel title="最近活动" eyebrow="RECENT ACTIVITY" action={<Link href="/usage" className="ac-text-link">查看全部 <ArrowUpRight size={14} /></Link>}>
          <div className="ac-activity-list">
            {recent.slice(0, 7).map(item => <div className="ac-activity-row" key={item.id}>
              <span className="ac-activity-icon"><Activity size={15} /></span>
              <div><strong>{item.feature || '模型调用'}</strong><small>{item.model || '默认模型'} · {formatDate(item.at)}</small></div>
              <b>{item.usageKnown ? `${formatTokens(item.totalTokens)} Tokens` : '已调用'}</b>
            </div>)}
            {!recent.length ? <div className="ac-empty">还没有调用记录</div> : null}
          </div>
        </Panel>
      </div>

      <aside className="ac-member-side">
        <Panel title="团队概览" action={canManageTeam ? <Link href="/team" className="ac-text-link">查看团队 <ArrowUpRight size={14} /></Link> : null}>
          <div className="ac-team-brand"><span className="ac-team-logo">Q</span><div><strong>qiantie</strong><small>{canManageTeam ? '核心团队' : '所属团队'}</small></div></div>
          <div className="ac-team-kpis">
            <div><small>成员</small><strong>{members.length || (self.role === 'member' ? 1 : 0)}</strong></div>
            <div><small>已授权</small><strong>{members.filter(item => item.apiEnabled).length}</strong></div>
            <div><small>本月消耗</small><strong>{formatTokens(canManageTeam ? teamMonth : month.totalTokens)}</strong></div>
          </div>
          <div className="ac-side-summary"><span>今日消耗</span><strong>{formatTokens(canManageTeam ? teamDay : day.totalTokens)} Tokens</strong></div>
        </Panel>

        {canManageTeam ? <Panel title="成员消耗 TOP5" action={<Link href="/team" className="ac-text-link">查看全部</Link>}>
          <div className="ac-ranking-list">
            {ranking.map((member, index) => <div className="ac-ranking-row" key={member.username}>
              <span className={`rank rank-${index + 1}`}>{index + 1}</span>
              <MemberIdentity member={member} size={34} />
              <div className="ac-ranking-value"><strong>{formatTokens(member.usage?.month?.totalTokens)}</strong><small>Tokens</small></div>
            </div>)}
            {!ranking.length ? <div className="ac-empty">还没有成员用量</div> : null}
          </div>
        </Panel> : null}

        <Panel title="快捷入口">
          <div className="ac-quick-grid">
            <Link href="/profile"><span><Sparkles size={18} /></span><b>个人资料</b></Link>
            <Link href="/usage"><span><Gauge size={18} /></span><b>用量统计</b></Link>
            <Link href="/api-config"><span><KeyRound size={18} /></span><b>API 配置</b></Link>
            {canManageTeam ? <Link href="/team"><span><UsersRound size={18} /></span><b>团队管理</b></Link> : <Link href="/security"><span><Activity size={18} /></span><b>账号安全</b></Link>}
          </div>
        </Panel>
      </aside>
    </div>
  </div>;
}
