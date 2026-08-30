import { Button } from 'antd';

export function AccountCenterError({ message = '页面数据加载失败', onRetry }) {
  return <div className="account-center-page"><div className="ac-empty ac-load-error"><strong>{message}</strong><Button onClick={onRetry}>重试</Button></div></div>;
}
