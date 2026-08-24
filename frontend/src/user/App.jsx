import { lazy, Suspense, useEffect, useState } from 'react';
import { UserLayout } from '../shared/layouts/UserLayout';
import { HomePage } from './pages/HomePage';

const ScriptPage = lazy(() => import('./pages/ScriptPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const NovelPanelPage = lazy(() => import('./pages/NovelPanelPage'));
const AgentPage = lazy(() => import('./pages/AgentPageV2').then(module => ({ default: module.AgentPageV2 })));
const ShuihuoProductionPage = lazy(() => import('./pages/ShuihuoProductionPage'));
const TtsPage = lazy(() => import('./pages/TtsPage'));
const NovelFetchPage = lazy(() => import('./pages/NovelFetchPage'));
const NovelFetchWorkshopPage = lazy(() => import('./pages/NovelFetchWorkshopPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const MemberCenterPage = lazy(() => import('./pages/MemberCenterPage'));
const IssueLogPage = lazy(() => import('./pages/IssueLogPage').then(module => ({ default: module.IssueLogPage })));

function usePathname() {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return pathname;
}

function getPage(pathname) {
  const routes = {
    '/script': ScriptPage,
    '/novel-fetch': NovelFetchPage,
    '/novel-fetch-workshop': NovelFetchWorkshopPage,
    '/history': HistoryPage,
    '/novel-panel': NovelPanelPage,
    '/agent': AgentPage,
    '/shuihuo-production': ShuihuoProductionPage,
    '/tts': TtsPage,
    '/settings': SettingsPage,
    '/member': MemberCenterPage,
    '/issues': IssueLogPage
  };
  const Page = routes[pathname];
  if (Page) {
    return <Suspense fallback={<div className="route-loading" role="status">正在加载工作台</div>}><Page /></Suspense>;
  }
  return <HomePage />;
}

export function UserApp() {
  useEffect(() => {
    const recoverChunk = event => {
      const message = String(event?.reason?.message || event?.error?.message || event?.message || '');
      if (!/Failed to fetch dynamically imported module|Unable to preload CSS/i.test(message)) return;
      const key = 'qiantie:chunk-recovery';
      if (sessionStorage.getItem(key) === window.location.href) return;
      sessionStorage.setItem(key, window.location.href);
      window.location.reload();
    };
    window.addEventListener('error', recoverChunk);
    window.addEventListener('unhandledrejection', recoverChunk);
    return () => { window.removeEventListener('error', recoverChunk); window.removeEventListener('unhandledrejection', recoverChunk); };
  }, []);
  return <UserLayout>{getPage(usePathname())}</UserLayout>;
}
