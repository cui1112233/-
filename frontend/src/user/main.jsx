import React from 'react';
import { createRoot } from 'react-dom/client';
import 'antd/dist/reset.css';
import '../shared/styles/global.css';
import '../shared/styles/login-card.css';
import '../shared/styles/agent-workspace.css';
import { installClientErrorReporting } from '../shared/error-reporting';
import { UserApp } from './App';

installClientErrorReporting();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <UserApp />
  </React.StrictMode>
);
