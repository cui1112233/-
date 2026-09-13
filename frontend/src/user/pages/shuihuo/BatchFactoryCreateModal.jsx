import { InputNumber, Modal, Select, Switch, Button, Input, message } from 'antd';
import { useEffect, useState } from 'react';
import { getWorkshopPlatforms } from '../../../shared/api/novelFetchWorkshop';
import { fetchNovelContent } from '../../../shared/api/novelFetch';
import { batchFactoryPlatformOptions } from './batchFactoryPlatformOptions';
import { hasFetchedManualSources, manualBookIDsFromInput } from './batchFactoryManualFetch';

const parseModes = [
  { value: 'smart', label: '智能识别' },
  { value: 'header', label: '单行表头' },
  { value: 'multi_header', label: '多行表头' },
  { value: 'fixed_full_11', label: '完整 11 列' },
  { value: 'fixed_from_b', label: '从 B 列开始' },
  { value: 'fixed_paid_basic', label: '付费 ID 基础列' },
  { value: 'custom', label: '自定义列顺序' }
];
const presets = [
  { value: '', label: '不使用预设' },
  { value: 'paid_name_reason', label: '付费 ID / 书名 / 推荐理由' },
  { value: 'paid_name_gender_reason', label: '付费 ID / 书名 / 男女频 / 推荐理由' },
  { value: 'free_paid_name_gender_reason', label: '免费 ID / 付费 ID / 书名 / 男女频 / 推荐理由' },
  { value: 'sample_input', label: '书籍 ID / 书名 / 推荐理由 / 男女频 / 标签 / 评级' },
  { value: 'full_11', label: '完整 11 列' }
];

