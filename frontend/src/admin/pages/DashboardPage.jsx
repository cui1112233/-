import { Card, Col, Row, Statistic, Typography } from 'antd';

export function DashboardPage() {
  return (
    <>
      <Typography.Title level={3}>系统概览</Typography.Title>
      <Row gutter={16}>
        <Col span={6}><Card><Statistic title="服务状态" value="运行中" /></Card></Col>
        <Col span={6}><Card><Statistic title="前端" value="React + Antd" /></Card></Col>
        <Col span={6}><Card><Statistic title="后端" value="Express" /></Card></Col>
        <Col span={6}><Card><Statistic title="Prompt" value="后端保护" /></Card></Col>
      </Row>
    </>
  );
}
