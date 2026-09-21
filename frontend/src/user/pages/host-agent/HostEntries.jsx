import { lazy, Suspense, useState } from 'react';
import { Button } from 'antd';
import HostChatWorkspace from './HostChatWorkspace';

const OriginalAgent = lazy(() => import('../AgentPageV2').then(m => ({ default: m.AgentPageV2 })));

// The conversational interface belongs exclusively to /agent. It inherits the
// existing UserLayout; the production route continues to load its original page.
export function HostAgentEntry(props) {
  const [classic, setClassic] = useState(false);
  if (classic) return <><Button onClick={() => setClassic(false)}>返回 Agent 聊天工作区</Button><Suspense fallback={<p>正在读取原 Agent…</p>}><OriginalAgent {...props} /></Suspense></>;
  return <HostChatWorkspace onClassic={() => setClassic(true)} />;
}
