import { Avatar, Button, Form, Input, Progress, Skeleton, Tag, message } from 'antd';
import { Camera, CheckCircle2, Mail, MailCheck, Phone, Save, Sparkles, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getMemberCenter, updateMemberProfile, uploadMemberAvatar } from '../../shared/api/member';
import { getEmailVerificationStatus, requestEmailVerification } from '../../shared/api/accountRecovery';
import { PageHeader, Panel, RoleBadge, avatarFallback, formatDate } from './accountCenterShared';

export default function ProfilePage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mailing, setMailing] = useState(false);
  const [center, setCenter] = useState(null);
  const [emailStatus, setEmailStatus] = useState(null);
  const fileRef = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const [result, status] = await Promise.all([
        getMemberCenter(),
        getEmailVerificationStatus().catch(() => null)
      ]);
      setCenter(result);
      setEmailStatus(status);
      form.setFieldsValue({
        displayName: result.member?.displayName,
        bio: result.member?.bio || '',
        phone: result.member?.phone || '',
        email: result.member?.email || '',
        teamTitle: result.member?.teamTitle || ''
      });
    } catch (error) {
      message.error(error.message || '个人资料加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function save(values) {
    setSaving(true);
    try {
      const previousEmail = center?.member?.email || '';
      const result = await updateMemberProfile(values);
      setCenter(current => ({ ...current, member: result.member }));
      window.dispatchEvent(new CustomEvent('qiantie:profile-updated'));
      if ((result.member?.email || '') !== previousEmail) {
        setEmailStatus(await getEmailVerificationStatus().catch(() => null));
        message.success('个人资料已保存；邮箱发生变化，需要重新验证');
      } else {
        message.success('个人资料已保存');
      }
    } catch (error) {
      message.error(error.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function sendVerification() {
    setMailing(true);
    try {
      const result = await requestEmailVerification();
      message.success(`验证邮件已发送到 ${result.email}`);
    } catch (error) {
      message.error(error.message || '验证邮件发送失败');
    } finally { setMailing(false); }
  }

  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return message.error('请选择 PNG、JPG 或 WebP 图片');
    if (file.size > 2 * 1024 * 1024) return message.error('头像不能超过 2MB');
    const reader = new FileReader();
    reader.onload = async () => {
      setSaving(true);
      try {
        const result = await uploadMemberAvatar(reader.result);
        setCenter(current => ({ ...current, member: result.member }));
        window.dispatchEvent(new CustomEvent('qiantie:profile-updated'));
        message.success('头像已更新');
      } catch (error) {
        message.error(error.message || '头像上传失败');
      } finally {
        setSaving(false);
      }
    };
    reader.readAsDataURL(file);
  }

  const member = center?.member;
  const completion = useMemo(() => {
    if (!member) return 0;
    const fields = [member.avatarUrl, member.displayName, member.bio, member.phone, member.email, member.teamTitle];
    return Math.round((fields.filter(Boolean).length / fields.length) * 100);
  }, [member]);

  if (loading) return <div className="account-center-page"><Skeleton active paragraph={{ rows: 9 }} /></div>;
  if (!member) return <div className="account-center-page"><div className="ac-empty">无法读取资料</div></div>;

  return <div className="account-center-page profile-page">
    <PageHeader title="个人资料" subtitle="管理你的个人信息、验证邮箱与团队名片" />

    <section className={`ac-profile-hero role-${member.role}`}>
      <button className="ac-profile-avatar-button" type="button" onClick={() => fileRef.current?.click()} disabled={saving}>
        <Avatar size={118} src={member.avatarUrl}>{avatarFallback(member)}</Avatar>
        <span><Camera size={16} /> 更换头像</span>
      </button>
      <input ref={fileRef} className="member-hidden-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} />
      <div className="ac-profile-hero-copy">
        <div><h2>{member.displayName}</h2><RoleBadge role={member.role} /></div>
        <p>@{member.username}</p>
        <div className="ac-profile-facts">
          <span><UsersRound size={15} /> {center?.team?.name || 'qiantie'}</span>
          <span><Sparkles size={15} /> {member.role === 'dev' ? '开发 · 最高权限' : member.role === 'manager' ? '团队管理' : '团队成员'}</span>
          <span>加入 {formatDate(member.createdAt).slice(0, 10)}</span>
        </div>
      </div>
    </section>

    <div className="ac-two-column profile-grid">
      <Panel title="基本资料" className="ac-form-panel">
        <Form form={form} layout="vertical" onFinish={save}>
          <div className="ac-form-row two">
            <Form.Item label="显示名称" name="displayName" rules={[{ required: true, whitespace: true, max: 40, message: '请输入 1-40 个字符的显示名称' }]}><Input maxLength={40} /></Form.Item>
            <Form.Item label="账号 ID"><Input value={member.username} disabled /></Form.Item>
          </div>
          <div className="ac-form-row two">
            <Form.Item label="手机号" name="phone"><Input prefix={<Phone size={15} />} placeholder="可选" maxLength={32} /></Form.Item>
            <Form.Item label="邮箱" name="email"><Input prefix={<Mail size={15} />} placeholder="可选" maxLength={120} /></Form.Item>
          </div>
          <Form.Item label="团队职务" name="teamTitle"><Input placeholder="例如：核心开发者、内容负责人" maxLength={60} /></Form.Item>
          <Form.Item label="个人简介" name="bio"><Input.TextArea rows={4} maxLength={240} showCount placeholder="向团队成员介绍一下自己" /></Form.Item>
          <div className="ac-form-actions"><Button type="primary" htmlType="submit" icon={<Save size={16} />} loading={saving}>保存修改</Button></div>
        </Form>
      </Panel>

      <div className="ac-side-stack">
        <Panel title="邮箱验证" eyebrow="ACCOUNT RECOVERY">
          <div className="ac-api-status-line">
            <span className="ac-security-card-icon"><MailCheck size={20} /></span>
            <div><strong>{member.email || '尚未填写邮箱'}</strong><small>只有验证后的邮箱可以用于找回密码</small></div>
            <Tag color={emailStatus?.verified ? 'green' : 'gold'}>{emailStatus?.verified ? '已验证' : '未验证'}</Tag>
          </div>
          {member.email ? <Button block type={emailStatus?.verified ? 'default' : 'primary'} disabled={emailStatus?.verified || !emailStatus?.deliveryConfigured} loading={mailing} onClick={sendVerification}>
            {emailStatus?.verified ? '邮箱已验证' : emailStatus?.deliveryConfigured ? '发送验证邮件' : '邮件通道未配置'}
          </Button> : <p className="ac-muted-copy">先在左侧填写邮箱并保存，再发送验证邮件。</p>}
          {emailStatus?.verifiedAt ? <p className="ac-security-note">验证时间：{formatDate(emailStatus.verifiedAt)}</p> : null}
        </Panel>

        <Panel title="资料完整度">
          <div className="ac-completion-ring"><Progress type="circle" percent={completion} size={138} strokeWidth={7} /></div>
          <p className="ac-center-note">完善资料后，团队成员更容易识别你的身份与职责。</p>
          <div className="ac-check-list">
            {[
              ['设置头像', Boolean(member.avatarUrl)],
              ['设置显示名称', Boolean(member.displayName)],
              ['填写个人简介', Boolean(member.bio)],
              ['填写联系方式', Boolean(member.phone || member.email)],
              ['验证找回邮箱', Boolean(emailStatus?.verified)],
              ['设置团队职务', Boolean(member.teamTitle)]
            ].map(([label, done]) => <div key={label}><CheckCircle2 size={15} className={done ? 'done' : ''} /><span>{label}</span><b>{done ? '已完成' : '待完善'}</b></div>)}
          </div>
        </Panel>

        <Panel title="资料预览" eyebrow="TEAM CARD">
          <div className="ac-profile-preview">
            <Avatar size={58} src={member.avatarUrl}>{avatarFallback(member)}</Avatar>
            <div><div><strong>{member.displayName}</strong><RoleBadge role={member.role} compact /></div><small>@{member.username}</small><p>{member.teamTitle || '暂未设置团队职务'}</p></div>
          </div>
        </Panel>
      </div>
    </div>
  </div>;
}
