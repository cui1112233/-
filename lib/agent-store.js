const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { safeUserName } = require('./shared');

const MAX_MESSAGE_LENGTH = 12000;
const MAX_TASK_TITLE_LENGTH = 80;
const TASK_DOCUMENT_VERSION = 1;
const DEFAULT_TASK_TITLE = '新聊天';
const LEGACY_TASK_TITLE = '历史聊天';
const PREVIEW_LENGTH = 120;
const HARD_MAX_TASKS = 100;
const HARD_MAX_ENTRIES = 100;
const MAX_CANVAS_NODES = 200;
const MAX_CANVAS_EDGES = 400;
const MAX_EXECUTIONS = 200;
const MAX_SUMMARY_LENGTH = 10000;
const CANVAS_NODE_TYPES = new Set(['input', 'copy', 'storyboard', 'image', 'video', 'voice', 'delivery']);
const CANVAS_NODE_STATUSES = new Set(['pending', 'running', 'succeeded', 'failed', 'awaiting_result']);
const EXECUTION_STATUSES = new Set(['pending', 'running', 'succeeded', 'failed', 'awaiting_result']);

function unicodeLength(value) {
  return Array.from(value).length;
}

function isValidMessage(message) {
  return Boolean(
    message &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    message.content.trim() &&
    unicodeLength(message.content) <= MAX_MESSAGE_LENGTH &&
    typeof message.createdAt === 'string' &&
    message.createdAt
  );
}

function cloneTask(task) {
  return {
    ...task,
    messages: task.messages.map(message => ({ ...message }))
  };
}

function cloneMessage(message) {
  return {
    role: message.role,
    content: message.content,
    createdAt: message.createdAt
  };
}

function defaultCanvas() {
  return { version: 1, revision: 0, nodes: [], edges: [] };
}

function cloneCanvas(canvas) {
  return {
    version: canvas.version,
    revision: canvas.revision,
    nodes: canvas.nodes.map(node => ({ ...node })),
    edges: canvas.edges.map(edge => ({ ...edge }))
  };
}

function sanitizeCanvas(canvas) {
  return {
    version: 1,
    revision: canvas.revision,
    nodes: canvas.nodes.map(node => {
      const result = {
        id: node.id,
        type: node.type,
        position: { x: node.position.x, y: node.position.y },
        title: node.title,
        version: node.version,
        sourceNodeIds: [...node.sourceNodeIds],
        status: node.status,
        summary: node.summary
      };
      if (node.assetRef) result.assetRef = { kind: node.assetRef.kind, id: node.assetRef.id };
      if (node.executionId) result.executionId = node.executionId;
      if (node.errorCode) result.errorCode = node.errorCode;
      return result;
    }),
    edges: canvas.edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      relation: edge.relation
    }))
  };
}

function validateCanvas(canvas) {
  if (!canvas || canvas.version !== 1 || !Number.isInteger(canvas.revision) || canvas.revision < 0 ||
      !Array.isArray(canvas.nodes) || canvas.nodes.length > MAX_CANVAS_NODES ||
      !Array.isArray(canvas.edges) || canvas.edges.length > MAX_CANVAS_EDGES) {
    throw new Error('画布数据不合法');
  }
  const nodeIds = new Set();
  for (const node of canvas.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || nodeIds.has(node.id) ||
        !CANVAS_NODE_TYPES.has(node.type) || !CANVAS_NODE_STATUSES.has(node.status) ||
        !node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y) ||
        !Number.isInteger(node.version) || node.version < 1 ||
        !Array.isArray(node.sourceNodeIds) || node.sourceNodeIds.some(id => typeof id !== 'string' || !id) ||
        typeof node.title !== 'string' || !node.title || typeof node.summary !== 'string') throw new Error('画布节点不合法');
    if (node.assetRef && (typeof node.assetRef !== 'object' || !['image', 'video', 'audio', 'text'].includes(node.assetRef.kind) || typeof node.assetRef.id !== 'string' || !node.assetRef.id)) throw new Error('画布资产引用不合法');
    nodeIds.add(node.id);
  }
  for (const edge of canvas.edges) {
    if (!edge || typeof edge.id !== 'string' || !edge.id ||
        typeof edge.source !== 'string' || typeof edge.target !== 'string' ||
        !nodeIds.has(edge.source) || !nodeIds.has(edge.target) ||
        !['reference', 'derived', 'sequence'].includes(edge.relation)) throw new Error('画布边不合法');
  }
}

function cloneExecution(execution) {
  return {
    id: execution.id,
    status: execution.status,
    summary: execution.summary,
    startedAt: execution.startedAt,
    updatedAt: execution.updatedAt,
    finishedAt: execution.finishedAt
  };
}

function taskSummary(task) {
  const lastMessage = task.messages.at(-1);
  return {
    id: task.id,
    title: task.title,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    messageCount: task.messages.length,
    preview: lastMessage ? Array.from(lastMessage.content).slice(0, PREVIEW_LENGTH).join('') : ''
  };
}

