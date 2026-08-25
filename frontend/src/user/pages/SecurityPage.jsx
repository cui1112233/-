import { Button, Form, Input, Modal, Progress, Skeleton, Tag, message } from 'antd';
import { Copy, Fingerprint, KeyRound, Laptop, LockKeyhole, LogOut, RotateCcwKey, ShieldCheck, Smartphone, TimerReset, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  beginMfaSetup,
  changeOwnPassword,
  disableMfa,
  enableMfa,
  getSecurityOverview,
  revokeOtherSessions,
  rotateMfaRecoveryCodes
} from '../../shared/api/member';
import { listPasskeys, registerPasskey, removePasskey } from '../../shared/api/accountRecovery';
import { passkeySupported } from '../../shared/webauthn';
import { formatDate, PageHeader, Panel } from './accountCenterShared';

function deviceLabel(session) {
  const parts = [session?.browser, session?.os].filter(Boolean);
  return parts.length ? parts.join(' · ') : '未知设备';
}

export default function SecurityPage() {
  const [loading, setLoading] = useState(true);
  const [security, setSecurity] = useState(null);
  const [passkeys, setPasskeys] = useState([]);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [mfaSetup, setMfaSetup] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [mfaForm] = Form.useForm();

  async function load() {
    setLoading(true);
    try {
      const [nextSecurity, passkeyResult] = await Promise.all([getSecurityOverview(), listPasskeys().catch(() => ({ passkeys: [] }))]);
      setSecurity(nextSecurity);
      setPasskeys(passkeyResult.passkeys || []);
    } catch (error) { message.error(error.message || '安全信息加载失败'); }
    finally { setLoading(false); }
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
    } catch (error) { message.error(error.message || '密码修改失败'); }
    finally { setSaving(false); }
  }

  async function revokeOthers() {
    setSaving(true);
    try {
      await revokeOtherSessions();
      message.success('其他登录会话已退出');
      await load();
    } catch (error) { message.error(error.message || '退出其他会话失败'); }
    finally { setSaving(false); }
  }

  async function addPasskey() {
    setSaving(true);
    try {
      await registerPasskey(`Passkey ${passkeys.length + 1}`);
      message.success('Passkey 已绑定，现在登录页可以直接使用');
      await load();
    } catch (error) { message.error(error.message || 'Passkey 添加失败'); }
    finally { setSaving(false); }
  }

  async function deletePasskey(id) {
    setSaving(true);
    try {
      await removePasskey(id);
      message.success('Passkey 已移除');
      await load();
    } catch (error) { message.error(error.message || 'Passkey 删除失败'); }
    finally { setSaving(false); }
  }

  async function startMfa() {
    const currentPassword = mfaForm.getFieldValue('currentPassword');
    if (!currentPassword) return message.warning('先输入当前密码');
    setSaving(true);
    try {
      const setup = await beginMfaSetup(currentPassword);
      setMfaSetup(setup);
      message.success('MFA 密钥已生成，请添加到验证器');
    } catch (error) { message.error(error.message || 'MFA 设置失败'); }
    finally { setSaving(false); }
  }

  async function confirmMfa() {
    const code = mfaForm.getFieldValue('code');
    if (!code) return message.warning('请输入验证器中的 6 位动态码');
    setSaving(true);
    try {
      const result = await enableMfa(code);
      setRecoveryCodes(result.recoveryCodes || []);
      setMfaOpen(false);
      setMfaSetup(null);
      mfaForm.resetFields();
      message.success('MFA 已启用');
      await load();
    } catch (error) { message.error(error.message || '动态码验证失败'); }
    finally { setSaving(false); }
  }

  async function disableMfaNow() {
    const values = await mfaForm.validateFields(['currentPassword', 'code']).catch(() => null);
    if (!values) return;
    setSaving(true);
    try {
      await disableMfa(values.currentPassword, values.code);
      setMfaOpen(false);
      mfaForm.resetFields();
      message.success('MFA 已关闭');
      await load();
    } catch (error) { message.error(error.message || '关闭 MFA 失败'); }
    finally { setSaving(false); }
  }

  async function rotateRecovery() {
    const values = await mfaForm.validateFields(['currentPassword', 'code']).catch(() => null);
    if (!values) return;
    setSaving(true);
    try {
      const result = await rotateMfaRecoveryCodes(values.currentPassword, values.code);
      setRecoveryCodes(result.recoveryCodes || []);
      setMfaOpen(false);
      mfaForm.resetFields();
      message.success('恢复码已重新生成，旧恢复码全部失效');
      await load();
    } catch (error) { message.error(error.message || '恢复码刷新失败'); }
    finally { setSaving(false); }
  }

  const sessionCount = useMemo(() => (security?.sessions?.length || 0) + (security?.persistentSessions?.length || 0), [security]);
  const mfaEnabled = Boolean(security?.mfa?.enabled);
  const hasPasskey = passkeys.length > 0;
  const score = security ? Math.min(100, 66 + (security.otherSessionCount === 0 ? 10 : 4) + (mfaEnabled ? 14 : 0) + (hasPasskey ? 10 : 0)) : 0;

  if (loading) return <div className="account-center-page"><Skeleton active paragraph={{ rows: 9 }} /></div>;

  return <div className="account-center-page security-page">
    <PageHeader title="账号安全" subtitle="密码、MFA、Passkey 与登录设备安全" />

    <div className="ac-security-grid">
      <Panel title="安全总览" className="ac-security-overview">
        <div className="ac-security-score">
          <Progress type="circle" percent={score} size={150} strokeWidth={6} format={value => <><strong>{value}</strong><small>安全评分</small></>} />
          <div><Tag color={mfaEnabled || hasPasskey ? 'green' : 'gold'}>{mfaEnabled || hasPasskey ? '强认证已配置' : '建议开启强认证'}</Tag><p>Passkey 使用设备安全密钥验签；MFA 恢复码每个只能使用一次。</p></div>
        </div>
        <div className="ac-check-list security-checks">
          <div><ShieldCheck size={16} className="done" /><span>账号状态</span><b>正常</b></div>
          <div><KeyRound size={16} className="done" /><span>登录密码</span><b>已设置</b></div>
          <div><Fingerprint size={16} className={hasPasskey ? 'done' : ''} /><span>Passkey</span><b>{hasPasskey ? `${passkeys.length} 个` : '未绑定'}</b></div>
          <div><LockKeyhole size={16} className={mfaEnabled ? 'done' : ''} /><span>二步验证 / MFA</span><b>{mfaEnabled ? '已启用' : '未启用'}</b></div>
        </div>
      </Panel>

      <Panel title="登录密码">
        <div className="ac-security-card-icon"><KeyRound size={22} /></div><h3>定期更新登录密码</h3>
        <p className="ac-muted-copy">修改后保留当前会话，并退出同账号的其他会话。</p>
        <Button block onClick={() => setPasswordOpen(true)}>修改密码</Button>
      </Panel>

      <Panel title="二步验证 / MFA">
        <div className="ac-security-card-icon violet"><LockKeyhole size={22} /></div>
        <h3>{mfaEnabled ? '动态验证码已启用' : '增加第二层登录保护'}</h3>
        <p className="ac-muted-copy">兼容常见 TOTP 验证器。当前剩余 {security?.mfa?.recoveryCodesRemaining || 0} 个恢复码。</p>
        <Button block type={mfaEnabled ? 'default' : 'primary'} onClick={() => { setMfaSetup(null); mfaForm.resetFields(); setMfaOpen(true); }}>{mfaEnabled ? '管理 MFA' : '开启 MFA'}</Button>
      </Panel>
    </div>

    <div className="ac-two-column security-session-grid">
      <Panel title="Passkey / 安全密钥" eyebrow="PASSWORDLESS">
        <div className="ac-session-control"><span><Fingerprint size={22} /></span><div><h3>使用设备解锁登录</h3><p>Passkey 可使用 Windows Hello、Touch ID、Face ID 或硬件安全密钥，不需要把私钥发送给服务器。</p></div></div>
        <Button type="primary" icon={<Fingerprint size={16} />} disabled={!passkeySupported()} loading={saving} onClick={addPasskey}>添加当前设备 Passkey</Button>
        {!passkeySupported() ? <p className="ac-security-note">Passkey 需要 HTTPS 或本机安全环境，以及支持 WebAuthn 的现代浏览器。</p> : null}
        <div className="ac-session-list ac-passkey-list">
          {passkeys.map(item => <div key={item.id}>
            <span className="ac-session-icon"><Fingerprint size={17} /></span>
            <div><strong>{item.name}</strong><small>创建于 {formatDate(item.createdAt)}{item.lastUsedAt ? ` · 最近使用 ${formatDate(item.lastUsedAt)}` : ''}</small></div>
            <Button type="text" danger icon={<Trash2 size={15} />} disabled={saving} onClick={() => deletePasskey(item.id)} />
          </div>)}
          {!passkeys.length ? <div className="ac-empty">尚未绑定 Passkey</div> : null}
        </div>
      </Panel>

      <Panel title="当前与活动设备" eyebrow="ACTIVE DEVICES">
        <div className="ac-session-list">
          {(security?.sessions || []).map(session => <div key={`runtime-${session.id}`}><span className="ac-session-icon"><Laptop size={17} /></span><div><strong>{session.current ? `当前设备 · ${deviceLabel(session)}` : deviceLabel(session)}</strong><small>{session.issuedAt ? `登录于 ${formatDate(session.issuedAt)}` : '活动登录会话'}{session.ipHint ? ` · ${session.ipHint}` : ''}</small></div><Tag color={session.current ? 'green' : 'blue'}>{session.current ? '当前设备' : '活动'}</Tag></div>)}
          {(security?.persistentSessions || []).map(session => <div key={`persist-${session.id}`}><span className="ac-session-icon"><TimerReset size={17} /></span><div><strong>{deviceLabel(session)}</strong><small>{session.issuedAt ? `登录于 ${formatDate(session.issuedAt)} · ` : ''}有效期至 {formatDate(session.expiresAt)}{session.ipHint ? ` · ${session.ipHint}` : ''}</small></div><Tag>{session.current ? '当前' : '已记住'}</Tag></div>)}
          {!sessionCount ? <div className="ac-empty">当前仅有本次登录会话</div> : null}
        </div>
      </Panel>
    </div>

    <Panel title="会话管理" eyebrow="SESSION CONTROL">
      <div className="ac-session-control"><span><LogOut size={22} /></span><div><h3>退出其他设备</h3><p>撤销其他运行时 Token 与持久化登录凭据，不影响当前页面。</p></div></div>
      <Button danger loading={saving} disabled={!security?.otherSessionCount} onClick={revokeOthers}>退出其他设备</Button>
      <p className="ac-security-note">网络信息只保留类似 192.168.*.* 的模糊提示，不做精确位置跟踪。</p>
    </Panel>

    <Modal title="修改登录密码" open={passwordOpen} onCancel={() => setPasswordOpen(false)} onOk={() => form.submit()} okText="确认修改" confirmLoading={saving}>
      <Form form={form} layout="vertical" onFinish={changePassword}>
        <Form.Item label="当前密码" name="currentPassword" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
        <Form.Item label="新密码" name="newPassword" rules={[{ required: true, min: 8, message: '新密码至少 8 位' }]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Form.Item label="确认新密码" name="confirmPassword" dependencies={['newPassword']} rules={[{ required: true }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue('newPassword') === value ? Promise.resolve() : Promise.reject(new Error('两次输入的新密码不一致')); } })]}><Input.Password autoComplete="new-password" /></Form.Item>
      </Form>
    </Modal>

    <Modal title={mfaEnabled ? '管理 MFA' : '开启 MFA'} open={mfaOpen} onCancel={() => { setMfaOpen(false); setMfaSetup(null); }} footer={null}>
      <Form form={mfaForm} layout="vertical">
        <Form.Item label="当前密码" name="currentPassword" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
        {!mfaEnabled ? <>
          {!mfaSetup ? <Button block type="primary" loading={saving} onClick={startMfa}>生成验证器密钥</Button> : <>
            <p className="ac-muted-copy">在验证器中添加以下密钥，或复制 otpauth URI 到支持导入的验证器。</p>
            <div className="ac-mfa-secret">{mfaSetup.secret}</div>
            <Button type="text" icon={<Copy size={15} />} onClick={() => navigator.clipboard?.writeText(mfaSetup.otpauthUri).then(() => message.success('otpauth URI 已复制'))}>复制 otpauth URI</Button>
            <Form.Item label="6 位动态验证码" name="code" rules={[{ required: true, pattern: /^\d{6}$/, message: '请输入 6 位动态码' }]}><Input inputMode="numeric" maxLength={6} /></Form.Item>
            <Button block type="primary" loading={saving} onClick={confirmMfa}>验证并启用 MFA</Button>
          </>}
        </> : <>
          <Form.Item label="动态码或恢复码" name="code" rules={[{ required: true }]}><Input autoComplete="one-time-code" /></Form.Item>
          <div className="ac-member-actions">
            <Button icon={<RotateCcwKey size={15} />} loading={saving} onClick={rotateRecovery}>重新生成恢复码</Button>
            <Button danger loading={saving} onClick={disableMfaNow}>关闭 MFA</Button>
          </div>
        </>}
      </Form>
    </Modal>

    <Modal title="请保存一次性恢复码" open={recoveryCodes.length > 0} onCancel={() => setRecoveryCodes([])} footer={<Button type="primary" onClick={() => setRecoveryCodes([])}>我已安全保存</Button>}>
      <p className="ac-muted-copy">每个恢复码只能使用一次。关闭窗口后不会再次显示这些明文恢复码。</p>
      <div className="ac-recovery-grid">{recoveryCodes.map(code => <div className="ac-recovery-code" key={code}>{code}</div>)}</div>
      <Button icon={<Copy size={15} />} onClick={() => navigator.clipboard?.writeText(recoveryCodes.join('\n')).then(() => message.success('恢复码已复制'))}>复制全部</Button>
    </Modal>
  </div>;
}
