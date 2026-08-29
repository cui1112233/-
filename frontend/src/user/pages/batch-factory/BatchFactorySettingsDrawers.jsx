import {
  Alert,
  Badge,
  Button,
  Divider,
  Drawer,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
  message
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import {
  getBatchFactoryPromptCatalog,
  getBatchFactoryPublishConfigVersions,
  getBatchFactoryVideoManagementAccountStatus,
  reloginBatchFactoryVideoManagementAccount,
  updateBatchFactoryPublishSettings,
  updateBatchFactorySettings
} from '../../../shared/api/batchFactory';
import { listModels } from '../../../shared/api/shuihuoProduction';
import { BatchConstraintEditor } from './BatchConstraintSettings';

const DEFAULT_SCRIPT = 'standard-short-drama';
const DEFAULT_ASSET = 'standard-asset-extraction';
const full = { width: '100%' };
const settingsRow = { display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'flex-start' };

export function UnifiedSettings({ open, batch, onClose, onSaved }) {
  const [catalog, setCatalog] = useState({ scriptPrompts: [], assetPrompts: [] });
  const [models, setModels] = useState([]);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      ...batch.settings,
      productionMode: batch.mode || 'original',
      scriptPromptPresetId: batch.settings?.scriptPromptPresetId || DEFAULT_SCRIPT,
      assetPromptPresetId: batch.settings?.assetPromptPresetId || DEFAULT_ASSET,
      injectCharacterPrompt: batch.settings?.injectCharacterPrompt !== false,
      injectScenePrompt: batch.settings?.injectScenePrompt !== false,
      injectPropPrompt: batch.settings?.injectPropPrompt !== false,
      constraintPrefixEnabled: batch.settings?.constraintPrefixEnabled !== false,
      constraintQualityEnabled: batch.settings?.constraintQualityEnabled === true,
      constraintRestrictionEnabled: batch.settings?.constraintRestrictionEnabled === true,
      constraintNegativeEnabled: batch.settings?.constraintNegativeEnabled === true
    });
    getBatchFactoryPromptCatalog().then(setCatalog).catch(() => {});
    listModels()
      .then(result => setModels((result.models || []).filter(model => model.kind === 'video' && model.requiresImageInput !== true)))
      .catch(() => {});
  }, [open, batch?.id]);

  function patch(key, value) {
    setForm(current => ({ ...current, [key]: value }));
  }

  function patchMany(next) {
    setForm(current => ({ ...current, ...next }));
  }

  function selectModel(value) {
    const model = models.find(entry => Number(entry.id) === Number(value));
    patchMany({
      videoModelId: value,
      ...(model ? {
        videoModelVersionId: model.versionId,
        videoModelName: model.name,
        maxVideoDuration: Number(model.maxVideoDuration || form.maxVideoDuration || 10)
      } : {})
    });
  }

  async function save() {
    setSaving(true);
    try {
      await updateBatchFactorySettings(batch.id, form);
      message.success('生产统一设置已保存');
      await onSaved();
      onClose();
    } catch (error) {
      message.error(error.message || '保存统一设置失败');
    } finally {
      setSaving(false);
    }
  }

  const productionLocked = batch.items.some(item => item.status !== 'pending');

  return <Drawer
    title="生产统一设置"
    width={620}
    open={open}
    onClose={onClose}
    extra={<Button type="primary" loading={saving} onClick={save}>保存统一设置</Button>}
  >
    <Space direction="vertical" size={14} style={full}>
      <Typography.Text type="secondary">应用于当前批次 · {batch.items.length} 本小说</Typography.Text>
      <Divider plain>基础生产设置</Divider>

      <div>
        <Typography.Text strong>生产方式</Typography.Text>
        <div style={{ marginTop: 8 }}>
          <Segmented
            value={form.productionMode || batch.mode || 'original'}
            disabled={productionLocked}
            onChange={value => patch('productionMode', value)}
            options={[{ value: 'original', label: '原文直转' }, { value: 'viral', label: '爆款开头' }]}
          />
        </div>
        {productionLocked ? <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6 }}>
          当前批次已经开始导演，生产方式保持本批次原始模式。
        </Typography.Text> : null}
      </div>

      <div>
        <Typography.Text strong>剧本提示词</Typography.Text>
        <Select
          style={{ ...full, marginTop: 8 }}
          value={form.scriptPromptPresetId}
          onChange={value => patch('scriptPromptPresetId', value)}
          options={(catalog.scriptPrompts || []).map(item => ({ value: item.id, label: `${item.name} · V${item.version || 1}` }))}
        />
      </div>

      <div>
        <Typography.Text strong>人物 / 场景提示词</Typography.Text>
        <Select
          style={{ ...full, marginTop: 8 }}
          value={form.assetPromptPresetId}
          onChange={value => patch('assetPromptPresetId', value)}
          options={(catalog.assetPrompts || []).map(item => ({ value: item.id, label: `${item.name} · V${item.version || 1}` }))}
        />
      </div>

      <div>
        <Typography.Text strong>视频模型</Typography.Text>
        <Select
          style={{ ...full, marginTop: 8 }}
          value={form.videoModelId}
          onChange={selectModel}
          options={models.map(model => ({ value: model.id, label: `${model.name} · 最大 ${model.maxVideoDuration || '—'}s` }))}
        />
      </div>

      <div>
        <Typography.Text strong>视频画幅</Typography.Text>
        <div style={{ marginTop: 8 }}>
          <Segmented value={form.aspectRatio || '9:16'} onChange={value => patch('aspectRatio', value)} options={['9:16', '16:9']} />
        </div>
      </div>

      <div style={settingsRow}>
        <div>
          <Typography.Text strong>固定单 VIDEO</Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 3 }}>
            开启后，不管输入多少小说内容，每本小说只输出一个 VIDEO，时长跟随当前模型单次最大时长。
          </Typography.Text>
        </div>
        <Switch checked={form.fixedSingleVideo === true} onChange={value => patch('fixedSingleVideo', value)} />
      </div>

      <Divider plain>约束设置</Divider>
      <BatchConstraintEditor value={form} onChange={patchMany} scopeLabel={`应用于当前批次 · ${batch.items.length} 本小说`} />
    </Space>
  </Drawer>;
}

