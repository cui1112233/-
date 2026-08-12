const common = {
  colorPrimary: '#f07167',
  borderRadius: 8,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif'
};

const dark = {
  colorText: '#e8e8f0',
  colorTextSecondary: '#b8b8c8',
  colorTextTertiary: '#8b8ba0',
  colorTextPlaceholder: '#9ea0b2',
  colorTextDisabled: 'rgba(232, 232, 240, 0.5)',
  colorBgBase: '#0a0a14',
  colorBgContainer: '#171726',
  colorBgElevated: '#1e1e36',
  colorBgLayout: '#0a0a14',
  colorBgContainerDisabled: '#2a2a3d',
  colorBorder: 'rgba(255, 255, 255, 0.14)',
  colorBorderSecondary: 'rgba(255, 255, 255, 0.1)'
};

const light = {
  colorText: '#202330',
  colorTextSecondary: '#536074',
  colorTextTertiary: '#667085',
  colorTextPlaceholder: '#667085',
  colorTextDisabled: '#7a8494',
  colorBgBase: '#f4f6fa',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBgLayout: '#f4f6fa',
  colorBgContainerDisabled: '#edf1f6',
  colorBorder: '#cfd5e1',
  colorBorderSecondary: '#e4e7ee'
};

export function createAntTheme(mode) {
  return { token: { ...common, ...(mode === 'light' ? light : dark) } };
}