export function BatchFactoryCreateModal({ open, onCancel, onCreated }) {
  const [title, setTitle] = useState('');
  const [platformId, setPlatformId] = useState('');
  const [platformOptions, setPlatformOptions] = useState([]);
  const [platformState, setPlatformState] = useState('idle');
  const [platformError, setPlatformError] = useState('');
  const [parseMode, setParseMode] = useState('smart');
  const [columnPresetId, setColumnPresetId] = useState('sample_input');
  const [columnOrder, setColumnOrder] = useState('书籍ID,书名,推荐理由,男女频,标签,评级');
  const [inputText, setInputText] = useState('');
  const [automatic, setAutomatic] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [contentRangeLines, setContentRangeLines] = useState(5);
  const [contentCaptureCharacters, setContentCaptureCharacters] = useState(4000);
  const [sourceTextByBookId, setSourceTextByBookId] = useState({});
  const [fetching, setFetching] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setPlatformState('loading');
    setPlatformError('');
    getWorkshopPlatforms().then(result => {
      if (!active) return;
      const options = batchFactoryPlatformOptions(result?.platforms);
      setPlatformOptions(options);
      setPlatformId(current => options.some(option => option.value === current) ? current : (options[0]?.value || ''));
      setPlatformState(options.length ? 'ready' : 'empty');
    }).catch(error => {
      if (!active) return;
      setPlatformOptions([]);
      setPlatformId('');
      setPlatformState('error');
      setPlatformError(error.message || '无法读取小说获取书城');
    });
    return () => { active = false; };
  }, [open]);

  const hasSelectedPlatform = platformOptions.some(option => option.value === platformId);
  function clearFetchedSources() { setSourceTextByBookId({}); }
  function reset() { setTitle(''); setInputText(''); setAutomatic(false); setScheduledAt(''); setContentRangeLines(5); setContentCaptureCharacters(4000); clearFetchedSources(); }
  const bookIds = manualBookIDsFromInput(inputText);
  const sourceReady = hasFetchedManualSources(bookIds, sourceTextByBookId);
  async function fetchOriginals() {
    if (!hasSelectedPlatform) return message.warning(platformError || '请先选择小说获取书城');
    if (!bookIds.length) return message.warning('请先在小说列表中输入有效的 Book ID');
    setFetching(true);
    try {
      const result = await fetchNovelContent({ platform: platformId, bookIds, maxTxt: contentCaptureCharacters });
      const fetched = {};
      const failed = [];
      for (const item of result?.results || []) {
        const bookId = String(item?.bookId || '').trim();
        const sourceText = String(item?.data || '').trim();
        if (item?.status === 'ok' && bookId && sourceText) fetched[bookId] = sourceText;
        else failed.push(bookId || '未知 Book ID');
      }
      setSourceTextByBookId(fetched);
      if (failed.length || !hasFetchedManualSources(bookIds, fetched)) {
        message.error(`有 ${failed.length || bookIds.length - Object.keys(fetched).length} 本未抓到原文，请检查 Book ID 后重试`);
        return;
      }
      message.success(`已抓取 ${bookIds.length} 本小说，每本保存前 ${contentCaptureCharacters} 字用于后续上传`);
    } catch (error) {
      clearFetchedSources();
      message.error(error.message || '获取内容失败');
    } finally { setFetching(false); }
  }
  async function submit() {
    if (!hasSelectedPlatform) return message.warning(platformError || '请先选择小说获取书城');
    if (!title.trim()) return message.warning('请填写作品名称');
    if (!inputText.trim()) return message.warning('请粘贴小说列表');
    if (!bookIds.length) return message.warning('小说列表中没有有效的 Book ID');
    if (!sourceReady) return message.warning('请先点击“获取内容”，并确保每本小说都已抓取原文');
    if (automatic && !scheduledAt) return message.warning('请选择定时执行时间');
    const scheduled = automatic ? new Date(scheduledAt) : null;
    if (automatic && Number.isNaN(scheduled.getTime())) return message.warning('定时执行时间无效');
    setBusy(true);
    try {
      await onCreated({ title: title.trim(), platformId, parseMode, columnPresetId, columnOrder, inputText, sourceTextByBookId, contentRangeLines, contentCaptureCharacters, scheduledAt: scheduled ? scheduled.toISOString() : '' });
      reset();
    } catch (error) { message.error(error.message || '新建批量失败'); } finally { setBusy(false); }
  }
  return <Modal className="shuihuo-create-project-modal" title="新建批量" open={open} onCancel={() => { onCancel(); reset(); }} width={760} footer={<><Button onClick={() => { onCancel(); reset(); }}>取消</Button><Button type="primary" loading={busy} disabled={platformState !== 'ready' || !hasSelectedPlatform} onClick={submit}>确定创建</Button></>}>
    <label className="shuihuo-form-label" htmlFor="batch-title">作品名称 <em>*</em></label>
    <Input id="batch-title" value={title} onChange={event => setTitle(event.target.value)} placeholder="请输入作品名称" maxLength={255} />
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 16 }}>
      <label className="shuihuo-form-label">书城<Select value={platformId || undefined} onChange={value => { setPlatformId(value); clearFetchedSources(); }} options={platformOptions} loading={platformState === 'loading'} disabled={platformState !== 'ready'} placeholder={platformState === 'loading' ? '正在读取小说获取书城' : '请选择书城'} notFoundContent={platformState === 'empty' ? '小说获取没有启用书城' : undefined} /></label>
      <label className="shuihuo-form-label">输入格式<Select value={parseMode} onChange={value => { setParseMode(value); clearFetchedSources(); }} options={parseModes} /></label>
      <label className="shuihuo-form-label">列顺序预设<Select value={columnPresetId} onChange={value => { setColumnPresetId(value); clearFetchedSources(); }} options={presets} /></label>
    </div>
    <label className="shuihuo-form-label" htmlFor="batch-column-order">自定义列顺序</label>
    <Input id="batch-column-order" value={columnOrder} onChange={event => { setColumnOrder(event.target.value); clearFetchedSources(); }} placeholder="书籍ID,书名,标签,推荐理由" />
    <label className="shuihuo-form-label" htmlFor="batch-input-text">小说列表 <em>*</em></label>
    <Input.TextArea id="batch-input-text" value={inputText} onChange={event => { setInputText(event.target.value); clearFetchedSources(); }} rows={9} placeholder={'每行一本小说，可粘贴 ID、书名、男女频、标签、理由、评级。\n示例：2080989285751305136\t重生书\t推荐理由\t女频\t重生,爽文\tS'} />
    <div className="batch-factory-fetch-originals"><span className="shuihuo-modal-note">按所选书城抓取每个 Book ID 的前 {contentCaptureCharacters} 字；全部成功后才可创建。</span><Button type="primary" loading={fetching} disabled={platformState !== 'ready' || !hasSelectedPlatform || !bookIds.length} onClick={fetchOriginals}>获取内容</Button></div>
    {bookIds.length ? <p className="shuihuo-modal-note">待抓取 {bookIds.length} 本；已获取 {Object.keys(sourceTextByBookId).length} 本。</p> : null}
    <div className="shuihuo-create-collection"><strong>自动</strong><Switch size="small" checked={automatic} onChange={setAutomatic} /><span>在设定时间把本批小说标为待执行；新建时不会启动生成。</span></div>
    {automatic ? <><label className="shuihuo-form-label" htmlFor="batch-scheduled-at">定时执行时间 <em>*</em></label><Input id="batch-scheduled-at" type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} /></> : null}
    <div className="batch-factory-content-controls">
      <label className="shuihuo-form-label">内容范围<InputNumber min={1} max={500} value={contentRangeLines} onChange={value => setContentRangeLines(value || 5)} addonAfter="行" /></label>
      <label className="shuihuo-form-label">内容截取<Select value={contentCaptureCharacters} onChange={value => { setContentCaptureCharacters(value); clearFetchedSources(); }} options={[1000, 2000, 4000, 8000, 12000, 20000, 50000, 100000].map(value => ({ value, label: `${value} 字` }))} /></label>
    </div>
    <p className="shuihuo-modal-note">内容范围只控制工作台展示前 N 条有效正文；内容截取决定实际抓取和后续上传的正文长度。</p>
    {platformState === 'error' ? <p className="shuihuo-modal-note">书城读取失败：{platformError}</p> : null}
  </Modal>;
}
