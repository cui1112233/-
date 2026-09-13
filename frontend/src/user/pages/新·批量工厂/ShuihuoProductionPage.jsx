import { ArrowLeftOutlined } from '@ant-design/icons';
import { Button, Spin, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as batchFactoryV11 from '../../../shared/api/batchFactoryV11.js';
import { createBatchFactoryLibrary } from '../../../shared/api/batchFactoryLibrary.js';
import { BatchFactoryV11UiPage } from '../batch-factory-v11/BatchFactoryV11UiPage.jsx';
import { ProjectsView } from './shuihuo/ProjectsView';
import './shuihuo-production.css';

function requestedBatchId() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search || '').get('batch') || '';
}

export function ShuihuoProductionPage() {
  const library = useMemo(() => createBatchFactoryLibrary(batchFactoryV11), []);
  const [projects, setProjects] = useState([]);
  const [activeBatchId, setActiveBatchId] = useState(requestedBatchId);
  const [view, setView] = useState(() => requestedBatchId() ? 'studio' : 'projects');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    document.body.classList.add('shuihuo-theme-active');
    document.body.classList.add('shuihuo-reference-shell');
    return () => {
      document.body.classList.remove('shuihuo-theme-active');
      document.body.classList.remove('shuihuo-reference-shell');
    };
  }, []);

  const refreshProjects = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const next = await library.listDocuments();
      setProjects(next);
      setLoadError('');
      return true;
    } catch (error) {
      const reason = error?.message || '读取批量工厂作品列表失败';
      setLoadError(reason);
      if (!quiet) message.error(reason);
      return false;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [library]);

  useEffect(() => { void refreshProjects(); }, [refreshProjects]);

  async function handleCreate({ name, sourceText, filename }) {
    const batch = await library.createDocument({ title: name, sourceText, filename });
    const refreshed = await refreshProjects({ quiet: true });
    setActiveBatchId(batch.id);
    setView('studio');
    if (refreshed) message.success('批量工厂作品已创建');
    else message.warning('作品已创建；列表刷新失败，工作台仍可继续使用。');
  }

  function openBatch(batch) {
    setActiveBatchId(batch.id);
    setView('studio');
  }

  function returnToProjects() {
    setActiveBatchId('');
    setView('projects');
    void refreshProjects();
  }

  return <div className={`shuihuo-production ${view === 'studio' ? 'is-workbench' : ''}`}>
    {loading && view === 'projects' ? <div className="shuihuo-loading"><Spin /></div> : null}
    {!loading && view === 'projects' ? <ProjectsView
      projects={projects}
      loadError={loadError}
      onRefresh={refreshProjects}
      onCreate={handleCreate}
      onOpen={openBatch}
    /> : null}
    {view === 'studio' && activeBatchId ? <section className="batch-factory-v11-embedded">
      <div className="batch-factory-v11-embedded-nav">
        <Button icon={<ArrowLeftOutlined />} onClick={returnToProjects}>返回作品列表</Button>
        <span>批量工厂作品</span>
      </div>
      <BatchFactoryV11UiPage key={activeBatchId} initialBatchId={activeBatchId} />
    </section> : null}
  </div>;
}

export default ShuihuoProductionPage;
