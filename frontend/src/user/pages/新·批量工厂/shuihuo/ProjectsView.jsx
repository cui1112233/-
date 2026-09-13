import { CloseOutlined, FileTextOutlined, FolderOpenOutlined, PlusOutlined, SearchOutlined, UploadOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Input, Modal, Upload, message } from 'antd';
import { useMemo, useState } from 'react';

function formatTime(value) {
  if (!value) return '尚未开始制作';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '已创建' : date.toLocaleDateString('zh-CN');
}

export function ProjectsView({ projects, loadError, onRefresh, onCreate, onOpen }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState('desc');
  const [name, setName] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setName('');
    setSourceText('');
    setFile(null);
  }

  function selectSourceFile(nextFile) {
    setFile(nextFile);
    setSourceText('');
    return false;
  }

  async function submit() {
    const normalizedName = name.trim();
    if (!normalizedName) { message.warning('请填写作品名称'); return; }
    if (!sourceText.trim() && !file) { message.warning('请粘贴小说原文或选择 TXT、MD 文件'); return; }
    setBusy(true);
    try {
      const importedText = file ? await file.text() : sourceText;
      if (!importedText.trim()) throw new Error('文件中没有可导入的正文内容');
      await onCreate({ name: normalizedName, sourceText: importedText, filename: file?.name || '' });
      setOpen(false);
      reset();
    } catch (error) {
      message.error(error.message || '创建批量工厂作品失败');
    } finally {
      setBusy(false);
    }
  }

  const visibleProjects = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return [...(projects || [])]
      .filter(project => !keyword || String(project.title || '').toLocaleLowerCase().includes(keyword))
      .sort((left, right) => {
        const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
        const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
        return sortOrder === 'desc' ? rightTime - leftTime : leftTime - rightTime;
      });
  }, [projects, search, sortOrder]);

  function projectCount(project) {
    const count = Array.isArray(project.books) ? project.books.length : 0;
    return `${count} 本小说`;
  }

  return <section className="shuihuo-project-library">
    <div className="shuihuo-project-library-heading">
      <div className="shuihuo-project-library-title"><h1>批量工厂</h1><p>管理和创建小说前贴作品；新建作品只保存原文，不会自动启动 AI 生产</p></div>
      <div className="shuihuo-create-actions"><Button className="shuihuo-create-project" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建作品</Button></div>
    </div>
    <div className="shuihuo-project-library-section-title"><UserOutlined /> <strong>作品文档</strong></div>
    <div className="shuihuo-project-library-toolbar">
      <Input className="shuihuo-project-search" prefix={<SearchOutlined />} value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索作品..." allowClear />
      <button className="shuihuo-project-filter" type="button" onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}><span>{sortOrder === 'desc' ? '按时间降序' : '按时间升序'}</span></button>
      <Button type="text" onClick={() => onRefresh?.()} aria-label="刷新作品列表">刷新</Button>
    </div>
    {loadError ? <Alert type="error" showIcon message="批量工厂作品列表读取失败" description={loadError} action={<Button size="small" onClick={() => onRefresh?.()}>重试</Button>} /> : null}
    <div className="shuihuo-project-grid">
      {visibleProjects.map(project => <article className="shuihuo-project-card" key={project.id}>
        <button type="button" className="shuihuo-project-card-open" onClick={() => onOpen(project)} aria-label={`打开${project.title || project.id}`}>
          <div className="shuihuo-project-card-cover"><span>{projectCount(project)}</span></div>
          <div className="shuihuo-project-card-meta"><strong>{project.title || project.id}</strong><span>{formatTime(project.updatedAt || project.createdAt)}</span></div>
        </button>
        <div className="shuihuo-project-card-actions"><Button type="text" icon={<FolderOpenOutlined />} onClick={() => onOpen(project)} aria-label={`打开工作台 ${project.title || project.id}`} /></div>
      </article>)}
      {!loadError && !visibleProjects.length ? <div className="shuihuo-empty"><FileTextOutlined /><p>{projects?.length ? '没有匹配的作品' : '还没有批量工厂作品'}</p><Button onClick={() => setOpen(true)}>从小说原文开始</Button></div> : null}
    </div>
    <Modal className="shuihuo-create-project-modal" title="新建批量工厂作品" open={open} onCancel={() => { setOpen(false); reset(); }} footer={<><Button onClick={() => { setOpen(false); reset(); }}>取消</Button><Button type="primary" loading={busy} onClick={submit}>创建作品</Button></>} width={500}>
      <label className="shuihuo-form-label" htmlFor="batch-factory-doc-name">作品文档名 <em>*</em></label>
      <Input id="batch-factory-doc-name" value={name} onChange={event => setName(event.target.value)} placeholder="请输入作品名称" maxLength={255} />
      <label className="shuihuo-form-label" htmlFor="batch-factory-source-text">小说原文 <em>*</em></label>
      <div className={`shuihuo-source-composer${file || sourceText ? ' has-value' : ''}`}>
        {file ? <div className="shuihuo-source-file"><FileTextOutlined /><strong>{file.name}</strong><Button type="text" danger icon={<CloseOutlined />} aria-label="移除原文文件" onClick={() => setFile(null)} /></div> : <Input.TextArea id="batch-factory-source-text" value={sourceText} onChange={event => { setSourceText(event.target.value); if (event.target.value) setFile(null); }} rows={sourceText ? 5 : 4} placeholder="直接粘贴小说原文" />}
        {!file ? <Upload accept=".txt,.md,text/plain,text/markdown" showUploadList={false} maxCount={1} beforeUpload={selectSourceFile}><Button className="shuihuo-source-file-trigger" type="text" icon={<UploadOutlined />}>选择 TXT / MD 文件</Button></Upload> : null}
        {!file && !sourceText ? <span className="shuihuo-source-composer-hint">支持粘贴原文或导入 TXT、MD 文件</span> : null}
      </div>
      <p className="shuihuo-modal-note">作品保存在批量工厂 V11；内容会保留为小说原文，不会自动生成剧本、图片、视频或上传。</p>
    </Modal>
  </section>;
}
