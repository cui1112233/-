import { Alert, Button, Input, InputNumber, Modal, Select, Space, Tag, message } from 'antd';
import { useEffect, useState } from 'react';
import { getWorkshopPlatforms } from '../../../shared/api/novelFetchWorkshop';
import { fetchDirectOriginals, getBatchAutomationStatus, listAutomationPresets, listBatches } from '../../../shared/api/batchFactoryV11';
import { batchFactoryPlatformOptions } from './batchFactoryPlatformOptions';
import { buildManualBatchSubmission, manualBookIDsFromInput, removePlatformGroup, replacePlatformGroup, totalGroupBookCount, upsertPlatformGroup } from './batchFactoryManualFetch';
import { formatBeijingDatetimeLocal, normalizeAutomationConcurrency, parseBeijingDatetimeLocal } from './batchFactoryAutomationSchedule';

// 输入格式与列顺序固定为默认值（智能识别 + 完整元数据列），AI 会自动分析男女频/风格，无需用户手选
const DEFAULT_PARSE_MODE = 'smart';
const DEFAULT_COLUMN_PRESET_ID = 'full_metadata';
const DEFAULT_COLUMN_ORDER = '书籍ID,书名,男女频,风格,标签,推荐理由,评级';

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

  function reset() {
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

  function validateDraft() {
    if (!title.trim()) return message.warning('请填写作品名称');
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
          onChange={value => {
            if (editingPlatformId && value !== editingPlatformId) {
              message.warning('请先完成当前修改：点“添加书城”保存，或点当前标签的 × 放弃');
              return;
            }
            setPlatformId(value);
          }}
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

    <label className="shuihuo-form-label" htmlFor="batch-input-text">小说列表 <em>*</em></label>
    <Input.TextArea
      id="batch-input-text"
      value={inputText}
      onChange={event => setInputText(event.target.value)}
      rows={9}
      placeholder={'每行一本小说，可粘贴 ID、书名、男女频、风格、标签、推荐理由、评级。\n示例：2080989285751305136\t重生书\t女频\t现代爽文\t重生,逆袭\t女主逆袭\tS'}
    />

    <div className="batch-factory-create-toolbar">
      <Button type="primary" onClick={handleAddPlatformGroup}>{editingPlatformId ? '保存书城修改' : '添加书城'}</Button>
      <Button type="primary" loading={busy} onClick={() => openAutomationDialog('immediate')}>立即执行</Button>
      <Button onClick={() => openAutomationDialog('scheduled')}>开始定时</Button>
      <Button onClick={openScheduleTasks}>定时任务</Button>
    </div>
    {groups.length ? (
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
