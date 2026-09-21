import { Alert, Button, Input, InputNumber, Modal, Select, Space, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { getWorkshopPlatforms } from '../../../shared/api/novelFetchWorkshop';
import { fetchDirectOriginals, getBatchAutomationStatus, listAutomationPresets, listBatches } from '../../../shared/api/batchFactoryV11';
import { batchFactoryPlatformOptions } from './batchFactoryPlatformOptions';
import { buildManualBatchSubmission, hasFetchedManualSources, manualBookIDsFromInput } from './batchFactoryManualFetch';

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
  { value: 'full_metadata', label: '书籍 ID / 书名 / 男女频 / 风格 / 标签 / 推荐理由 / 评级' },
  { value: 'full_11', label: '完整 11 列' }
];

function normalizedError(error, fallback) {
  return String(error?.message || fallback || '请求失败').trim();
}

function fallbackPlatformOptions() {
  return batchFactoryPlatformOptions([], { fallback: true });
}

export function BatchFactoryCreateModal({ open, onCancel, onCreated }) {
  const [title, setTitle] = useState('');
  const [platformId, setPlatformId] = useState('');
  const [platformOptions, setPlatformOptions] = useState([]);
  const [platformState, setPlatformState] = useState('idle');
  const [platformError, setPlatformError] = useState('');
  const [parseMode, setParseMode] = useState('smart');
  const [columnPresetId, setColumnPresetId] = useState('full_metadata');
  const [columnOrder, setColumnOrder] = useState('书籍ID,书名,男女频,风格,标签,推荐理由,评级');
  const [inputText, setInputText] = useState('');
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduleTasksOpen, setScheduleTasksOpen] = useState(false);
  const [scheduleTasks, setScheduleTasks] = useState([]);
  const [scheduleTasksLoading, setScheduleTasksLoading] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [automationPresets, setAutomationPresets] = useState([]);
  const [automationPresetID, setAutomationPresetID] = useState('');
  const [automationRunMode, setAutomationRunMode] = useState('video_no_submit');
  const [automationConcurrency, setAutomationConcurrency] = useState(2);
  const [contentRangeLines, setContentRangeLines] = useState(5);
  const [contentCaptureCharacters, setContentCaptureCharacters] = useState(4000);
  const [sourceTextByBookId, setSourceTextByBookId] = useState({});
  const [fetchErrorsByBookId, setFetchErrorsByBookId] = useState({});
  const [fetching, setFetching] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadPlatforms() {
    setPlatformState('loading');
    setPlatformError('');
    try {
      const result = await getWorkshopPlatforms();
      const options = batchFactoryPlatformOptions(result?.platforms);
      if (!options.length) throw new Error('在线书城目录为空');
      setPlatformOptions(options);
      setPlatformId(current => options.some(option => option.value === current) ? current : (options[0]?.value || ''));
      setPlatformState('ready');
    } catch (error) {
      const options = fallbackPlatformOptions();
      setPlatformOptions(options);
      setPlatformId(current => options.some(option => option.value === current) ? current : (options[0]?.value || ''));
      setPlatformState('fallback');
      setPlatformError(normalizedError(error, '无法读取在线书城目录'));
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setPlatformState('loading');
    setPlatformError('');
    getWorkshopPlatforms().then(result => {
      if (!active) return;
      const options = batchFactoryPlatformOptions(result?.platforms);
      if (!options.length) throw new Error('在线书城目录为空');
      setPlatformOptions(options);
      setPlatformId(current => options.some(option => option.value === current) ? current : (options[0]?.value || ''));
      setPlatformState('ready');
    }).catch(error => {
      if (!active) return;
      const options = fallbackPlatformOptions();
      setPlatformOptions(options);
      setPlatformId(current => options.some(option => option.value === current) ? current : (options[0]?.value || ''));
      setPlatformState('fallback');
      setPlatformError(normalizedError(error, '无法读取在线书城目录'));
    });
    return () => { active = false; };
  }, [open]);

  const hasSelectedPlatform = platformOptions.some(option => option.value === platformId);
  const bookIds = useMemo(() => manualBookIDsFromInput(inputText), [inputText]);
  const sourceReady = hasFetchedManualSources(bookIds, sourceTextByBookId);
  const fetchedCount = bookIds.filter(bookId => String(sourceTextByBookId[bookId] || '').trim()).length;
  const missingBookIds = bookIds.filter(bookId => !String(sourceTextByBookId[bookId] || '').trim());
  const failedBookIds = bookIds.filter(bookId => String(fetchErrorsByBookId[bookId] || '').trim());

  function clearFetchedSources() {
    setSourceTextByBookId({});
    setFetchErrorsByBookId({});
  }

  function reset() {
    setTitle('');
    setInputText('');
    setScheduleDialogOpen(false);
    setScheduleTasksOpen(false);
    setScheduleTasks([]);
    setScheduledAt('');
    setAutomationPresetID('');
    setAutomationRunMode('video_no_submit');
    setAutomationConcurrency(2);
    setContentRangeLines(5);
    setContentCaptureCharacters(4000);
    clearFetchedSources();
  }

  async function fetchMissingOriginals({ quiet = false } = {}) {
    if (!hasSelectedPlatform) {
      if (!quiet) message.warning('请先选择书城');
      return { ok: false, sources: sourceTextByBookId };
    }
    if (!bookIds.length) {
      if (!quiet) message.warning('请先在小说列表中输入有效的 Book ID');
      return { ok: false, sources: sourceTextByBookId };
    }

    const pendingBookIds = bookIds.filter(bookId => !String(sourceTextByBookId[bookId] || '').trim());
    if (!pendingBookIds.length) return { ok: true, sources: sourceTextByBookId };

    setFetching(true);
    try {
      const result = await fetchDirectOriginals({
        platform: platformId,
        bookIds: pendingBookIds,
        maxTxt: contentCaptureCharacters
      });
      const items = Array.isArray(result?.results) ? result.results : [];
      const byId = new Map(items.map(item => [String(item?.bookId || '').trim(), item]));
      const nextSources = { ...sourceTextByBookId };
      const nextErrors = { ...fetchErrorsByBookId };

      for (const bookId of pendingBookIds) {
        const item = byId.get(bookId);
        const sourceText = String(item?.data || '').trim();
        if (item?.status === 'ok' && sourceText) {
          nextSources[bookId] = sourceText;
          delete nextErrors[bookId];
        } else {
          nextErrors[bookId] = String(item?.error || item?.message || '没有返回正文').trim();
        }
      }

      setSourceTextByBookId(nextSources);
      setFetchErrorsByBookId(nextErrors);
      const ready = hasFetchedManualSources(bookIds, nextSources);
      const successCount = bookIds.filter(bookId => String(nextSources[bookId] || '').trim()).length;
      if (!quiet) {
        if (ready) message.success(`已获取 ${successCount} 本小说正文`);
        else message.error(`已获取 ${successCount} / ${bookIds.length} 本；失败项可再次点击“重试未获取”`);
      }
      return { ok: ready, sources: nextSources };
    } catch (error) {
      const errorText = normalizedError(error, '获取内容失败');
      setFetchErrorsByBookId(current => ({
        ...current,
        ...Object.fromEntries(pendingBookIds.map(bookId => [bookId, errorText]))
      }));
      if (!quiet) message.error(errorText);
      return { ok: false, sources: sourceTextByBookId };
    } finally {
      setFetching(false);
    }
  }

  function validateDraft() {
    if (!hasSelectedPlatform) return message.warning('请先选择书城');
    if (!title.trim()) return message.warning('请填写作品名称');
    if (!inputText.trim()) return message.warning('请粘贴小说列表');
    if (!bookIds.length) return message.warning('小说列表中没有有效的 Book ID');
    return true;
  }

  async function openScheduleDialog() {
    if (!validateDraft()) return;
    const date = new Date(Date.now() + 10 * 60 * 1000);
    const pad = value => String(value).padStart(2, '0');
    setScheduledAt(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`);
    try {
      const result = await listAutomationPresets();
      setAutomationPresets(Array.isArray(result?.presets) ? result.presets : []);
    } catch (error) {
      message.error(normalizedError(error, '读取自动化预设失败'));
      return;
    }
    setScheduleDialogOpen(true);
  }

  async function openScheduleTasks() {
    setScheduleTasksOpen(true);
    setScheduleTasksLoading(true);
    try {
      const result = await listBatches();
      const batches = Array.isArray(result?.batches) ? result.batches : [];
      const tasks = await Promise.all(batches.map(async batch => {
        const status = await getBatchAutomationStatus(batch.id).catch(() => null);
        const automation = status?.automation || status || {};
        return { id: batch.id, title: batch.title || '未命名批量', state: automation.state || 'idle', scheduledAt: automation.scheduledAt || '' };
      }));
      setScheduleTasks(tasks.filter(task => task.state !== 'idle'));
    } catch (error) {
      message.error(normalizedError(error, '读取定时任务失败'));
    } finally {
      setScheduleTasksLoading(false);
    }
  }

  async function submit({ scheduledRun = false } = {}) {
    if (!validateDraft()) return;

    let resolvedSources = sourceTextByBookId;
    if (!sourceReady) {
      const fetched = await fetchMissingOriginals({ quiet: true });
      if (!fetched.ok) {
        message.error('仍有小说正文未获取成功，未创建批量；请查看失败 Book ID 后重试');
        return;
      }
      resolvedSources = fetched.sources;
    }

    if (scheduledRun && !scheduledAt) return message.warning('请选择开始时间');
    if (scheduledRun && !automationPresetID) return message.warning('请选择自动化预设');
    const scheduled = scheduledRun ? new Date(scheduledAt) : null;
    if (scheduledRun && (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() <= Date.now())) return message.warning('定时时间需要晚于现在');

    setBusy(true);
    try {
      const platformName = platformOptions.find(option => option.value === platformId)?.label || platformId;
      await onCreated(buildManualBatchSubmission({
        title: title.trim(),
        platformId,
        platformName,
        parseMode,
        columnPresetId,
        columnOrder,
        inputText,
        sourceTextByBookId: resolvedSources,
        contentRangeLines,
        contentCaptureCharacters,
        scheduledAt: scheduled ? scheduled.toISOString() : '',
        automationEnabled: scheduledRun,
        autoPublishEnabled: scheduledRun && automationRunMode === 'full_submit',
        presetId: automationPresetID,
        runMode: automationRunMode,
        concurrency: Number(automationConcurrency || 2)
      }));
      reset();
    } catch (error) {
      message.error(normalizedError(error, '新建批量失败'));
    } finally {
      setBusy(false);
    }
  }

  const createDisabled = busy || fetching || !title.trim() || !inputText.trim() || !bookIds.length || !hasSelectedPlatform;
  const createLabel = sourceReady ? '确定创建' : '获取并创建';
  return <><Modal
    className="shuihuo-create-project-modal"
    title="新建批量"
    open={open}
    onCancel={() => { onCancel(); reset(); }}
    width={760}
    footer={<Button onClick={() => { onCancel(); reset(); }}>取消</Button>}
  >
    <label className="shuihuo-form-label" htmlFor="batch-title">作品名称 <em>*</em></label>
    <Input id="batch-title" value={title} onChange={event => setTitle(event.target.value)} placeholder="请输入作品名称" maxLength={255} />

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 16 }}>
      <label className="shuihuo-form-label">书城
        <Select
          value={platformId || undefined}
          onChange={value => { setPlatformId(value); clearFetchedSources(); }}
          options={platformOptions}
          loading={platformState === 'loading'}
          disabled={platformState === 'loading'}
          placeholder="请选择书城"
        />
      </label>
      <label className="shuihuo-form-label">输入格式<Select value={parseMode} onChange={value => { setParseMode(value); clearFetchedSources(); }} options={parseModes} /></label>
      <label className="shuihuo-form-label">列顺序预设<Select value={columnPresetId} onChange={value => { setColumnPresetId(value); clearFetchedSources(); }} options={presets} /></label>
    </div>

    {platformState === 'fallback' ? <Alert
      type="warning"
      showIcon
      message="在线书城目录暂不可用，已启用内置书城列表"
      description={<Space direction="vertical" size={6}>
        <span>正文仍通过真实小说获取接口抓取，不会伪造内容。在线目录错误：{platformError}</span>
        <Button size="small" onClick={loadPlatforms} loading={platformState === 'loading'}>重试在线书城目录</Button>
      </Space>}
    /> : null}

    <label className="shuihuo-form-label" htmlFor="batch-column-order">自定义列顺序</label>
    <Input id="batch-column-order" value={columnOrder} onChange={event => { setColumnOrder(event.target.value); clearFetchedSources(); }} placeholder="书籍ID,书名,标签,推荐理由" />
    <label className="shuihuo-form-label" htmlFor="batch-input-text">小说列表 <em>*</em></label>
    <Input.TextArea
      id="batch-input-text"
      value={inputText}
      onChange={event => { setInputText(event.target.value); clearFetchedSources(); }}
      rows={9}
      placeholder={'每行一本小说，可粘贴 ID、书名、男女频、风格、标签、推荐理由、评级。\n示例：2080989285751305136\t重生书\t女频\t现代爽文\t重生,逆袭\t女主逆袭\tS'}
    />

    <div className="batch-factory-create-toolbar">
      <Button type="primary" loading={busy || fetching} disabled={createDisabled} onClick={() => submit()}>{createLabel}</Button>
      <Button loading={fetching} disabled={!hasSelectedPlatform || !bookIds.length} onClick={() => fetchMissingOriginals()}>{missingBookIds.length && fetchedCount ? '重试未获取' : '获取内容'}</Button>
      <Button onClick={openScheduleDialog}>开始定时</Button>
      <Button onClick={openScheduleTasks}>定时任务</Button>
    </div>

    {bookIds.length ? <Alert
      type={sourceReady ? 'success' : failedBookIds.length ? 'warning' : 'info'}
      showIcon
      message={sourceReady ? `正文已全部获取（${fetchedCount} / ${bookIds.length}）` : `待获取 ${bookIds.length} 本；已获取 ${fetchedCount} 本`}
      description={failedBookIds.length ? `失败 Book ID：${failedBookIds.slice(0, 8).join('、')}${failedBookIds.length > 8 ? ` 等 ${failedBookIds.length} 本` : ''}` : '未获取正文时，创建会自动获取。'}
    /> : null}

    <div className="batch-factory-content-controls">
      <label className="shuihuo-form-label">内容范围<InputNumber min={1} max={500} value={contentRangeLines} onChange={value => setContentRangeLines(value || 5)} addonAfter="行" /></label>
      <label className="shuihuo-form-label">内容截取<Select value={contentCaptureCharacters} onChange={value => { setContentCaptureCharacters(value); clearFetchedSources(); }} options={[1000, 2000, 4000, 8000, 12000, 20000, 50000, 100000].map(value => ({ value, label: `${value} 字` }))} /></label>
    </div>
  </Modal>
  <Modal
    title="开始定时"
    open={scheduleDialogOpen}
    onCancel={() => setScheduleDialogOpen(false)}
    confirmLoading={busy || fetching}
    okText="创建并定时执行"
    cancelText="取消"
    onOk={() => submit({ scheduledRun: true })}
  >
    <label className="shuihuo-form-label" htmlFor="batch-scheduled-at">开始时间 <em>*</em></label>
    <Input id="batch-scheduled-at" type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} />
    <label className="shuihuo-form-label">自动化预设 <em>*</em></label>
    <Select value={automationPresetID || undefined} onChange={setAutomationPresetID} placeholder="选择已保存预设" options={automationPresets.map(item => ({ value: item.id, label: `${item.name} · v${item.version}` }))} />
    <label className="shuihuo-form-label">执行模式</label>
    <Select value={automationRunMode} onChange={setAutomationRunMode} options={[{ value: 'storyboard_only', label: '只生成分镜' }, { value: 'video_no_submit', label: '生成视频不提交' }, { value: 'full_submit', label: '全自动生成并提交' }]} />
    <label className="shuihuo-form-label">并发数</label>
    <InputNumber min={1} max={8} value={automationConcurrency} onChange={value => setAutomationConcurrency(value || 2)} />
  </Modal>
  <Modal title="定时任务" open={scheduleTasksOpen} onCancel={() => setScheduleTasksOpen(false)} footer={<Button onClick={() => setScheduleTasksOpen(false)}>关闭</Button>}>
    <Button loading={scheduleTasksLoading} onClick={openScheduleTasks}>刷新</Button>
    <div className="batch-factory-log-list">{scheduleTasks.length ? scheduleTasks.map(task => <section key={task.id}><strong>{task.title}</strong><span>{task.scheduledAt || '立即执行'} · {task.state}</span></section>) : <p>{scheduleTasksLoading ? '读取中…' : '暂无定时任务'}</p>}</div>
  </Modal></>;
}
