import { useEffect, useMemo, useState } from 'react';
import { EMPTY_MATERIAL, normalizeGiantMaterialId, stageState } from './giantMaterialTest.js';
import './giant-material-test.css';

const SAMPLE_ID = '7689285397448523826';

function statusClass(status) {
  return `giant-material-test-stage is-${status.tone || 'muted'}`;
}

function safeVideoPath(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch (_) {
    return '';
  }
}

function Stage({ title, status, children }) {
  return <section className={statusClass(status)}><div className="giant-material-test-stage-heading"><strong>{title}</strong><span>{status.label}</span></div><p>{status.detail}</p>{children}</section>;
}

export default function GiantMaterialTestPage() {
  const [giantMaterialId, setGiantMaterialId] = useState(SAMPLE_ID);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState('');
  const [material, setMaterial] = useState(EMPTY_MATERIAL);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    document.title = '巨量素材调用测试';
    return () => { document.title = '一战晟铭'; };
  }, []);

  const normalizedId = useMemo(() => normalizeGiantMaterialId(giantMaterialId), [giantMaterialId]);
  const resolveStatus = busy
    ? { tone: 'loading', label: '调用中', detail: '正在请求青语素材接口…' }
    : resolved
      ? { tone: 'success', label: '已完成', detail: '素材元数据已返回' }
      : { tone: 'muted', label: '待执行', detail: '输入巨量素材 ID 后开始' };
  const videoStatus = resolved && material.videoUrl
    ? { tone: 'success', label: '已返回', detail: '已取得视频地址，可进入下一阶段读取' }
    : errorCode
      ? { tone: 'error', label: '失败', detail: errorCode }
      : { tone: 'muted', label: '待执行', detail: '等待素材解析' };
  const ocrStatus = stageState('ocr', errorCode);
  const bodyStatus = resolved
    ? { tone: 'muted', label: '未执行', detail: '测试页阶段一不写入或生成正文' }
    : { tone: 'muted', label: '未执行', detail: '尚未取得素材' };

  async function resolveMaterial(event) {
    event.preventDefault();
    if (!normalizedId || busy) return;
    setBusy(true);
    setErrorCode('');
    setResolved(false);
    setMaterial(EMPTY_MATERIAL);
    try {
      const response = await fetch('/__local/giant-material-test/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ giantMaterialId: normalizedId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true) throw new Error(String(payload?.code || `HTTP_${response.status}`));
      setMaterial(payload.material || EMPTY_MATERIAL);
      setResolved(true);
    } catch (error) {
      setErrorCode(String(error?.message || 'GIANT_MATERIAL_TEST_FAILED'));
    } finally {
      setBusy(false);
    }
  }

  return <main className="giant-material-test-page">
    <header className="giant-material-test-header">
      <div><span className="giant-material-test-eyebrow">LOCAL PROBE</span><h1>巨量素材调用测试</h1><p>只验证素材读取链路，不写入批量工厂小说列表。</p></div>
      <span className="giant-material-test-safety">本机临时测试</span>
    </header>
    <form className="giant-material-test-form" onSubmit={resolveMaterial}>
      <label htmlFor="giant-material-id">巨量素材 ID</label>
      <div className="giant-material-test-input-row"><input id="giant-material-id" value={giantMaterialId} onChange={event => setGiantMaterialId(event.target.value)} inputMode="numeric" placeholder="输入 10–25 位数字 ID" /><button type="submit" disabled={!normalizedId || busy}>{busy ? '调用中…' : '开始读取'}</button></div>
      {!normalizedId && giantMaterialId ? <small className="giant-material-test-error">请输入 10–25 位数字 ID</small> : <small>测试样本：{SAMPLE_ID}</small>}
    </form>
    {errorCode ? <div className="giant-material-test-alert" role="alert"><strong>调用未完成</strong><span>{errorCode === 'QINGYU_AUTH_NOT_CONFIGURED' ? '本机尚未配置青语服务令牌。' : errorCode}</span></div> : null}
    <div className="giant-material-test-stages">
      <Stage title="素材解析" status={resolveStatus}>{resolved ? <dl><div><dt>平台书名</dt><dd>{material.title || '未返回'}</dd></div><div><dt>平台 Book ID</dt><dd>{material.platformBookId || '未返回'}</dd></div><div><dt>书城</dt><dd>{material.platformName || '未返回'}</dd></div><div><dt>青语素材 ID</dt><dd>{material.materialId || '未返回'}</dd></div></dl> : null}</Stage>
      <Stage title="视频读取" status={videoStatus}>{resolved ? <dl><div><dt>视频地址</dt><dd>{safeVideoPath(material.videoUrl) || '未返回'}</dd></div><div><dt>规格</dt><dd>{material.width && material.height ? `${material.width} × ${material.height}` : '未返回'}{material.durationSeconds ? ` · ${material.durationSeconds}s` : ''}</dd></div></dl> : null}</Stage>
      <Stage title="滚屏 OCR" status={ocrStatus}><p className="giant-material-test-muted">阶段二接入 OCR 后，这里显示滚屏进度和去重字数。</p></Stage>
      <Stage title="小说正文" status={bodyStatus}><p className="giant-material-test-muted">当前不会写入或生成正文。</p></Stage>
    </div>
  </main>;
}
