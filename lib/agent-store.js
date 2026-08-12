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

function unicodeLength(value) {
  return Array.from(value).length;
}

function isValidMessage(message) {
  return Boolean(
    message &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    message.content.trim() &&
    message.content.length <= MAX_MESSAGE_LENGTH &&
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
  const effectiveMaxTasks = Math.min(maxTasks, 100);
  const effectiveMaxEntries = Math.min(maxEntries, 100);

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
      return Array.isArray(messages) ? messages.filter(isValidMessage).slice(-effectiveMaxEntries) : [];
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
        messages: messages.map(cloneMessage)
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
        return {
          version: TASK_DOCUMENT_VERSION,
          tasks: document.tasks.slice(0, effectiveMaxTasks).map(task => ({
            ...cloneTask(task),
            messages: task.messages.slice(-effectiveMaxEntries).map(cloneMessage)
          }))
        };
      }
    } catch (error) {
      // A malformed task document is never interpreted as another account's data.
    }
    return { version: TASK_DOCUMENT_VERSION, tasks: [] };
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
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(taskSummary);
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
    if (!['user', 'assistant'].includes(role) || !content || content.length > MAX_MESSAGE_LENGTH) {
      throw new Error('Invalid agent message');
    }
    const document = readDocument(username);
    const task = findTask(document, taskId);
    if (!task) return null;
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

  return {
    listTasks,
    getTask,
    createTask,
    renameTask,
    append,
    clearTaskMessages,
    deleteTask
  };
}

module.exports = { createAgentStore };
