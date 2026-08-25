import { Button, Form, Input, Modal, Progress, Skeleton, Tag, message } from 'antd';
import { KeyRound, Laptop, LockKeyhole, LogOut, ShieldCheck, Smartphone, TimerReset } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { changeOwnPassword, getSecurityOverview, revokeOtherSessions } from '../../shared/api/member';
import { formatDate, PageHeader, Panel } from './accountCenterShared';

function deviceLabel(session) {
  const parts = [session?.browser, session?.os].filter(Boolean);
  return parts.length ? parts.join(' · ') : '未知设备';
}

export default function SecurityPage() {
  const [loading, setLoading] = useState(true);
  const [security, setSecurity] = useState(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    try {
      setSecurity(await getSecurityOverview());
    } catch (error) {
      message.error(error.message || '安全信息加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function changePassword(values) {
    setSaving(true);
    try {
      await changeOwnPassword(values.currentPassword, values.newPassword);
      message.success('密码已修改，其他登录会话已退出');
      setPasswordOpen(false);
      form.resetFields();
      await load();
    } catch (error) {
      message.error(error.message || '密码修改失败');
    } finally {
      setSaving(false);
    }
  }

  async function revokeOthers() {
    setSaving(true);
    try {
      await revokeOtherSessions();
      message.success('其他登录会话已退出');
      await load();
    } catch (error) {
      message.error(error.message || '退出其他会话失败');
    } finally {
      setSaving(false);
    }
  }

  const sessionCount = useMemo(() => (security?.sessions?.length || 0) + (security?.persistentSessions?.length || 0), [security]);
  const score = security ? Math.min(95, 72 + (security.otherSessionCount === 0 ? 18 : 4)) : 0;

  if (loading) return <div className="account-center-page"><Skeleton active paragraph={{ rows: 9 }} /></div>;

  return <div className="account-center-page security-page">
    <PageHeader title="账号安全" subtitle="管理密码与登录设备，保护你的 qiantie 账号" />

    <div className="ac-security-grid">
      <Panel title="安全总览" className="ac-security-overview">
        <div className="ac-security-score">
          <Progress type="circle" percent={score} size={150} strokeWidth={6} format={value => <><strong>{value}</strong><small>安全评分</small></>} />
          <div>
            <Tag color="green">安全状态良好</Tag>
            <p>当前账号状态正常，建议定期更新密码并检查登录会话。</p>
          </div>
        </div>
        <div className="ac-check-list security-checks">
          <div><ShieldCheck size={16} className="done" /><span>账号状态</span><b>正常</b></div>
          <div><KeyRound size={16} className="done" /><span>登录密码</span><b>已设置</b></div>
          <div><Smartphone size={16} className="done" /><span>当前会话</span><b>{sessionCount || 1} 个</b></div>
          <div><LockKeyhole size={16} /><span>二步验证 / MFA</span><b>尚未接入</b></div>
        </div>
      </Panel>

      <Panel title="登录密码">
        <div className="ac-security-card-icon"><KeyRound size={22} /></div>
        <h3>定期更新登录密码</h3>
        <p className="ac-muted-copy">新密码至少 8 位。修改后系统会保留当前会话，并退出同账号的其他会话。</p>
        <Button block onClick={() => setPasswordOpen(true)}>修改密码</Button>
      </Panel>

      <Panel title="会话状态">
        <div className="ac-security-card-icon violet"><Laptop size={22} /></div>
        <h3>{security?.otherSessionCount || 0} 个其他会话</h3>
        <p className="ac-muted-copy">记录浏览器、系统与模糊网络提示，不展示精确定位。</p>
        <Button block danger disabled={!security?.otherSessionCount} loading={saving} onClick={revokeOthers}>退出其他会话</Button>
      </Panel>
    </div>

    <div className="ac-two-column security-session-grid">
      <Panel title="当前与活动设备" eyebrow="ACTIVE DEVICES">
        <div className="ac-session-list">
          {(security?.sessions || []).map(session => <div key={`runtime-${session.id}`}>
            <span className="ac-session-icon"><Laptop size={17} /></span>
            <div>
              <strong>{session.current ? `当前设备 · ${deviceLabel(session)}` : deviceLabel(session)}</strong>
              <small>{session.issuedAt ? `登录于 ${formatDate(session.issuedAt)}` : '活动登录会话'}{session.ipHint ? ` · ${session.ipHint}` : ''}</small>
            </div>
            <Tag color={session.current ? 'green' : 'blue'}>{session.current ? '当前设备' : '活动'}</Tag>
          </div>)}
          {(security?.persistentSessions || []).map(session => <div key={`persist-${session.id}`}>
            <span className="ac-session-icon"><TimerReset size={17} /></span>
            <div>
              <strong>{deviceLabel(session)}</strong>
              <small>{session.issuedAt ? `登录于 ${formatDate(session.issuedAt)} · ` : ''}有效期至 {formatDate(session.expiresAt)}{session.ipHint ? ` · ${session.ipHint}` : ''}</small>
            </div>
            <Tag>{session.current ? '当前' : '已记住'}</Tag>
          </div>)}
          {!sessionCount ? <div className="ac-empty">当前仅有本次登录会话</div> : null}
        </div>
      </Panel>

      <Panel title="会话管理" eyebrow="SESSION CONTROL">
        <div className="ac-session-control">
          <span><LogOut size={22} /></span>
          <div><h3>退出其他设备</h3><p>撤销同一账号的其他运行时 Token 与持久化登录凭据，不影响当前页面。</p></div>
        </div>
        <Button danger loading={saving} disabled={!security?.otherSessionCount} onClick={revokeOthers}>退出其他设备</Button>
        <p className="ac-security-note">网络信息只保留类似 192.168.*.* 的模糊提示，不做精确位置跟踪。</p>
      </Panel>
    </div>

    <Modal title="修改登录密码" open={passwordOpen} onCancel={() => setPasswordOpen(false)} onOk={() => form.submit()} okText="确认修改" confirmLoading={saving}>
      <Form form={form} layout="vertical" onFinish={changePassword}>
        <Form.Item label="当前密码" name="currentPassword" rules={[{ required: true, message: '请输入当前密码' }]}><Input.Password autoComplete="current-password" /></Form.Item>
        <Form.Item label="新密码" name="newPassword" rules={[{ required: true, min: 8, message: '新密码至少 8 位' }]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Form.Item label="确认新密码" name="confirmPassword" dependencies={['newPassword']} rules={[
          { required: true, message: '请再次输入新密码' },
          ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue('newPassword') === value ? Promise.resolve() : Promise.reject(new Error('两次输入的新密码不一致')); } })
        ]}><Input.Password autoComplete="new-password" /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
