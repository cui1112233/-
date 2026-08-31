import { useEffect, useRef, useState } from 'react';
import './novel-fetch.css';

const HOTFIX_SRC = '/batch-rewrite/121-login-hotfix.js?v=20260831-config-guard1';

function install121LoginHotfix(frame) {
  const doc = frame?.contentDocument;
  if (!doc || doc.getElementById('qiantie-121-login-hotfix')) return;
  const script = doc.createElement('script');
  script.id = 'qiantie-121-login-hotfix';
  script.src = HOTFIX_SRC;
  script.async = false;
  (doc.body || doc.documentElement).appendChild(script);
}

export function NovelFetchSafePage({ theme }) {
  const frameRef = useRef(null);
  const [frameReady, setFrameReady] = useState(false);
  const normalizedTheme = theme === 'light' ? 'light' : 'dark';

  const syncTheme = () => {
    frameRef.current?.contentWindow?.postMessage({ type: 'qiantie-theme-sync', theme: normalizedTheme }, '*');
  };

  useEffect(() => { syncTheme(); }, [normalizedTheme]);

  useEffect(() => {
    const transferToBatchFactory = event => {
      if (event.origin !== window.location.origin || event.data?.type !== 'qiantie:batch-factory-intake' || !event.data?.redirectTo) return;
      window.history.pushState({}, '', event.data.redirectTo);
      window.dispatchEvent(new PopStateEvent('popstate'));
    };
    window.addEventListener('message', transferToBatchFactory);
    return () => window.removeEventListener('message', transferToBatchFactory);
  }, []);

  return (
    <div className={`novel-fetch-frame-shell${frameReady ? ' is-ready' : ''}`}>
      <iframe
        ref={frameRef}
        className="novel-fetch-original-workbench"
        title="批量原文改文系统"
        src={`/batch-rewrite/index.html?theme=${normalizedTheme}`}
        onLoad={() => {
          syncTheme();
          install121LoginHotfix(frameRef.current);
          requestAnimationFrame(() => setFrameReady(true));
        }}
      />
    </div>
  );
}

export default NovelFetchSafePage;
