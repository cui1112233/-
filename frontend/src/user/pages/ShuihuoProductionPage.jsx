import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Spin, message } from 'antd';
import { CommentaryWorkbench } from './shuihuo/CommentaryWorkbench';
import { BatchFactoryNovelList } from './shuihuo/BatchFactoryNovelList';
import { batchFactoryBatchFromResponse, batchFactoryCoverFrom, batchFactoryProjectsFrom, isBatchFactoryV11Project } from './shuihuo/batchFactoryProjects';
import { batchFactoryMergeCoverFrom } from './shuihuo/batchFactoryMergeCover';
import { ProjectsView } from './shuihuo/ProjectsView';
import { AssetsView } from './shuihuo/AssetsView';
import { confirmSegmentation, createProject, deleteProject, getProductionHealth, getProject, listModels, listProjects, paragraphSegmentation, replaceProjectSource, smartSegmentation } from '../../shared/api/shuihuoProduction';
import { appendNovelFetchIntake, classifyFetchedBatchMetadata, createBatchFromIntake, createManualIntake, deleteBatchFactoryProject, getBatch, getIntake, getMergeStatus, getProductionStatus, listBatches, startBatchAutomation } from '../../shared/api/batchFactoryV11';
import { BATCH_FACTORY_ACTIVE_BATCH_STORAGE_KEY, novelFetchIntakeBooks, pendingNovelFetchIntakeId } from './shuihuo/batchFactoryNovelFetchHandoff';
import './shuihuo-production.css';

const modelNames = { text: '文本模型', image: '图片模型', video: '视频模型', audio: '配音模型' };

function readinessItems(health) {
  const enabled = new Set(health?.enabledModelKinds || []);
  return [['数据库', health?.database], ['Redis', health?.redis], ['存储', health?.storage], ...Object.entries(modelNames).map(([kind, name]) => [name, { ready: enabled.has(kind), reason: enabled.has(kind) ? '' : `缺少已启用的${name}` }])];
}

