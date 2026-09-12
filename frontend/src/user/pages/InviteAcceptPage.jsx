import { Button, Form, Input, Result, Skeleton, Tag, message } from 'antd';
import { KeyRound, ShieldCheck, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { inspectTeamInvite, redeemTeamInvite } from '../../shared/api/member';
import { BrandLogo } from '../../shared/components/BrandLogo';

function tokenFromPath() {
  const match = window.location.pathname.match(/^\/invite\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : '';
}

export default function InviteAcceptPage() {
  const token = useMemo(tokenFromPath, []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState(null);
  const [joined, setJoined] = useState(null);
  const [form] = Form.useForm();

  useEffect(() => {
    inspectTeamInvite(token).then(setData).catch(error => message.error(error.message || '邀请读取失败')).finally(() => setLoading(false));
  }, [token]);

  async function submit(values) {
    setSaving(true);
    try {
      const result = await redeemTeamInvite(token, values);
      setJoined(result);
      message.success('已加入团队');
    } catch (error) {
      message.error(error.message || '接受邀请失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="invite-page"><div className="invite-card"><Skeleton active /></div></div>;
  if (!data?.invite) return <div className="invite-page"><Result status="404" title="邀请不存在" subTitle="请联系团队管理员重新生成邀请链接。" /></div>;
  if (!data.invite.available && !joined) return <div className="invite-page"><Result status="warning" title={data.invite.expired ? '邀请已过期' : '邀请已被使用'} subTitle="请联系团队管理员获取新的邀请链接。" /></div>;
  if (joined) return <div className="invite-page"><Result status="success" title={`已加入 ${joined.team?.name || data.invite.teamName}`} subTitle={`账号 @${joined.member.username} 已创建，现在可以返回首页登录。`} extra={<Button type="primary" href="/">返回登录</Button>} /></div>;

  return <div className="invite-page">
    <div className="invite-card">
      <div className="invite-brand"><BrandLogo /><span>一战晟铭 · qiantie</span></div>
      <div className="invite-hero"><span className="invite-team-icon"><UsersRound size={26} /></span><div><small>TEAM INVITATION</small><h1>加入 {data.invite.teamName}</h1><p>{data.manager?.displayName || data.invite.managerUsername} 邀请你加入团队。</p></div></div>
      <div className="invite-policy">
        <div><ShieldCheck size={17} /><span>默认能力</span><strong>{data.invite.apiScopes?.length ? data.invite.apiScopes.join(' / ') : '暂不授权 AI'}</strong></div>
        <div><KeyRound size={17} /><span>月度额度</span><strong>{data.invite.monthlyTokenLimit === null ? '不限额' : `${data.invite.monthlyTokenLimit.toLocaleString()} Tokens`}</strong></div>
        <Tag color="blue">有效至 {new Date(data.invite.expiresAt).toLocaleString('zh-CN')}</Tag>
      </div>
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item label="显示名称" name="displayName" rules={[{ required: true, whitespace: true, max: 40 }]}><Input placeholder="团队里显示的名字" /></Form.Item>
        <Form.Item label="登录账号" name="username" rules={[{ required: true, pattern: /^[A-Za-z0-9_-]{3,32}$/, message: '3-32 位字母、数字、下划线或短横线' }]}><Input autoComplete="username" /></Form.Item>
        <Form.Item label="设置密码" name="password" rules={[{ required: true, min: 8, message: '密码至少 8 位' }]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Form.Item label="确认密码" name="confirmPassword" dependencies={['password']} rules={[{ required: true }, ({ getFieldValue }) => ({ validator(_, value) { return value === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error('两次密码不一致')); } })]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Button block type="primary" htmlType="submit" loading={saving}>接受邀请并创建账号</Button>
      </Form>
      <p className="invite-footnote">邀请只可使用一次。加入后，你不会看到管理员的 API Key。</p>
    </div>
  </div>;
}
