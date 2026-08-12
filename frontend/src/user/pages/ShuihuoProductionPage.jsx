import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Select, Spin, message } from 'antd';
import { Link } from '../../shared/components/Link';
import { createProject, deleteProject, getProductionHealth, getProject, listProjects } from '../../shared/api/shuihuoProduction';
import { ProjectsView } from './shuihuo/ProjectsView';
import { StudioView } from './shuihuo/StudioView';
import { AssetsView } from './shuihuo/AssetsView';
import './shuihuo-production.css';

const viewNames = { projects: '作品列表', studio: '分段生产台', assets: '人物场景预设' };
const modelNames = { text: '文本模型', image: '图片模型', video: '视频模型' };

function readinessItems(health) {
  const enabled = new Set(health?.enabledModelKinds || []);
  return [
    ['Redis', health?.redis],
    ['存储', health?.storage],
    ...Object.entries(modelNames).map(([kind, name]) => [name, { ready: enabled.has(kind), reason: enabled.has(kind) ? '' : `缺少已启用的${name}` }])
  ];
}

export function ShuihuoProductionPage() {
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [view, setView] = useState('projects');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');

  useEffect(() => {
    document.body.classList.add('shuihuo-theme-active');
    return () => document.body.classList.remove('shuihuo-theme-active');
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listProjects();
      setProjects(data.projects || []);
    } catch (error) {
      message.error(error.message || '读取作品失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    let active = true;
    getProductionHealth().then(result => {
      if (active) { setHealth(result); setHealthError(''); }
    }).catch(error => {
      if (active) setHealthError(error.message || '无法读取运行依赖状态');
    });
    return () => { active = false; };
  }, []);

  async function openProject(project, nextView = 'studio') {
    try {
      const data = await getProject(project.id);
      setActiveProject(data);
      setView(nextView);
    } catch (error) {
      message.error(error.message || '读取作品失败');
    }
  }

  async function handleCreate() {
    if (!name.trim()) { message.warning('请填写作品名称'); return; }
    setCreating(true);
    try {
      const created = await createProject({ name: name.trim(), sourceText });
      setCreateOpen(false);
      setName('');
      setSourceText('');
      await refresh();
      await openProject(created, 'studio');
    } catch (error) {
      message.error(error.message || '创建作品失败');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(project) {
    try {
      await deleteProject(project.id);
      if (activeProject?.project?.id === project.id) {
        setActiveProject(null);
        setView('projects');
      }
      await refresh();
      message.success('作品已删除');
    } catch (error) {
      message.error(error.message || '删除作品失败');
    }
  }

  const project = activeProject?.project;
  const projectSummary = useMemo(() => {
    if (!project) return '等待创建作品';
    return `${activeProject.segments?.length || 0} 个分段 · ${activeProject.assets?.length || 0} 个资产`;
  }, [activeProject, project]);

  return <div className="shuihuo-production">
    <aside className="shuihuo-sidebar">
      <div className="shuihuo-brand"><span>水货生产</span><small>小说可视化工作台</small></div>
      <button className="shuihuo-project-switch" type="button" onClick={() => setView('projects')}>
        <span>当前作品</span><strong>{project?.name || '暂无作品'}</strong>
      </button>
      <div className="shuihuo-side-label">制作流程</div>
      <nav className="shuihuo-side-nav">
        <button className={view === 'projects' ? 'active' : ''} type="button" onClick={() => setView('projects')}><span>▦</span>作品列表</button>
        <button className={view === 'studio' ? 'active' : ''} type="button" disabled={!project} onClick={() => setView('studio')}><span>▤</span>分段生产台</button>
        <button className={view === 'assets' ? 'active' : ''} type="button" disabled={!project} onClick={() => setView('assets')}><span>♧</span>人物场景预设</button>
      </nav>
      <div className="shuihuo-sidebar-footer"><strong>{projectSummary}</strong><span>项目隔离 · 后端保存</span></div>
    </aside>
    <main className="shuihuo-main">
      <header className="shuihuo-topbar"><div><div className="shuihuo-breadcrumb"><Link href="/">一战晟铭</Link> / {viewNames[view]}</div><h1>{view === 'projects' ? '小说视频工坊' : project?.name || '水货生产'}</h1></div><span className="shuihuo-status">后端工作流</span></header>
      <div className="shuihuo-readiness-strip" role="status" aria-live="polite">
        <span className="shuihuo-readiness-title">生产依赖</span>
        {readinessItems(health).map(([name, dependency]) => <span className={dependency?.ready ? 'ready' : 'missing'} key={name}>{name}：{dependency?.ready ? '已就绪' : dependency?.reason || '检测中'}</span>)}
        {healthError ? <span className="missing">状态读取失败：{healthError}</span> : null}
      </div>
      {loading && view === 'projects' ? <div className="shuihuo-loading"><Spin /></div> : null}
      {!loading && view === 'projects' ? <ProjectsView projects={projects} onCreate={() => setCreateOpen(true)} onOpen={openProject} onDelete={handleDelete} /> : null}
      {view === 'studio' && project ? <StudioView data={activeProject} readiness={health} onRefresh={() => openProject(project)} onAssets={() => setView('assets')} /> : null}
      {view === 'assets' && project ? <AssetsView data={activeProject} onRefresh={() => openProject(project, 'assets')} /> : null}
    </main>
    <Modal title="创建作品" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={handleCreate} okText="创建并进入生产台" confirmLoading={creating} width={720}>
      <label className="shuihuo-form-label" htmlFor="shuihuo-name">作品名称</label>
      <Input id="shuihuo-name" value={name} onChange={event => setName(event.target.value)} placeholder="例如：雨夜车站" maxLength={255} />
      <label className="shuihuo-form-label" htmlFor="shuihuo-source">小说原文或已分段文本</label>
      <Input.TextArea id="shuihuo-source" value={sourceText} onChange={event => setSourceText(event.target.value)} placeholder="上传文件接口将在对象存储接入后开放；此处可先粘贴文本。创建不会自动分析人物或生成提示词。" rows={12} />
    </Modal>
  </div>;
}

export default ShuihuoProductionPage;
