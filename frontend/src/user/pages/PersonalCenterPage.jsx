import {
  Alert,
  Avatar,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Segmented,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  message
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { getCurrentAccount, getCurrentUsername } from '../../shared/api/auth';
import {
  getBatchFactoryPromptLibrary,
  resetBatchFactoryPersonalPrompt,
  saveBatchFactoryPersonalPrompt
} from '../../shared/api/promptLibrary';
import {
  deleteVideoModelCredentials,
  getVideoModelCredentials,
  saveVideoModelCredentials
} from '../../shared/api/shuihuoProduction';

const styles = {
  page: { width: '100%', minWidth: 0 },
  heading: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16
  },
  profile: { display: 'flex', alignItems: 'center', gap: 14 },
  full: { width: '100%' },
  promptGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))',
    gap: 12,
    width: '100%'
  },
  promptCard: { minWidth: 0 },
  promptMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 10
  }
};

function PromptCard({ prompt, onChanged }) {
  const [body, setBody] = useState(prompt.body || '');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => setBody(prompt.body || ''), [prompt.id, prompt.body]);

  async function save() {
    if (!body.trim()) return message.warning('提示词正文不能为空');
    setSaving(true);
    try {
      const result = await saveBatchFactoryPersonalPrompt(prompt.id, body);
      message.success(`${prompt.name} 已保存为我的版本`);
      await onChanged(result.prompt);
    } catch (error) {
      message.error(error.message || '保存提示词失败');
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setResetting(true);
    try {
      const result = await resetBatchFactoryPersonalPrompt(prompt.id);
      setBody(result.prompt.body || '');
      message.success(`${prompt.name} 已恢复系统版本`);
      await onChanged(result.prompt);
    } catch (error) {
      message.error(error.message || '恢复系统版本失败');
    } finally {
      setResetting(false);
    }
  }

  const changed = body !== (prompt.body || '');

  return <Card
    size="small"
    style={styles.promptCard}
    title={prompt.name}
    extra={prompt.customized ? <Tag color="purple">我的版本 v{prompt.personalVersion}</Tag> : <Tag>系统版本</Tag>}
  >
    <div style={styles.promptMeta}>
      <Space wrap>
        <Tag color={prompt.category === 'script' ? 'blue' : 'cyan'}>{prompt.category === 'script' ? '剧本提示词' : '人物场景提示词'}</Tag>
        <Typography.Text type="secondary">系统 v{prompt.systemVersion}</Typography.Text>
      </Space>
      {prompt.updatedAt ? <Typography.Text type="secondary">最近修改 {new Date(prompt.updatedAt).toLocaleString()}</Typography.Text> : null}
    </div>
    <Input.TextArea
      value={body}
      onChange={event => setBody(event.target.value)}
      autoSize={{ minRows: 14, maxRows: 28 }}
      style={{ width: '100%', lineHeight: 1.65 }}
    />
    <Space wrap style={{ marginTop: 10 }}>
      <Button type="primary" loading={saving} disabled={!changed} onClick={save}>保存为我的版本</Button>
      <Button loading={resetting} disabled={!prompt.customized} onClick={reset}>恢复系统版本</Button>
      {changed ? <Tag color="gold">有未保存修改</Tag> : null}
    </Space>
  </Card>;
}