function isValidTask(task) {
  return Boolean(
    task &&
    typeof task.id === 'string' && task.id &&
    typeof task.title === 'string' && task.title &&
    unicodeLength(task.title) <= MAX_TASK_TITLE_LENGTH &&
    (task.titleMode === 'automatic' || task.titleMode === 'manual') &&
    typeof task.createdAt === 'string' && task.createdAt &&
    typeof task.updatedAt === 'string' && task.updatedAt &&
    (task.legacyMessagePreservation === undefined || task.legacyMessagePreservation === true) &&
    Array.isArray(task.messages) &&
    task.messages.every(isValidMessage)
  );
}

function createAgentStore({
  usersDir,
  maxTasks = 100,
  maxEntries = 100,
  now = () => new Date().toISOString(),
  id = () => crypto.randomUUID()
} = {}) {
  if (!usersDir) throw new Error('usersDir is required');
  const effectiveMaxTasks = Math.min(maxTasks, HARD_MAX_TASKS);
  const effectiveMaxEntries = Math.min(maxEntries, HARD_MAX_ENTRIES);

  function userDir(username) {
    return path.join(usersDir, safeUserName(username));
  }

  function taskPath(username) {
    return path.join(userDir(username), 'agent-tasks.json');
  }

  function legacyHistoryPath(username) {
    return path.join(userDir(username), 'agent-history.json');
  }

  function readLegacyMessages(username) {
    const filePath = legacyHistoryPath(username);
    if (!fs.existsSync(filePath)) return [];
    try {
      const messages = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(messages) ? messages.filter(isValidMessage) : [];
    } catch (error) {
      return [];
    }
  }

  function createLegacyDocument(username) {
    const messages = readLegacyMessages(username);
    if (!messages.length) return { version: TASK_DOCUMENT_VERSION, tasks: [] };

    return {
      version: TASK_DOCUMENT_VERSION,
      tasks: [{
        id: id(),
        title: LEGACY_TASK_TITLE,
        titleMode: 'manual',
        createdAt: messages[0].createdAt,
        updatedAt: messages.at(-1).createdAt,
        messages: messages.map(cloneMessage),
        ...(messages.length > HARD_MAX_ENTRIES ? { legacyMessagePreservation: true } : {})
      }]
    };
  }

  function readDocument(username) {
    const filePath = taskPath(username);
    if (!fs.existsSync(filePath)) {
      const document = createLegacyDocument(username);
      writeDocument(username, document);
      return document;
    }

    try {
      const document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (
        document &&
        document.version === TASK_DOCUMENT_VERSION &&
        Array.isArray(document.tasks) &&
        document.tasks.every(isValidTask)
      ) {
        if (
          document.tasks.length > HARD_MAX_TASKS ||
          document.tasks.some(task => task.messages.length > HARD_MAX_ENTRIES && !task.legacyMessagePreservation)
        ) {
          throw new Error('Agent task data exceeds supported limit');
        }
        return {
          version: TASK_DOCUMENT_VERSION,
          tasks: document.tasks.map(task => ({
            ...cloneTask(task),
            messages: task.messages.map(cloneMessage),
            canvas: task.canvas ? (validateCanvas(task.canvas), sanitizeCanvas(task.canvas)) : defaultCanvas(),
            executions: Array.isArray(task.executions) ? task.executions.map(cloneExecution) : []
          }))
        };
      }
    } catch (error) {
      if (error.message === 'Agent task data exceeds supported limit') throw error;
      throw new Error('Agent task data is unreadable');
    }
    throw new Error('Agent task data is unreadable');
  }

  function writeDocument(username, document) {
    const destination = taskPath(username);
    const directory = path.dirname(destination);
    fs.mkdirSync(directory, { recursive: true });
    let descriptor;
    let temporary;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      temporary = path.join(directory, `.agent-tasks.${process.pid}.${crypto.randomBytes(12).toString('hex')}.tmp`);
      try {
        descriptor = fs.openSync(temporary, 'wx', 0o600);
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    if (descriptor === undefined) throw new Error('Unable to create private agent task document');
    try {
      fs.fchmodSync(descriptor, 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(document, null, 2), 'utf8');
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, destination);
    } catch (error) {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary);
      throw error;
    }
  }

  function findTask(document, taskId) {
    return document.tasks.find(task => task.id === taskId) || null;
  }

  function listTasks(username) {
    const document = readDocument(username);
    return document.tasks
      .map((task, index) => ({ task, index }))
      .sort((left, right) => {
        const timestampOrder = right.task.updatedAt.localeCompare(left.task.updatedAt);
        // Equal timestamps are common with injected clocks; later array entries are newer.
        return timestampOrder || right.index - left.index;
      })
      .map(({ task }) => taskSummary(task));
  }

  function getTask(username, taskId) {
    const task = findTask(readDocument(username), taskId);
    return task ? cloneTask(task) : null;
  }

  function createTask(username) {
    const document = readDocument(username);
    if (document.tasks.length >= effectiveMaxTasks) throw new Error('任务数量已达上限');
    const timestamp = now();
    const task = {
      id: id(),
      title: DEFAULT_TASK_TITLE,
      titleMode: 'automatic',
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: []
    };
    document.tasks.push(task);
    writeDocument(username, document);
    return cloneTask(task);
  }

  function renameTask(username, taskId, title) {
    const value = typeof title === 'string' ? title.trim() : '';
    if (!value || unicodeLength(value) > MAX_TASK_TITLE_LENGTH) {
      throw new Error('任务标题不合法');
    }
    const document = readDocument(username);
    const task = findTask(document, taskId);
    if (!task) return null;
    task.title = value;
    task.titleMode = 'manual';
    task.updatedAt = now();
    writeDocument(username, document);
    return cloneTask(task);
  }

  function append(username, taskId, message) {
    const role = message?.role;
    const content = typeof message?.content === 'string' ? message.content.trim() : '';
    if (!['user', 'assistant'].includes(role) || !content || unicodeLength(content) > MAX_MESSAGE_LENGTH) {
      throw new Error('Invalid agent message');
    }
    const document = readDocument(username);
    const task = findTask(document, taskId);
    if (!task) return null;
    if (task.legacyMessagePreservation && task.messages.length >= effectiveMaxEntries) {
      throw new Error('Agent task data exceeds supported limit');
    }
    const entry = { role, content, createdAt: now() };
    task.messages = [...task.messages, entry].slice(-effectiveMaxEntries);
    if (task.titleMode === 'automatic' && task.title === DEFAULT_TASK_TITLE && role === 'user') {
      task.title = Array.from(content).slice(0, 20).join('');
    }
    task.updatedAt = entry.createdAt;
    writeDocument(username, document);
    return cloneMessage(entry);
  }

  function clearTaskMessages(username, taskId) {
    const document = readDocument(username);
    const task = findTask(document, taskId);
    if (!task) return null;
    task.messages = [];
    delete task.legacyMessagePreservation;
    task.updatedAt = now();
    writeDocument(username, document);
    return cloneTask(task);
  }

  function deleteTask(username, taskId) {
    const document = readDocument(username);
    const index = document.tasks.findIndex(task => task.id === taskId);
    if (index === -1) return false;
    document.tasks.splice(index, 1);
    writeDocument(username, document);
    return true;
  }

  function getCanvas(username, taskId) {
    const task = findTask(readDocument(username), taskId);
    return task ? cloneCanvas(task.canvas || defaultCanvas()) : null;
  }

  function saveCanvas(username, taskId, canvas, expectedRevision) {
    validateCanvas(canvas);
    const document = readDocument(username);
    const task = findTask(document, taskId);
    if (!task) return null;
    const current = task.canvas || defaultCanvas();
    if (current.revision !== expectedRevision) {
      return { ok: false, conflict: true, canvas: cloneCanvas(current) };
    }
    const next = sanitizeCanvas({ ...canvas, revision: current.revision + 1 });
    task.canvas = next;
    writeDocument(username, document);
    return { ok: true, canvas: cloneCanvas(next) };
  }

  function appendExecution(username, taskId, input) {
    const document = readDocument(username);
    const task = findTask(document, taskId);
    if (!task) return null;
    const status = input?.status;
    const summary = typeof input?.summary === 'string' ? input.summary : '';
    if (!EXECUTION_STATUSES.has(status) || unicodeLength(summary) > MAX_SUMMARY_LENGTH) throw new Error('执行记录不合法');
    const timestamp = now();
    const execution = {
      id: id(), status, summary,
      startedAt: typeof input.startedAt === 'string' ? input.startedAt : timestamp,
      updatedAt: timestamp
    };
    if (typeof input.finishedAt === 'string') execution.finishedAt = input.finishedAt;
    task.executions = [...(task.executions || []), execution].slice(-MAX_EXECUTIONS);
    writeDocument(username, document);
    return cloneExecution(execution);
  }

  function updateExecution(username, taskId, executionId, patch) {
    const document = readDocument(username);
    const task = findTask(document, taskId);
    if (!task) return null;
    const execution = (task.executions || []).find(item => item.id === executionId);
    if (!execution) return null;
    if (patch.status !== undefined && !EXECUTION_STATUSES.has(patch.status)) throw new Error('执行记录不合法');
    if (patch.summary !== undefined && (typeof patch.summary !== 'string' || unicodeLength(patch.summary) > MAX_SUMMARY_LENGTH)) throw new Error('执行摘要不合法');
    if (patch.status !== undefined) execution.status = patch.status;
    if (patch.summary !== undefined) execution.summary = patch.summary;
    if (typeof patch.finishedAt === 'string') execution.finishedAt = patch.finishedAt;
    execution.updatedAt = now();
    writeDocument(username, document);
    return cloneExecution(execution);
  }

  function getExecutions(username, taskId) {
    const task = findTask(readDocument(username), taskId);
    return task ? (task.executions || []).map(cloneExecution) : [];
  }

  return {
    listTasks,
    getTask,
    createTask,
    renameTask,
    append,
    clearTaskMessages,
    deleteTask,
    getCanvas,
    saveCanvas,
    appendExecution,
    updateExecution,
    getExecutions
  };
}

module.exports = { createAgentStore };
