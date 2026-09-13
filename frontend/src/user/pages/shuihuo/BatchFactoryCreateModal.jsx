import { InputNumber, Modal, Select, Switch, Button, Input, message } from 'antd';
import { useEffect, useState } from 'react';
import { getWorkshopPlatforms } from '../../../shared/api/novelFetchWorkshop';
import { batchFactoryPlatformOptions } from './batchFactoryPlatformOptions';

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
  function reset() { setTitle(''); setInputText(''); setAutomatic(false); setScheduledAt(''); setContentRangeLines(5); }
  async function submit() {
    if (!hasSelectedPlatform) return message.warning(platformError || '请先选择小说获取书城');
    if (!title.trim()) return message.warning('请填写作品名称');
    if (!inputText.trim()) return message.warning('请粘贴小说列表');
    if (automatic && !scheduledAt) return message.warning('请选择定时执行时间');
    const scheduled = automatic ? new Date(scheduledAt) : null;
    if (automatic && Number.isNaN(scheduled.getTime())) return message.warning('定时执行时间无效');
    setBusy(true);
    try {
      await onCreated({ title: title.trim(), platformId, parseMode, columnPresetId, columnOrder, inputText, contentRangeLines, scheduledAt: scheduled ? scheduled.toISOString() : '' });
      reset();
    } catch (error) { message.error(error.message || '新建批量失败'); } finally { setBusy(false); }
  }
  return <Modal className="shuihuo-create-project-modal" title="新建批量" open={open} onCancel={() => { onCancel(); reset(); }} width={760} footer={<><Button onClick={() => { onCancel(); reset(); }}>取消</Button><Button type="primary" loading={busy} disabled={platformState !== 'ready' || !hasSelectedPlatform} onClick={submit}>确定创建</Button></>}>
    <label className="shuihuo-form-label" htmlFor="batch-title">作品名称 <em>*</em></label>
    <Input id="batch-title" value={title} onChange={event => setTitle(event.target.value)} placeholder="请输入作品名称" maxLength={255} />
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 16 }}>
      <label className="shuihuo-form-label">书城<Select value={platformId || undefined} onChange={setPlatformId} options={platformOptions} loading={platformState === 'loading'} disabled={platformState !== 'ready'} placeholder={platformState === 'loading' ? '正在读取小说获取书城' : '请选择书城'} notFoundContent={platformState === 'empty' ? '小说获取没有启用书城' : undefined} /></label>
      <label className="shuihuo-form-label">输入格式<Select value={parseMode} onChange={setParseMode} options={parseModes} /></label>
      <label className="shuihuo-form-label">列顺序预设<Select value={columnPresetId} onChange={setColumnPresetId} options={presets} /></label>
    </div>
    <label className="shuihuo-form-label" htmlFor="batch-column-order">自定义列顺序</label>
    <Input id="batch-column-order" value={columnOrder} onChange={event => setColumnOrder(event.target.value)} placeholder="书籍ID,书名,标签,推荐理由" />
    <label className="shuihuo-form-label" htmlFor="batch-input-text">小说列表 <em>*</em></label>
    <Input.TextArea id="batch-input-text" value={inputText} onChange={event => setInputText(event.target.value)} rows={9} placeholder={'每行一本小说，可粘贴 ID、书名、男女频、标签、理由、评级。\n示例：2080989285751305136\t重生书\t推荐理由\t女频\t重生,爽文\tS'} />
    <p className="shuihuo-modal-note">手动入口只保存小说列表和元数据；开始制作时才按书城与 bookId 获取完整原文。</p>
    <div className="shuihuo-create-collection"><strong>自动</strong><Switch size="small" checked={automatic} onChange={setAutomatic} /><span>在设定时间把本批小说标为待执行；新建时不会启动生成。</span></div>
    {automatic ? <><label className="shuihuo-form-label" htmlFor="batch-scheduled-at">定时执行时间 <em>*</em></label><Input id="batch-scheduled-at" type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} /></> : null}
    <label className="shuihuo-form-label">内容范围</label>
    <InputNumber min={1} max={500} value={contentRangeLines} onChange={value => setContentRangeLines(value || 5)} addonAfter="条有效正文" />
    <p className="shuihuo-modal-note">内容范围是每本书后续制作使用的前 N 条非空正文；完整原文不会被裁掉。</p>
    {platformState === 'error' ? <p className="shuihuo-modal-note">书城读取失败：{platformError}</p> : null}
  </Modal>;
}
