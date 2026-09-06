'use strict';

const {
  normalizeDirectorPipelineRequest,
  runScriptDirectorPipeline
} = require('./script-director-pipeline');

const activeUsers = new Set();

function text(value) { return String(value == null ? '' : value).trim(); }

function createScriptDirectorPipelineHandler({ runner = runScriptDirectorPipeline } = {}) {
  return async function scriptDirectorPipelineHandler(req, res) {
    const username = text(req?.username) || 'anonymous';
    if (activeUsers.has(username)) {
      return res.status(409).json({
        ok: false,
        code: 'SCRIPT_DIRECTOR_PIPELINE_IN_PROGRESS',
        error: '当前导演分镜正在处理中，请等待本次请求完成后再试。'
      });
    }

    try {
      // 用户输入错误在任何模型调用前直接 400；模型输出/语义验收错误由 runner 标记为 422/502。
      normalizeDirectorPipelineRequest(req?.body || {});
    } catch (error) {
      return res.status(400).json({ ok: false, code: 'SCRIPT_DIRECTOR_REQUEST_INVALID', error: error.message || '导演流水线请求无效。' });
    }

    activeUsers.add(username);
    try {
      const result = await runner({ req, body: req.body || {} });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const status = Number(error?.statusCode) || 502;
      return res.status(status).json({
        ok: false,
        applied: false,
        retained_previous_result: true,
        code: error?.code || 'SCRIPT_DIRECTOR_PIPELINE_FAILED',
        error: error?.message || '导演流水线执行失败。',
        ...(error?.report ? { report: error.report } : {}),
        ...(error?.audit ? { director_constraint_audit: error.audit } : {})
      });
    } finally {
      activeUsers.delete(username);
    }
  };
}

module.exports = { createScriptDirectorPipelineHandler, _private: { activeUsers } };
