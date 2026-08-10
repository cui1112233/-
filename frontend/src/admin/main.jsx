import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import 'antd/dist/reset.css';
import '../shared/styles/global.css';
import { theme } from '../shared/styles/theme';
import { AdminApp } from './App';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider theme={theme}>
      <AdminApp />
    </ConfigProvider>
  </React.StrictMode>
);