export function ShuihuoProductionPage({ openBatchOnLoad = false }) {
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [activeBatchProject, setActiveBatchProject] = useState(null);
  const [importNotice, setImportNotice] = useState(null);
  const [view, setView] = useState('projects');
  const [loading, setLoading] = useState(true);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');
  const mountedRef = useRef(true);
  const projectRequestRef = useRef(0);
  const refreshRequestRef = useRef(0);
  const novelFetchHandoffRef = useRef('');

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
    try {
      const [water, batch] = await Promise.allSettled([
        listProjects({ silent: true }),
        listBatches()
      ]);

      const waterProjects =
        water.status === 'fulfilled'
          ? (Array.isArray(water.value?.projects)
              ? water.value.projects
              : Array.isArray(water.value?.data?.projects)
                ? water.value.data.projects
                : [])
          : [];

      const batchPayload =
        batch.status === 'fulfilled' ? batch.value : null;

      const batches =
        Array.isArray(batchPayload) ? batchPayload :
        Array.isArray(batchPayload?.batches) ? batchPayload.batches :
        Array.isArray(batchPayload?.items) ? batchPayload.items :
        Array.isArray(batchPayload?.data?.batches) ? batchPayload.data.batches :
        Array.isArray(batchPayload?.data?.items) ? batchPayload.data.items :
        [];

      const batchProjects = batchFactoryProjectsFrom(batches);

      if (batch.status === 'rejected') {
        console.error('[共享作品库] 批量工厂读取失败', batch.reason);
        message.error(
          `批量工厂工程读取失败：${batch.reason?.message || '接口请求失败'}`
        );
      }

      if (water.status === 'rejected') {
        console.error('[共享作品库] 漫剧作品读取失败', water.reason);
      }

      if (water.status === 'rejected' && batch.status === 'rejected') {
        throw batch.reason || water.reason;
      }

      setProjects([...waterProjects, ...batchProjects]);
      const coveredProjects = await Promise.all(batchProjects.map(async project => {
        const [productionStatus, mergeStatus] = await Promise.all([
          getProductionStatus(project.batchId, { silent: true }).catch(() => null),
          getMergeStatus(project.batchId, { silent: true }).catch(() => null)
        ]);
        const productionCover = batchFactoryCoverFrom(project.batch, productionStatus);
        const mergeCover = batchFactoryMergeCoverFrom(project.batch, mergeStatus);
        return { ...project, coverMedia: productionCover || mergeCover };
      }));
      if (mountedRef.current) setProjects([...waterProjects, ...coveredProjects]);
    } catch (error) { message.error(error.message || '读取项目库失败'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refreshProjects(); }, [refreshProjects]);
  useEffect(() => {
    let active = true;
    getProductionHealth({ silent: true }).then(result => { if (active) { setHealth(result); setHealthError(''); } }).catch(error => { if (active) setHealthError(error.message || '无法读取运行依赖状态'); });
    return () => { active = false; };
  }, []);

  const openProject = useCallback(async project => {
    try {
      if (isBatchFactoryV11Project(project)) {
        const batch = batchFactoryBatchFromResponse(await getBatch(project.batchId));
        localStorage.setItem(BATCH_FACTORY_ACTIVE_BATCH_STORAGE_KEY, batch.id);
        setActiveBatchProject(batch);
        setView('batch-novels');
        return;
      }
      setActiveProject(await getProject(project.id)); setView('studio');
    } catch (error) { message.error(error.message || '读取项目工作台失败'); }
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

  async function handleCreate({ name, sourceText, segmentationMode, productionMode }) {
    const created = await createProject({ name, productionMode });
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
  async function handleCreateBatch(input) {
    const created = await createManualIntake(input);
    const batch = created.batch;
    localStorage.setItem(BATCH_FACTORY_ACTIVE_BATCH_STORAGE_KEY, batch.id);
    setActiveBatchProject(batch);
    setView('batch-novels');
    await refreshProjects();
    if (batch?.id) {
      try {
        const result = await classifyFetchedBatchMetadata(batch.id);
        const rows = Array.isArray(result?.results) ? result.results : [];
        const classified = rows.filter(item => item?.status === 'classified').length;
        const failed = rows.filter(item => item?.status === 'failed').length;
        if (classified) message.success(`已识别 ${classified} 本小说的男女频与风格`);
        if (failed) message.warning(`${failed} 本小说的男女频与风格暂未识别，可在单书中重试；不影响生产。`);
        const refreshed = batchFactoryBatchFromResponse(await getBatch(batch.id));
        if (mountedRef.current) setActiveBatchProject(current => String(current?.id) === String(batch.id) ? refreshed : current);
        await refreshProjects();
      } catch (error) {
        if (mountedRef.current) message.warning(`男女频与风格暂未识别：${error?.message || '可在单书中重试；不影响生产。'}`);
      }
    }
    if (input?.automationEnabled === true && batch?.id) {
      try {
        await startBatchAutomation(batch.id, {
          scheduledAt: input.scheduledAt || '',
          presetId: input.presetId || '',
          runMode: input.runMode || (input.autoPublishEnabled === true ? 'full_submit' : 'video_no_submit'),
          autoPublish: input.autoPublishEnabled === true,
          concurrency: input.automationConcurrency
        });
        message.success(input.scheduledAt ? `批量工程已创建，自动生产将在设定时间启动${input.autoPublishEnabled ? '，并自动上传视频管理系统' : ''}。` : `批量工程已创建并启动自动生产${input.autoPublishEnabled ? '，完成后将自动上传视频管理系统' : ''}。`);
      } catch (error) {
        message.warning(`批量工程已创建，但自动生产启动失败：${error?.message || '请进入工程后手动启动'}`);
      }
    }
    return batch;
  }

  useEffect(() => {
    const intakeId = pendingNovelFetchIntakeId(window.location.search);
    if (!intakeId || novelFetchHandoffRef.current === intakeId) return;
    novelFetchHandoffRef.current = intakeId;
    let cancelled = false;
    const clearHandoffQuery = () => window.history.replaceState({}, '', '/shuihuo-production');
    const openImportedBatch = async batch => {
      if (cancelled || !batch?.id) return;
      localStorage.setItem(BATCH_FACTORY_ACTIVE_BATCH_STORAGE_KEY, batch.id);
      setActiveBatchProject(batchFactoryBatchFromResponse(batch));
      setView('batch-novels');
      clearHandoffQuery();
      await refreshProjects();
    };
    const join = async () => {
      try {
        const [intakeResult, currentBatchId] = await Promise.all([
          getIntake(intakeId),
          Promise.resolve(localStorage.getItem(BATCH_FACTORY_ACTIVE_BATCH_STORAGE_KEY) || '')
        ]);
        if (cancelled) return;
        const intake = intakeResult?.intake || intakeResult;
        const incoming = novelFetchIntakeBooks(intake);
        if (!currentBatchId) {
          const created = await createBatchFromIntake(intakeId, {
            title: incoming.length === 1 ? `小说获取·${incoming[0]?.title || '新批量'}` : `小说获取·${incoming.length || 0}本`
          });
          await openImportedBatch(created?.batch || created);
          message.success('小说获取内容已登记到新批量');
          return;
        }
        const current = await getBatch(currentBatchId);
        if (cancelled) return;
        const batch = current?.batch || current;
        const existingSourceIDs = new Set((batch?.books || []).map(book => String(book?.bookId || '').trim()).filter(Boolean));
        const duplicates = incoming.filter(book => existingSourceIDs.has(String(book?.bookId || book?.id || '').trim()));
        const append = async allowDuplicate => {
          const updated = await appendNovelFetchIntake(batch.id, intakeId, { allowDuplicate });
          await openImportedBatch(updated?.batch || updated);
          message.success('小说获取内容已登记到当前批量');
        };
        if (!duplicates.length) {
          await append(false);
          return;
        }
        Modal.confirm({
          title: '当前批量已有同源小说',
          content: `发现 ${duplicates.length} 本同一 Book ID 的内容。允许后会作为 AI1·原书名等新版本加入；上传视频管理系统仍使用原 Book ID。`,
          okText: '允许加入',
          cancelText: '暂不加入',
          onOk: () => append(true),
          onCancel: () => { novelFetchHandoffRef.current = ''; }
        });
      } catch (error) {
        if (!cancelled) {
          novelFetchHandoffRef.current = '';
          message.error(error?.message || '小说获取交接失败');
        }
      }
    };
    join();
    return () => { cancelled = true; };
  }, [refreshProjects]);
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
      if (isBatchFactoryV11Project(project)) await deleteBatchFactoryProject(project.batchId);
      else await deleteProject(project.id);
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

  return <div className={`shuihuo-production ${view === 'studio' || view === 'batch-novels' ? 'is-workbench' : ''}`}>
    {view !== 'projects' && health ? <div className="shuihuo-readiness-strip" role="status" aria-live="polite"><strong className="shuihuo-readiness-title">运行依赖</strong>{readinessItems(health).map(([name, dependency]) => <span className={dependency?.ready ? 'ready' : 'missing'} key={name} title={dependency?.reason || `${name}已配置`}>{name}：{dependency?.ready ? '已配置' : '未配置'}{dependency?.ready || !dependency?.reason ? '' : `（${dependency.reason}）`}</span>)}</div> : null}
    {view === 'studio' && healthError ? <div className="shuihuo-readiness-strip" role="status" aria-live="polite"><span className="missing">状态读取失败：{healthError}</span></div> : null}
    {loading && view === 'projects' ? <div className="shuihuo-loading"><Spin /></div> : null}
    {!loading && view === 'projects' ? <ProjectsView projects={projects} health={health} onCreate={handleCreate} onImported={handleImported} onCreateBatch={handleCreateBatch} onOpen={openProject} onDelete={handleDelete} onRefresh={refreshProjects} openCreateOnLoad={openBatchOnLoad} /> : null}
    {view === 'batch-novels' && activeBatchProject ? <BatchFactoryNovelList batch={activeBatchProject} onBack={() => { setActiveBatchProject(null); setView('projects'); refreshProjects(); }} onBatchChanged={async () => { const current = batchFactoryBatchFromResponse(await getBatch(activeBatchProject.id)); setActiveBatchProject(current); await refreshProjects(); }} /> : null}
    {view === 'studio' && activeProject ? <CommentaryWorkbench data={activeProject} readiness={health} importNotice={importNotice} onBackToProjects={() => { setImportNotice(null); setView('projects'); refreshProjects(); }} onOpenAssets={() => setAssetsOpen(true)} onDataChange={applyReadModel} /> : null}
    <Modal title="人物场景预设" open={assetsOpen} onCancel={() => setAssetsOpen(false)} footer={null} width="min(1360px, calc(100vw - 48px))" className="shuihuo-assets-modal" destroyOnClose={false}>
      {activeProject ? <AssetsView data={activeProject} onRefresh={refreshActive} embedded /> : null}
    </Modal>
  </div>;
}

export default ShuihuoProductionPage;
