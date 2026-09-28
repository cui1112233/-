import { useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_MATERIAL, normalizeGiantMaterialId } from './giantMaterialTest.js';
import { readGiantMaterialContent } from './giantMaterialExtractionClient.js';
import './giant-material-test.css';

const SAMPLE_ID = '7689285397448523826';
const ERROR_MESSAGES = {
  QINGYU_AUTH_NOT_CONFIGURED: '本机尚未配置青语服务令牌。',
  QINGYU_AUTH_FAILED: '青语登录授权已失效，需要更新令牌。',
  QINGYU_TIMEOUT: '查询素材超时，可以重新开始读取。',
  QINGYU_UPSTREAM_FAILED: '青语未返回有效素材，请核对 ID 或登录授权。',
  OCR_PLATFORM_NOT_SUPPORTED: '当前本地 OCR 仅支持 Mac，尚未接入服务器版本。',
  OCR_DURATION_NOT_SUPPORTED: '暂只支持 30 分钟以内且有时长信息的视频。',
  OCR_VIDEO_NOT_ALLOWED: '视频地址不属于当前已验证的青语素材域名。',
  OCR_NO_TEXT: '未识别到正文，可能不是滚屏视频或文字区域不同。',
  OCR_BUSY: '本机已有识别任务正在运行，请稍后重试。',
  OCR_TIMEOUT: '识别超过 10 分钟，已停止；可重新读取。',
  OCR_CANCELLED: '已取消读取，不会写入小说列表。',
  OCR_EXECUTION_FAILED: '本机识别未完成，请重试并确认视频可访问。',
  OCR_STREAM_INCOMPLETE: '识别连接中断，未收到完整结果，请重新读取。',
  MATERIAL_RESOLVE_REQUIRED: '素材缓存已过期，请重新开始读取。'
};

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
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [copyMessage, setCopyMessage] = useState('');
  const currentTask = useRef(null);

  useEffect(() => {
    document.title = '巨量素材调用测试';
    return () => { currentTask.current?.abort(); document.title = '一战晟铭'; };
  }, []);

  const normalizedId = useMemo(() => normalizeGiantMaterialId(giantMaterialId), [giantMaterialId]);
  const resolveStatus = busy && !resolved
    ? { tone: 'loading', label: '调用中', detail: '正在请求青语素材接口…' }
    : resolved
      ? { tone: 'success', label: '已完成', detail: '素材元数据已返回' }
      : { tone: 'muted', label: '待执行', detail: '输入巨量素材 ID 后开始' };
  const videoStatus = resolved && material.videoUrl
    ? { tone: 'success', label: '已返回', detail: '已取得视频地址，可进入下一阶段读取' }
    : errorCode
      ? { tone: 'error', label: '失败', detail: errorCode }
      : { tone: 'muted', label: '待执行', detail: '等待素材解析' };
  const ocrStatus = result
    ? { tone: 'success', label: '已完成', detail: `已识别 ${result.frames} 帧，去重后 ${result.characters} 字符。` }
    : busy && resolved
      ? { tone: 'loading', label: '识别中', detail: progress?.frames ? `已处理 ${progress.frames} 帧 · 视频 ${Math.round(progress.seconds)} / ${Math.round(progress.durationSeconds)} 秒 · ${progress.characters} 字符` : '正在启动 Mac 本地 OCR，无需付费模型 API…' }
      : errorCode && resolved
        ? { tone: 'error', label: errorCode === 'OCR_CANCELLED' ? '已取消' : '未完成', detail: ERROR_MESSAGES[errorCode] || errorCode }
        : { tone: 'muted', label: '待执行', detail: '素材返回后自动识别滚屏文字' };
  const bodyStatus = result
    ? { tone: 'warning', label: '待校对', detail: `已获取 ${result.characters} 字符。仅为视频展示的文字，不等于平台小说全文。` }
    : { tone: 'muted', label: '待执行', detail: busy ? '识别完成后自动显示正文' : '尚未取得正文' };

  async function resolveMaterial(event) {
    event.preventDefault();
    if (!normalizedId || busy) return;
    setBusy(true);
    setErrorCode('');
    setResolved(false);
    setMaterial(EMPTY_MATERIAL);
    setProgress(null);
    setResult(null);
    setCopyMessage('');
    const controller = new AbortController();
    currentTask.current = controller;
    try {
      const extracted = await readGiantMaterialContent(normalizedId, {
        signal: controller.signal,
        onResolved: value => { setMaterial(value || EMPTY_MATERIAL); setResolved(true); },
        onProgress: setProgress
      });
      setResult(extracted);
    } catch (error) {
      setErrorCode(controller.signal.aborted ? 'OCR_CANCELLED' : String(error?.message || 'GIANT_MATERIAL_TEST_FAILED'));
    } finally {
      currentTask.current = null;
      setBusy(false);
    }
  }

  async function copyText() {
    try { await navigator.clipboard.writeText(result.text); setCopyMessage('已复制正文'); }
    catch { setCopyMessage('复制受浏览器限制，请选中正文复制或下载 TXT。'); }
  }
  function downloadText() {
    const url = URL.createObjectURL(new Blob([result.text + '\n'], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${material.giantMaterialId || normalizedId}-OCR.txt`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <main className="giant-material-test-page">
    <header className="giant-material-test-header">
      <div><span className="giant-material-test-eyebrow">LOCAL PROBE</span><h1>巨量素材调用测试</h1><p>输入 ID → 获取素材 → 本机 OCR → 显示正文，不写入批量工厂小说列表。</p></div>
      <span className="giant-material-test-safety">本机临时测试</span>
    </header>
    <form className="giant-material-test-form" onSubmit={resolveMaterial}>
      <label htmlFor="giant-material-id">巨量素材 ID</label>
      <div className="giant-material-test-input-row"><input id="giant-material-id" value={giantMaterialId} disabled={busy} onChange={event => setGiantMaterialId(event.target.value)} inputMode="numeric" placeholder="输入 10–25 位数字 ID" /><button type="submit" disabled={!normalizedId || busy}>{busy ? '读取中…' : '开始读取'}</button>{busy ? <button type="button" className="giant-material-test-cancel" onClick={() => currentTask.current?.abort()}>取消读取</button> : null}</div>
      {!normalizedId && giantMaterialId ? <small className="giant-material-test-error">请输入 10–25 位数字 ID</small> : <small>测试样本：{SAMPLE_ID}</small>}
    </form>
    {errorCode ? <div className="giant-material-test-alert" role="alert"><strong>读取未完成</strong><span>{ERROR_MESSAGES[errorCode] || errorCode}</span></div> : null}
    <div className="giant-material-test-stages">
      <Stage title="素材解析" status={resolveStatus}>{resolved ? <>
        <dl><div><dt>素材名称</dt><dd>{material.materialTitle || material.title || '未返回'}</dd></div><div><dt>青语素材 ID</dt><dd>{material.materialId || '未返回'}</dd></div></dl>
        {material.books?.length ? <>
          {material.books.length > 1 ? <p>此素材关联 {material.books.length} 条平台书籍记录，入库前需要确认书籍。</p> : null}
          {material.books.map(book => <dl key={`${book.platformName}:${book.platformBookId}`}><div><dt>平台书名</dt><dd>{book.title || '未返回'}</dd></div><div><dt>平台 Book ID · {book.platformName || '书城未返回'}</dt><dd>{book.platformBookId}</dd></div></dl>)}
        </> : <dl><div><dt>平台书名</dt><dd>{material.title || '未返回'}</dd></div><div><dt>平台 Book ID</dt><dd>{material.platformBookId || '未返回'}</dd></div><div><dt>书城</dt><dd>{material.platformName || '未返回'}</dd></div></dl>}
      </> : null}</Stage>
      <Stage title="视频读取" status={videoStatus}>{resolved ? <dl><div><dt>视频地址</dt><dd>{safeVideoPath(material.videoUrl) || '未返回'}</dd></div><div><dt>规格</dt><dd>{material.width && material.height ? `${material.width} × ${material.height}` : '未返回'}{material.durationSeconds ? ` · ${material.durationSeconds}s` : ''}</dd></div></dl> : null}</Stage>
      <Stage title="滚屏 OCR" status={ocrStatus}>
        {busy && resolved ? <progress aria-label="滚屏识别进度" max={progress?.durationSeconds || material.durationSeconds || 1} value={progress?.seconds || 0} /> : null}
        {result ? <><p>未对齐片段：{result.issues.length} · 读取失败帧：{result.frameReadFailures.length} · 无正文帧：{result.emptyBodyFrames?.length || 0}。OCR 可能有错字，请校对。</p>
          {result.emptyBodyFrames?.length ? <p>无正文画面位于 {result.emptyBodyFrames.join('、')} 秒，可能是广告、空白或未识别到文字，不能据此确认原文完整。</p> : null}</> : null}
        <p className="giant-material-test-muted">使用 Mac 本地文字识别，不调用付费大模型；不保存完整视频或抽帧文件。其他视频排版可能需要调整文字区域。</p>
      </Stage>
      <Stage title="小说正文" status={bodyStatus}>{result ? <>
        <textarea aria-label="识别出的小说正文" className="giant-material-test-body" readOnly value={result.text} />
        <div className="giant-material-test-actions"><button type="button" onClick={copyText}>复制正文</button><button type="button" onClick={downloadText}>下载 TXT</button><span role="status">{copyMessage}</span></div>
      </> : <p className="giant-material-test-muted">只显示视频中出现的文字，不自动补写缺失内容。</p>}</Stage>
    </div>
  </main>;
}
