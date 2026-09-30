import { Alert, Button, Progress, Space, Tag, message } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createGiantMaterialExecutorClient, normalizeGiantMaterialExecutorStatus } from '../../../shared/api/giantMaterialExecutor.js';
import { createGiantMaterialPairing, listGiantMaterialExecutors } from '../../../shared/api/giantMaterialExecutorPublic.js';

const EXECUTOR_BASE_URL = 'http://127.0.0.1:17861';
const OFFLINE_LABEL = '执行器未安装或未启动';
const MODEL_LABEL = '正在下载 OCR 模型';
const OCR_LABEL = '正在 OCR';
const BOUND_OFFLINE_LABEL = '已绑定但当前离线';
const NEEDS_PAIRING_LABEL = '需要首次绑定或重新绑定';

function localNonce() {
  try {
    return String(window.localStorage.getItem('giant_material_executor_nonce') || '').trim();
  } catch (_) {
    return '';
  }
}

export function BatchFactoryGiantMaterialExecutorStatus({ job, onHealthChange, onInstall }) {
  const [health, setHealth] = useState(null);
  const [backendOnline, setBackendOnline] = useState(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingFallback, setPairingFallback] = useState(null);
  const nonce = localNonce();
  const client = useMemo(() => createGiantMaterialExecutorClient({ baseUrl: EXECUTOR_BASE_URL, nonce }), [nonce]);
  // 本机直连常被浏览器"公网页面 → 本机回环"安全策略拦截；后台名单不受影响。
  // 两者任一可用即认为执行器可用，任务本身通过后台队列派发，不依赖本机直连。
  const effectiveHealth = health || backendOnline;
  const status = normalizeGiantMaterialExecutorStatus(effectiveHealth);
  const modelReady = status.modelReady;
  const bindingState = String(effectiveHealth?.bindingState || '').trim();
  const requiresPairing = !effectiveHealth || status.kind === 'needs_pairing' || bindingState === 'unpaired';
  const jobState = String(job?.state || '').toLowerCase();
  const progress = Number(job?.progress?.percent || 0);
  const onHealthChangeRef = useRef(onHealthChange);
  onHealthChangeRef.current = onHealthChange;

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const next = await client.health().catch(() => null);
      if (!active) return;
      setHealth(next);
      onHealthChangeRef.current?.(next);
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [client]);

  useEffect(() => {
    let active = true;
    const pollBackend = async () => {
      const next = await listGiantMaterialExecutors().catch(() => null);
      if (!active) return;
      const list = Array.isArray(next?.executors) ? next.executors : Array.isArray(next?.data?.executors) ? next.data.executors : [];
      const online = list.find(item => item?.online === true) || null;
      setBackendOnline(online ? { online: true, version: online.version || '', bindingState: 'online', state: 'ready', modelReady: true, backendView: true } : null);
    };
    pollBackend();
    const timer = setInterval(pollBackend, 6000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const completed = jobState === 'succeeded';
  const failed = jobState === 'failed' || jobState === 'cancelled';
  const statusMessage = completed ? '已完成' : failed ? '失败原因' : !effectiveHealth ? OFFLINE_LABEL : status.kind === 'offline' || status.kind === 'needs_pairing' || status.kind === 'connecting' ? status.label : modelReady === false ? MODEL_LABEL : status.kind === 'running' ? OCR_LABEL : status.label;
  const versionLabel = effectiveHealth?.version || 'Windows 执行器';
  const description = completed
    ? '正文已返回并登记，可继续查看书籍详情。'
    : failed
      ? (job?.errorMessage || job?.errorCode || '执行器返回失败，请重试。')
      : !effectiveHealth
        ? '请安装并启动 Windows 巨量素材执行器；首次使用时完成一次绑定，之后会自动连接。'
        : status.kind === 'needs_pairing'
          ? `${NEEDS_PAIRING_LABEL}：这台电脑完成一次配对后，后续启动不需要再次配对。`
          : status.kind === 'offline'
            ? `${BOUND_OFFLINE_LABEL}；执行器会自动尝试重新连接。`
            : status.kind === 'connecting'
              ? '正在使用已保存的设备凭证连接公网，不需要重新配对。'
              : status.kind === 'downloading_model'
                ? '首次使用会自动安装 OCR 依赖并下载模型，可能需要几分钟，完成后会自动进入空闲状态。'
                : health
                  ? '执行器在本机运行，浏览器关闭后任务仍可继续。'
                  : '执行器已在线（后台确认），任务会自动派发到这台电脑。';

  async function pairExecutor() {
    if (pairingBusy) return;
    setPairingBusy(true);
    try {
      const pairing = await createGiantMaterialPairing();
      const code = String(pairing?.code || '').trim();
      if (!code) throw new Error('配对码生成失败，请稍后重试');
      try {
        const bootstrapClient = createGiantMaterialExecutorClient({ baseUrl: EXECUTOR_BASE_URL });
        const paired = await bootstrapClient.pair(code);
        const pairedNonce = String(paired?.nonce || '').trim();
        if (!pairedNonce) throw new Error('配对未返回本机 nonce');
        window.localStorage.setItem('giant_material_executor_nonce', pairedNonce);
        const next = await createGiantMaterialExecutorClient({ baseUrl: EXECUTOR_BASE_URL, nonce: pairedNonce }).health();
        setHealth(next);
        onHealthChangeRef.current?.(next);
        setPairingFallback(null);
        message.success('Windows 巨量素材执行器已配对。');
      } catch (_) {
        // 本机直连被浏览器拦截时，退回“本机配置页粘贴配对码”的方式。
        setPairingFallback(code);
        message.info('已生成配对码，请在打开的执行器配置页中粘贴完成绑定。');
      }
    } catch (error) {
      message.error(error?.message || '自动配对失败，请确认执行器已启动。');
    } finally {
      setPairingBusy(false);
    }
  }

  return <Alert
    type={failed ? 'error' : completed ? 'success' : requiresPairing || status.kind === 'offline' ? 'warning' : 'info'}
    showIcon
    message={<span>{statusMessage} <Tag>{versionLabel}</Tag></span>}
    description={<div>
      <div>{description}</div>
      {pairingFallback ? <div style={{ marginTop: 8 }}>
        <div>配对码：<strong>{pairingFallback}</strong>（10 分钟内有效）</div>
        <Space style={{ marginTop: 8 }}>
          <Button size="small" type="primary" onClick={() => window.open(`${EXECUTOR_BASE_URL}/setup`, '_blank', 'noopener')}>打开执行器配置页</Button>
          <Button size="small" onClick={() => { navigator.clipboard?.writeText(pairingFallback).catch(() => {}); message.success('配对码已复制'); }}>复制配对码</Button>
        </Space>
      </div> : null}
      {requiresPairing && !pairingFallback ? <Space style={{ marginTop: 8 }}><Button size="small" type="primary" loading={pairingBusy} onClick={pairExecutor}>首次绑定（自动配对）</Button>{onInstall ? <Button size="small" onClick={onInstall}>查看安装与配对说明</Button> : null}</Space> : null}
      {!completed && !failed && jobState && progress > 0 ? <Progress percent={progress} size="small" status={status.kind === 'running' ? 'active' : 'normal'} /> : null}
    </div>}
  />;
}
