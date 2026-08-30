import { AppstoreOutlined, ClockCircleOutlined, CloseOutlined, DeleteOutlined, DownOutlined, FileTextOutlined, FolderOpenOutlined, PlusOutlined, SearchOutlined, UploadOutlined, UserOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Button, Input, Modal, Popconfirm, Select, Switch, Upload, message } from 'antd';
import { useMemo, useState } from 'react';
import { importProject } from '../../../shared/api/shuihuoProduction';

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

function formatTime(value) {
  if (!value) return '尚未开始制作';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '已创建' : date.toLocaleDateString('zh-CN');
}

export function ProjectsView({ projects, health, onCreate, onImported, onOpen, onDelete, onOpenBatchFactory }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [collection, setCollection] = useState('all');
  const [sortOrder, setSortOrder] = useState('desc');
  const [createCollection, setCreateCollection] = useState(false);
  const [name, setName] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [file, setFile] = useState(null);
  const [segmentationMode, setSegmentationMode] = useState('paragraph');
  const [busy, setBusy] = useState(false);

  const hasSource = Boolean(file || sourceText.trim());
  const smartReady = Boolean(health?.database?.ready && health?.enabledModelKinds?.includes('text'));

  function reset() {
    setName('');
    setSourceText('');
    setFile(null);
    setSegmentationMode('paragraph');
    setCreateCollection(false);
  }

  function selectSourceFile(nextFile) {
    setFile(nextFile);
    setSourceText('');
    return false;
  }

  function pasteSourceText() {
    setFile(null);
  }

  async function submit() {
    const normalizedName = name.trim();
    if (!normalizedName) { message.warning('请填写作品名称'); return; }
    if (!sourceText.trim() && !file) { message.warning('请粘贴原文或选择 TXT、SRT、DOCX 文件'); return; }
    setBusy(true);
    try {
      if (file) {
        const dataUrl = await readAsDataURL(file);
        const result = await importProject({ name: normalizedName, filename: file.name, dataUrl });
        await onImported(result, segmentationMode);
      } else {
        await onCreate({ name: normalizedName, sourceText: sourceText.trim(), segmentationMode });
      }
      setOpen(false);
      reset();
    } catch (error) {
      message.error(error.message || '创建项目失败');
    } finally {
      setBusy(false);
    }
  }

  const visibleProjects = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return [...(projects || [])]
      .filter(project => !keyword || project.name.toLocaleLowerCase().includes(keyword))
      .filter(() => collection === 'all')
      .sort((left, right) => {
        const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
        const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
        return sortOrder === 'desc' ? rightTime - leftTime : leftTime - rightTime;
      });
  }, [collection, projects, search, sortOrder]);

  function projectCount(project) {
    if (Number.isFinite(project.segmentCount)) return `${project.segmentCount} 个分镜`;
    return project.segmentationStatus === 'confirmed' ? '已确认分镜' : '待生成分镜';
  }

  return <section className="shuihuo-project-library">
    <div className="shuihuo-project-library-heading">
      <div className="shuihuo-project-library-title"><h1>漫剧解说</h1><p>管理和创建您的漫剧解说作品</p></div>
      <div className="shuihuo-create-actions"><Button className="shuihuo-create-project" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>创作漫剧</Button><Button className="shuihuo-create-batch" icon={<ThunderboltOutlined />} onClick={onOpenBatchFactory}>批量工厂</Button></div>
    </div>
    <div className="shuihuo-project-library-section-title"><UserOutlined /> <strong>个人作品</strong></div>
    <div className="shuihuo-project-library-toolbar">
      <Input className="shuihuo-project-search" prefix={<SearchOutlined />} value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索作品..." allowClear />
      <button className="shuihuo-project-filter" type="button" onClick={() => setCollection(collection === 'all' ? 'all' : 'all')}><span>{collection === 'all' ? '全部合集' : collection}</span><DownOutlined /></button>
      <button className="shuihuo-project-filter" type="button" onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}><ClockCircleOutlined /><span>{sortOrder === 'desc' ? '按时间降序' : '按时间升序'}</span><DownOutlined /></button>
      <Button className="shuihuo-project-view-toggle" type="text" icon={<AppstoreOutlined />} aria-label="网格视图" title="网格视图" />
    </div>
    <div className="shuihuo-project-grid">
      {visibleProjects.map(project => <article className="shuihuo-project-card" key={project.id}>
        <button type="button" className="shuihuo-project-card-open" onClick={() => onOpen(project)} aria-label={`打开${project.name}`}>
          <div className="shuihuo-project-card-cover"><span>{projectCount(project)}</span></div>
          <div className="shuihuo-project-card-meta"><strong>{project.name}</strong><span>{formatTime(project.updatedAt || project.createdAt)}</span></div>
        </button>
        <div className="shuihuo-project-card-actions"><Button type="text" icon={<FolderOpenOutlined />} onClick={() => onOpen(project)} aria-label={`打开工作台 ${project.name}`} /><Popconfirm title="删除项目？此操作不会撤销。" onConfirm={() => onDelete(project)}><Button type="text" danger icon={<DeleteOutlined />} aria-label={`删除${project.name}`} /></Popconfirm></div>
      </article>)}
      {!visibleProjects.length ? <div className="shuihuo-empty"><FileTextOutlined /><p>{projects?.length ? '没有匹配的作品' : '还没有项目'}</p><Button onClick={() => setOpen(true)}>从原文或字幕开始</Button></div> : null}
    </div>
    <Modal className="shuihuo-create-project-modal" title="新建漫剧" open={open} onCancel={() => { setOpen(false); reset(); }} footer={<><Button onClick={() => { setOpen(false); reset(); }}>取消</Button><Button type="primary" loading={busy} onClick={submit}>确定创建</Button></>} width={500}>
      <div className="shuihuo-create-collection"><strong>创建合集</strong><Switch size="small" checked={createCollection} onChange={setCreateCollection} /><span>开启后可继承新作品的人物/场景设定</span></div>
      <label className="shuihuo-form-label" htmlFor="shuihuo-project-name">作品名称 <em>*</em></label>
      <Input id="shuihuo-project-name" value={name} onChange={event => setName(event.target.value)} placeholder="请输入作品名称" maxLength={255} />
      <label className="shuihuo-form-label" htmlFor="shuihuo-project-source">字幕内容 <em>*</em></label>
      <div className={`shuihuo-source-composer${file || sourceText ? ' has-value' : ''}`}>
        {file ? <div className="shuihuo-source-file"><FileTextOutlined /><strong>{file.name}</strong><Button type="text" danger icon={<CloseOutlined />} aria-label="移除字幕文件" onClick={() => setFile(null)} /></div> : <Input.TextArea id="shuihuo-project-source" value={sourceText} onPaste={pasteSourceText} onChange={event => { setSourceText(event.target.value); if (event.target.value) setFile(null); }} rows={sourceText ? 5 : 4} placeholder="直接粘贴字幕内容" />}
        {!file ? <Upload accept=".txt,.srt,.docx,text/plain,application/x-subrip,application/vnd.openxmlformats-officedocument.wordprocessingml.document" showUploadList={false} maxCount={1} beforeUpload={selectSourceFile}><Button className="shuihuo-source-file-trigger" type="text" icon={<UploadOutlined />}>点击选择字幕文件 (SRT/TXT/DOCX)</Button></Upload> : null}
        {!file && !sourceText ? <span className="shuihuo-source-composer-hint">也可直接在此输入或粘贴内容</span> : null}
      </div>
      <p className="shuihuo-modal-note">文件与文本二选一；支持 TXT、SRT、DOCX，文件会保留原始内容并解析正文。</p>
      {hasSource ? <><label className="shuihuo-form-label" htmlFor="shuihuo-segmentation-mode">分段方式</label><Select id="shuihuo-segmentation-mode" value={segmentationMode} onChange={setSegmentationMode} options={[{ value: 'paragraph', label: '自动识别' }, { value: 'smart', label: '智能识别', disabled: !smartReady }]} /></> : null}
    </Modal>
  </section>;
}
