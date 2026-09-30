import { Alert, Button, Input, InputNumber, Modal, Select, Space, Tag, message } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getWorkshopPlatforms } from '../../../shared/api/novelFetchWorkshop';
import { createNovelFetchIntake, fetchDirectOriginals, getBatchAutomationStatus, listAutomationPresets, listBatches } from '../../../shared/api/batchFactoryV11';
import { batchFactoryPlatformOptions } from './batchFactoryPlatformOptions';
import { buildManualBatchSubmission, manualBookIDsFromInput, removePlatformGroup, replacePlatformGroup, totalGroupBookCount, upsertPlatformGroup } from './batchFactoryManualFetch';
import { formatBeijingDatetimeLocal, normalizeAutomationConcurrency, parseBeijingDatetimeLocal } from './batchFactoryAutomationSchedule';
import { resolveGiantMaterialForBatch } from '../giantMaterialExtractionClient.js';
import { normalizeGiantMaterialId } from '../giantMaterialTest.js';
import GiantMaterialStatusCard from '../GiantMaterialStatusCard.jsx';
import { createGiantMaterialJob, waitForGiantMaterialJob } from '../../../shared/api/giantMaterialExecutorPublic.js';
import { BatchFactoryGiantMaterialExecutorStatus } from './BatchFactoryGiantMaterialExecutorStatus.jsx';
import { availableGiantMaterialBooks, buildGiantMaterialIntake, giantMaterialBookKey, selectGiantMaterialBook } from './batchFactoryGiantMaterialImport.js';

// 输入格式与列顺序固定为默认值（智能识别 + 完整元数据列），AI 会自动分析男女频/风格，无需用户手选
const DEFAULT_PARSE_MODE = 'smart';
const DEFAULT_COLUMN_PRESET_ID = 'full_metadata';
const DEFAULT_COLUMN_ORDER = '书籍ID,书名,男女频,风格,标签,推荐理由,评级';

function normalizedError(error, fallback) {
  const code = String(error?.message || '').trim();
  const messages = {
    INVALID_GIANT_MATERIAL_ID: '请输入10—25位数字巨量素材 ID。',
    QINGYU_AUTH_NOT_CONFIGURED: '本机尚未配置青语服务令牌。',
    QINGYU_AUTH_FAILED: '青语授权已失效，需要更新令牌。',
    QINGYU_BOOK_METADATA_INCOMPLETE: '素材没有完整的平台书名或 Book ID，不能登记。',
    QINGYU_BOOK_SELECTION_REQUIRED: '该素材关联多条平台书籍记录，请先选择一条。',
    QINGYU_VIDEO_DURATION_MISSING: '素材没有返回有效的视频时长，暂时不能交给执行器处理。',
    GIANT_EXECUTOR_OFFLINE: 'Windows 巨量素材执行器未安装或未启动，请先安装并完成配对。',
    GIANT_EXECUTOR_FAILED: 'Windows 巨量素材执行器处理失败，可重试失败项。',
    GIANT_EXECUTOR_TIMEOUT: 'Windows 巨量素材执行器超时，任务仍可能在后台运行，请稍后查看状态。',
    GIANT_OCR_EMPTY: '没有识别到可登记的正文。',
    OCR_NO_TEXT: '没有识别到可登记的正文。'
  };
  return messages[code] || code || String(fallback || '请求失败').trim();
}

const GIANT_MATERIAL_PLATFORM_OPTION = { value: 'giant_material', label: '巨量获取' };

function withGiantMaterialOption(options = []) {
  return [GIANT_MATERIAL_PLATFORM_OPTION, ...(Array.isArray(options) ? options : []).filter(option => option?.value !== GIANT_MATERIAL_PLATFORM_OPTION.value)];
}

function preferredPlatformId(options, current = '') {
  if (Array.isArray(options) && options.some(option => option?.value === current)) return current;
  return options.find(option => option?.value !== GIANT_MATERIAL_PLATFORM_OPTION.value)?.value || options[0]?.value || '';
}

function fallbackPlatformOptions() {
  return withGiantMaterialOption(batchFactoryPlatformOptions([], { fallback: true }));
}

