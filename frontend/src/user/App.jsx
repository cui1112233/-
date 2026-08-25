import { lazy, Suspense, useEffect, useState } from 'react';
import { UserLayout } from '../shared/layouts/UserLayout';
import { HomePage } from './pages/HomePage';

const ScriptPage = lazy(() => import('./pages/ScriptPage'));
const BatchFactoryPage = lazy(() => import('./pages/BatchFactoryPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const NovelPanelPage = lazy(() => import('./pages/NovelPanelPage'));
const AgentPage = lazy(() => import('./pages/AgentPageV2').then(module => ({ default: module.AgentPageV2 })));
const ShuihuoProductionPage = lazy(() => import('./pages/ShuihuoProductionPage'));
const TtsPage = lazy(() => import('./pages/TtsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
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
    '/batch-factory': BatchFactoryPage,
    '/history': HistoryPage,
    '/novel-panel': NovelPanelPage,
    '/agent': AgentPage,
    '/shuihuo-production': ShuihuoProductionPage,
    '/tts': TtsPage,
    '/settings': SettingsPage,
    '/issues': IssueLogPage
  };
  const Page = routes[pathname];
  if (Page) {
    return <Suspense fallback={<div className="route-loading" role="status">正在加载工作台</div>}><Page /></Suspense>;
  }
  return <HomePage />;
}

export function UserApp() {
  return <UserLayout>{getPage(usePathname())}</UserLayout>;
}
