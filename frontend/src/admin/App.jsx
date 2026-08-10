import { useEffect, useState } from 'react';
import { AdminLayout } from '../shared/layouts/AdminLayout';
import { DashboardPage } from './pages/DashboardPage';
import { PromptStrategyPage } from './pages/PromptStrategyPage';

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
  if (pathname === '/admin/prompts') return <PromptStrategyPage />;
  return <DashboardPage />;
}

export function AdminApp() {
  return <AdminLayout>{getPage(usePathname())}</AdminLayout>;
}