function accountErrorMessage(account) {
  if (account?.state === 'login_required') return '账号登录状态已失效';
  return account?.message || '视频管理系统账号验证能力暂不可用';
}

export function PublishSettings({ open, batch, onClose, onSaved }) {
  const [versions, setVersions] = useState([]);
  const [latestByKey, setLatestByKey] = useState({});
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [account, setAccount] = useState({ loading: false, state: '', accountName: '', message: '' });
  const [reloginLoading, setReloginLoading] = useState(false);
  const accountPollRef = useRef(null);

  function stopAccountPoll() {
    if (accountPollRef.current) {
      window.clearInterval(accountPollRef.current);
      accountPollRef.current = null;
    }
  }

  async function validateAccount({ quiet = false } = {}) {
    if (!quiet) setAccount(current => ({ ...current, loading: true }));
    try {
      const result = await getBatchFactoryVideoManagementAccountStatus();
      const next = {
        loading: false,
        state: result?.state || 'unavailable',
        accountName: result?.accountName || '',
        message: result?.message || ''
      };
      setAccount(next);
      if (next.state === 'online') stopAccountPoll();
      return next;
    } catch (error) {
      const next = {
        loading: false,
        state: 'unavailable',
        accountName: '',
        message: error.message || '视频管理系统账号验证能力暂不可用'
      };
      setAccount(next);
      return next;
    }
  }

  useEffect(() => {
    if (!open) {
      stopAccountPoll();
      return;
    }
    const current = batch.publishSettings || {};
    setDraft({
      materialReuse: current.materialReuse === true,
      horizontalFlip: current.horizontalFlip === true,
      configProfileKey: current.configProfileKey || '',
      configProfileName: current.configProfileName || '',
      configProfileVersion: Number(current.configProfileVersion || 0),
      configProfileSyncedAt: current.configProfileSyncedAt || ''
    });
    getBatchFactoryPublishConfigVersions()
      .then(result => {
        setVersions(Array.isArray(result?.versions) ? result.versions : []);
        setLatestByKey(result?.latestByKey || {});
      })
      .catch(() => {
        setVersions([]);
        setLatestByKey({});
      });
    validateAccount();
    return stopAccountPoll;
  }, [open, batch?.id]);

  function applyVersion(record) {
    if (!record) return;
    setDraft(current => ({
      ...current,
      materialReuse: record.settings?.materialReuse === true,
      horizontalFlip: record.settings?.horizontalFlip === true,
      configProfileKey: record.key,
      configProfileName: record.name,
      configProfileVersion: Number(record.version || 0),
      configProfileSyncedAt: new Date().toISOString()
    }));
  }

  function selectVersion(value) {
    const [key, rawVersion] = String(value || '').split('@');
    const record = versions.find(item => item.key === key && Number(item.version) === Number(rawVersion));
    applyVersion(record);
  }

  function syncLatest() {
    const key = draft.configProfileKey || Object.keys(latestByKey)[0];
    const latest = latestByKey[key];
    if (!latest) return message.warning('批量后台暂时没有可同步的已发布配置');
    applyVersion(latest);
    message.success(`已载入 ${latest.name} · V${latest.version}，保存后应用到当前批次`);
  }

  async function relogin() {
    setReloginLoading(true);
    try {
      const result = await reloginBatchFactoryVideoManagementAccount();
      if (result?.state !== 'started' || !result?.loginUrl) throw new Error(result?.message || '暂时无法重新登录视频管理系统');
      const loginWindow = window.open(result.loginUrl, '_blank', 'noopener,noreferrer');
      message.info('请在新窗口完成视频管理系统登录，完成后会自动重新验证');
      stopAccountPoll();
      accountPollRef.current = window.setInterval(async () => {
        const next = await validateAccount({ quiet: true });
        if (next.state === 'online' || loginWindow?.closed) {
          stopAccountPoll();
          if (next.state !== 'online') validateAccount();
        }
      }, 2000);
    } catch (error) {
      message.error(error.message || '重新登录失败');
      await validateAccount();
    } finally {
      setReloginLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await updateBatchFactoryPublishSettings(batch.id, draft);
      await onSaved();
      message.success('发布统一设置已保存');
      onClose();
    } catch (error) {
      message.error(error.message || '保存发布设置失败');
    } finally {
      setSaving(false);
    }
  }

  const versionValue = draft.configProfileKey && Number(draft.configProfileVersion) > 0
    ? `${draft.configProfileKey}@${draft.configProfileVersion}`
    : undefined;
  const latest = draft.configProfileKey ? latestByKey[draft.configProfileKey] : null;
  const hasUpdate = Boolean(latest && Number(latest.version) > Number(draft.configProfileVersion || 0));

  return <Drawer
    title="发布统一设置"
    width={520}
    open={open}
    onClose={onClose}
    extra={<Button type="primary" loading={saving} onClick={save}>保存发布统一设置</Button>}
  >
    <Space direction="vertical" size={16} style={full}>
      <Typography.Text type="secondary">应用于当前批次 · {batch.items.length} 本小说</Typography.Text>

      <Divider plain>版本配置</Divider>
      <div>
        <Space align="center" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
          <Typography.Text strong>版本配置</Typography.Text>
          {hasUpdate
            ? <Tag color="gold">后台已有 V{latest.version}</Tag>
            : draft.configProfileVersion
              ? <Tag color="green">已同步批量后台配置</Tag>
              : <Tag>未选择版本</Tag>}
        </Space>
        <Select
          allowClear
          placeholder="选择批量发布配置"
          value={versionValue}
          onChange={selectVersion}
          style={full}
          options={versions.map(record => ({
            value: `${record.key}@${record.version}`,
            label: `${record.name} · V${record.version}${record.status === 'archived' ? ' · 历史' : ''}`
          }))}
        />
        <Space wrap style={{ marginTop: 8 }}>
          <Button onClick={syncLatest}>同步最新配置</Button>
          {draft.configProfileName && draft.configProfileVersion
            ? <Typography.Text type="secondary">当前：{draft.configProfileName} · V{draft.configProfileVersion}</Typography.Text>
            : null}
        </Space>
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6 }}>
          后台新版本不会自动覆盖当前批次；同步后仍需保存发布统一设置才会应用。
        </Typography.Text>
      </div>

      <Divider plain>视频管理系统</Divider>
      <div>
        {account.loading ? <Space><Spin size="small" /><Typography.Text>正在验证账号状态...</Typography.Text></Space> : null}
        {!account.loading && account.state === 'online' ? <Space direction="vertical" size={2}>
          <Badge color="blue" text={<Typography.Text strong>{account.accountName}</Typography.Text>} />
          <Typography.Text type="secondary">账号在线</Typography.Text>
        </Space> : null}
        {!account.loading && account.state && account.state !== 'online' ? <Alert
          type="error"
          showIcon
          message="登录异常"
          description={<Space direction="vertical" size={8}>
            <Typography.Text>{accountErrorMessage(account)}</Typography.Text>
            <Button size="small" loading={reloginLoading} onClick={relogin}>重新登录</Button>
          </Space>}
        /> : null}
      </div>

      <Divider plain>发布设置</Divider>
      <div>
        <Typography.Text strong>素材复用</Typography.Text>
        <Select
          style={{ ...full, marginTop: 8 }}
          value={draft.materialReuse === true}
          onChange={value => setDraft(current => ({ ...current, materialReuse: value }))}
          options={[{ value: false, label: '不复用' }, { value: true, label: '复用' }]}
        />
      </div>
      <div>
        <Typography.Text strong>水平翻转</Typography.Text>
        <Select
          style={{ ...full, marginTop: 8 }}
          value={draft.horizontalFlip === true}
          onChange={value => setDraft(current => ({ ...current, horizontalFlip: value }))}
          options={[{ value: false, label: '不翻转' }, { value: true, label: '翻转' }]}
        />
      </div>
    </Space>
  </Drawer>;
}
