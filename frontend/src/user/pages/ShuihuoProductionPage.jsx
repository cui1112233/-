import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, Select, Spin, message } from 'antd';
import { Link } from '../../shared/components/Link';
import { createProject, deleteProject, getProductionHealth, getProject, listProjects } from '../../shared/api/shuihuoProduction';
import { ProjectsView } from './shuihuo/ProjectsView';
import { ProjectFilesModal } from './shuihuo/ProjectFilesModal';
import { CreateProjectModal } from './shuihuo/CreateProjectModal';
import { StudioView } from './shuihuo/StudioView';
import { ProductionGuide } from './shuihuo/ProductionGuide';
import { AssetsView } from './shuihuo/AssetsView';
import { dispatchPetContext } from '../../shared/pet/stacky';
import './shuihuo-production.css';

const viewNames = { projects: '作品列表', guide: '生产向导', studio: '分段生产台', assets: '人物场景预设' };
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
  const [filesProject, setFilesProject] = useState(null);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');
  const mountedRef = useRef(true);
  const projectRequestRef = useRef(0);
  const refreshRequestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      projectRequestRef.current += 1;
      refreshRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    document.body.classList.add('shuihuo-theme-active');
    return () => document.body.classList.remove('shuihuo-theme-active');
  }, []);

  useEffect(() => {
    const projectId = new URLSearchParams(window.location.search).get('project');
    if (!projectId) return;
    openProject({ id: projectId });
  }, []);

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestRef.current;
    setLoading(true);
    try {
      const data = await listProjects();
      if (!mountedRef.current || refreshRequestRef.current !== requestId) return null;
      setProjects(data.projects || []);
    } catch (error) {
      if (!mountedRef.current || refreshRequestRef.current !== requestId) return null;
      message.error(error.message || '读取作品失败');
    } finally {
      if (mountedRef.current && refreshRequestRef.current === requestId) setLoading(false);
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

  async function openProject(project, nextView = 'guide') {
    if (!project?.id) return;
    const requestId = ++projectRequestRef.current;
    try {
      const data = await getProject(project.id);
      if (!mountedRef.current || projectRequestRef.current !== requestId) return;
      setActiveProject(data);
      setView(nextView);
    } catch (error) {
      if (!mountedRef.current || projectRequestRef.current !== requestId) return;
      message.error(error.message || '读取作品失败');
    }
  }

  async function handleCreate({ name, sourceText, dialogueMode }) {
    setCreating(true);
    try {
      const created = await createProject({ name, sourceText, dialogueMode });
      setCreateOpen(false);
      await refresh();
      await openProject(created, 'guide');
    } catch (error) {
      message.error(error.message || '创建作品失败');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(project) {
    // A delayed project read must not restore an item after it has been deleted.
    projectRequestRef.current += 1;
    try {
      await deleteProject(project.id);
      if (activeProject?.project?.id === project.id) {
        setActiveProject(null);
        setView('projects');
      }
      if (filesProject?.id === project.id) setFilesProject(null);
      await refresh();
      message.success('作品已删除');
    } catch (error) {
      message.error(error.message || '删除作品失败');
    }
  }

  const project = activeProject?.project;
  useEffect(() => {
    const segments = Array.isArray(activeProject?.segments) ? activeProject.segments : [];
    const assets = Array.isArray(activeProject?.assets) ? activeProject.assets : [];
    const tasks = Array.isArray(activeProject?.tasks) ? activeProject.tasks : [];
    const taskStatus = tasks.length
      ? `任务 ${tasks.filter(task => task?.status === 'completed' || task?.status === 'done').length}/${tasks.length} 已完成`
      : '暂无任务';
    const projectName = String(project?.name || '').trim().slice(0, 120);
    const actionsByView = {
      projects: ['检查作品列表', '创建或打开作品'],
      guide: ['检查生产向导进度', '继续完成下一步'],
      studio: ['检查分段生产进度', '继续编辑当前分段'],
      assets: ['检查人物场景预设', '继续编辑当前项目']
    };
    dispatchPetContext({
      page: '水货生产',
      pagePath: '/shuihuo-production',
      summary: `当前项目：${projectName || '未选择'}；已确认分段 ${segments.length} 个；资产 ${assets.length} 个；${taskStatus}；当前视图：${viewNames[view] || view}`,
      entities: {
        projectId: project?.id || '',
        projectName,
        segmentCount: segments.length,
        assetCount: assets.length,
        view
      },
      actions: actionsByView[view] || ['检查当前项目']
    });
  }, [project, activeProject, view, projects]);

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
        <button className={view === 'guide' ? 'active' : ''} type="button" disabled={!project} onClick={() => setView('guide')}><span>◉</span>生产向导</button>
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
      {!loading && view === 'projects' ? <ProjectsView projects={projects} onCreate={() => setCreateOpen(true)} onOpen={openProject} onDelete={handleDelete} onFiles={setFilesProject} /> : null}
      {view === 'guide' && project ? <ProductionGuide data={activeProject} onOpenAssets={() => setView('assets')} onOpenStudio={() => setView('studio')} /> : null}
      {view === 'studio' && project ? <StudioView data={activeProject} readiness={health} onRefresh={() => openProject(project)} onAssets={() => setView('assets')} /> : null}
      {view === 'assets' && project ? <AssetsView data={activeProject} onRefresh={() => openProject(project, 'assets')} /> : null}
    </main>
    <ProjectFilesModal open={Boolean(filesProject)} project={filesProject} onClose={() => setFilesProject(null)} />
    <CreateProjectModal
      open={createOpen}
      loading={creating}
      onClose={() => setCreateOpen(false)}
      onCreate={handleCreate}
    />
  </div>;
}

export default ShuihuoProductionPage;
