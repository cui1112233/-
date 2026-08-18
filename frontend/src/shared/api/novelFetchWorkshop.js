import { apiRequest } from './client';

// 改文工作台：后端接口封装（apiRequest 统一处理鉴权与错误上报）

// 批量处理清单：解析 →（可选）分类 → 建任务 →（可选）抓原文 →（可选）AI 改文
export function processBatch(payload) {
  return apiRequest('/api/novel-fetch-workshop/process', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// 任务列表
export function listWorkshopTasks() {
  return apiRequest('/api/novel-fetch-workshop/tasks');
}

// 任务详情（meta + 处理后原文 + 日志）
export function getWorkshopTask(bookId) {
  return apiRequest(`/api/novel-fetch-workshop/tasks/${encodeURIComponent(bookId)}`);
}

// 抓取单本原文
export function fetchWorkshopOriginal(bookId, maxTxt) {
  return apiRequest(`/api/novel-fetch-workshop/tasks/${encodeURIComponent(bookId)}/fetch`, {
    method: 'POST',
    body: JSON.stringify({ maxTxt })
  });
}

// 生成 AI 改文版本（数量 1~20）
export function generateWorkshopAi(bookId, count) {
  return apiRequest(`/api/novel-fetch-workshop/tasks/${encodeURIComponent(bookId)}/generate-ai`, {
    method: 'POST',
    body: JSON.stringify({ count })
  });
}

// 读取工作台配置（appConfig / platforms / styles / aiConfig）
export function getWorkshopConfig() {
  return apiRequest('/api/novel-fetch-workshop/config');
}

// 保存工作台配置（一期仅持久化 appConfig）
export function saveWorkshopConfig(patch) {
  return apiRequest('/api/novel-fetch-workshop/config', {
    method: 'POST',
    body: JSON.stringify(patch)
  });
}

// AI 接口连通性测试
export function testWorkshopAi(purpose) {
  return apiRequest('/api/novel-fetch-workshop/ai/test', {
    method: 'POST',
    body: JSON.stringify({ purpose })
  });
}