export function BatchFactoryCreateModal({ open, onCancel, onCreated }) {
  const [title, setTitle] = useState('');
  const [platformId, setPlatformId] = useState('');
  const [platformOptions, setPlatformOptions] = useState([]);
  const [platformState, setPlatformState] = useState('idle');
  const [platformError, setPlatformError] = useState('');
  const parseMode = DEFAULT_PARSE_MODE;
  const columnPresetId = DEFAULT_COLUMN_PRESET_ID;
  const columnOrder = DEFAULT_COLUMN_ORDER;
  const [inputText, setInputText] = useState('');
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [automationDialogMode, setAutomationDialogMode] = useState('scheduled');
  const [scheduleTasksOpen, setScheduleTasksOpen] = useState(false);
  const [scheduleTasks, setScheduleTasks] = useState([]);
  const [scheduleTasksLoading, setScheduleTasksLoading] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [automationPresets, setAutomationPresets] = useState([]);
  const [automationPresetID, setAutomationPresetID] = useState('');
  const [automationRunMode, setAutomationRunMode] = useState('full_submit');
  const [automationConcurrency, setAutomationConcurrency] = useState(2);
  const [contentRangeLines, setContentRangeLines] = useState(5);
  const [contentCaptureCharacters, setContentCaptureCharacters] = useState(4000);
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState([]);
  const [editingPlatformId, setEditingPlatformId] = useState(null);
  const [giantMaterial, setGiantMaterial] = useState(null);
  const [giantSelectedBookKey, setGiantSelectedBookKey] = useState('');
  const [giantExtraction, setGiantExtraction] = useState(null);
  const [giantProgress, setGiantProgress] = useState(null);
  const [giantBusy, setGiantBusy] = useState(false);
  const [giantPhase, setGiantPhase] = useState('idle');
  const [giantError, setGiantError] = useState('');
  const [executorHealth, setExecutorHealth] = useState(null);
  const [executorJob, setExecutorJob] = useState(null);
  const giantControllerRef = useRef(null);

  async function loadPlatforms() {
    setPlatformState('loading');
    setPlatformError('');
    try {
      const result = await getWorkshopPlatforms();
      const options = withGiantMaterialOption(batchFactoryPlatformOptions(result?.platforms));
      if (!options.length) throw new Error('在线书城目录为空');
      setPlatformOptions(options);
      setPlatformId(current => preferredPlatformId(options, current));
      setPlatformState('ready');
    } catch (error) {
      const options = fallbackPlatformOptions();
      setPlatformOptions(options);
      setPlatformId(current => preferredPlatformId(options, current));
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
      const options = withGiantMaterialOption(batchFactoryPlatformOptions(result?.platforms));
      if (!options.length) throw new Error('在线书城目录为空');
      setPlatformOptions(options);
      setPlatformId(current => preferredPlatformId(options, current));
      setPlatformState('ready');
    }).catch(error => {
      if (!active) return;
      const options = fallbackPlatformOptions();
      setPlatformOptions(options);
      setPlatformId(current => preferredPlatformId(options, current));
      setPlatformState('fallback');
      setPlatformError(normalizedError(error, '无法读取在线书城目录'));
    });
    return () => { active = false; };
  }, [open]);

  const isGiantMaterial = platformId === GIANT_MATERIAL_PLATFORM_OPTION.value;
  const inputBookIds = useMemo(() => manualBookIDsFromInput(inputText), [inputText]);
  const giantMaterialId = isGiantMaterial ? normalizeGiantMaterialId(inputBookIds[0]) : '';
  const giantBooks = useMemo(() => availableGiantMaterialBooks(giantMaterial || {}), [giantMaterial]);
  const giantBook = useMemo(() => selectGiantMaterialBook(giantMaterial || {}, giantSelectedBookKey), [giantMaterial, giantSelectedBookKey]);

  function reset() {
    giantControllerRef.current?.abort();
    giantControllerRef.current = null;
    setGiantMaterial(null);
    setGiantSelectedBookKey('');
    setGiantExtraction(null);
    setGiantProgress(null);
    setGiantBusy(false);
    setGiantPhase('idle');
    setGiantError('');
    setExecutorJob(null);
    setTitle('');
    setInputText('');
    setScheduleDialogOpen(false);
    setScheduleTasksOpen(false);
    setScheduleTasks([]);
    setScheduledAt('');
    setAutomationDialogMode('scheduled');
    setAutomationPresetID('');
    setAutomationRunMode('full_submit');
    setAutomationConcurrency(2);
    setContentRangeLines(5);
    setContentCaptureCharacters(4000);
    setGroups([]);
    setEditingPlatformId(null);
  }

  function clearGiantMaterialDraft() {
    giantControllerRef.current?.abort();
    giantControllerRef.current = null;
    setGiantMaterial(null);
    setGiantSelectedBookKey('');
    setGiantExtraction(null);
    setGiantProgress(null);
    setGiantBusy(false);
    setGiantPhase('idle');
    setGiantError('');
    setExecutorJob(null);
  }

  function changePlatform(value) {
    if (editingPlatformId && value !== editingPlatformId) {
      message.warning('请先完成当前修改：点“添加书城”保存，或点当前标签的 × 放弃');
      return;
    }
    setPlatformId(value);
    if (value === GIANT_MATERIAL_PLATFORM_OPTION.value) {
      setEditingPlatformId(null);
      setInputText('');
      clearGiantMaterialDraft();
    }
  }

  function handleAddPlatformGroup() {
    const id = String(platformId || '').trim();
    if (!id) return message.warning('请先选择书城');
    const ids = manualBookIDsFromInput(inputText);
    if (!ids.length) return message.warning('小说列表中没有有效的 Book ID（每行以书 ID 开头）');
    // 非编辑态向已存在书城追加时，按模拟合并后的预计数判断，避免同 ID 被重复计数
    const currentEditingOld = editingPlatformId
      ? manualBookIDsFromInput(groups.find(group => group.platformId === editingPlatformId)?.inputText).length
      : 0;
    let projected;
    if (editingPlatformId) {
      projected = totalGroupBookCount(groups) - currentEditingOld + ids.length;
    } else {
      const merged = upsertPlatformGroup(groups, { platformId, platformName: '', inputText });
      projected = totalGroupBookCount(merged);
    }
    if (projected > 50) {
      return message.warning('一个批量最多 50 本书');
    }
    if (editingPlatformId) {
      setGroups(current => replacePlatformGroup(current, editingPlatformId, inputText));
      setEditingPlatformId(null);
    } else {
      const platformName = platformOptions.find(option => option.value === platformId)?.label || platformId;
      setGroups(current => upsertPlatformGroup(current, { platformId, platformName, inputText }));
    }
    setInputText('');
  }

  function handleEditGroup(group) {
    // 编辑中点自己的标签：保持现状，不重载文本造成静默回滚
    if (editingPlatformId === group.platformId) return;
    if (editingPlatformId && editingPlatformId !== group.platformId) {
      return message.warning('请先完成当前修改：点“添加书城”保存，或点当前标签的 × 放弃');
    }
    setPlatformId(group.platformId);
    setInputText(group.inputText);
    setEditingPlatformId(group.platformId);
  }

  function handleRemoveGroup(removedPlatformId) {
    if (editingPlatformId === removedPlatformId) {
      // 编辑中点自己的 × = 放弃修改
      setEditingPlatformId(null);
      setInputText('');
      return;
    }
    if (editingPlatformId) {
      return message.warning('请先完成当前修改：点“添加书城”保存，或点当前标签的 × 放弃');
    }
    setGroups(current => removePlatformGroup(current, removedPlatformId));
  }

  async function resolveGiantMaterialDraft() {
    if (!isGiantMaterial) return;
    if (inputBookIds.length !== 1 || !giantMaterialId) {
      message.warning('请输入一条10—25位数字巨量素材 ID');
      return;
    }
    clearGiantMaterialDraft();
    setGiantBusy(true);
    setGiantPhase('resolving');
    const controller = new AbortController();
    giantControllerRef.current = controller;
    try {
      const material = await resolveGiantMaterialForBatch(giantMaterialId, { signal: controller.signal });
      const candidates = availableGiantMaterialBooks(material || {});
      if (!candidates.length) throw new Error('QINGYU_BOOK_METADATA_INCOMPLETE');
      setGiantMaterial(material);
      setGiantPhase('reading');
      if (candidates.length === 1) {
        setGiantSelectedBookKey(giantMaterialBookKey(candidates[0]));
        setTitle(current => current.trim() || candidates[0].title);
      }
      message.success(`已解析素材，可登记 ${candidates.length} 条平台书籍记录`);
    } catch (error) {
      if (controller.signal.aborted) return;
      const errorText = normalizedError(error, '巨量素材解析失败');
      setGiantError(errorText);
      setGiantPhase('error');
      message.error(errorText);
    } finally {
      giantControllerRef.current = null;
      setGiantBusy(false);
    }
  }

  async function submitGiantMaterial({ scheduledRun = false, automationRun = false } = {}) {
    if (!validateDraft()) return;
    const automationEnabled = scheduledRun || automationRun;
    if (scheduledRun && !scheduledAt) return message.warning('请选择北京时间自动启动时间');
    if (automationEnabled && !automationPresetID) return message.warning('请选择自动化预设');
    const scheduledAtISO = scheduledRun ? parseBeijingDatetimeLocal(scheduledAt) : '';
    if (scheduledRun && (!scheduledAtISO || new Date(scheduledAtISO).getTime() <= Date.now())) return message.warning('北京时间自动启动时间需要晚于现在');
    if (executorHealth?.online !== true) {
      const errorText = normalizedError(new Error('GIANT_EXECUTOR_OFFLINE'));
      setGiantError(errorText);
      setGiantPhase('error');
      message.error(errorText);
      return;
    }
    const durationSeconds = Number(giantMaterial?.durationSeconds || giantMaterial?.duration || 0);
    if (!(durationSeconds > 0)) {
      const errorText = normalizedError(new Error('QINGYU_VIDEO_DURATION_MISSING'));
      setGiantError(errorText);
      setGiantPhase('error');
      message.error(errorText);
      return;
    }
    setBusy(true);
    setGiantError('');
    setGiantPhase(giantExtraction ? 'success' : 'ocr');
    const controller = new AbortController();
    giantControllerRef.current = controller;
    try {
      let extraction = giantExtraction;
      if (!extraction) {
        setGiantProgress({ completed: 0, total: 0, percent: 0 });
        const createdResponse = await createGiantMaterialJob({
          materialId: giantMaterialId,
          platformBookId: giantBook.platformBookId || giantBook.bookId,
          title: giantBook.title,
          videoUrl: giantMaterial.videoUrl,
          durationSeconds,
          modelVersion: 'windows-paddleocr-v1',
          contentRangeLines
        });
        const createdJob = createdResponse?.job || createdResponse?.data?.job || createdResponse;
        if (!createdJob?.id) throw new Error('GIANT_EXECUTOR_FAILED');
        setExecutorJob(createdJob);
        const completedJob = await waitForGiantMaterialJob(createdJob.id, {
          signal: controller.signal,
          onState: next => {
            setExecutorJob(next);
            setGiantProgress(next?.progress || null);
            setGiantPhase(String(next?.state || '').toLowerCase() === 'cleaning' ? 'cleaning' : 'ocr');
          }
        });
        if (String(completedJob?.state || '').toLowerCase() !== 'succeeded' || !String(completedJob?.result?.text || '').trim()) {
          throw new Error(completedJob?.errorCode || 'GIANT_EXECUTOR_FAILED');
        }
        extraction = { ...completedJob.result, sourceCompleteness: 'video_excerpt', requiresProofreading: true };
      }
      setGiantExtraction(extraction);
      setGiantPhase('success');
      const intakeResponse = await createNovelFetchIntake(buildGiantMaterialIntake({
        giantMaterialId,
        material: giantMaterial,
        extraction,
        book: giantBook,
        contentRangeLines
      }));
      const intake = intakeResponse?.intake || intakeResponse;
      if (!intake?.id) throw new Error('GIANT_MATERIAL_INTAKE_FAILED');
      await onCreated?.({
        intakeId: intake.id,
        title: title.trim() || giantBook.title,
        scheduledAt: scheduledAtISO,
        automationEnabled,
        autoPublishEnabled: automationRun && automationRunMode === 'full_submit',
        presetId: automationPresetID,
        runMode: automationRunMode,
        automationConcurrency: normalizeAutomationConcurrency(automationConcurrency)
      });
      message.success(`已创建《${giantBook.title}》巨量素材批量`);
      reset();
    } catch (error) {
      if (!controller.signal.aborted) {
        const errorText = normalizedError(error, '巨量素材创建失败');
        setGiantError(errorText);
        setGiantPhase('error');
        message.error(errorText);
      } else {
        setGiantPhase('cancelled');
      }
    } finally {
      giantControllerRef.current = null;
      setBusy(false);
    }
  }

  function validateDraft() {
    if (!title.trim()) return message.warning('请填写作品名称');
    if (isGiantMaterial) {
      if (inputBookIds.length !== 1 || !giantMaterialId) return message.warning('请输入一条10—25位数字巨量素材 ID');
      if (!giantMaterial) return message.warning('请先点击“解析素材”');
      if (!giantBook) return message.warning('该素材关联多条平台书籍记录，请先选择一条');
      return true;
    }
    if (!groups.length) return message.warning('请至少添加一个书城的书（粘贴后点“添加书城”）');
    if (editingPlatformId) return message.warning('请先完成当前书城的修改：点“保存书城修改”或 × 放弃');
    return true;
  }

  async function openAutomationDialog(mode = 'scheduled') {
    if (!validateDraft()) return;
    const scheduled = mode === 'scheduled';
    setAutomationDialogMode(scheduled ? 'scheduled' : 'immediate');
    if (!scheduled) setAutomationRunMode('full_submit');
    setScheduledAt(scheduled ? formatBeijingDatetimeLocal(new Date(Date.now() + 10 * 60 * 1000).toISOString()) : '');
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

  async function submit({ scheduledRun = false, automationRun = false } = {}) {
    if (isGiantMaterial) {
      await submitGiantMaterial({ scheduledRun, automationRun });
      return;
    }
    if (!validateDraft()) return;

    const automationEnabled = scheduledRun || automationRun;
    if (scheduledRun && !scheduledAt) return message.warning('请选择北京时间自动启动时间');
    if (automationEnabled && !automationPresetID) return message.warning('请选择自动化预设');
    const scheduledAtISO = scheduledRun ? parseBeijingDatetimeLocal(scheduledAt) : '';
    if (scheduledRun && (!scheduledAtISO || new Date(scheduledAtISO).getTime() <= Date.now())) return message.warning('北京时间自动启动时间需要晚于现在');

    setBusy(true);
    try {
      // 编辑中点了定时入口也会先校验；此时 groups 是唯一事实源。
      // 正文按组隔离：不同书城即便撞 Book ID 也各自抓各自的，互不覆盖。
      const sourcesByGroup = {};
      const failedPlatforms = [];
      let fetchedCount = 0;
      for (const group of groups) {
        const groupKey = String(group.platformId);
        const ids = manualBookIDsFromInput(group.inputText);
        const have = sourcesByGroup[groupKey] || {};
        const pending = ids.filter(bookId => !String(have[bookId] || '').trim());
        if (!pending.length) continue;
        try {
          const result = await fetchDirectOriginals({
            platform: group.platformId,
            bookIds: pending,
            maxTxt: contentCaptureCharacters
          });
          const groupSources = {};
          for (const item of Array.isArray(result?.results) ? result.results : []) {
            const text = String(item?.data || '').trim();
            if (item?.status === 'ok' && text) groupSources[String(item.bookId)] = text;
          }
          sourcesByGroup[groupKey] = { ...have, ...groupSources };
          // 只按本组请求的 pending id 计数，防止接口回传意外 ID 高估成功数
          for (const bookId of pending) {
            if (String(groupSources[bookId] || '').trim()) fetchedCount += 1;
          }
        } catch (error) {
          // 单组抓取失败不阻断：该组正文留空，书照样创建，列表中标红后可单独重试
          failedPlatforms.push(group.platformName || group.platformId);
          console.warn('分组抓取失败', group.platformId, error);
          sourcesByGroup[groupKey] = { ...have };
        }
      }
      // 设计约定：抓不到的书照样创建（正文为空，列表中标红），不阻断整个批量
      const totalCount = totalGroupBookCount(groups);

      await onCreated(buildManualBatchSubmission({
        title: title.trim(),
        groups: groups.map(group => ({
          platformId: group.platformId,
          platformName: group.platformName,
          inputText: group.inputText,
          sourceTextByBookId: sourcesByGroup[String(group.platformId)] || {}
        })),
        parseMode,
        columnPresetId,
        columnOrder,
        contentRangeLines,
        contentCaptureCharacters,
        scheduledAt: scheduledAtISO,
        automationEnabled,
        autoPublishEnabled: automationEnabled && automationRunMode === 'full_submit',
        presetId: automationPresetID,
        runMode: automationRunMode,
        automationConcurrency: normalizeAutomationConcurrency(automationConcurrency)
      }));
      reset();
      if (failedPlatforms.length > 0) {
        message.warning(`${fetchedCount}/${totalCount} 本已抓到正文；以下书城抓取失败：${failedPlatforms.join('、')}。失败的书已在列表中标红，可单独重试`);
      } else if (fetchedCount < totalCount) {
        message.warning(`${fetchedCount}/${totalCount} 本已抓到正文，其余书将在列表中标红，可单独重试`);
      }
    } catch (error) {
      message.error(normalizedError(error, '新建批量失败'));
    } finally {
      setBusy(false);
    }
  }

  const createDisabled = isGiantMaterial
    ? busy || giantBusy || !title.trim() || !giantMaterialId || !giantMaterial || !giantBook
    : busy || !title.trim() || editingPlatformId || !groups.length;
  const createLabel = isGiantMaterial ? '读取并创建' : '立即执行';

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

    <div style={{ marginTop: 16 }}>
      <label className="shuihuo-form-label">书城
        <Select
          value={platformId || undefined}
          onChange={changePlatform}
          options={platformOptions}
          loading={platformState === 'loading'}
          disabled={platformState === 'loading'}
          placeholder="请选择书城"
        />
      </label>
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

    {isGiantMaterial ? <Alert type="info" showIcon message="巨量获取" description="输入一条巨量素材 ID。系统会读取青语平台书名、Book ID 和视频正文；不会保存 MP4 文件。" /> : null}

    <label className="shuihuo-form-label" htmlFor="batch-input-text">{isGiantMaterial ? '巨量素材 ID' : '小说列表'} <em>*</em></label>
    <Input.TextArea
      id="batch-input-text"
      value={inputText}
      onChange={event => { setInputText(event.target.value); if (isGiantMaterial) clearGiantMaterialDraft(); }}
      rows={isGiantMaterial ? 3 : 9}
      placeholder={isGiantMaterial ? '例如：7689285397448523826' : '每行一本小说，可粘贴 ID、书名、男女频、风格、标签、推荐理由、评级。\n示例：2080989285751305136\t重生书\t女频\t现代爽文\t重生,逆袭\t女主逆袭\tS'}
    />

    {isGiantMaterial && giantMaterial ? <>
      {giantBooks.length > 1 ? <><label className="shuihuo-form-label">选择平台书籍</label><Select style={{ width: '100%' }} value={giantSelectedBookKey || undefined} onChange={setGiantSelectedBookKey} placeholder="该素材关联多条记录，请选择一条" options={giantBooks.map(book => ({ value: giantMaterialBookKey(book), label: book.title + ' · ' + (book.platformName || '书城') + ' · ' + book.platformBookId }))} /></> : null}
      <Alert type="success" showIcon message={'素材已解析：' + (giantMaterial.materialTitle || giantMaterial.title || '未命名素材')} description={giantBooks.length > 1 ? '检测到 ' + giantBooks.length + ' 条平台书籍记录，请选择后读取正文。' : (giantBook?.title || '已关联平台书籍') + ' · Book ID ' + (giantBook?.platformBookId || '—')} />
    </> : null}

    {isGiantMaterial ? <>
      <BatchFactoryGiantMaterialExecutorStatus job={executorJob} onHealthChange={setExecutorHealth} />
      <GiantMaterialStatusCard
        title="滚屏 OCR"
        phase={giantPhase}
        compact
        detail={giantPhase === 'resolving' ? '正在解析巨量素材…' : giantPhase === 'reading' ? '素材已返回，等待 Windows 执行器读取正文…' : giantPhase === 'ocr' ? '正在 OCR 读取滚屏正文（Windows 执行器）…' : giantPhase === 'cleaning' ? '正在整理正文…' : giantPhase === 'success' ? '正文已提取，可继续创建。' : giantError || '点击“读取并创建”后会显示实时处理状态。'}
        error={giantPhase === 'error' ? giantError : ''}
        progress={busy && !giantExtraction ? giantProgress?.total ? { value: giantProgress.completed, max: giantProgress.total, indeterminate: false } : { indeterminate: true } : null}
        stats={giantProgress?.total ? ['已处理 ' + (giantProgress.completed || 0) + ' / ' + (giantProgress.total || 0) + ' 帧', (giantProgress.percent || 0) + '%'] : giantExtraction ? [(giantExtraction.frames || 0) + ' 帧', (giantExtraction.characters || 0) + ' 字'] : []}
      />
    </> : null}

    <div className="batch-factory-create-toolbar">
      {isGiantMaterial ? <><Button loading={giantBusy} disabled={giantBusy || busy || !giantMaterialId} onClick={resolveGiantMaterialDraft}>解析素材</Button><Button type="primary" loading={busy} disabled={createDisabled} onClick={() => submit()}>{createLabel}</Button></> : <><Button type="primary" onClick={handleAddPlatformGroup}>{editingPlatformId ? '保存书城修改' : '添加书城'}</Button><Button type="primary" disabled={createDisabled} loading={busy} onClick={() => openAutomationDialog('immediate')}>立即执行</Button></>}
      <Button onClick={() => openAutomationDialog('scheduled')}>开始定时</Button>
      <Button onClick={openScheduleTasks}>定时任务</Button>
    </div>
    {!isGiantMaterial && groups.length ? (
      <div className="batch-factory-platform-groups" data-testid="platform-groups">
        {groups.map(group => (
          <Tag
            key={group.platformId}
            className={editingPlatformId === group.platformId ? 'platform-group-tag is-editing' : 'platform-group-tag'}
            closable
            onClose={event => { event.preventDefault(); handleRemoveGroup(group.platformId); }}
            onClick={() => handleEditGroup(group)}
            style={{ cursor: 'pointer', marginBottom: 4 }}
          >
            {group.platformName} ×{manualBookIDsFromInput(group.inputText).length}{editingPlatformId === group.platformId ? '（编辑中）' : ''}
          </Tag>
        ))}
      </div>
    ) : null}

    <div className="batch-factory-content-controls">
      <label className="shuihuo-form-label">内容范围<InputNumber min={1} max={500} value={contentRangeLines} onChange={value => setContentRangeLines(value || 5)} addonAfter="行" /></label>
      <label className="shuihuo-form-label">内容截取<Select value={contentCaptureCharacters} onChange={setContentCaptureCharacters} options={[1000, 2000, 4000, 8000, 12000, 20000, 50000, 100000].map(value => ({ value, label: `${value} 字` }))} /></label>
    </div>
  </Modal>
  <Modal
    title={automationDialogMode === 'scheduled' ? '开始定时' : '立即执行自动生产'}
    open={scheduleDialogOpen}
    onCancel={() => setScheduleDialogOpen(false)}
    confirmLoading={busy}
    okText={automationDialogMode === 'scheduled' ? '创建并定时执行' : '创建并立即执行'}
    cancelText="取消"
    onOk={() => submit({ scheduledRun: automationDialogMode === 'scheduled', automationRun: true })}
  >
    {automationDialogMode === 'scheduled' ? <><label className="shuihuo-form-label" htmlFor="batch-scheduled-at">自动启动时间（北京时间 UTC+8） <em>*</em></label>
    <Input id="batch-scheduled-at" type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} />
    <small>到点启动自动生产；生成、合成与上传按后续流程继续，不会在此时间直接提交。</small></> : <Alert type="info" showIcon message="创建完成后立即启动自动生产" description="不会直接提交；只有选择全自动模式且成片完成后，才会上传视频管理系统。" />}
    <label className="shuihuo-form-label">自动化预设 <em>*</em></label>
    <Select value={automationPresetID || undefined} onChange={setAutomationPresetID} placeholder="选择已保存预设" options={automationPresets.map(item => ({ value: item.id, label: `${item.name} · v${item.version}` }))} />
    <label className="shuihuo-form-label">执行模式</label>
    <Select value={automationRunMode} onChange={setAutomationRunMode} options={[{ value: 'storyboard_only', label: '只生成分镜' }, { value: 'video_no_submit', label: '生成视频不提交' }, { value: 'full_submit', label: '全自动生成并提交（成片完成后上传）' }]} />
    <label className="shuihuo-form-label">同时处理书籍</label>
    <Select value={automationConcurrency} onChange={value => setAutomationConcurrency(normalizeAutomationConcurrency(value))} options={[1, 2, 4].map(value => ({ value, label: `${value} 本并行` }))} />
  </Modal>
  <Modal title="定时任务" open={scheduleTasksOpen} onCancel={() => setScheduleTasksOpen(false)} footer={<Button onClick={() => setScheduleTasksOpen(false)}>关闭</Button>}>
    <Button loading={scheduleTasksLoading} onClick={openScheduleTasks}>刷新</Button>
    <div className="batch-factory-log-list">{scheduleTasks.length ? scheduleTasks.map(task => <section key={task.id}><strong>{task.title}</strong><span>{task.scheduledAt ? `北京时间 ${formatBeijingDatetimeLocal(task.scheduledAt)}` : '立即执行'} · {task.state}</span></section>) : <p>{scheduleTasksLoading ? '读取中…' : '暂无定时任务'}</p>}</div>
  </Modal></>;
}
