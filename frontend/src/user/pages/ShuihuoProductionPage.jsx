import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Spin, message } from 'antd';
import { CommentaryWorkbench } from './shuihuo/CommentaryWorkbench';
import { ProjectsView } from './shuihuo/ProjectsView';
import { AssetsView } from './shuihuo/AssetsView';
import { confirmSegmentation, createProject, deleteProject, getProductionHealth, getProject, listModels, listProjects, paragraphSegmentation, replaceProjectSource, smartSegmentation } from '../../shared/api/shuihuoProduction';
import './shuihuo-production.css';

const modelNames = { text: '文本模型', image: '图片模型', video: '视频模型', audio: '配音模型' };

function readinessItems(health) {
  const enabled = new Set(health?.enabledModelKinds || []);
  return [['数据库', health?.database], ['Redis', health?.redis], ['存储', health?.storage], ...Object.entries(modelNames).map(([kind, name]) => [name, { ready: enabled.has(kind), reason: enabled.has(kind) ? '' : `缺少已启用的${name}` }])];
}

export function ShuihuoProductionPage() {
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [importNotice, setImportNotice] = useState(null);
  const [view, setView] = useState('projects');
  const [loading, setLoading] = useState(true);
  const [assetsOpen, setAssetsOpen] = useState(false);
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
    document.body.classList.add('shuihuo-reference-shell');
    return () => {
      document.body.classList.remove('shuihuo-theme-active');
      document.body.classList.remove('shuihuo-reference-shell');
    };
  }, []);

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    try { const result = await listProjects(); setProjects(result.projects || []); } catch (error) { message.error(error.message || '读取项目库失败'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refreshProjects(); }, [refreshProjects]);
  useEffect(() => {
    let active = true;
    getProductionHealth().then(result => { if (active) { setHealth(result); setHealthError(''); } }).catch(error => { if (active) setHealthError(error.message || '无法读取运行依赖状态'); });
    return () => { active = false; };
  }, []);

  const openProject = useCallback(async project => {
    try { setActiveProject(await getProject(project.id)); setView('studio'); } catch (error) { message.error(error.message || '读取项目工作台失败'); }
  }, []);

  async function segmentAndOpenProject(readModel, segmentationMode) {
    const projectId = readModel?.project?.id;
    if (!projectId) throw new Error('项目创建后无法读取原文');

    let candidates;
    if (segmentationMode === 'smart') {
      const modelResult = await listModels();
      const textModels = modelResult.models || [];
      const textModel = textModels.find(model => model.kind === 'text');
      if (!textModel) throw new Error('当前没有可用的文本分析模型，请联系管理员配置后重试');
      const result = await smartSegmentation(projectId, { modelId: textModel.id });
      candidates = result.candidates || [];
    } else {
      const result = await paragraphSegmentation(projectId, {});
      candidates = result.candidates || [];
    }

    if (!candidates.length) throw new Error('未识别到可导入的文本段落');
    const confirmed = await confirmSegmentation(projectId, candidates);
    setActiveProject(confirmed?.project ? confirmed : await getProject(projectId));
    setImportNotice(candidates.length);
    setView('studio');
    message.success(`成功导入 ${candidates.length} 条文本`);
  }

  async function handleCreate({ name, sourceText, segmentationMode }) {
    const created = await createProject({ name });
    let readModel;
    try {
      readModel = sourceText ? await replaceProjectSource(created.id, { sourceText }) : await getProject(created.id);
    } catch (error) {
      const sourceError = error.message || '保存原文失败';
      try {
        await deleteProject(created.id);
      } catch (_) {
        await refreshProjects();
        throw new Error(`${sourceError}。项目已创建，但自动清理失败，请在项目库手动删除“${name}”。`);
      }
      await refreshProjects();
      throw new Error(`${sourceError}。已自动删除未保存原文的项目。`);
    }
    try {
      await segmentAndOpenProject(readModel, segmentationMode);
    } finally {
      await refreshProjects();
    }
  }
  async function handleImported(readModel, segmentationMode) {
    try {
      await segmentAndOpenProject(readModel, segmentationMode);
    } finally {
      await refreshProjects();
    }
  }
  async function handleDelete(project) {
    // A delayed project read must not restore an item after it has been deleted.
    projectRequestRef.current += 1;
    try {
      await deleteProject(project.id);
      if (activeProject?.project?.id === project.id) { setActiveProject(null); setView('projects'); }
      await refreshProjects();
      message.success('项目已删除');
    } catch (error) { message.error(error.message || '删除项目失败'); }
  }
  function applyReadModel(readModel) { setActiveProject(readModel); }
  async function refreshActive() {
    if (!activeProject?.project?.id) return;
    try { setActiveProject(await getProject(activeProject.project.id)); } catch (error) { message.error(error.message || '刷新项目失败'); }
  }

  return <div className={`shuihuo-production ${view === 'studio' ? 'is-workbench' : ''}`}>
    {view !== 'projects' && health ? <div className="shuihuo-readiness-strip" role="status" aria-live="polite"><strong className="shuihuo-readiness-title">运行依赖</strong>{readinessItems(health).map(([name, dependency]) => <span className={dependency?.ready ? 'ready' : 'missing'} key={name} title={dependency?.reason || `${name}已配置`}>{name}：{dependency?.ready ? '已配置' : '未配置'}{dependency?.ready || !dependency?.reason ? '' : `（${dependency.reason}）`}</span>)}</div> : null}
    {view !== 'projects' && healthError ? <div className="shuihuo-readiness-strip" role="status" aria-live="polite"><span className="missing">状态读取失败：{healthError}</span></div> : null}
    {loading && view === 'projects' ? <div className="shuihuo-loading"><Spin /></div> : null}
    {!loading && view === 'projects' ? <ProjectsView projects={projects} health={health} onCreate={handleCreate} onImported={handleImported} onOpen={openProject} onDelete={handleDelete} /> : null}
    {view === 'studio' && activeProject ? <CommentaryWorkbench data={activeProject} readiness={health} importNotice={importNotice} onBackToProjects={() => { setImportNotice(null); setView('projects'); refreshProjects(); }} onOpenAssets={() => setAssetsOpen(true)} onDataChange={applyReadModel} /> : null}
    <Modal title="人物场景预设" open={assetsOpen} onCancel={() => setAssetsOpen(false)} footer={null} width="min(1360px, calc(100vw - 48px))" className="shuihuo-assets-modal" destroyOnClose={false}>
      {activeProject ? <AssetsView data={activeProject} onRefresh={refreshActive} embedded /> : null}
    </Modal>
  </div>;
}

export default ShuihuoProductionPage;
