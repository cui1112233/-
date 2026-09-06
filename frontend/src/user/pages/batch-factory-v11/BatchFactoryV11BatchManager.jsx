import { Alert, Button, Checkbox, Drawer, Empty, Input, List, Select, Space, Tabs, Tag, Typography, message } from 'antd';
import { Archive, FileText, FolderPlus, RotateCcw, Upload, WandSparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { listAgentSkills } from '../../../shared/api/agent.js';
import { canImportFile, normalizeImportedFile, normalizeSkillIds, parsePastedContent } from './manualContentImport.js';

function resultError(result, fallback) {
  return result?.message || result?.raw?.error || fallback;
}

function batchCount(batch) {
  return Number(batch?.count ?? batch?.books?.length ?? 0);
}

export function BatchFactoryV11BatchManager({
  open,
  initialTab = 'new',
  onClose,
  batches = [],
  intake = null,
  onPreviewManualSkillProcessing,
  onCreateManualIntake,
  onManualIntakeCreated,
  onOpenBatch
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [manualText, setManualText] = useState('');
  const [items, setItems] = useState([]);
  const [previewItems, setPreviewItems] = useState([]);
  const [skillOptions, setSkillOptions] = useState([]);
  const [skillIds, setSkillIds] = useState([]);
  const [recognitionEnabled, setRecognitionEnabled] = useState(false);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setActiveTab(initialTab);
    let cancelled = false;
    setLoadingSkills(true);
    listAgentSkills()
      .then(result => {
        if (!cancelled) setSkillOptions(Array.isArray(result?.skills) ? result.skills : []);
      })
      .catch(loadError => {
        if (!cancelled) setError(loadError?.message || '读取可用技能失败');
      })
      .finally(() => {
        if (!cancelled) setLoadingSkills(false);
      });
    return () => { cancelled = true; };
  }, [open, initialTab]);

  function appendItems(nextItems) {
    setItems(current => [...current, ...nextItems].map((item, index) => ({
      ...item,
      title: item.title || `手动导入 ${String(index + 1).padStart(2, '0')}`
    })));
    setPreviewItems([]);
    setError('');
  }

  function addPastedContent() {
    try {
      appendItems(parsePastedContent(manualText));
      setManualText('');
    } catch (parseError) {
      setError(parseError.message || '请输入有效内容');
    }
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!canImportFile(file)) {
      setError('只支持 TXT 或 MD 文件');
      return;
    }
    try {
      appendItems([normalizeImportedFile(file.name, await file.text())]);
    } catch (fileError) {
      setError(fileError.message || '文件读取失败');
    }
  }

  async function processContent() {
    if (!items.length || processing) return;
    setProcessing(true);
    setError('');
    try {
      const result = await onPreviewManualSkillProcessing({ items, skillIds: normalizeSkillIds(skillIds) });
      if (!result?.ok) throw new Error(resultError(result, '技能处理预览失败'));
      const nextItems = result.raw?.items || [];
      setPreviewItems(nextItems);
      if (result.raw?.allSucceeded === false) setError('部分内容处理失败，可单独重试失败项。');
    } catch (processError) {
      setError(processError.message || '技能处理预览失败');
      setPreviewItems([]);
    } finally {
      setProcessing(false);
    }
  }

  async function retryItem(item) {
    setProcessing(true);
    setError('');
    try {
      const source = items[item.index] || { title: item.title, sourceText: item.originalText, txtFileName: item.txtFileName };
      const result = await onPreviewManualSkillProcessing({ items: [source], skillIds: normalizeSkillIds(skillIds) });
      if (!result?.ok || !result.raw?.items?.[0]) throw new Error(resultError(result, '重试失败'));
      const retried = { ...result.raw.items[0], index: item.index };
      setPreviewItems(current => current.map(candidate => candidate.index === item.index ? retried : candidate));
    } catch (retryError) {
      setError(retryError.message || '重试失败');
    } finally {
      setProcessing(false);
    }
  }

  async function confirmImport() {
    if (!previewItems.length || previewItems.some(item => item.status !== 'ready') || confirming) return;
    setConfirming(true);
    setError('');
    try {
      const selectedSkillIds = normalizeSkillIds(skillIds);
      const selectedSkills = skillOptions
        .filter(skill => selectedSkillIds.includes(skill.id))
        .map(skill => ({ id: skill.id, version: skill.version, name: skill.name }));
      const books = previewItems.map(item => ({
        title: item.title,
        sourceText: item.processedText,
        txtText: item.processedText,
        txtFileName: item.txtFileName || `${item.title || 'manual'}.txt`,
        sourceMetadata: {
          ...(item.sourceMetadata || {}),
          sourceType: 'manual',
          originalText: item.originalText,
          processedText: item.processedText,
          skillRuns: item.skillRuns || []
        }
      }));
      const result = await onCreateManualIntake({
        items: books,
        metadata: { sourceType: 'manual', manualMetadataRecognitionEnabled: recognitionEnabled, skillIds: selectedSkillIds, skills: selectedSkills }
      });
      if (!result?.ok) throw new Error(resultError(result, '直接导入失败'));
      const intakeId = result.raw?.intake?.id || result.raw?.id || '';
      if (!intakeId) throw new Error('服务器未返回导入记录编号');
      message.success(`已创建 ${books.length} 条真实导入记录，等待明确创建批次`);
      onManualIntakeCreated?.(intakeId);
    } catch (confirmError) {
      setError(confirmError.message || '直接导入失败');
    } finally {
      setConfirming(false);
    }
  }

  const preview = previewItems.length ? previewItems : items.map((item, index) => ({
    index,
    title: item.title,
    originalText: item.sourceText,
    processedText: '',
    status: 'pending',
    skillRuns: []
  }));

  const newBatch = <div className="bf11-batch-manager-pane">
    {intake ? <Alert
      type="success"
      showIcon
      message="已接收小说获取任务"
      description="小说获取转入的内容会保留来源任务、小说 ID、平台、文本文件和来源元数据；你需要明确点击创建批次。"
    /> : null}

    <section className="bf11-batch-intake-card">
      <div>
        <Typography.Text strong>直接导入内容</Typography.Text>
      <Typography.Text type="secondary">粘贴一篇或多篇正文，或选择 TXT / MD 文件；内容会先经过选定技能处理，再进入正式导入记录。</Typography.Text>
      </div>
      <Tag color="blue">最多选择 3 个技能</Tag>
    </section>

    <section className="bf11-fallback-import">
      <Typography.Text strong>手动粘贴</Typography.Text>
      <Input.TextArea
        rows={7}
        value={manualText}
        onChange={event => setManualText(event.target.value)}
        placeholder="粘贴小说正文；多篇之间单独一行写 --- 分隔。"
      />
      <Space wrap>
        <Button icon={<FileText size={14} />} onClick={addPastedContent}>加入内容</Button>
        <Button icon={<Upload size={14} />} onClick={() => fileInputRef.current?.click()}>上传 TXT / MD</Button>
        <input ref={fileInputRef} type="file" accept=".txt,.md,text/plain,text/markdown" onChange={handleFileChange} style={{ display: 'none' }} />
      </Space>
      <Select
        mode="multiple"
        allowClear
        maxTagCount={3}
        loading={loadingSkills}
        value={skillIds}
        onChange={value => setSkillIds(normalizeSkillIds(value))}
        options={skillOptions.map(skill => ({ value: skill.id, label: `${skill.name} v${skill.version}` }))}
        placeholder="选择 0-3 个现有技能（可选）"
        style={{ width: '100%' }}
      />
      <Checkbox checked={recognitionEnabled} onChange={event => setRecognitionEnabled(event.target.checked)}>
        启用元数据识别（识别性别和类型；关闭时保留“未识别”）
      </Checkbox>
      <Space wrap>
        <Button type="primary" icon={<WandSparkles size={14} />} disabled={!items.length} loading={processing} onClick={processContent}>执行技能并预览</Button>
        <Typography.Text type="secondary">已加入 {items.length} 条</Typography.Text>
      </Space>
    </section>

    {error ? <Alert type="warning" showIcon message={error} /> : null}

    {preview.length ? <section className="bf11-batch-intake-card">
      <Typography.Text strong>处理预览</Typography.Text>
      <List
        dataSource={preview}
        renderItem={item => <List.Item
          actions={[
            item.status === 'failed' ? <Button key="retry" size="small" icon={<RotateCcw size={13} />} loading={processing} onClick={() => retryItem(item)}>重试</Button> : null,
            <Tag key="status" color={item.status === 'ready' ? 'green' : item.status === 'failed' ? 'red' : 'default'}>{item.status === 'ready' ? '已处理' : item.status === 'failed' ? '失败' : '待处理'}</Tag>
          ].filter(Boolean)}
        >
          <List.Item.Meta
            title={<Typography.Text strong>{item.title}</Typography.Text>}
            description={<Space direction="vertical" style={{ width: '100%' }}>
              <Typography.Text type="secondary">原文：{String(item.originalText || '').slice(0, 120)}{String(item.originalText || '').length > 120 ? '…' : ''}</Typography.Text>
              {item.status === 'ready' ? <Typography.Text>处理后：{String(item.processedText || '').slice(0, 160)}{String(item.processedText || '').length > 160 ? '…' : ''}</Typography.Text> : null}
              {item.error ? <Typography.Text type="danger">{item.error}</Typography.Text> : null}
            </Space>}
          />
        </List.Item>}
      />
      <Button type="primary" block disabled={!previewItems.length || previewItems.some(item => item.status !== 'ready')} loading={confirming} onClick={confirmImport}>确认导入并创建 V11 批次</Button>
    </section> : null}

  </div>;

  const history = <div className="bf11-batch-manager-pane">
    <div className="bf11-batch-manager-heading">
      <div>
        <Typography.Text strong>历史批次</Typography.Text>
      <Typography.Text type="secondary">这里读取服务端返回的真实批次，不展示示例数据。</Typography.Text>
      </div>
      <Tag>{batches.length} 个批次</Tag>
    </div>
    <List
      dataSource={batches}
      locale={{ emptyText: <Empty description="暂无历史批次" /> }}
      renderItem={item => <List.Item actions={[<Button key="open" size="small" onClick={() => onOpenBatch?.(item.id)}>打开</Button>]}> 
        <List.Item.Meta
          avatar={<Archive size={18} />}
          title={<Space wrap><Typography.Text strong>{item.title || item.id}</Typography.Text><Tag>{batchCount(item)} 本</Tag></Space>}
          description={`服务端记录 · ${item.id}`}
        />
      </List.Item>}
    />
  </div>;

  return <Drawer
    title={<Space><FolderPlus size={18} /><span>批次管理</span></Space>}
    width={760}
    open={open}
    onClose={onClose}
  >
    <Tabs
      activeKey={activeTab}
      onChange={setActiveTab}
      items={[
        { key: 'new', label: '直接导入内容', children: newBatch },
        { key: 'history', label: '历史批次', children: history }
      ]}
    />
  </Drawer>;
}

export default BatchFactoryV11BatchManager;
