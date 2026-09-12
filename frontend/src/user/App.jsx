import { lazy, Suspense, useEffect, useState } from 'react';
import { UserLayout } from '../shared/layouts/UserLayout';
import { HomePage } from './pages/HomePage';

const ScriptPage = lazy(() => import('./pages/ScriptPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const NovelPanelPage = lazy(() => import('./pages/NovelPanelPage'));
const AgentPage = lazy(() => import('./pages/AgentPageV2').then(module => ({ default: module.AgentPageV2 })));
const ShuihuoProductionPage = lazy(() => import('./pages/ShuihuoProductionPage'));
const TtsPage = lazy(() => import('./pages/TtsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const MemberCenterPage = lazy(() => import('./pages/MemberCenterPage'));
const TeamManagementPage = lazy(() => import('./pages/TeamManagementPage'));
const UsageStatsPage = lazy(() => import('./pages/UsageStatsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const SecurityPage = lazy(() => import('./pages/SecurityPage'));
const ApiConfigPage = lazy(() => import('./pages/ApiConfigPage'));
const InviteAcceptPage = lazy(() => import('./pages/InviteAcceptPage'));
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
    '/history': HistoryPage,
    '/novel-panel': NovelPanelPage,
    '/agent': AgentPage,
    '/shuihuo-production': ShuihuoProductionPage,
    '/tts': TtsPage,
    '/settings': SettingsPage,
    '/member': MemberCenterPage,
    '/team': TeamManagementPage,
    '/usage': UsageStatsPage,
    '/profile': ProfilePage,
    '/security': SecurityPage,
    '/api-config': ApiConfigPage,
    '/issues': IssueLogPage
  };
  const Page = routes[pathname];
  if (Page) return <Suspense fallback={<div className="route-loading" role="status">正在加载工作台</div>}><Page /></Suspense>;
  return <HomePage />;
}

export function UserApp() {
  const pathname = usePathname();
  if (/^\/invite\/[^/]+$/.test(pathname)) {
    return <Suspense fallback={<div className="route-loading" role="status">正在加载团队邀请</div>}><InviteAcceptPage /></Suspense>;
  }
  return <UserLayout>{getPage(pathname)}</UserLayout>;
}
