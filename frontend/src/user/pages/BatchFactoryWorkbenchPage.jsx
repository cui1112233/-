import { FileTextOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Modal, Spin, message } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appendNovelFetchIntake,
  createBatchFromIntake,
  createManualIntake,
  getBatch,
  getIntake,
  listBatches,
  startBatchAutomation
} from '../../shared/api/batchFactoryV11';
import { BatchFactoryNovelList } from './shuihuo/BatchFactoryNovelList';
import { BatchFactoryCreateModal } from './shuihuo/BatchFactoryCreateModal';
import { batchFactoryBatchFromResponse } from './shuihuo/batchFactoryProjects';
import {
  BATCH_FACTORY_ACTIVE_BATCH_STORAGE_KEY,
  novelFetchIntakeBooks,
  pendingNovelFetchIntakeId
} from './shuihuo/batchFactoryNovelFetchHandoff';
import './shuihuo-production.css';
import './BatchFactoryWorkbenchPage.css';

function batchesFromResult(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.batches)) return result.batches;
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result?.data?.batches)) return result.data.batches;
  if (Array.isArray(result?.data?.items)) return result.data.items;
  return [];
}

function asBatch(result) {
  return batchFactoryBatchFromResponse({ batch: result?.batch || result });
}

function bookCount(batch) {
  return Array.isArray(batch?.books) ? batch.books.length : Number(batch?.bookCount || 0);
}

