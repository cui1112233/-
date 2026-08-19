import { Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Typography, message } from 'antd';
import { Check, Copy, Download, Eye, Pencil, RotateCcw, Save, UploadCloud, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchNovelContent, listNovelFetchProcessPresets, processNovelContent, saveNovelContent, uploadLogin, getUploadSession, uploadBatch } from '../../shared/api/novelFetch';
import { apiRequest } from '../../shared/api/client';
import './novel-fetch.css';

const GENDER_OPTIONS = [
  { value: '男', label: '男频' },
  { value: '女', label: '女频' }
];

const STYLE_OPTIONS = [
  '古风虐文','古风甜文','古风通用','年代虐文','年代甜文','年代通用',
  '现代虐文','现代甜文','现代悬疑','现代通用','男频都市','现代女主',
  '玄幻','历史','爆款BGM','家庭奇葩','家庭伤感','职场打脸'
].map(name => ({ value: name, label: name }));

const UPLOAD_PLATFORMS = [
  { id: 1, name: '黑岩付费' }, { id: 2, name: '番茄付费' }, { id: 3, name: '七猫付费' },
  { id: 4, name: '点众付费' }, { id: 6, name: '阅文付费' }, { id: 7, name: '番茄免费' },
  { id: 15, name: '知乎付费' }, { id: 20, name: '掌阅付费' }, { id: 26, name: '卓越付费' },
  { id: 29, name: '九州书城' }, { id: 31, name: '掌文付费' }
];

const DEFAULT_UPLOAD_ADVANCED = {
  jieyaNum: 4, jieyaAiHead: 0, jieyaSpeed: 1.7, jieyaPitch: 0,
  gunpingNum: 4, gunpingSpeed: 1
};

const PLATFORMS = [
  { id: 1, name: '黑岩付费' },
  { id: 2, name: '番茄付费' },
  { id: 3, name: '七猫付费' },
  { id: 4, name: '点众付费' },
  { id: 7, name: '番茄免费' },
  { id: 15, name: '知乎付费' },
  { id: 20, name: '掌阅付费' },
  { id: 26, name: '卓越付费' },
  { id: 29, name: '九州书城' },
  { id: 31, name: '掌文付费' }
];

const WORD_COUNTS = [500, 1000, 2000, 3000, 5000, 10000];
const MAX_BOOK_IDS = 50;

