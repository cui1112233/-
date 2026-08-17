import { Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Typography, message } from 'antd';
import { Check, Copy, Download, Eye, RotateCcw, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchNovelContent, listNovelFetchProcessPresets, processNovelContent } from '../../shared/api/novelFetch';
import './novel-fetch.css';

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
        items: chosen.map(row => ({ bookId: row.bookId, text: row.data }))
      });
      const results = data.results || [];
      setRows(current => current.map(row => {
        const result = results.find(item => item.bookId === row.bookId);
        return result ? { ...row, induced: result.status === 'ok' ? { mode: processMode, report: result.report, text: result.text } : null, processError: result.status === 'ok' ? null : result.error } : row;
      }));
      setProcessModal({ mode: processMode, results });
      const failed = results.filter(item => item.status === 'error').length;
      if (failed) message.error(`${failed} 本处理失败`);
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
      const data = await processNovelContent({ mode: processMode, items: [{ bookId: row.bookId, text: row.data }] });
      const result = (data.results || [])[0];
      setRows(current => current.map(item => item.bookId === row.bookId
        ? { ...item, induced: result && result.status === 'ok' ? { mode: processMode, report: result.report, text: result.text } : null, processError: result && result.status === 'ok' ? null : (result ? result.error : '处理失败') }
        : item));
      if (result && result.status === 'ok') setProcessModal({ mode: processMode, results: [result] });
      else message.error((result && result.error) || '处理失败');
    } catch (error) {
      message.error(error.message || '处理失败');
    } finally {
      setProcessing(false);
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
                    <Button size="small" icon={<Download size={14} aria-hidden="true" />} onClick={() => downloadText(`${row.bookId}.txt`, row.data)}>下载</Button>
                    <Button size="small" icon={<Wand2 size={14} aria-hidden="true" />} loading={processing} onClick={() => handleProcessOne(row)}>
                      {row.induced ? '查看处理结果' : (processPresets.find(p => p.value === processMode)?.label || '处理')}
                    </Button>
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
    </Space>
  );
}

export default NovelFetchPage;
