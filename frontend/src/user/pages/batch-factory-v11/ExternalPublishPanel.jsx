import { Alert, Button, Input, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { nextSubmissionState, providerCapability, redactedCredentialView } from './externalState.js';

const PROVIDERS = [
  { value: '121', label: '121' },
  { value: 'yadi', label: 'Yadi' }
];

export function ExternalPublishPanel({
  open,
  batch,
  books = [],
  capabilities = {},
  onClose,
  onGetCredential,
  onSaveCredential,
  onCreateIntent,
  onConfirmIntent,
  onSubmitIntent
}) {
  const [provider, setProvider] = useState('121');
  const [credential, setCredential] = useState(null);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [state, setState] = useState({ phase: 'idle' });
  const [intent, setIntent] = useState(null);
  const [busy, setBusy] = useState(false);
  const capability = useMemo(() => providerCapability(capabilities, provider), [capabilities, provider]);

  useEffect(() => {
    if (!open) return;
    setState({ phase: 'idle' });
    setIntent(null);
    setSecret('');
    let cancelled = false;
    if (onGetCredential) onGetCredential(provider).then(result => {
      if (!cancelled && result?.ok) setCredential(redactedCredentialView(result.raw));
    });
    return () => { cancelled = true; };
  }, [open, provider]);

  async function saveCredential() {
    if (!onSaveCredential || !name.trim() || !secret) return;
    setBusy(true);
    try {
      const result = await onSaveCredential(provider, { name: name.trim(), secret });
      if (!result.ok) { message.error(result.message); return; }
      setCredential(redactedCredentialView(result.raw));
      setSecret('');
      message.success('发布账号已加密保存；页面不会回显密钥');
    } finally { setBusy(false); }
  }

  async function createIntent() {
    if (!capability.available || !onCreateIntent || !batch?.id) return;
    setBusy(true);
    try {
      const result = await onCreateIntent(provider, {
        batchId: batch.id,
        bookId: books.length === 1 ? books[0].id : '',
        payload: { batchId: batch.id, bookCount: books.length, publishSettings: batch.settingsState?.patch?.publishSettings || {} }
      });
      if (!result.ok) { message.error(result.message); return; }
      setIntent(result.raw?.intent || result.raw);
      setState(nextSubmissionState(state, 'create-intent'));
    } finally { setBusy(false); }
  }

  async function confirmAndSubmit() {
    if (!intent?.id || !onConfirmIntent || !onSubmitIntent) return;
    setBusy(true);
    try {
      const confirmed = await onConfirmIntent(provider, intent.id);
      if (!confirmed.ok) { setState(nextSubmissionState(state, 'failure')); message.error(confirmed.message); return; }
      setState(nextSubmissionState(state, 'confirm'));
      const submitted = await onSubmitIntent(provider, intent.id);
      if (!submitted.ok) { setState(nextSubmissionState(state, 'failure')); message.error(submitted.message); return; }
      setState(nextSubmissionState({ phase: 'submitting' }, 'success'));
      message.success(`${provider} 发布已提交，返回引用：${submitted.raw?.reference?.reference || submitted.raw?.reference || '已记录'}`);
    } finally { setBusy(false); }
  }

  return <Modal title="上传待上传 / 外部发布" open={open} onCancel={onClose} footer={null} destroyOnClose>
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="info" showIcon message="外部发布必须先生成确认单，再由你明确确认后提交。" description="账号密钥只在保存请求期间存在于页面内；接口返回只含账号名称和脱敏审计。" />
      <Select value={provider} options={PROVIDERS} onChange={setProvider} style={{ width: '100%' }} />
      {!capability.available ? <Alert type="warning" showIcon message={`${provider} 发布当前不可用`} description={capability.reason} /> : null}
      <Space wrap>
        <Tag color={credential?.configured ? 'green' : 'default'}>{credential?.configured ? `已配置：${credential.name}` : '尚未配置账号'}</Tag>
        {credential?.configured ? <Typography.Text type="secondary">密钥不会显示</Typography.Text> : null}
      </Space>
      <Input placeholder="账号名称" value={name} onChange={event => setName(event.target.value)} disabled={!capability.available} />
      <Input.Password placeholder="账号密钥 / Token" value={secret} onChange={event => setSecret(event.target.value)} disabled={!capability.available} />
      <Button onClick={saveCredential} loading={busy} disabled={!capability.available || !name.trim() || !secret}>保存账号（加密）</Button>
      {state.phase === 'idle' ? <Button type="primary" onClick={createIntent} loading={busy} disabled={!capability.available || !credential?.configured}>生成发布确认单</Button> : null}
      {intent ? <Alert type={state.phase === 'succeeded' ? 'success' : state.phase === 'failed' ? 'error' : 'warning'} showIcon message={`确认单 ${intent.id}`} description={<Space direction="vertical"><Typography.Text>目标：{provider} · 批次：{batch?.title || batch?.id}</Typography.Text><Typography.Text>内容摘要：{intent.payloadDigest || '已锁定'}</Typography.Text>{state.phase === 'confirm' ? <Button type="primary" onClick={confirmAndSubmit} loading={busy}>我确认提交外部发布</Button> : null}{state.phase === 'succeeded' ? <Typography.Text type="success">已提交；可在审计记录中追踪结果。</Typography.Text> : null}</Space>} /> : null}
    </Space>
  </Modal>;
}

export default ExternalPublishPanel;