function parseBookIds(text) {
  const values = String(text || '')
    .split(/[\s,，;；]+/)
    .map(item => item.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
}

function resolveMaxTxt(form, customWordCount) {
  const value = form.getFieldValue('maxTxt');
  if (customWordCount) return Number(form.getFieldValue('customMaxTxt'));
  return Number(value);
}

export function NovelFetchPage() {
  const [form] = Form.useForm();
  const [rows, setRows] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [selected, setSelected] = useState([]);
  const [customWordCount, setCustomWordCount] = useState(false);
  const [preview, setPreview] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [processPresets, setProcessPresets] = useState([]);
  const [processMode, setProcessMode] = useState('');
  const [processing, setProcessing] = useState(false);
  const [processModal, setProcessModal] = useState(null); // { mode, results: [{bookId, status, report, text, error}] }
  const [inducedModal, setInducedModal] = useState(null); // 单本改编查看：row（含 induced 与原文 data）
  const [editModal, setEditModal] = useState(null);        // { bookId, platformName, mode, text, original } 编辑弹窗
  const [editText, setEditText] = useState('');            // 编辑弹窗当前文本
  const [editDirty, setEditDirty] = useState(false);       // 是否有未保存修改
  const [uploadOpen, setUploadOpen] = useState(false);     // 上传配置弹窗
  const [loginOpen, setLoginOpen] = useState(false);       // 登录弹窗
  const [loginForm] = Form.useForm();                      // 登录表单
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [uploadConfig, setUploadConfig] = useState({ platformId: null, advanced: { ...DEFAULT_UPLOAD_ADVANCED } });
  const [uploadItems, setUploadItems] = useState([]);      // [{ bookId, gender, style, overrideJieyaNum, overrideGunpingNum }]
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState([]);  // [{ bookId, status, error }]
  const [retryUploading, setRetryUploading] = useState(null); // 正在单本重试上传的 bookId

  useEffect(() => {
    let active = true;
    // 处理类型来自系统预设：诱导排查(induce)、爆款优化(hook)
    listNovelFetchProcessPresets()
      .then(data => {
        if (!active) return;
        const available = (data && data.catalog || []).filter(item => item.processOperation === 'induce' || item.processOperation === 'hook');
        const options = available.map(item => ({ value: item.processOperation, label: item.name }));
        setProcessPresets(options);
        if (options.length > 0) setProcessMode(options[0].value);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  async function handleFetch() {
    const bookIds = parseBookIds(form.getFieldValue('bookIdsText'));
    if (bookIds.length === 0) { message.warning('请填写书籍 ID'); return; }
    if (bookIds.length > MAX_BOOK_IDS) { message.warning(`一次最多获取 ${MAX_BOOK_IDS} 本书`); return; }
    const maxTxt = resolveMaxTxt(form, customWordCount);
    if (!Number.isInteger(maxTxt) || maxTxt < 100 || maxTxt > 100000) { message.warning('字数需为 100–100000 的整数'); return; }
    const platformId = Number(form.getFieldValue('platformId'));
    const platformName = PLATFORMS.find(p => p.id === platformId)?.name || '';
    const initialRows = bookIds.map(bookId => ({ bookId, platform: platformId, platformName, status: 'loading', data: null, error: null, length: 0 }));
    setRows(initialRows);
    setSelected([]);
    setFetching(true);
    try {
      const data = await fetchNovelContent({ platform: platformId, bookIds, maxTxt });
      const byId = new Map((data.results || []).map(item => [item.bookId, item]));
      setRows(initialRows.map(row => {
        const result = byId.get(row.bookId);
        return result
          ? { ...row, status: result.status, data: result.data, error: result.error, length: result.length }
          : { ...row, status: 'error', error: '无返回结果', length: 0 };
      }));
      const failed = (data.results || []).filter(item => item.status === 'error').length;
      if (failed) message.error(`${failed} 本获取失败`);
      else message.success('全部获取成功');
    } catch (error) {
      setRows(initialRows.map(row => ({ ...row, status: 'error', error: error.message || '请求失败', length: 0 })));
      message.error(error.message || '获取失败');
    } finally {
      setFetching(false);
    }
  }

  async function handleRetry(row) {
    setRetrying(true);
    try {
      const maxTxt = resolveMaxTxt(form, customWordCount);
      const data = await fetchNovelContent({ platform: row.platform, bookIds: [row.bookId], maxTxt });
      const result = (data.results || [])[0];
      if (!result) { message.error('重试失败：无返回结果'); return; }
      setRows(current => current.map(item => item.bookId === row.bookId
        ? { ...item, status: result.status, data: result.data, error: result.error, length: result.length }
        : item));
      message[result.status === 'ok' ? 'success' : 'error'](result.status === 'ok' ? '重试成功' : (result.error || '重试失败'));
    } catch (error) {
      message.error(error.message || '重试失败');
    } finally {
      setRetrying(false);
    }
  }

  function handleReset() {
    form.resetFields();
    setRows([]);
    setSelected([]);
    setPreview(null);
    setCustomWordCount(false);
  }

  async function handleDownload(row) {
    try {
      const data = await apiRequest('/api/novel-fetch', {
        method: 'POST',
        body: JSON.stringify({
          platform: row.platform,
          bookIds: [row.bookId],
          maxTxt: resolveMaxTxt(form, customWordCount),
          saveToFolder: true
        })
      });
      const result = ((data && data.results) || [])[0];
      if (result && result.savedToFolder) {
        message.success(`已保存到本地文件夹（小说获取）：${row.bookId}.txt`);
        return;
      }
      message.warning('未配置本地存储文件夹，已用浏览器下载');
      downloadText(`${row.bookId}.txt`, row.data);
    } catch (error) {
      message.warning((error && error.message) || '保存失败，已用浏览器下载');
      downloadText(`${row.bookId}.txt`, row.data);
    }
  }

  function toggleRow(bookId) {
    setSelected(current => current.includes(bookId) ? current.filter(id => id !== bookId) : [...current, bookId]);
  }

  function okRows() {
    return rows.filter(row => row.status === 'ok');
  }

  function toggleAll() {
    const oks = okRows();
    setSelected(current => current.length === oks.length ? [] : oks.map(row => row.bookId));
  }

  async function handleBatchCopy() {
    const chosen = rows.filter(row => selected.includes(row.bookId));
    if (chosen.length === 0) { message.warning('请先选择要复制的书籍'); return; }
    const text = chosen.map(row => `bookid：${row.bookId} —— ${row.platformName}\n\n${row.data}`).join('\n\n----------------\n\n');
    await copyText(text);
    message.success(`已复制 ${chosen.length} 本内容`);
  }

  function handleBatchDownload() {
    const chosen = rows.filter(row => selected.includes(row.bookId));
    if (chosen.length === 0) { message.warning('请先选择要下载的书籍'); return; }
    chosen.forEach(row => downloadText(`${row.bookId}.txt`, row.data));
  }

  async function handleProcess() {
    const chosen = okRows().filter(row => selected.includes(row.bookId) && (!row.induced || row.induced.mode !== processMode));
    if (chosen.length === 0) { message.warning('所选书籍均已处理'); return; }
    if (!processMode) { message.warning('暂无可用的处理类型'); return; }
    setProcessing(true);
    try {
      const data = await processNovelContent({
        mode: processMode,
        platform: chosen[0]?.platform,
        platformName: chosen[0]?.platformName,
        items: chosen.map(row => ({ bookId: row.bookId, text: row.data })),
        saveToFolder: true
      });
      const results = data.results || [];
      setRows(current => current.map(row => {
        const result = results.find(item => item.bookId === row.bookId);
        return result ? {
          ...row,
          induced: result.status === 'ok' ? { mode: processMode, report: result.report, text: result.text, analysis: result.analysis || null, edited: false } : null,
          processError: result.status === 'ok' ? null : result.error
        } : row;
      }));
      setProcessModal({ mode: processMode, results });
      const failed = results.filter(item => item.status === 'error').length;
      if (failed) message.error(`${failed} 本处理失败`);
      else if (results.length && results.every(item => item.savedToFolder)) message.success('处理完成，已保存到本地文件夹（改编小说）');
      else message.success('处理完成');
    } catch (error) {
      message.error(error.message || '处理失败');
    } finally {
      setProcessing(false);
    }
  }

  async function handleProcessOne(row) {
    if (!processMode) { message.warning('暂无可用的处理类型'); return; }
    if (row.induced && row.induced.mode === processMode) {
      setProcessModal({ mode: processMode, results: [{ bookId: row.bookId, status: 'ok', text: row.induced.text, report: row.induced.report, error: null }] });
      return;
    }
    setProcessing(true);
    try {
      const data = await processNovelContent({ mode: processMode, platform: row.platform, platformName: row.platformName, items: [{ bookId: row.bookId, text: row.data }], saveToFolder: true });
      const result = (data.results || [])[0];
      setRows(current => current.map(item => item.bookId === row.bookId
        ? { ...item, induced: result && result.status === 'ok' ? { mode: processMode, report: result.report, text: result.text, analysis: result.analysis || null } : null, processError: result && result.status === 'ok' ? null : (result ? result.error : '处理失败') }
        : item));
      if (result && result.status === 'ok') {
        setProcessModal({ mode: processMode, results: [result] });
        if (result.savedToFolder) message.success('已保存到本地文件夹（改编小说）');
      }
      else message.error((result && result.error) || '处理失败');
    } catch (error) {
      message.error(error.message || '处理失败');
    } finally {
      setProcessing(false);
    }
  }

  function openEdit(row) {
    const text = row.induced?.text ?? row.data ?? '';
    setEditModal({ bookId: row.bookId, platformName: row.platformName, mode: row.induced?.mode, gender: row.induced?.analysis?.gender || null, style: row.induced?.analysis?.style || null });
    setEditText(text);
    setEditDirty(false);
  }

  async function handleSaveEdit() {
    if (!editModal) return;
    if (!editText.trim()) { message.warning('正文不能为空'); return; }
    const meta = editModal.mode ? { mode: editModal.mode, platform: uploadConfig.platformId, platformName: editModal.platformName, gender: editModal.gender, style: editModal.style } : undefined;
    try {
      await saveNovelContent({ bookId: editModal.bookId, text: editText, meta });
      setEditDirty(false);
      setRows(current => current.map(r => r.bookId === editModal.bookId
        ? { ...r, induced: r.induced ? { ...r.induced, text: editText, edited: true } : r.induced }
        : r));
      message.success('已保存');
    } catch (error) {
      message.error(error.message || '保存失败');
    }
  }

  async function openUploadPanel() {
    setUploadResults([]);
    const oks = okRows().filter(r => r.induced);
    if (oks.length === 0) { message.warning('请先对小说执行 AI 处理'); return; }
    const platformId = oks[0].platform;
    setUploadConfig({ platformId, advanced: { ...DEFAULT_UPLOAD_ADVANCED } });
    setUploadItems(oks.map(r => ({
      bookId: r.bookId,
      gender: r.induced?.analysis?.gender || '',
      style: r.induced?.analysis?.style || '',
      overrideJieyaNum: null,
      overrideGunpingNum: null
    })));
    let sessionOk = false;
    try {
      const session = await getUploadSession();
      sessionOk = Boolean(session && session.loggedIn);
    } catch (_) {
      sessionOk = false;
    }
    setLoggedIn(sessionOk);
    if (!sessionOk) { setLoginOpen(true); return; }
    setUploadOpen(true);
  }

  async function handleLogin() {
    const { username, password } = await loginForm.validateFields().catch(() => null);
    if (!username || !password) return;
    setLoggingIn(true);
    try {
      const data = await uploadLogin({ username, password });
      if (data.ok) { setLoggedIn(true); setLoginOpen(false); setUploadOpen(true); message.success('登录成功'); }
      else message.error(data.error || '登录失败');
    } catch (error) {
      message.error(error.message || '登录失败');
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleUploadBatch() {
    if (uploadItems.some(i => !i.gender || !i.style)) { message.warning('请为每本选择性别和风格'); return; }
    // 跳过已经上传成功的书籍，避免重复上传
    const okBookIds = new Set(uploadResults.filter(r => r.status === 'ok').map(r => String(r.bookId)));
    const pendingItems = uploadItems.filter(i => !okBookIds.has(String(i.bookId)));
    if (pendingItems.length === 0) { message.success('所选书籍均已上传成功'); return; }
    setUploading(true);
    try {
      const data = await uploadBatch({
        platformId: uploadConfig.platformId,
        advanced: uploadConfig.advanced,
        items: pendingItems
      });
      if (data.notLoggedIn) {
        message.warning(data.error || '请先登录目标站');
        setLoggedIn(false);
        setUploadOpen(false);
        setLoginOpen(true);
        return;
      }
      const results = data.results || [];
      // 保留已有的成功结果，仅合并本次结果，避免成功标记丢失
      setUploadResults(current => {
        const newIds = new Set(results.map(r => String(r.bookId)));
        const keptOk = current.filter(r => r.status === 'ok' && !newIds.has(String(r.bookId)));
        return [...keptOk, ...results];
      });
      const ok = results.filter(r => r.status === 'ok').length;
      const fail = results.filter(r => r.status === 'error').length;
      if (fail === 0) message.success(`全部上传成功（${ok} 本）`);
      else message.warning(`成功 ${ok} 本，失败 ${fail} 本`);
    } catch (error) {
      message.error(error.message || '上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function handleRetryUpload(row) {
    setRetryUploading(row.bookId);
    try {
      const data = await uploadBatch({
        platformId: uploadConfig.platformId,
        advanced: uploadConfig.advanced,
        items: [{
          bookId: row.bookId,
          gender: row.gender,
          style: row.style,
          overrideJieyaNum: row.overrideJieyaNum,
          overrideGunpingNum: row.overrideGunpingNum
        }]
      });
      if (data.notLoggedIn) {
        message.warning(data.error || '请先登录目标站');
        setLoggedIn(false);
        setUploadOpen(false);
        setLoginOpen(true);
        return;
      }
      const result = (data.results || []).find(r => String(r.bookId) === String(row.bookId));
      if (result) {
        // 仅更新该行对应的上传结果
        setUploadResults(current => [...current.filter(x => String(x.bookId) !== String(row.bookId)), result]);
        message[result.status === 'ok' ? 'success' : 'error'](result.status === 'ok' ? `重试上传成功：${row.bookId}` : `重试上传失败：${result.error || ''}`);
      } else {
        message.error('重试上传失败：无返回结果');
      }
    } catch (error) {
      message.error(error.message || '重试上传失败');
    } finally {
      setRetryUploading(null);
    }
  }

  return (
    <Space className="novel-fetch-page" direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3} style={{ margin: 0 }}>小说获取</Typography.Title>
      <Form
        form={form}
        layout="inline"
        initialValues={{ platformId: 2, maxTxt: 2000 }}
        className="novel-fetch-form"
      >
        <Form.Item name="platformId" label="平台">
          <Select style={{ width: 160 }} options={PLATFORMS.map(p => ({ value: p.id, label: p.name }))} />
        </Form.Item>
        <Form.Item name="bookIdsText" label="书籍 ID" style={{ minWidth: 300, flex: 1 }}>
          <Input.TextArea
            rows={2}
            placeholder={'每行一个书籍 ID，支持逗号/空格分隔\n例：7673480334440139800'}
          />
        </Form.Item>
        <Form.Item name="maxTxt" label="字数">
          <Select
            style={{ width: 130 }}
            options={[
              ...WORD_COUNTS.map(n => ({ value: n, label: String(n) })),
              { value: 'custom', label: '自定义' }
            ]}
            onChange={(value) => setCustomWordCount(value === 'custom')}
          />
        </Form.Item>
        {customWordCount ? (
          <Form.Item name="customMaxTxt" label="自定义字数">
            <InputNumber min={100} max={100000} style={{ width: 120 }} />
          </Form.Item>
        ) : null}
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="button" loading={fetching} onClick={handleFetch}>获取</Button>
            <Button onClick={handleReset}>重置</Button>
          </Space>
        </Form.Item>
      </Form>

      {rows.length > 0 ? (
        <div className="legacy-panel-card novel-fetch-results">
          <div className="novel-fetch-toolbar">
            <Checkbox
              checked={okRows().length > 0 && selected.length === okRows().length}
              disabled={okRows().length === 0}
              onChange={toggleAll}
            >
              全选
            </Checkbox>
            <Button size="small" icon={<Copy size={14} aria-hidden="true" />} onClick={handleBatchCopy}>批量复制</Button>
            <Button size="small" icon={<Download size={14} aria-hidden="true" />} onClick={handleBatchDownload}>批量下载</Button>
            <Button size="small" icon={<UploadCloud size={14} aria-hidden="true" />} disabled={okRows().filter(r => r.induced).length === 0} onClick={openUploadPanel}>对接上传</Button>
            <Select
              size="small"
              style={{ width: 120 }}
              value={processMode}
              onChange={setProcessMode}
              options={processPresets}
              placeholder="处理类型"
              disabled={processPresets.length === 0 || processing}
            />
            <Button
              size="small"
              type="primary"
              icon={<Wand2 size={14} aria-hidden="true" />}
              loading={processing}
              disabled={okRows().length === 0 || !processMode}
              onClick={handleProcess}
            >AI 处理</Button>
          </div>
          {rows.map(row => (
            <div key={row.bookId} className="novel-fetch-row">
              <Checkbox
                checked={selected.includes(row.bookId)}
                disabled={row.status !== 'ok'}
                onChange={() => toggleRow(row.bookId)}
              />
              <span className="novel-fetch-bookid">{row.bookId}</span>
              <span className="novel-fetch-platform">{row.platformName}</span>
              <span className={`novel-fetch-status novel-fetch-status--${row.status}`}>
                {row.status === 'loading' ? '获取中…' : row.status === 'ok' ? '成功' : '失败'}
              </span>
              <span className="novel-fetch-length">
                {row.processError ? row.processError : (row.status === 'ok' ? `${row.length} 字` : (row.error || ''))}
              </span>
              <Space className="novel-fetch-actions">
                {row.status === 'ok' ? (
                  <>
                    <Button size="small" icon={<Eye size={14} aria-hidden="true" />} onClick={() => setPreview(row)}>查看</Button>
                    <Button size="small" icon={<Download size={14} aria-hidden="true" />} onClick={() => handleDownload(row)}>下载</Button>
                    <Button size="small" icon={<Wand2 size={14} aria-hidden="true" />} loading={processing} onClick={() => handleProcessOne(row)}>
                      {row.induced ? '查看处理结果' : (processPresets.find(p => p.value === processMode)?.label || '处理')}
                    </Button>
                    {row.induced ? (
                      <>
                        <Button size="small" icon={<Eye size={14} aria-hidden="true" />} onClick={() => setInducedModal(row)}>查看改编</Button>
                        <Button size="small" icon={<Pencil size={14} aria-hidden="true" />} onClick={() => openEdit(row)}>编辑</Button>
                      </>
                    ) : null}
                  </>
                ) : row.status === 'error' ? (
                  <Button size="small" icon={<RotateCcw size={14} aria-hidden="true" />} loading={retrying} onClick={() => handleRetry(row)}>重试</Button>
                ) : null}
              </Space>
            </div>
          ))}
        </div>
      ) : null}

      <Modal
        title={preview ? `${preview.bookId} — ${preview.platformName}` : ''}
        open={Boolean(preview)}
        width={860}
        footer={[
          <Button key="copy" icon={<Copy size={14} aria-hidden="true" />} onClick={async () => {
            if (!preview) return;
            try {
              await copyText(preview.data);
              message.success('已复制到剪贴板');
            } catch (_) {
              message.error('复制失败');
            }
          }}>复制</Button>,
          <Button key="close" onClick={() => setPreview(null)}>关闭</Button>
        ]}
        onCancel={() => setPreview(null)}
      >
        <Input.TextArea value={preview ? preview.data : ''} rows={18} readOnly className="novel-fetch-preview" />
      </Modal>

      <Modal
        title="AI 处理结果"
        open={Boolean(processModal)}
        width={880}
        onCancel={() => setProcessModal(null)}
        footer={[
          <Button key="all" icon={<Download size={14} aria-hidden="true" />} onClick={() => {
            (processModal?.results || []).filter(item => item.status === 'ok').forEach(item => downloadText(`${item.bookId}.txt`, item.text));
          }}>全选下载</Button>,
          <Button key="close" onClick={() => setProcessModal(null)}>关闭</Button>
        ]}
      >
        <Space direction="vertical" size={12} style={{ width: '100%', maxHeight: '60vh', overflow: 'auto' }}>
          {(processModal?.results || []).map(item => (
            <div key={item.bookId} className="novel-fetch-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="novel-fetch-bookid">{item.bookId}</span>
                {item.status === 'ok'
                  ? <span style={{ color: '#389e0d' }}><Check size={14} /> 成功</span>
                  : <span style={{ color: '#cf1322' }}>失败：{item.error}</span>}
                {item.status === 'ok' ? (
                  <>
                    <Button size="small" icon={<Copy size={14} aria-hidden="true" />} onClick={async () => { await copyText(item.text); message.success('已复制'); }}>复制</Button>
                    <Button size="small" icon={<Download size={14} aria-hidden="true" />} onClick={() => downloadText(`${item.bookId}.txt`, item.text)}>下载</Button>
                  </>
                ) : null}
              </div>
              {item.status === 'ok' && item.report ? (
                <Typography.Paragraph type="secondary" style={{ margin: '4px 0' }}>{item.report}</Typography.Paragraph>
              ) : null}
              {item.status === 'ok' ? (
                <Input.TextArea value={item.text} rows={10} readOnly className="novel-fetch-preview" />
              ) : null}
            </div>
          ))}
        </Space>
      </Modal>

      <Modal
        title={inducedModal ? `${inducedModal.bookId} — ${processPresets.find(p => p.value === inducedModal.induced?.mode)?.label || '改编'}` : ''}
        open={Boolean(inducedModal)}
        width={880}
        onCancel={() => setInducedModal(null)}
        footer={[
          <Button key="copy" icon={<Copy size={14} aria-hidden="true" />} onClick={async () => {
            if (!inducedModal?.induced) return;
            try {
              await copyText(inducedModal.induced.text);
              message.success('已复制改编全文');
            } catch (_) {
              message.error('复制失败');
            }
          }}>复制改编</Button>,
          <Button key="dl" icon={<Download size={14} aria-hidden="true" />} onClick={() => {
            if (!inducedModal?.induced) return;
            downloadText(`${inducedModal.bookId}.txt`, inducedModal.induced.text);
          }}>下载改编</Button>,
          <Button key="close" onClick={() => setInducedModal(null)}>关闭</Button>
        ]}
      >
        {inducedModal?.induced ? (
          <Tabs
            items={[
              {
                key: 'adapted',
                label: '改编结果',
                children: (
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    {inducedModal.induced.report ? (
                      <Typography.Paragraph type="secondary" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{inducedModal.induced.report}</Typography.Paragraph>
                    ) : null}
                    <Input.TextArea value={inducedModal.induced.text} rows={16} readOnly className="novel-fetch-preview" />
                  </Space>
                )
              },
              {
                key: 'original',
                label: '原文',
                children: (
                  <Input.TextArea value={inducedModal.data} rows={16} readOnly className="novel-fetch-preview" />
                )
              }
            ]}
          />
        ) : null}
      </Modal>

      <Modal
        title={editModal ? `${editModal.bookId} — ${editModal.platformName}（${processPresets.find(p => p.value === editModal.mode)?.label || '改编'}）` : ''}
        open={Boolean(editModal)}
        width={900}
        destroyOnClose
        onCancel={() => {
          if (editDirty) {
            Modal.confirm({ title: '有未保存的修改', content: '关闭将丢失未保存的修改，确定关闭吗？', onOk: () => setEditModal(null) });
          } else {
            setEditModal(null);
          }
        }}
        footer={[
          <Button key="save" type="primary" icon={<Save size={14} aria-hidden="true" />} onClick={handleSaveEdit}>保存</Button>,
          <Button key="dl" icon={<Download size={14} aria-hidden="true" />} onClick={() => downloadText(`${editModal?.bookId}.txt`, editText)}>下载</Button>,
          <Button key="close" onClick={() => { if (editDirty) { Modal.confirm({ title: '有未保存的修改', content: '关闭将丢失未保存的修改，确定关闭吗？', onOk: () => setEditModal(null) }); } else { setEditModal(null); } }}>关闭</Button>
        ]}
      >
        <Input.TextArea
          value={editText}
          rows={18}
          onChange={e => { setEditText(e.target.value); setEditDirty(true); }}
          className="novel-fetch-preview"
        />
      </Modal>

      <Modal
        title="登录 two.121w.com"
        open={loginOpen}
        onCancel={() => setLoginOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setLoginOpen(false)}>取消</Button>,
          <Button key="login" type="primary" loading={loggingIn} onClick={handleLogin}>登录</Button>
        ]}
      >
        <Form form={loginForm} layout="vertical">
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="对接上传（two.121w.com）"
        open={uploadOpen}
        width={1000}
        onCancel={() => setUploadOpen(false)}
        footer={[
          <Button key="close" onClick={() => setUploadOpen(false)}>关闭</Button>,
          <Button key="upload" type="primary" icon={<UploadCloud size={14} aria-hidden="true" />} loading={uploading} onClick={handleUploadBatch}>开始上传</Button>
        ]}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space wrap>
            <span>平台：</span>
            <Select
              style={{ width: 150 }}
              value={uploadConfig.platformId}
              onChange={v => setUploadConfig(c => ({ ...c, platformId: v }))}
              options={UPLOAD_PLATFORMS.map(p => ({ value: p.id, label: p.name }))}
            />
            <span>解压数量：</span>
            <InputNumber min={0} max={20} value={uploadConfig.advanced.jieyaNum} onChange={v => setUploadConfig(c => ({ ...c, advanced: { ...c.advanced, jieyaNum: v } }))} />
            <span>AI头部：</span>
            <Select style={{ width: 130 }} value={uploadConfig.advanced.jieyaAiHead} onChange={v => setUploadConfig(c => ({ ...c, advanced: { ...c.advanced, jieyaAiHead: v } }))}
              options={[{ value: 0, label: '不加AI头部' }, { value: 1, label: '单个视频加AI头部' }, { value: 2, label: 'AI头部复用' }]} />
            <span>解压语速：</span>
            <InputNumber min={0.5} max={2.0} step={0.1} value={uploadConfig.advanced.jieyaSpeed} onChange={v => setUploadConfig(c => ({ ...c, advanced: { ...c.advanced, jieyaSpeed: v } }))} />
            <span>解压音调：</span>
            <InputNumber min={-50} max={50} value={uploadConfig.advanced.jieyaPitch} onChange={v => setUploadConfig(c => ({ ...c, advanced: { ...c.advanced, jieyaPitch: v } }))} />
            <span>滚屏数量：</span>
            <InputNumber min={0} max={20} value={uploadConfig.advanced.gunpingNum} onChange={v => setUploadConfig(c => ({ ...c, advanced: { ...c.advanced, gunpingNum: v } }))} />
            <span>滚屏语速：</span>
            <InputNumber min={0.1} max={2.0} step={0.1} value={uploadConfig.advanced.gunpingSpeed} onChange={v => setUploadConfig(c => ({ ...c, advanced: { ...c.advanced, gunpingSpeed: v } }))} />
          </Space>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            每本使用自己的性别/风格（来自 AI 分析，可修改）。本期暂不支持背景音乐与自定义 AI 头部视频。
          </Typography.Paragraph>
          <Table
            size="small"
            rowKey="bookId"
            dataSource={uploadItems}
            pagination={false}
            columns={[
              { title: '书籍 ID', dataIndex: 'bookId', width: 180 },
              {
                title: '性别', dataIndex: 'gender', width: 120,
                render: (v, row) => <Select size="small" style={{ width: 110 }} value={v} options={GENDER_OPTIONS} onChange={g => setUploadItems(list => list.map(i => i.bookId === row.bookId ? { ...i, gender: g } : i))} />
              },
              {
                title: '风格', dataIndex: 'style', width: 150,
                render: (v, row) => <Select size="small" showSearch style={{ width: 140 }} value={v} options={STYLE_OPTIONS} onChange={s => setUploadItems(list => list.map(i => i.bookId === row.bookId ? { ...i, style: s } : i))} />
              },
              {
                title: '解压数量', dataIndex: 'overrideJieyaNum', width: 120,
                render: (v, row) => <InputNumber size="small" min={0} max={20} value={v} placeholder="默认" onChange={n => setUploadItems(list => list.map(i => i.bookId === row.bookId ? { ...i, overrideJieyaNum: n } : i))} />
              },
              {
                title: '滚屏数量', dataIndex: 'overrideGunpingNum', width: 120,
                render: (v, row) => <InputNumber size="small" min={0} max={20} value={v} placeholder="默认" onChange={n => setUploadItems(list => list.map(i => i.bookId === row.bookId ? { ...i, overrideGunpingNum: n } : i))} />
              },
              {
                title: '状态', dataIndex: 'status', width: 260,
                render: (_, row) => {
                  const r = uploadResults.find(x => x.bookId === row.bookId);
                  if (!r) return <span>-</span>;
                  if (r.status === 'ok') {
                    return <span style={{ color: '#389e0d' }}><Check size={14} aria-hidden="true" /> 成功</span>;
                  }
                  return (
                    <Space size={4}>
                      <span style={{ color: '#cf1322' }}>失败：{r.error}</span>
                      <Button
                        size="small"
                        icon={<RotateCcw size={14} aria-hidden="true" />}
                        loading={retryUploading === row.bookId}
                        disabled={uploading || (retryUploading !== null && retryUploading !== row.bookId)}
                        onClick={() => handleRetryUpload(row)}
                      >重试</Button>
                    </Space>
                  );
                }
              }
            ]}
          />
        </Space>
      </Modal>
    </Space>
  );
}

export default NovelFetchPage;