function BatchFactoryPromptLibrary() {
  const [library, setLibrary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('script');

  async function load() {
    setLoading(true);
    try {
      setLibrary(await getBatchFactoryPromptLibrary());
    } catch (error) {
      message.error(error.message || '读取提示词库失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const prompts = useMemo(() => (
    category === 'script' ? (library?.scriptPrompts || []) : (library?.assetPrompts || [])
  ), [library, category]);

  async function replacePrompt(updated) {
    setLibrary(current => {
      if (!current) return current;
      const key = updated.category === 'script' ? 'scriptPrompts' : 'assetPrompts';
      return {
        ...current,
        [key]: (current[key] || []).map(item => item.id === updated.id ? updated : item)
      };
    });
  }

  if (loading) return <div style={{ padding: 32, textAlign: 'center' }}><Spin /></div>;
  if (!library) return <Empty description="提示词库暂不可用" />;

  return <Space direction="vertical" size={14} style={styles.full}>
    <Alert
      showIcon
      type="info"
      message="批量工厂提示词"
      description="这里是你自己的批量工厂提示词库。默认跟随管理员发布的系统版本；保存修改后只影响当前账号。批量工厂导演优先使用你的版本，没有个人版本时自动回退系统版本。"
    />
    <Segmented
      value={category}
      onChange={setCategory}
      options={[
        { value: 'script', label: `剧本提示词 ${library.scriptPrompts?.length || 0}` },
        { value: 'asset', label: `人物场景提示词 ${library.assetPrompts?.length || 0}` }
      ]}
    />
    <div style={styles.promptGrid}>
      {prompts.map(prompt => <PromptCard key={prompt.id} prompt={prompt} onChanged={replacePrompt} />)}
    </div>
  </Space>;
}

function VideoModelCredentials() {
  const [settings, setSettings] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setSettings(await getVideoModelCredentials());
    } catch (error) {
      message.error(error.message || '读取视频模型配置失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    const value = apiKey.trim();
    if (!value) return message.warning('请输入 Yadi API Key');
    setSaving(true);
    try {
      await saveVideoModelCredentials(value);
      setApiKey('');
      await load();
      message.success('Yadi API Key 已保存；剧本生成和批量工厂会共用这份配置');
    } catch (error) {
      message.error(error.message || '保存 Yadi API Key 失败');
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setDeleting(true);
    try {
      await deleteVideoModelCredentials();
      setApiKey('');
      await load();
      message.success('Yadi API Key 已清除');
    } catch (error) {
      message.error(error.message || '清除 Yadi API Key 失败');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <div style={{ padding: 32, textAlign: 'center' }}><Spin /></div>;

  return <Space direction="vertical" size={14} style={styles.full}>
    <Alert
      showIcon
      type="info"
      message="视频生成模型只配置一次"
      description="这里保存的是当前账号自己的 Yadi OpenAPI Key。剧本生成的分镜卡和批量工厂 VIDEO 都读取同一份密钥；服务端不会把已保存的 Key 返回给浏览器。"
    />
    <Card
      title="Yadi 视频生成"
      extra={settings?.configured ? <Tag color="green">已配置</Tag> : <Tag color="orange">未配置</Tag>}
    >
      <Space direction="vertical" size={12} style={styles.full}>
        <div>
          <Typography.Text strong>可用模型</Typography.Text>
          <div style={{ marginTop: 8 }}>
            <Space wrap>
              {(settings?.models || []).length
                ? settings.models.map(model => <Tag color="blue" key={model.modelId || model.id}>{model.name} · 最大 {model.maxVideoDuration || '—'}s</Tag>)
                : <Typography.Text type="secondary">部署后会自动注册 YD2.0 Fast（Yadi 文生视频）</Typography.Text>}
            </Space>
          </div>
        </div>
        <div>
          <Typography.Text strong>API Key</Typography.Text>
          <Input.Password
            style={{ marginTop: 8 }}
            value={apiKey}
            onChange={event => setApiKey(event.target.value)}
            placeholder={settings?.configured ? '已保存；留空不会修改，输入新 Key 可替换' : 'sk-yadi-xxxxxxxx'}
            autoComplete="new-password"
          />
          <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
            只接受 Yadi「令牌管理」中创建的 sk-yadi- API Key；Cookie、主站登录态和控制台 token 不能用于视频任务。
          </Typography.Paragraph>
        </div>
        <Space wrap>
          <Button type="primary" loading={saving} disabled={!apiKey.trim()} onClick={save}>保存视频模型密钥</Button>
          {settings?.configured ? <Popconfirm title="确认清除当前账号的 Yadi API Key？" onConfirm={clear} okText="清除" cancelText="取消">
            <Button danger loading={deleting}>清除密钥</Button>
          </Popconfirm> : null}
        </Space>
      </Space>
    </Card>
  </Space>;
}

export default function PersonalCenterPage() {
  const [account, setAccount] = useState(null);
  const username = getCurrentUsername();

  useEffect(() => {
    getCurrentAccount().then(setAccount).catch(() => setAccount(null));
  }, []);

  const role = account?.isOwner ? '开发' : (account?.role === 'manager' ? '管理' : '组员');

  return <div style={styles.page}>
    <div style={styles.heading}>
      <div style={styles.profile}>
        <Avatar size={52}>{String(account?.displayName || username || 'U').slice(0, 1).toUpperCase()}</Avatar>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>个人中心</Typography.Title>
          <Space wrap style={{ marginTop: 6 }}>
            <Typography.Text type="secondary">{account?.displayName || username || '当前账号'}</Typography.Text>
            <Tag color={account?.isOwner ? 'gold' : account?.role === 'manager' ? 'blue' : 'green'}>{role}</Tag>
          </Space>
        </div>
      </div>
    </div>

    <Tabs
      defaultActiveKey="video-models"
      items={[
        {
          key: 'overview',
          label: '账号概览',
          children: <Card><Space direction="vertical"><Typography.Text strong>{account?.displayName || username}</Typography.Text><Typography.Text type="secondary">账号：{username}</Typography.Text><Typography.Text type="secondary">身份：{role}</Typography.Text></Space></Card>
        },
        {
          key: 'video-models',
          label: '视频生成模型',
          children: <VideoModelCredentials />
        },
        {
          key: 'prompt-library',
          label: '提示词库',
          children: <Tabs
            defaultActiveKey="batch-factory"
            items={[
              {
                key: 'batch-factory',
                label: '批量工厂',
                children: <BatchFactoryPromptLibrary />
              }
            ]}
          />
        }
      ]}
    />
  </div>;
}
