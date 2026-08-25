import React from 'react';
import { createRoot } from 'react-dom/client';
import 'antd/dist/reset.css';
import '../shared/styles/global.css';
import '../shared/styles/login-card.css';
import '../shared/styles/agent-workspace.css';
import '../shared/styles/member-center.css';
import '../shared/styles/team-governance.css';
import '../shared/styles/team-collaboration.css';
import { installClientErrorReporting } from '../shared/error-reporting';
import { UserApp } from './App';

installClientErrorReporting();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <UserApp />
  </React.StrictMode>
);
