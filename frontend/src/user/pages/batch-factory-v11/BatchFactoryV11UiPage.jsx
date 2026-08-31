import { message } from 'antd';
import { useMemo, useState } from 'react';
import { BatchFactoryV11Workbench } from './BatchFactoryV11Workbench';
import { BatchFactoryV11BatchManager } from './BatchFactoryV11BatchManager';
import { ProductionSettingsDrawer } from './BatchFactoryV11SettingsDrawers';
import { PublishSettingsDrawer } from './BatchFactoryV11PublishSettings';
import { BookSettingsModal, VideoSettingsDrawer } from './BatchFactoryV11ScopedSettings';
import {
  SHOWCASE_BATCH,
  SHOWCASE_BATCH_SETTINGS,
  SHOWCASE_BOOKS
} from './showcaseData';
import './batch-factory-v11-scoped.css';
import './batch-factory-v11-batch-manager.css';
import './batch-factory-v11-detail.css';
import './batch-factory-v11-theme.css';

const CONFIG_LABELS = {
  'v3.5': '批量配置 V3.5',
  'v3.2': '批量配置 V3.2',
  'v3.1': '批量配置 V3.1',
  'v3.0': '批量配置 V3.0'
};

const MODEL_LABELS = {
  'seedance-pro': 'Seedance Video Pro · 最大 15s',
  'seedance-fast': 'Seedance Video Fast · 最大 10s',
  'video-model-c': 'Video Model C · 最大 12s'
};

const MODEL_MAX_DURATIONS = {
  'seedance-pro': 15,
  'seedance-fast': 10,
  'video-model-c': 12
};

const INITIAL_BOOK_PATCHES = {
  'book-02': { aspectRatio: '16:9', qualityEnabled: false },
  'book-04': { negativeEnabled: true },
  'book-06': { configVersion: 'v3.5', fixedSingleVideo: true, prefixMode: 'manual' }
};

export function BatchFactoryV11UiPage() {
  const [batchSettings, setBatchSettings] = useState(SHOWCASE_BATCH_SETTINGS);
  const [publishSettings, setPublishSettings] = useState({});
  const [bookPatches, setBookPatches] = useState(INITIAL_BOOK_PATCHES);
  const [videoPatches, setVideoPatches] = useState({});
  const [batchManager, setBatchManager] = useState({ open: false, tab: 'new' });
  const [productionSettingsOpen, setProductionSettingsOpen] = useState(false);
  const [publishSettingsOpen, setPublishSettingsOpen] = useState(false);
  const [bookSettingsTarget, setBookSettingsTarget] = useState(null);
  const [videoSettingsTarget, setVideoSettingsTarget] = useState(null);

  const batch = useMemo(() => ({
    ...SHOWCASE_BATCH,
    mode: batchSettings.productionMode,
    aspectRatio: batchSettings.aspectRatio,
    fixedSingleVideo: batchSettings.fixedSingleVideo,
    configVersion: CONFIG_LABELS[batchSettings.configVersion] || batchSettings.configVersion,
    videoModel: MODEL_LABELS[batchSettings.videoModelId] || SHOWCASE_BATCH.videoModel
  }), [batchSettings]);

  const books = useMemo(() => SHOWCASE_BOOKS.map(book => {
    const patch = bookPatches[book.id];
    return {
      ...book,
      overrideCount: patch === undefined ? book.overrideCount : Object.keys(patch).length
    };
  }), [bookPatches]);

  function showUiOnlyNotice(label) {
    message.info(`${label}已更新当前 UI 状态；第一阶段尚未写入 Go / MySQL。`);
  }

  function saveBatchSettings(next) {
    setBatchSettings(next);
    showUiOnlyNotice('生产统一设置');
  }

  function savePublishSettings(next) {
    setPublishSettings(next);
    showUiOnlyNotice('发布统一设置');
  }

  function saveBookPatch(book, patch) {
    setBookPatches(current => ({ ...current, [book.id]: patch }));
    showUiOnlyNotice('当前小说设置');
  }

  function saveVideoPatch(video, patch) {
    setVideoPatches(current => ({ ...current, [video.id]: patch }));
    showUiOnlyNotice('单 VIDEO 设置');
  }

  function openBatchManager(tab) {
    setBatchManager({ open: true, tab });
  }

  function openProductionSettingsFromBatchManager() {
    setBatchManager(current => ({ ...current, open: false }));
    setProductionSettingsOpen(true);
  }

  const activeBook = bookSettingsTarget
    ? books.find(book => book.id === bookSettingsTarget.id) || bookSettingsTarget
    : null;
  const activeVideoBook = videoSettingsTarget
    ? books.find(book => book.id === videoSettingsTarget.book.id) || videoSettingsTarget.book
    : null;
  const activeVideo = videoSettingsTarget?.video || null;
  const activeBookPatch = activeVideoBook ? (bookPatches[activeVideoBook.id] || {}) : {};
  const videoParentSettings = { ...batchSettings, ...activeBookPatch };
  const modelMaxDuration = MODEL_MAX_DURATIONS[batchSettings.videoModelId] || 1;

  return <div data-bf-v11-ui="final">
    <BatchFactoryV11Workbench
      batch={batch}
      books={books}
      onOpenBatchManager={() => openBatchManager('new')}
      onOpenHistory={() => openBatchManager('history')}
      onOpenBatchSettings={() => setProductionSettingsOpen(true)}
      onOpenPublishSettings={() => setPublishSettingsOpen(true)}
      onOpenBookSettings={book => setBookSettingsTarget(book)}
      onOpenVideoSettings={(book, video) => setVideoSettingsTarget({ book, video })}
    />

    <BatchFactoryV11BatchManager
      open={batchManager.open}
      initialTab={batchManager.tab}
      onClose={() => setBatchManager(current => ({ ...current, open: false }))}
      onOpenProductionSettings={openProductionSettingsFromBatchManager}
    />

    <ProductionSettingsDrawer
      open={productionSettingsOpen}
      batch={batch}
      initialValue={batchSettings}
      onClose={() => setProductionSettingsOpen(false)}
      onSave={saveBatchSettings}
    />

    <PublishSettingsDrawer
      open={publishSettingsOpen}
      batch={batch}
      initialValue={publishSettings}
      onClose={() => setPublishSettingsOpen(false)}
      onSave={savePublishSettings}
    />

    <BookSettingsModal
      open={Boolean(activeBook)}
      book={activeBook}
      batchSettings={batchSettings}
      initialPatch={activeBook ? (bookPatches[activeBook.id] || {}) : {}}
      onClose={() => setBookSettingsTarget(null)}
      onSave={patch => activeBook && saveBookPatch(activeBook, patch)}
    />

    <VideoSettingsDrawer
      open={Boolean(activeVideoBook && activeVideo)}
      book={activeVideoBook}
      video={activeVideo}
      parentSettings={videoParentSettings}
      modelMaxDuration={modelMaxDuration}
      initialPatch={activeVideo ? (videoPatches[activeVideo.id] || {}) : {}}
      onClose={() => setVideoSettingsTarget(null)}
      onSave={patch => activeVideo && saveVideoPatch(activeVideo, patch)}
    />
  </div>;
}

export default BatchFactoryV11UiPage;
