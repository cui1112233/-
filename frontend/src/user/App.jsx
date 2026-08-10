import { useEffect, useState } from 'react';
import { UserLayout } from '../shared/layouts/UserLayout';
import { HomePage } from './pages/HomePage';
import { ScriptPage } from './pages/ScriptPage';
import { TtsPage } from './pages/TtsPage';

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
  if (pathname === '/tts') return <TtsPage />;
  return <HomePage />;
}

export function UserApp() {
  return <UserLayout>{getPage(usePathname())}</UserLayout>;
}