export default function BatchFactoryWorkbenchPage() {
  const [batches, setBatches] = useState([]);
  const [activeBatch, setActiveBatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const handoffRef = useRef('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    document.body.classList.add('shuihuo-theme-active');
    document.body.classList.add('shuihuo-reference-shell');
    return () => {
      mountedRef.current = false;
      document.body.classList.remove('shuihuo-theme-active');
      document.body.classList.remove('shuihuo-reference-shell');
    };
  }, []);

  const refreshBatches = useCallback(async ({ quiet = false } = {}) => {
    setLoading(true);
    setError('');
    try {
      const next = batchesFromResult(await listBatches());
      if (mountedRef.current) setBatches(next);
      return next;
    } catch (requestError) {
      const reason = requestError?.message || '批量工程读取失败';
      if (mountedRef.current) setError(reason);
      if (!quiet) message.error(reason);
      return [];
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const openBatch = useCallback(async batchId => {
    try {
      const batch = asBatch(await getBatch(batchId));
      localStorage.setItem(BATCH_FACTORY_ACTIVE_BATCH_STORAGE_KEY, batch.id);
      if (mountedRef.current) setActiveBatch(batch);
    } catch (requestError) {
      message.error(requestError?.message || '读取批量工程失败');
    }
  }, []);

  useEffect(() => { refreshBatches({ quiet: true }); }, [refreshBatches]);

  useEffect(() => {
    const intakeId = pendingNovelFetchIntakeId(window.location.search);
    if (!intakeId || handoffRef.current === intakeId) return undefined;
    handoffRef.current = intakeId;
    let cancelled = false;
    const clearHandoffQuery = () => window.history.replaceState({}, '', '/shuihuo-production');
    const finish = async result => {
      const batch = asBatch(result);
      if (cancelled) return;
      localStorage.setItem(BATCH_FACTORY_ACTIVE_BATCH_STORAGE_KEY, batch.id);
      setActiveBatch(batch);
      clearHandoffQuery();
      await refreshBatches({ quiet: true });
    };
    const join = async () => {
      try {
        const intakeResult = await getIntake(intakeId);
        const intake = intakeResult?.intake || intakeResult;
        const incoming = novelFetchIntakeBooks(intake);
        const currentBatchId = localStorage.getItem(BATCH_FACTORY_ACTIVE_BATCH_STORAGE_KEY) || '';
        if (!currentBatchId) {
          const result = await createBatchFromIntake(intakeId, {
            title: incoming.length === 1 ? `小说获取·${incoming[0]?.title || '新批量'}` : `小说获取·${incoming.length || 0}本`
          });
          await finish(result);
          message.success('小说获取内容已登记到新批量');
          return;
        }
        const current = asBatch(await getBatch(currentBatchId));
        const existingBookIds = new Set((current.books || []).map(book => String(book?.bookId || '').trim()).filter(Boolean));
        const duplicates = incoming.filter(book => existingBookIds.has(String(book?.bookId || book?.id || '').trim()));
        const append = async allowDuplicate => {
          const result = await appendNovelFetchIntake(current.id, intakeId, { allowDuplicate });
          await finish(result);
          message.success('小说获取内容已登记到当前批量');
        };
        if (!duplicates.length) return append(false);
        Modal.confirm({
          title: '当前批量已有同源小说',
          content: `发现 ${duplicates.length} 本同一 Book ID 的内容。允许后会作为新版本加入。`,
          okText: '允许加入',
          cancelText: '暂不加入',
          onOk: () => append(true),
          onCancel: () => { handoffRef.current = ''; }
        });
      } catch (requestError) {
        if (!cancelled) {
          handoffRef.current = '';
          message.error(requestError?.message || '小说获取交接失败');
        }
      }
    };
    join();
    return () => { cancelled = true; };
  }, [refreshBatches]);

  async function createBatch(input) {
    const batch = asBatch(await createManualIntake(input));
    localStorage.setItem(BATCH_FACTORY_ACTIVE_BATCH_STORAGE_KEY, batch.id);
    setActiveBatch(batch);
    await refreshBatches({ quiet: true });
    if (!input?.automationEnabled) return;
    try {
      await startBatchAutomation(batch.id, {
        scheduledAt: input.scheduledAt || '',
        presetId: input.presetId || '',
        runMode: input.runMode || (input.autoPublishEnabled ? 'full_submit' : 'video_no_submit'),
        autoPublish: input.autoPublishEnabled === true
      });
      message.success(input.scheduledAt ? '批量工程已创建，自动生产将在设定时间启动。' : '批量工程已创建并启动自动生产。');
    } catch (requestError) {
      message.warning(`批量工程已创建，但自动生产启动失败：${requestError?.message || '请进入工程后手动启动'}`);
    }
  }

  if (activeBatch) {
    return <div className="shuihuo-production is-workbench batch-factory-canonical-entry">
      <BatchFactoryNovelList batch={activeBatch} onBack={() => { setActiveBatch(null); refreshBatches({ quiet: true }); }} onBatchChanged={async () => {
        setActiveBatch(asBatch(await getBatch(activeBatch.id)));
        await refreshBatches({ quiet: true });
      }} />
    </div>;
  }

  return <main className="shuihuo-production batch-factory-canonical-entry batch-factory-workbench-home">
    <section className="batch-factory-workbench-home-heading">
      <div><h1>批量工厂</h1><p>统一管理批次、单书配置、分镜生产与视频提交。</p></div>
      <div className="batch-factory-workbench-home-actions"><Button icon={<ReloadOutlined />} loading={loading} onClick={() => refreshBatches()}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建批量</Button></div>
    </section>
    {loading ? <div className="batch-factory-workbench-home-state"><Spin /><span>正在读取批量工程</span></div> : null}
    {!loading && error ? <div className="batch-factory-workbench-home-state is-error"><strong>批量工程暂时无法读取</strong><span>{error}</span><Button onClick={() => refreshBatches()}>重试</Button></div> : null}
    {!loading && !error ? <section className="batch-factory-workbench-grid">
      {batches.map(batch => <button type="button" className="batch-factory-workbench-card" key={batch.id} onClick={() => openBatch(batch.id)}><FileTextOutlined /><strong>{batch.title || '未命名批量'}</strong><span>{bookCount(batch)} 本小说</span><small>{batch.updatedAt || batch.createdAt || '刚刚创建'}</small></button>)}
      {!batches.length ? <div className="batch-factory-workbench-home-state"><FileTextOutlined /><strong>还没有批量工程</strong><span>新建批量后即可进入每本小说的完整生产工作台。</span><Button type="primary" onClick={() => setCreateOpen(true)}>新建批量</Button></div> : null}
    </section> : null}
    <BatchFactoryCreateModal open={createOpen} onCancel={() => setCreateOpen(false)} onCreated={async input => { await createBatch(input); setCreateOpen(false); }} />
  </main>;
}
