import { useEffect, useState } from 'react';
import { UserLayout } from '../shared/layouts/UserLayout';
import { HomePage } from './pages/HomePage';
import { ScriptPage } from './pages/ScriptPage';
import { TtsPage } from './pages/TtsPage';
import { SettingsPage } from './pages/SettingsPage';
import { HistoryPage } from './pages/HistoryPage';

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
  if (pathname === '/script') return <ScriptPage />;
  if (pathname === '/history') return <HistoryPage />;
  if (pathname === '/tts') return <TtsPage />;
  if (pathname === '/settings') return <SettingsPage />;
  return <HomePage />;
}

export function UserApp() {
  return <UserLayout>{getPage(usePathname())}</UserLayout>;
}
