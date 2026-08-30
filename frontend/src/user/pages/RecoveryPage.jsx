import { Button, Form, Input, Result, Spin, message } from 'antd';
import { KeyRound, MailCheck, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { requestPasswordReset, resetPasswordWithToken, verifyEmailToken } from '../../shared/api/accountRecovery';
import { BrandLogo } from '../../shared/components/BrandLogo';

function query() {
  return new URLSearchParams(window.location.search);
}

export default function RecoveryPage() {
  const params = useMemo(query, []);
  const verifyToken = params.get('verify') || '';
  const resetToken = params.get('reset') || '';
  const [verifying, setVerifying] = useState(Boolean(verifyToken));
  const [verified, setVerified] = useState(null);
  const [requested, setRequested] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!verifyToken) return;
    verifyEmailToken(verifyToken)
      .then(result => setVerified(result))
      .catch(error => setVerified({ error: error.message || '邮箱验证失败' }))
      .finally(() => setVerifying(false));
  }, [verifyToken]);

  async function request(values) {
    setSaving(true);
    try {
      await requestPasswordReset(values.email);
      setRequested(true);
    } catch (error) {
      message.error(error.message || '找回密码请求失败');
    } finally { setSaving(false); }
  }

  async function reset(values) {
    setSaving(true);
    try {
      await resetPasswordWithToken(resetToken, values.password);
      setResetDone(true);
    } catch (error) {
      message.error(error.message || '密码重置失败');
    } finally { setSaving(false); }
  }

  if (verifying) return <div className="invite-page"><div className="invite-card"><Spin /><p>正在验证邮箱…</p></div></div>;
  if (verified?.error) return <div className="invite-page"><Result status="warning" title="邮箱验证失败" subTitle={verified.error} extra={<Button href="/">返回首页</Button>} /></div>;
  if (verified?.verified) return <div className="invite-page"><Result status="success" title="邮箱验证完成" subTitle={`${verified.email} 已可用于找回密码。`} extra={<Button type="primary" href="/">返回登录</Button>} /></div>;
  if (resetDone) return <div className="invite-page"><Result status="success" title="密码已重置" subTitle="所有旧登录会话已经撤销，请使用新密码重新登录。" extra={<Button type="primary" href="/">返回登录</Button>} /></div>;

  return <div className="invite-page">
    <div className="invite-card recovery-card">
      <div className="invite-brand"><BrandLogo /><span>一战晟铭 · 账号恢复</span></div>
      {resetToken ? <>
        <div className="invite-hero"><span className="invite-team-icon"><RotateCcw size={26} /></span><div><small>PASSWORD RECOVERY</small><h1>设置新密码</h1><p>重置链接只能使用一次，成功后所有旧会话都会失效。</p></div></div>
        <Form layout="vertical" onFinish={reset}>
          <Form.Item label="新密码" name="password" rules={[{ required: true, min: 8, message: '密码至少 8 位' }]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Form.Item label="确认新密码" name="confirm" dependencies={['password']} rules={[{ required: true }, ({ getFieldValue }) => ({ validator(_, value) { return value === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error('两次密码不一致')); } })]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Button block type="primary" htmlType="submit" loading={saving} icon={<KeyRound size={16} />}>确认重置密码</Button>
        </Form>
      </> : requested ? <Result status="success" title="如果邮箱可用于找回密码，邮件已经发送" subTitle="为了保护账号隐私，无论邮箱是否存在，这里都会显示相同结果。请检查收件箱和垃圾邮件。" extra={<Button href="/">返回登录</Button>} /> : <>
        <div className="invite-hero"><span className="invite-team-icon"><MailCheck size={26} /></span><div><small>ACCOUNT RECOVERY</small><h1>找回登录密码</h1><p>输入已经验证过的邮箱，我们会发送一次性重置链接。</p></div></div>
        <Form layout="vertical" onFinish={request}>
          <Form.Item label="已验证邮箱" name="email" rules={[{ required: true, type: 'email', message: '请输入正确邮箱' }]}><Input autoComplete="email" placeholder="name@example.com" /></Form.Item>
          <Button block type="primary" htmlType="submit" loading={saving}>发送重置邮件</Button>
        </Form>
        <p className="invite-footnote">邮箱必须先在个人资料里完成验证。未配置邮件网关时，系统会明确提示通道不可用。</p>
      </>}
    </div>
  </div>;
}
