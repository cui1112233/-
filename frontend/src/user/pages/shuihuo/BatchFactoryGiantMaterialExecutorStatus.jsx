import { Alert, Button, Progress, Space, Tag, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { createGiantMaterialExecutorClient, normalizeGiantMaterialExecutorStatus } from '../../../shared/api/giantMaterialExecutor.js';
import { createGiantMaterialPairing } from '../../../shared/api/giantMaterialExecutorPublic.js';

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
  const [pairingBusy, setPairingBusy] = useState(false);
  const nonce = localNonce();
  const client = useMemo(() => createGiantMaterialExecutorClient({ baseUrl: EXECUTOR_BASE_URL, nonce }), [nonce]);
  const status = normalizeGiantMaterialExecutorStatus(health);
  const modelReady = status.modelReady;
  const bindingState = String(health?.bindingState || '').trim();
  const requiresPairing = !health || status.kind === 'needs_pairing' || bindingState === 'unpaired';
  const jobState = String(job?.state || '').toLowerCase();
  const progress = Number(job?.progress?.percent || 0);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const next = await client.health().catch(() => null);
      if (!active) return;
      setHealth(next);
      onHealthChange?.(next);
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [client, onHealthChange]);

  const completed = jobState === 'succeeded';
  const failed = jobState === 'failed' || jobState === 'cancelled';
  const statusMessage = completed ? '已完成' : failed ? '失败原因' : !health ? OFFLINE_LABEL : status.kind === 'offline' || status.kind === 'needs_pairing' || status.kind === 'connecting' ? status.label : modelReady === false ? MODEL_LABEL : status.kind === 'running' ? OCR_LABEL : status.label;
  const description = completed
    ? '正文已返回并登记，可继续查看书籍详情。'
    : failed
      ? (job?.errorMessage || job?.errorCode || '执行器返回失败，请重试。')
      : !health
        ? '请安装并启动 Windows 巨量素材执行器；首次使用时完成一次绑定，之后会自动连接。'
        : status.kind === 'needs_pairing'
          ? `${NEEDS_PAIRING_LABEL}：这台电脑完成一次配对后，后续启动不需要再次配对。`
          : status.kind === 'offline'
            ? `${BOUND_OFFLINE_LABEL}；执行器会自动尝试重新连接。`
            : status.kind === 'connecting'
              ? '正在使用已保存的设备凭证连接公网，不需要重新配对。'
              : status.kind === 'downloading_model'
                ? '首次使用会下载 OCR 运行包和模型，完成后会自动进入空闲状态。'
                : '执行器在后台工作，浏览器关闭后任务仍可继续。';

  async function pairExecutor() {
    if (pairingBusy) return;
    setPairingBusy(true);
    try {
      const pairing = await createGiantMaterialPairing();
      const bootstrapClient = createGiantMaterialExecutorClient({ baseUrl: EXECUTOR_BASE_URL });
      const paired = await bootstrapClient.pair(pairing?.code);
      const pairedNonce = String(paired?.nonce || '').trim();
      if (!pairedNonce) throw new Error('配对未返回本机 nonce');
      window.localStorage.setItem('giant_material_executor_nonce', pairedNonce);
      const next = await createGiantMaterialExecutorClient({ baseUrl: EXECUTOR_BASE_URL, nonce: pairedNonce }).health();
      setHealth(next);
      onHealthChange?.(next);
      message.success('Windows 巨量素材执行器已配对。');
    } catch (error) {
      message.error(error?.message || '自动配对失败，请确认执行器已启动。');
    } finally {
      setPairingBusy(false);
    }
  }

  return <Alert
    type={failed ? 'error' : completed ? 'success' : requiresPairing || status.kind === 'offline' ? 'warning' : 'info'}
    showIcon
    message={<span>{statusMessage} <Tag>{health?.version || 'Windows 执行器'}</Tag></span>}
    description={<div>
      <div>{description}</div>
      {requiresPairing ? <Space style={{ marginTop: 8 }}><Button size="small" type="primary" loading={pairingBusy} onClick={pairExecutor}>首次绑定（自动配对）</Button>{onInstall ? <Button size="small" onClick={onInstall}>查看安装与配对说明</Button> : null}</Space> : null}
      {!completed && !failed && jobState && progress > 0 ? <Progress percent={progress} size="small" status={status.kind === 'running' ? 'active' : 'normal'} /> : null}
    </div>}
  />;
}
